import type { LLMAdapter } from '../services/llm/adapter.js';
import type { PhaseDiagram, PhaseDoc } from '../types/index.js';
import type { PhaseConfig } from './phaseConfig.js';
import { extractMermaid, looksLikeMermaid, MERMAID_SYNTAX_RULES } from '../prompts/diagramPrompt.js';
import {
  approveDiagram,
  deleteDiagram,
  listDiagramSet,
  readDiagram,
  saveDiagramImage,
  saveEditedDiagram,
  saveGeneratedDiagram,
  skipDiagram,
} from '../services/diagramStore.js';
import { getPhaseDoc } from './engine/phaseDocStore.js';
import { phaseContextBlock, PhaseError, requirePhase } from './engine/index.js';

/**
 * Diagram sets — for phases whose config declares diagramMode: 'set'.
 *
 * A builder turns a phase's approved sections into a list of named diagrams. The
 * design phase's builder is the only one today:
 *
 *   navigation-map          extracted from Section 3's Mermaid navigation map
 *   user-flow-NN-<slug>     one per flow, extracted from Section 4
 *   component-hierarchy     drawn by the model from Sections 3, 6 and 7
 *
 * Extracting beats regenerating: those diagrams were already reviewed as part of
 * their section, so the set shows exactly what the reviewer approved. The model is
 * only asked to draw when a section is missing its diagram, or when a reviewer asks
 * for a change.
 */

export interface DiagramDraft {
  key: string;
  title: string;
  kind: string;
  mermaid: string;
  origin: 'extracted' | 'generated';
}

interface BuilderContext {
  sessionId: string;
  config: PhaseConfig;
  doc: PhaseDoc;
  llm: LLMAdapter;
}

type DiagramSetBuilder = (ctx: BuilderContext) => Promise<DiagramDraft[]>;

/** How to (re)draw one diagram of the set, given reviewer feedback. */
type DiagramRegenerator = (
  ctx: BuilderContext,
  diagram: PhaseDiagram,
  feedback?: string
) => Promise<string>;

// ── Shared helpers ─────────────────────────────────────────────────────────────

function approvedSection(doc: PhaseDoc, key: string): string {
  const s = doc.sections.find((sec) => sec.key === key);
  return s && s.status === 'approved' ? s.content : '';
}

function mermaidBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```mermaid\s*\n([\s\S]*?)```/gi)].map((m) => m[1].trim()).filter(Boolean);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'flow';
}

async function drawWithModel(
  llm: LLMAdapter,
  opts: { instruction: string; material: string; contextBlock: string; previous?: string; feedback?: string }
): Promise<string> {
  const parts = [
    'You are a Senior UX/UI Designer producing a Mermaid diagram for an approved UX/UI design package.',
    opts.instruction,
    MERMAID_SYNTAX_RULES,
    opts.contextBlock,
    `--- SOURCE (approved design package content) ---\n${opts.material}\n--- END SOURCE ---`,
  ];
  if (opts.previous) parts.push(`--- THE CURRENT DIAGRAM ---\n${opts.previous}\n--- END CURRENT DIAGRAM ---`);
  if (opts.feedback) {
    parts.push(
      `--- REVIEWER FEEDBACK ---\n"${opts.feedback}"\nProduce a new version that addresses every point and keeps everything the reviewer did not object to.`
    );
  }
  parts.push('Output ONLY the raw Mermaid syntax. No prose, no ``` fences.');

  const mermaid = extractMermaid(await llm.analyze(parts.join('\n\n'), ''));
  if (!mermaid || !looksLikeMermaid(mermaid)) {
    throw new PhaseError('The model did not return Mermaid syntax. Try again, or edit the diagram by hand.', 502);
  }
  return mermaid;
}

// ── Design phase ───────────────────────────────────────────────────────────────

const NAV_INSTRUCTION = `Draw the NAVIGATION MAP of the application from the Information Architecture.
Every screen in the screen inventory is a node labelled "SCR-00n Name". Group screens
into subgraph blocks by module. Arrows are navigation paths; edge labels are the user
actions that cause them ("Sign in", "Open row", "Save"). Use "flowchart LR".`;

const FLOW_INSTRUCTION = `Draw ONE user flow as "flowchart TD": a stadium start node for the trigger, a node per
step, diamond decision nodes {"..."} for every validation or branch, and a stadium end
node for the success state. Error paths branch off the decisions and loop back where
the flow says they do. End with exactly these lines, assigning every node to one class:
  classDef happy fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef error fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  class <happy-path node ids> happy
  class <error node ids> error`;

