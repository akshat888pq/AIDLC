import { Router } from 'express';
import { getAdapter } from '../services/connectionStore.js';
import { getLLM, getOrCreateSession, loadSession, saveSession } from '../state.js';
import { initSecondBrain, buildSecondBrainContextBlock } from '../services/secondBrain.js';
import { generateTicketHierarchy, countTickets } from '../services/tickets/ticketHierarchy.js';
import type { TicketProviderAdapter } from '../services/tickets/adapter.js';
import type { TicketHierarchyNode, CreatedTicket, TicketCreationSummary } from '../types/index.js';

const router = Router();

function getProvider(req: any): string {
  return (req.query.provider as string) || (req.body?.provider as string) || 'jira';
}

/**
 * Provider connections belong to the workspace, project content belongs to the
 * project. `:sessionId` addresses the connection; `targetSessionId` names the project
 * session the ticket should be filed into, so browsing tickets with a shared
 * connection can never write into the wrong project's context.
 */
function getTargetSessionId(req: any, fallback: string): string {
  return (req.query.targetSessionId as string) || (req.body?.targetSessionId as string) || fallback;
}

// List projects
router.get('/:sessionId/projects', async (req, res) => {
  try {
    const adapter = await getAdapter(req.params.sessionId, getProvider(req));
    if (!adapter) { res.status(400).json({ success: false, error: 'Provider not connected' }); return; }
    const projects = await adapter.getProjects();
    res.json({ success: true, data: projects });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List tickets in a project
router.get('/:sessionId/projects/:projectId/tickets', async (req, res) => {
  try {
    const adapter = await getAdapter(req.params.sessionId, getProvider(req));
    if (!adapter) { res.status(400).json({ success: false, error: 'Provider not connected' }); return; }
    const { type, status, sprint, assignee } = req.query;
    const tickets = await adapter.getTickets(req.params.projectId, {
      type: type as string,
      status: status as string,
      sprint: sprint as string,
      assignee: assignee as string,
    });
    res.json({ success: true, data: tickets });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search tickets
router.get('/:sessionId/projects/:projectId/search', async (req, res) => {
  try {
    const adapter = await getAdapter(req.params.sessionId, getProvider(req));
    if (!adapter) { res.status(400).json({ success: false, error: 'Provider not connected' }); return; }
    const query = req.query.q as string;
    if (!query) { res.status(400).json({ success: false, error: 'q parameter required' }); return; }
    const tickets = await adapter.searchTickets(query, req.params.projectId);
    res.json({ success: true, data: tickets });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single ticket
router.get('/:sessionId/ticket/:ticketId', async (req, res) => {
  try {
    const adapter = await getAdapter(req.params.sessionId, getProvider(req));
    if (!adapter) { res.status(400).json({ success: false, error: 'Provider not connected' }); return; }
    const ticket = await adapter.getTicket(req.params.ticketId);
    res.json({ success: true, data: ticket });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// "Work on this ticket" — feed ticket into analysis pipeline
router.post('/:sessionId/work-on/:ticketId', async (req, res) => {
  try {
    const { sessionId, ticketId } = req.params;
    const targetSessionId = getTargetSessionId(req, sessionId);
    const adapter = await getAdapter(sessionId, getProvider(req));
    if (!adapter) { res.status(400).json({ success: false, error: 'Provider not connected' }); return; }

    const ticket = await adapter.getTicket(ticketId);

    const docContent = [
      `# Ticket: ${ticket.key} — ${ticket.title}`,
      `**Type:** ${ticket.type}`,
      `**Status:** ${ticket.status}`,
      `**Priority:** ${ticket.priority}`,
      ticket.assignee ? `**Assignee:** ${ticket.assignee}` : '',
      '',
      '## Description',
      ticket.description || '_No description_',
      '',
      ticket.acceptanceCriteria ? `## Acceptance Criteria\n${ticket.acceptanceCriteria}` : '',
      ticket.labels.length ? `**Labels:** ${ticket.labels.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    // Store as a virtual parsed file in the project's own session
    const session = getOrCreateSession(targetSessionId);

    const fs = await import('fs/promises');
    const path = await import('path');
    const parsedDir = path.resolve('parsed');
    const fileId = `ticket-${ticket.key}`;
    await fs.writeFile(path.join(parsedDir, `${fileId}.txt`), docContent);

    session.files.push({
      id: fileId,
      originalName: `${ticket.key}: ${ticket.title}`,
      mimeType: 'text/plain',
      size: docContent.length,
      status: 'ready',
    });

    initSecondBrain(targetSessionId, { documents: [`${ticket.key}: ${ticket.title} (ticket)`] });
    saveSession(session);

    res.json({ success: true, data: { ticket, injected: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate ticket hierarchy from analysis
router.post('/:sessionId/generate-hierarchy', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { projectId } = req.body;
    if (!projectId) { res.status(400).json({ success: false, error: 'projectId required' }); return; }

    const session = loadSession(sessionId);
    if (!session || session.analyses.length === 0) {
      res.status(404).json({ success: false, error: 'No analysis found' });
      return;
    }

    const llm = getLLM();
    if (!llm) { res.status(500).json({ success: false, error: 'No LLM configured' }); return; }

    const latestAnalysis = session.analyses[session.analyses.length - 1];
    const result = await generateTicketHierarchy(
      llm,
      latestAnalysis,
      projectId,
      buildSecondBrainContextBlock(sessionId)
    );

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check for duplicates before creating
router.post('/:sessionId/check-duplicates', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { projectId, titles } = req.body;
    const adapter = await getAdapter(sessionId, getProvider(req));
    if (!adapter) { res.status(400).json({ success: false, error: 'Provider not connected' }); return; }

    const llm = getLLM();
    if (!llm) { res.status(500).json({ success: false, error: 'No LLM configured' }); return; }

    const existingTickets = await adapter.getTickets(projectId);

    if (existingTickets.length === 0) {
      res.json({ success: true, data: { duplicates: [] } });
      return;
    }

    const existingList = existingTickets
      .slice(0, 100)
      .map((t) => `[${t.key}] ${t.title} (${t.type})`)
      .join('\n');

    const newList = (titles as string[]).join('\n');

    const prompt = `Compare these NEW ticket titles against EXISTING tickets. Find any that are duplicates or very similar.

EXISTING TICKETS:
${existingList}

NEW TICKETS TO CREATE:
${newList}

Output JSON (no fences):
{
  "duplicates": [
    {
      "newTitle": "the new ticket title",
      "existingKey": "EXISTING-123",
      "existingTitle": "existing ticket title",
      "similarity": 85,
      "reason": "why they're similar"
    }
  ]
}

Rules:
- similarity > 80 = likely duplicate
- similarity 50-80 = worth reviewing
- similarity < 50 = not a duplicate, don't include`;

    const raw = await llm.analyze(prompt, '');
    const jsonStr = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim()
      || raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);

    let parsed: any;
    try { parsed = JSON.parse(jsonStr); } catch { parsed = { duplicates: [] }; }

    res.json({ success: true, data: parsed });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create tickets from hierarchy
router.post('/:sessionId/create-tickets', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { hierarchy, provider } = req.body;
    const adapter = await getAdapter(sessionId, provider || 'jira');
    if (!adapter) { res.status(400).json({ success: false, error: 'Provider not connected' }); return; }

    const created: CreatedTicket[] = [];
    const failed: { title: string; error: string }[] = [];

    async function createTree(nodes: TicketHierarchyNode[], parentId?: string) {
      for (const node of nodes) {
        try {
          const input = { ...node.ticket };
          if (parentId) input.parentId = parentId;

          const ticket = await adapter!.createTicket(input);
          created.push(ticket);
          node.createdTicket = ticket;
          node.status = 'created';

          if (parentId) {
            try { await adapter!.linkTickets(parentId, ticket.id); } catch {}
          }

          if (node.children.length > 0) {
            await createTree(node.children, ticket.id);
          }
        } catch (err: any) {
          node.status = 'failed';
          node.error = err.message;
          failed.push({ title: node.ticket.title, error: err.message });
        }
      }
    }

    await createTree(hierarchy);

    const counts = countTickets(hierarchy);
    const summary: TicketCreationSummary = { ...counts, created, failed };

    res.json({ success: true, data: summary });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
