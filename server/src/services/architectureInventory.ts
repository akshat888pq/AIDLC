import type { LLMAdapter } from './llm/adapter.js';
import { parseLlmJson } from './sessionContext.js';

/**
 * Structured extraction of an approved architecture document.
 *
 * The architecture document is prose; a delivery team needs it as a table they can
 * sort, filter and assign. This pulls the components, the decisions and the
 * traceability out of the markdown that a human already approved — so nothing here
 * invents architecture, it only re-shapes what was signed off.
 */

export interface ArchitectureComponent {
  id: string;
  name: string;
  type: string;
  responsibility: string;
  technology: string;
  dataStores: string;
  dependencies: string;
  interfaces: string;
  nfrs: string;
  tracesTo: string;
  risks: string;
}

export interface ArchitectureDecisionRow {
  id: string;
  title: string;
  status: string;
  decision: string;
  rationale: string;
  alternatives: string;
  consequences: string;
  drivenBy: string;
}

export interface TraceabilityRow {
  requirementId: string;
  requirement: string;
  components: string;
  decisions: string;
  section: string;
}

export interface ArchitectureInventory {
  components: ArchitectureComponent[];
  decisions: ArchitectureDecisionRow[];
  traceability: TraceabilityRow[];
}

const EXTRACTION_PROMPT = `You are a Solution Architect extracting a structured inventory from an architecture
document that a human has already approved.

Read the architecture document and produce a machine-readable inventory of what it
describes. You are EXTRACTING, not designing: every value must come from the document.
Where the document genuinely does not say, write "Not specified". Never invent a
component, a technology or a requirement id that does not appear in the document.

Output raw JSON only (no markdown fences, no commentary) with this exact structure:
{
  "components": [
    {
      "id": "C-001",
      "name": "Invoice API",
      "type": "service | ui | datastore | integration | job | gateway | other",
      "responsibility": "The single responsibility of this component, one sentence",
      "technology": "The named technology, e.g. 'Node.js 20 + Express on AWS Fargate'",
      "dataStores": "Data stores it owns or reads, comma separated",
      "dependencies": "Other components or external systems it depends on, comma separated",
      "interfaces": "APIs / queues / events it exposes or consumes",
      "nfrs": "NFRs that bind this component (latency, availability, throughput)",
      "tracesTo": "Requirement or story ids this component satisfies, comma separated",
      "risks": "Known risks for this component, or 'None recorded'"
    }
  ],
  "decisions": [
    {
      "id": "ADR-001",
      "title": "Short decision title",
      "status": "Accepted | Proposed | Superseded",
      "decision": "What was decided",
      "rationale": "Why",
      "alternatives": "What else was considered",
      "consequences": "What this commits the team to",
      "drivenBy": "Requirement id or NFR that drove it"
    }
  ],
  "traceability": [
    {
      "requirementId": "FR-001",
      "requirement": "Short restatement of the requirement",
      "components": "Component ids that address it",
      "decisions": "ADR ids that address it",
      "section": "Architecture section number(s) where it is addressed"
    }
  ]
}

Rules:
- Extract EVERY component the document names, including data stores and integrations.
- Extract every ADR the document contains. If the document has no ADR section, derive
  the decisions from the Technology Stack and Component sections and mark status
  "Accepted".
- The traceability rows must use the requirement ids that actually appear in the
  document. If the document contains no traceability matrix, return an empty array
  rather than fabricating ids.
- Return valid JSON and nothing else.`;

function str(value: any, fallback = 'Not specified'): string {
  if (Array.isArray(value)) {
    const joined = value.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
    return joined || fallback;
  }
  const text = String(value ?? '').trim();
  return text || fallback;
}