const HIERARCHY_INSTRUCTION = `Draw the COMPONENT HIERARCHY of the frontend as "flowchart TD":
App → layout shells (e.g. AuthLayout, AppShell with sidebar/header) → page components
(one per screen, labelled "SCR-00n Name") → the composite components each page uses →
the design-system primitives they are built from (ShadCN Button, Card, Table, Dialog…).
Put the design-system primitives in a subgraph titled with the design system's name and
custom components in a subgraph "Custom components". Reuse one node per primitive —
many pages point at the same Card. Keep it readable: at most about 45 nodes; if there are
many screens, group pages into one subgraph per module.`;

function splitFlows(section4: string): { id: string; name: string; body: string }[] {
  const lines = section4.split(/\r?\n/);
  const flows: { id: string; name: string; body: string }[] = [];
  let current: { id: string; name: string; start: number } | null = null;

  const close = (end: number) => {
    if (current) flows.push({ id: current.id, name: current.name, body: lines.slice(current.start, end).join('\n') });
  };
  lines.forEach((line, i) => {
    const m = line.match(/^#{3,4}\s+(UF-\d+)\s*[:—–-]?\s*(.*)$/i);
    if (m) {
      close(i);
      current = { id: m[1].toUpperCase(), name: m[2].trim() || m[1].toUpperCase(), start: i };
    }
  });
  close(lines.length);
  return flows;
}

const designBuilder: DiagramSetBuilder = async ({ sessionId, config, doc, llm }) => {
  const ia = approvedSection(doc, 'information_architecture');
  const flowsSection = approvedSection(doc, 'user_flows');
  const designSystem = approvedSection(doc, 'design_system');
  const screens = approvedSection(doc, 'screen_definitions');

  if (!ia) {
    throw new PhaseError('Approve Section 3 (Information Architecture) before building the design diagrams.', 409);
  }

  const contextBlock = phaseContextBlock(sessionId, config.id);
  const drafts: DiagramDraft[] = [];

  // 1. Navigation map
  const navBlock = mermaidBlocks(ia).find(looksLikeMermaid);
  drafts.push({
    key: 'navigation-map',
    title: 'Navigation Map',
    kind: 'navigation',
    mermaid: navBlock ?? (await drawWithModel(llm, { instruction: NAV_INSTRUCTION, material: ia, contextBlock })),
    origin: navBlock ? 'extracted' : 'generated',
  });

  // 2. One diagram per user flow
  splitFlows(flowsSection).forEach((flow, i) => {
    const block = mermaidBlocks(flow.body).find(looksLikeMermaid);
    drafts.push({
      key: `user-flow-${String(i + 1).padStart(2, '0')}-${slug(flow.name)}`,
      title: `${flow.id} · ${flow.name}`,
      kind: 'user-flow',
      mermaid: block ?? '',
      origin: block ? 'extracted' : 'generated',
    });
  });
  for (const [i, draft] of drafts.entries()) {
    if (draft.kind !== 'user-flow' || draft.mermaid) continue;
    const flow = splitFlows(flowsSection)[i - 1];
    drafts[i].mermaid = await drawWithModel(llm, { instruction: FLOW_INSTRUCTION, material: flow.body, contextBlock });
  }

  // 3. Component hierarchy
  if (designSystem || screens) {
    drafts.push({
      key: 'component-hierarchy',
      title: 'Component Hierarchy',
      kind: 'component-hierarchy',
      mermaid: await drawWithModel(llm, {
        instruction: HIERARCHY_INSTRUCTION,
        material: [ia, designSystem, screens].filter(Boolean).join('\n\n'),
        contextBlock,
      }),
      origin: 'generated',
    });
  }

  return drafts;
};

const designRegenerator: DiagramRegenerator = async ({ sessionId, config, doc, llm }, diagram, feedback) => {
  const contextBlock = phaseContextBlock(sessionId, config.id);
  const ia = approvedSection(doc, 'information_architecture');

  if (diagram.kind === 'navigation') {
    return drawWithModel(llm, { instruction: NAV_INSTRUCTION, material: ia, contextBlock, previous: diagram.mermaid, feedback });
  }
  if (diagram.kind === 'user-flow') {
    const id = diagram.title?.match(/UF-\d+/i)?.[0]?.toUpperCase();
    const flow = splitFlows(approvedSection(doc, 'user_flows')).find((f) => f.id === id);
    return drawWithModel(llm, {
      instruction: FLOW_INSTRUCTION,
      material: flow?.body ?? approvedSection(doc, 'user_flows'),
      contextBlock,
      previous: diagram.mermaid,
      feedback,
    });
  }
  return drawWithModel(llm, {
    instruction: HIERARCHY_INSTRUCTION,
    material: [ia, approvedSection(doc, 'design_system'), approvedSection(doc, 'screen_definitions')].filter(Boolean).join('\n\n'),
    contextBlock,
    previous: diagram.mermaid,
    feedback,
  });
};

const builders: Record<string, { build: DiagramSetBuilder; regenerate: DiagramRegenerator }> = {
  design: { build: designBuilder, regenerate: designRegenerator },
};

// ── Public API (used by the phase routes) ──────────────────────────────────────

function requireSetPhase(phaseId: string): PhaseConfig {
  const config = requirePhase(phaseId);
  if (config.comingSoon) throw new PhaseError(`The ${config.name} phase is not available yet.`, 409);
  if (config.diagramMode !== 'set' || !builders[phaseId]) {
    throw new PhaseError(`The ${config.name} phase does not use a diagram set.`, 400);
  }
  return config;
}

function requireDoc(sessionId: string, config: PhaseConfig): PhaseDoc {
  const doc = getPhaseDoc(sessionId, config.id);
  if (!doc) throw new PhaseError('No document exists for this phase yet', 404);
  return doc;
}

function requireMember(sessionId: string, phaseId: string, key: string): PhaseDiagram {
  const diagram = readDiagram(sessionId, phaseId, key);
  if (!diagram.mermaid.trim()) throw new PhaseError(`Diagram "${key}" does not exist. Build the diagram set first.`, 404);
  return diagram;
}

export function getDiagramSet(sessionId: string, phaseId: string): PhaseDiagram[] {
  requireSetPhase(phaseId);
  return listDiagramSet(sessionId, phaseId);
}

/**
 * Build (or rebuild) the whole set from the approved sections. A diagram whose source
 * has not changed keeps its approval; diagrams the rebuild no longer produces — a flow
 * removed from Section 4 — are deleted rather than left behind.
 */
export async function buildDiagramSet(sessionId: string, phaseId: string, llm: LLMAdapter): Promise<PhaseDiagram[]> {
  const config = requireSetPhase(phaseId);
  const doc = requireDoc(sessionId, config);
  const drafts = await builders[phaseId].build({ sessionId, config, doc, llm });

  const keep = new Set(drafts.map((d) => d.key));
  for (const existing of listDiagramSet(sessionId, phaseId)) {
    if (existing.key && !keep.has(existing.key)) deleteDiagram(sessionId, phaseId, existing.key);
  }

  for (const draft of drafts) {
    const existing = readDiagram(sessionId, phaseId, draft.key);
    // Re-extracting identical source must not throw away an approval.
    if (draft.origin === 'extracted' && existing.mermaid.trim() === draft.mermaid.trim() && existing.status !== 'none') {
      continue;
    }
    saveGeneratedDiagram(sessionId, phaseId, draft.mermaid, draft.key, {
      title: draft.title,
      kind: draft.kind,
      origin: draft.origin,
    });
  }

  console.log(`[phase:${phaseId}] session=${sessionId} diagram set: ${drafts.map((d) => `${d.key}(${d.origin})`).join(', ')}`);
  return listDiagramSet(sessionId, phaseId);
}

export async function regenerateSetDiagram(
  sessionId: string,
  phaseId: string,
  key: string,
  llm: LLMAdapter,
  feedback?: string
): Promise<PhaseDiagram> {
  const config = requireSetPhase(phaseId);
  const doc = requireDoc(sessionId, config);
  const diagram = requireMember(sessionId, phaseId, key);
  const mermaid = await builders[phaseId].regenerate({ sessionId, config, doc, llm }, diagram, feedback?.trim() || undefined);
  return saveGeneratedDiagram(sessionId, phaseId, mermaid, key, { origin: 'generated' });
}

export function saveSetDiagram(sessionId: string, phaseId: string, key: string, mermaid: string): PhaseDiagram {
  requireSetPhase(phaseId);
  requireMember(sessionId, phaseId, key);
  return saveEditedDiagram(sessionId, phaseId, mermaid, key);
}

export function approveSetDiagram(sessionId: string, phaseId: string, key: string, mermaid?: string): PhaseDiagram {
  requireSetPhase(phaseId);
  requireMember(sessionId, phaseId, key);
  return approveDiagram(sessionId, phaseId, mermaid, key);
}

export function skipSetDiagram(sessionId: string, phaseId: string, key: string): PhaseDiagram {
  requireSetPhase(phaseId);
  requireMember(sessionId, phaseId, key);
  return skipDiagram(sessionId, phaseId, key);
}

export function storeSetDiagramImage(sessionId: string, phaseId: string, key: string, jpg: Buffer): PhaseDiagram {
  requireSetPhase(phaseId);
  requireMember(sessionId, phaseId, key);
  try {
    return saveDiagramImage(sessionId, phaseId, key, jpg);
  } catch (err: any) {
    throw new PhaseError(err.message, 400);
  }
}
