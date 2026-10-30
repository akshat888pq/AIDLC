import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { getLLM, loadSession } from '../state.js';
import { getSectionPrompt, type SectionContext } from '../prompts/sections/index.js';
import { assembleRequirement } from '../prompts/sections/assembler.js';
import {
  createRequirement,
  getRequirement,
  getLatestRequirement,
  getRequirementsForProject,
  updateSectionContent,
  approveSection,
  skipSection,
  revertSection,
  finalizeRequirement,
} from '../services/requirementStore.js';
import { updateProject } from '../services/projectStore.js';
import { buildSecondBrainContextBlock, getStatus } from '../services/secondBrain.js';

const router = Router();

// List all requirements for a project (by sessionId)
router.get('/project/:sessionId/list', (req, res) => {
  try {
    const docs = getRequirementsForProject(req.params.sessionId);
    res.json({ success: true, data: docs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Initialize a new requirement doc from session analysis
router.post('/:sessionId/init', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = loadSession(sessionId);
    if (!session || session.analyses.length === 0) {
      res.status(404).json({ success: false, error: 'No analysis found for this session' });
      return;
    }

    const existing = getLatestRequirement(sessionId);
    if (existing && existing.status === 'in-progress') {
      res.json({ success: true, data: existing });
      return;
    }

    // Human-in-the-loop gate: requirements may only be generated from an
    // understanding a human has signed off on.
    const brainStatus = getStatus(sessionId);
    if (brainStatus.exists && brainStatus.approvalStatus !== 'approved') {
      res.status(403).json({
        success: false,
        error: 'The project understanding must be approved by a human before requirements can be generated.',
      });
      return;
    }

    const latest = session.analyses[session.analyses.length - 1];
    const sourceDocuments = session.files.filter((f) => f.status === 'ready').map((f) => f.originalName);
    const projectName = latest.understanding.projectOverview.split('.')[0].slice(0, 80) || 'Untitled Project';

    const doc = createRequirement(sessionId, projectName, sourceDocuments, [], latest.confidenceScore);
    res.json({ success: true, data: doc });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get current requirement
router.get('/:sessionId/:reqId', (req, res) => {
  const doc = getRequirement(req.params.sessionId, req.params.reqId);
  if (!doc) { res.status(404).json({ success: false, error: 'Requirement not found' }); return; }
  res.json({ success: true, data: doc });
});

// Get latest requirement for session
router.get('/:sessionId', (req, res) => {
  const doc = getLatestRequirement(req.params.sessionId);
  if (!doc) { res.status(404).json({ success: false, error: 'No requirement found' }); return; }
  res.json({ success: true, data: doc });
});

// Generate a section
router.post('/:sessionId/:reqId/generate', async (req, res) => {
  try {
    const { sessionId, reqId } = req.params;
    const { sectionNumber, feedback } = req.body;

    const doc = getRequirement(sessionId, reqId);
    if (!doc) { res.status(404).json({ success: false, error: 'Requirement not found' }); return; }

    const session = loadSession(sessionId);
    if (!session || session.analyses.length === 0) {
      res.status(404).json({ success: false, error: 'Session analysis not found' });
      return;
    }

    const llm = getLLM();
    if (!llm) { res.status(500).json({ success: false, error: 'No LLM configured' }); return; }

    // Build context
    const parsedDir = path.resolve('parsed');
    const readyFiles = session.files.filter((f) => f.status === 'ready');
    const contentParts: string[] = [];
    for (const file of readyFiles) {
      try {
        const text = await fs.readFile(path.join(parsedDir, `${file.id}.txt`), 'utf-8');
        contentParts.push(`=== FILE: ${file.originalName} ===\n${text}`);
      } catch {}
    }

    const latestAnalysis = session.analyses[session.analyses.length - 1];
    const answeredQs = latestAnalysis.questions
      .filter((q) => q.status === 'answered')
      .map((q) => `Q: ${q.question}\nA: ${Array.isArray(q.answer) ? q.answer.join(', ') : q.answer}`)
      .join('\n\n');

    const previousSections: Record<string, string> = {};
    for (const s of doc.sections) {
      if (s.status === 'approved' && s.content) {
        previousSections[String(s.number)] = s.content;
      }
    }

    const sectionContext: SectionContext = {
      parsedDocuments: contentParts.join('\n\n'),
      qnaAnswers: answeredQs,
      secondBrainContext: buildSecondBrainContextBlock(sessionId),
      previousSections,
      userFeedback: feedback || undefined,
      sourceFileNames: doc.sourceDocuments,
      linkedTicketIds: doc.linkedTickets,
      requirementId: doc.id,
      confidenceScore: doc.confidenceScore,
    };

    const section = doc.sections.find((s) => s.number === sectionNumber);
    if (!section) { res.status(400).json({ success: false, error: 'Invalid section number' }); return; }

    section.status = 'generating';

    const prompt = getSectionPrompt(sectionNumber, sectionContext);
    const content = await llm.analyze(prompt, '');

    const updated = updateSectionContent(doc, sectionNumber, content.trim(), feedback);
    const updatedSection = updated.sections.find((s) => s.number === sectionNumber)!;

    res.json({
      success: true,
      data: {
        sectionNumber,
        content: updatedSection.content,
        version: updatedSection.versions.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Approve a section
router.post('/:sessionId/:reqId/approve', (req, res) => {
  try {
    const { sessionId, reqId } = req.params;
    const { sectionNumber, content } = req.body;

    const doc = getRequirement(sessionId, reqId);
    if (!doc) { res.status(404).json({ success: false, error: 'Requirement not found' }); return; }

    const updated = approveSection(doc, sectionNumber, content);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Skip a section
router.post('/:sessionId/:reqId/skip', (req, res) => {
  try {
    const { sessionId, reqId } = req.params;
    const { sectionNumber } = req.body;

    const doc = getRequirement(sessionId, reqId);
    if (!doc) { res.status(404).json({ success: false, error: 'Requirement not found' }); return; }

    const updated = skipSection(doc, sectionNumber);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Revert a section to a previous version
router.post('/:sessionId/:reqId/revert', (req, res) => {
  try {
    const { sessionId, reqId } = req.params;
    const { sectionNumber, version } = req.body;

    const doc = getRequirement(sessionId, reqId);
    if (!doc) { res.status(404).json({ success: false, error: 'Requirement not found' }); return; }

    const updated = revertSection(doc, sectionNumber, version);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Assemble full requirement
router.get('/:sessionId/:reqId/assemble', (req, res) => {
  try {
    const doc = getRequirement(req.params.sessionId, req.params.reqId);
    if (!doc) { res.status(404).json({ success: false, error: 'Requirement not found' }); return; }

    const markdown = assembleRequirement(doc);
    res.json({ success: true, data: { markdown, doc } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download as markdown
router.get('/:sessionId/:reqId/download', (req, res) => {
  try {
    const doc = getRequirement(req.params.sessionId, req.params.reqId);
    if (!doc) { res.status(404).json({ success: false, error: 'Requirement not found' }); return; }

    const markdown = assembleRequirement(doc);
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.id}-requirement-${date}.md"`);
    res.send(markdown);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Finalize requirement
router.post('/:sessionId/:reqId/finalize', (req, res) => {
  try {
    const doc = getRequirement(req.params.sessionId, req.params.reqId);
    if (!doc) { res.status(404).json({ success: false, error: 'Requirement not found' }); return; }

    const markdown = assembleRequirement(doc);
    const savedPath = finalizeRequirement(doc, markdown);

    const { projectId } = req.body || {};
    if (projectId) {
      const allReqs = getRequirementsForProject(req.params.sessionId);
      const approved = allReqs.filter((r) => r.status === 'finalized' || r.status === 'approved').length;
      updateProject(projectId, {
        requirementCount: allReqs.length,
        approvedCount: approved,
        lastActivity: new Date().toISOString(),
      });
    }

    res.json({ success: true, data: { savedPath, requirementId: doc.id, markdown } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