export async function extractArchitectureInventory(
  llm: LLMAdapter,
  architectureMarkdown: string,
  contextBlock: string
): Promise<ArchitectureInventory> {
  const prompt = [EXTRACTION_PROMPT, contextBlock].filter(Boolean).join('\n\n---\n\n');
  const raw = await llm.analyze(prompt, architectureMarkdown);
  const parsed = parseLlmJson<any>(raw, 'architecture inventory');

  const components: ArchitectureComponent[] = (Array.isArray(parsed.components) ? parsed.components : []).map(
    (c: any, i: number) => ({
      id: str(c.id, `C-${String(i + 1).padStart(3, '0')}`),
      name: str(c.name, `Component ${i + 1}`),
      type: str(c.type, 'other'),
      responsibility: str(c.responsibility),
      technology: str(c.technology),
      dataStores: str(c.dataStores, 'None'),
      dependencies: str(c.dependencies, 'None'),
      interfaces: str(c.interfaces, 'None'),
      nfrs: str(c.nfrs),
      tracesTo: str(c.tracesTo, 'Not traced'),
      risks: str(c.risks, 'None recorded'),
    })
  );

  if (components.length === 0) {
    throw new Error(
      'No components could be extracted from the architecture document. Generate and approve the component architecture section first.'
    );
  }

  const decisions: ArchitectureDecisionRow[] = (Array.isArray(parsed.decisions) ? parsed.decisions : []).map(
    (d: any, i: number) => ({
      id: str(d.id, `ADR-${String(i + 1).padStart(3, '0')}`),
      title: str(d.title, `Decision ${i + 1}`),
      status: str(d.status, 'Accepted'),
      decision: str(d.decision),
      rationale: str(d.rationale),
      alternatives: str(d.alternatives, 'None recorded'),
      consequences: str(d.consequences),
      drivenBy: str(d.drivenBy, 'Not traced'),
    })
  );

  const traceability: TraceabilityRow[] = (Array.isArray(parsed.traceability) ? parsed.traceability : []).map(
    (t: any) => ({
      requirementId: str(t.requirementId, '—'),
      requirement: str(t.requirement),
      components: str(t.components, 'None'),
      decisions: str(t.decisions, 'None'),
      section: str(t.section, '—'),
    })
  );

  return { components, decisions, traceability };
}

// ── Ticket updates ─────────────────────────────────────────────────────────────

export interface StoryArchitectureUpdate {
  storyId: string;
  storyTitle: string;
  components: string;
  technicalNotes: string;
  decisions: string;
  technicalTasks: string[];
  risks: string;
}

const TICKET_UPDATE_PROMPT = `You are a Solution Architect preparing ticket updates after an architecture has been
approved.

You are given the approved architecture document and the user stories produced in the
requirement phase. For EACH user story, write the architecture context a developer
picking that story up would need: which components it touches, which architecture
decisions constrain it, what technical tasks it implies, and what could bite them.

You are annotating existing stories. Do NOT invent new stories, do NOT change their
scope, and do NOT contradict the architecture.

Output raw JSON only (no markdown fences, no commentary):
{
  "updates": [
    {
      "storyId": "US-001",
      "storyTitle": "The story's existing title, unchanged",
      "components": "Component names from the architecture this story touches, comma separated",
      "technicalNotes": "2-4 sentences of implementation guidance grounded in the architecture",
      "decisions": "ADR ids / decisions that constrain this story, comma separated",
      "technicalTasks": ["Concrete technical sub-task", "..."],
      "risks": "What is likely to go wrong, or 'None identified'"
    }
  ]
}

Rules:
- One entry per story given to you, in the same order, using the SAME story ids.
- Reference only components and decisions that appear in the architecture document.
- If a story touches no architecture component, say so plainly rather than guessing.
- Return valid JSON and nothing else.`;

export async function generateStoryArchitectureUpdates(
  llm: LLMAdapter,
  architectureMarkdown: string,
  storiesJson: string,
  contextBlock: string
): Promise<StoryArchitectureUpdate[]> {
  const prompt = [TICKET_UPDATE_PROMPT, contextBlock].filter(Boolean).join('\n\n---\n\n');
  const content = `=== APPROVED ARCHITECTURE DOCUMENT ===\n${architectureMarkdown}\n\n=== USER STORIES ===\n${storiesJson}`;

  const raw = await llm.analyze(prompt, content);
  const parsed = parseLlmJson<any>(raw, 'story architecture updates');

  const updates = Array.isArray(parsed.updates) ? parsed.updates : [];
  if (updates.length === 0) {
    throw new Error('The model returned no ticket updates. Try generating the deliverable again.');
  }

  return updates.map((u: any, i: number) => ({
    storyId: str(u.storyId, `US-${String(i + 1).padStart(3, '0')}`),
    storyTitle: str(u.storyTitle, `Story ${i + 1}`),
    components: str(u.components, 'None'),
    technicalNotes: str(u.technicalNotes),
    decisions: str(u.decisions, 'None'),
    technicalTasks: Array.isArray(u.technicalTasks)
      ? u.technicalTasks.map((t: any) => String(t ?? '').trim()).filter(Boolean)
      : [],
    risks: str(u.risks, 'None identified'),
  }));
}
