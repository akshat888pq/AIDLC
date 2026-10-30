import type { LLMAdapter } from '../llm/adapter.js';
import type { AnalysisResult, TicketHierarchyNode, CreateTicketInput } from '../../types/index.js';

const HIERARCHY_PROMPT = `You are a project management expert. Given a project understanding and requirements, create a work item hierarchy for a ticket management system.

RULES FOR DECIDING HIERARCHY:
- If the requirement has 5+ functional requirements OR spans multiple systems → create Epic + Features + Stories + Tasks
- If the requirement has 2-4 functional requirements → create Feature + Stories + Tasks
- If the requirement has 1 functional requirement → create Story + Tasks
- Each ticket must have a clear, action-oriented title
- Descriptions should be detailed enough for a developer to understand the work
- Acceptance criteria must be testable
- Story points should reflect relative complexity (1=trivial, 2=small, 3=medium, 5=large, 8=very large, 13=epic-sized)
- Priority: critical, high, medium, low
- Label every ticket with "AIDLC-generated"

Output JSON (no markdown fences):
{
  "reasoning": "Explain why you chose this hierarchy structure",
  "hierarchy": [
    {
      "tempId": "T1",
      "title": "Epic/Feature/Story title",
      "type": "epic|feature|story|task",
      "description": "Detailed description",
      "acceptanceCriteria": "- [ ] Criterion 1\\n- [ ] Criterion 2",
      "priority": "critical|high|medium|low",
      "storyPoints": 5,
      "labels": ["AIDLC-generated"],
      "children": [
        {
          "tempId": "T1.1",
          "title": "Child ticket title",
          "type": "feature|story|task",
          "description": "...",
          "acceptanceCriteria": "...",
          "priority": "...",
          "storyPoints": 3,
          "labels": ["AIDLC-generated"],
          "children": []
        }
      ]
    }
  ]
}`;

function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) return raw.slice(braceStart, braceEnd + 1);
  return raw;
}

function buildNode(item: any, projectId: string): TicketHierarchyNode {
  return {
    tempId: item.tempId,
    ticket: {
      title: item.title,
      description: item.description || '',
      type: item.type,
      priority: item.priority || 'medium',
      labels: item.labels || ['AIDLC-generated'],
      storyPoints: item.storyPoints,
      acceptanceCriteria: item.acceptanceCriteria,
      projectId,
    },
    children: (item.children || []).map((c: any) => buildNode(c, projectId)),
    status: 'pending',
  };
}

export async function generateTicketHierarchy(
  llm: LLMAdapter,
  analysis: AnalysisResult,
  projectId: string,
  secondBrainContext?: string,
): Promise<{ reasoning: string; hierarchy: TicketHierarchyNode[] }> {
  const u = analysis.understanding;

  const context = `
PROJECT: ${u.projectOverview}
BUSINESS OBJECTIVE: ${u.businessObjective}
SCOPE (In): ${u.scope.inScope.join('; ')}
SCOPE (Out): ${u.scope.outOfScope.join('; ')}
DELIVERABLES: ${u.deliverables.join('; ')}
TECH STACK: ${u.techStack}
CONSTRAINTS: ${u.constraints.join('; ')}
TIMELINE: ${u.timeline}

ANSWERED QUESTIONS:
${analysis.questions
  .filter((q) => q.status === 'answered')
  .map((q) => `Q: ${q.question}\nA: ${Array.isArray(q.answer) ? q.answer.join(', ') : q.answer}`)
  .join('\n\n')}`;

  const systemPrompt = secondBrainContext
    ? `${HIERARCHY_PROMPT}\n\n---\n\n${secondBrainContext}`
    : HIERARCHY_PROMPT;

  const raw = await llm.analyze(systemPrompt, context);
  const jsonStr = extractJson(raw);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse hierarchy response: ${raw.slice(0, 300)}`);
  }

  const hierarchy = (parsed.hierarchy || []).map((item: any) => buildNode(item, projectId));

  return {
    reasoning: parsed.reasoning || 'Hierarchy generated based on requirement complexity.',
    hierarchy,
  };
}

export function countTickets(nodes: TicketHierarchyNode[]): { epics: number; features: number; stories: number; tasks: number; total: number } {
  let epics = 0, features = 0, stories = 0, tasks = 0;

  function walk(node: TicketHierarchyNode) {
    switch (node.ticket.type) {
      case 'epic': epics++; break;
      case 'feature': features++; break;
      case 'story': stories++; break;
      case 'task': case 'subtask': tasks++; break;
    }
    node.children.forEach(walk);
  }

  nodes.forEach(walk);
  return { epics, features, stories, tasks, total: epics + features + stories + tasks };
}
