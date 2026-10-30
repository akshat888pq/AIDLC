import fs from 'fs';
import path from 'path';
import type {
  SecondBrainData,
  SecondBrainStatus,
  QnaRecord,
  UnderstandingSummary,
  EpicStoriesResult,
  ProjectUnderstanding,
  PhaseInputFromPreviousPhase,
  SectionLogEntry,
  PhaseKnowledgeBlock,
} from '../types/index.js';

/**
 * The Second Brain is the single source of truth for a project session.
 *
 * Two files are kept side by side:
 *   - second-brain.md    human-readable, the artifact the team reads and reviews
 *   - second-brain.json  the structured mirror the server reads/writes
 *
 * The markdown file is always re-rendered from the JSON on every mutation, so the
 * two can never drift. Parsing markdown back into structure would be fragile, so
 * the JSON is authoritative for machine reads while the markdown is authoritative
 * for the LLM context block and for humans.
 *
 * ── Phases ──
 * Every phase (requirement, architecture, …) owns its OWN brain, and can read the
 * brains of all the phases before it (see buildFullContextBlock). Layout:
 *
 *   projects/<sessionId>/
 *     context/                     ← the requirement phase's brain (unchanged)
 *     reports/                     ← the requirement phase's reports (unchanged)
 *     phases/requirement/          ← read-only mirror of context/ + the output doc
 *     phases/architecture/         ← the architecture phase's own brain, doc, reports
 *
 * The requirement phase deliberately keeps writing to context/: that path is what
 * every existing route, report and download already reads, and moving it would
 * break projects that are mid-flight. The mirror under phases/requirement/ exists
 * so downstream phases and the UI can use one uniform path shape.
 */

export const MAX_QUESTION_CYCLES = 2;

/** The phase whose brain lives at the legacy `context/` path. */
export const DEFAULT_PHASE_ID = 'requirement';

const PROJECTS_DIR = path.resolve('projects');

function sessionDir(sessionId: string): string {
  return path.join(PROJECTS_DIR, sessionId);
}

/** Home of a phase's own files: brain, output document, reports. */
export function phaseDir(sessionId: string, phaseId: string): string {
  return path.join(sessionDir(sessionId), 'phases', phaseId);
}

function contextDir(sessionId: string, phaseId: string = DEFAULT_PHASE_ID): string {
  return phaseId === DEFAULT_PHASE_ID
    ? path.join(sessionDir(sessionId), 'context')
    : phaseDir(sessionId, phaseId);
}

export function secondBrainMdPath(sessionId: string, phaseId: string = DEFAULT_PHASE_ID): string {
  return path.join(contextDir(sessionId, phaseId), 'second-brain.md');
}

function secondBrainJsonPath(sessionId: string, phaseId: string = DEFAULT_PHASE_ID): string {
  return path.join(contextDir(sessionId, phaseId), 'second-brain.json');
}

export function reportsDir(sessionId: string, phaseId: string = DEFAULT_PHASE_ID): string {
  return phaseId === DEFAULT_PHASE_ID
    ? path.join(sessionDir(sessionId), 'reports')
    : path.join(phaseDir(sessionId, phaseId), 'reports');
}

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function emptyBrain(sessionId: string, phaseId: string = DEFAULT_PHASE_ID): SecondBrainData {
  const now = new Date().toISOString();
  return {
    sessionId,
    phaseId,
    projectName: 'Untitled Project',
    createdAt: now,
    lastUpdated: now,
    sourceDocuments: [],
    documentUnderstanding: '',
    confidenceScore: 0,
    cycleCount: 0,
    qna: [],
    confirmedFacts: [],
    assumptions: [],
    openItems: [],
    humanInputs: [],
    approval: { status: 'pending' },
  };
}

// ── Read / write ───────────────────────────────────────────────────────────────

export function exists(sessionId: string, phaseId: string = DEFAULT_PHASE_ID): boolean {
  return fs.existsSync(secondBrainJsonPath(sessionId, phaseId));
}

export function readBrain(
  sessionId: string,
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData | null {
  const p = secondBrainJsonPath(sessionId, phaseId);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as SecondBrainData;
    // Defensive defaults — a brain written by an older build may miss fields.
    return {
      ...emptyBrain(sessionId, phaseId),
      ...parsed,
      phaseId: parsed.phaseId ?? phaseId,
      approval: parsed.approval ?? { status: 'pending' },
    };
  } catch (err: any) {
    console.error(`[secondBrain] corrupt brain for session=${sessionId} phase=${phaseId}: ${err.message}`);
    return null;
  }
}

/** Read the brain, creating it if it does not exist yet. */
export function getOrCreateBrain(
  sessionId: string,
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  const existing = readBrain(sessionId, phaseId);
  if (existing) return existing;
  const fresh = emptyBrain(sessionId, phaseId);
  writeBrain(fresh);
  return fresh;
}

function writeBrain(brain: SecondBrainData): SecondBrainData {
  const phaseId = brain.phaseId ?? DEFAULT_PHASE_ID;
  brain.lastUpdated = new Date().toISOString();
  const dir = contextDir(brain.sessionId, phaseId);
  ensureDir(dir);
  const markdown = renderMarkdown(brain);
  fs.writeFileSync(secondBrainJsonPath(brain.sessionId, phaseId), JSON.stringify(brain, null, 2), 'utf-8');
  fs.writeFileSync(secondBrainMdPath(brain.sessionId, phaseId), markdown, 'utf-8');

  // Keep the uniform phases/<id>/ layout populated for the phase whose brain lives
  // at the legacy path. The mirror is never read back as authoritative.
  if (phaseId === DEFAULT_PHASE_ID) {
    try {
      const mirrorDir = phaseDir(brain.sessionId, phaseId);
      ensureDir(mirrorDir);
      fs.writeFileSync(path.join(mirrorDir, 'second-brain.md'), markdown, 'utf-8');
    } catch (err: any) {
      console.warn(`[secondBrain] could not mirror requirement brain: ${err.message}`);
    }
  }
  return brain;
}

/** Apply a mutation to the brain and persist both files. */
export function updateBrain(
  sessionId: string,
  mutate: (brain: SecondBrainData) => void,
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  const brain = getOrCreateBrain(sessionId, phaseId);
  mutate(brain);
  return writeBrain(brain);
}

/** Raw markdown content — this is what gets injected into every LLM prompt. */
export function readMarkdown(
  sessionId: string,
  phaseId: string = DEFAULT_PHASE_ID
): string | null {
  const p = secondBrainMdPath(sessionId, phaseId);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
  const brain = readBrain(sessionId, phaseId);
  return brain ? renderMarkdown(brain) : null;
}

// ── Mutations ──────────────────────────────────────────────────────────────────

/** Called when the first document is uploaded. Idempotent. */
export function initSecondBrain(
  sessionId: string,
  opts: { projectName?: string; documents?: string[] } = {},
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      if (opts.projectName && brain.projectName === 'Untitled Project') {
        brain.projectName = opts.projectName;
      }
      for (const doc of opts.documents ?? []) {
        if (!brain.sourceDocuments.includes(doc)) brain.sourceDocuments.push(doc);
      }
    },
    phaseId
  );
}

export function recordDocuments(
  sessionId: string,
  documents: string[],
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      for (const doc of documents) {
        if (!brain.sourceDocuments.includes(doc)) brain.sourceDocuments.push(doc);
      }
    },
    phaseId
  );
}

/**
 * A new client document has arrived for a project that was already signed off.
 *
 * Everything the brain already knows is kept — the understanding, the full Q&A chain,
 * the confirmed facts — because that knowledge is what stops the agent re-asking what
 * it has already been told. What is reset is the *budget*: the question cycles are
 * returned so the agent can interrogate the new material, and the approval drops back
 * to pending so a human signs off on the combined picture before anything downstream
 * (requirements, the backlog) is regenerated from it.
 */
export function reopenForNewDocuments(
  sessionId: string,
  documents: string[],
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      for (const doc of documents) {
        if (!brain.sourceDocuments.includes(doc)) brain.sourceDocuments.push(doc);
      }
      brain.cycleCount = 0;
      brain.approval = { status: 'pending' };
      // The stored summary described the old document set; force it to be rebuilt.
      brain.understandingSummary = undefined;
    },
    phaseId
  );
}

export function setProjectName(
  sessionId: string,
  projectName: string,
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      if (projectName && projectName.trim()) brain.projectName = projectName.trim();
    },
    phaseId
  );
}

/** Store the AI's structured understanding of the documents. */
export function recordUnderstanding(
  sessionId: string,
  understanding: ProjectUnderstanding,
  confidenceScore: number,
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      brain.documentUnderstanding = renderUnderstanding(understanding);
      brain.confidenceScore = confidenceScore;
      brain.assumptions = dedupe(understanding.assumptions ?? []);
      brain.openItems = dedupe([...(understanding.scope?.unclear ?? []), ...brain.openItems]);
    },
    phaseId
  );
}

/**
 * Record one or more answers. Answers are keyed by question id + cycle so the same
 * question answered in the same cycle is updated rather than duplicated.
 */
export function recordAnswers(
  sessionId: string,
  records: QnaRecord[],
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      for (const rec of records) {
        if (!rec.answer || !String(rec.answer).trim()) continue;
        const idx = brain.qna.findIndex((q) => q.cycle === rec.cycle && q.questionId === rec.questionId);
        if (idx >= 0) brain.qna[idx] = rec;
        else brain.qna.push(rec);
      }
      brain.qna.sort((a, b) => a.cycle - b.cycle || a.questionId.localeCompare(b.questionId));
      brain.confirmedFacts = deriveConfirmedFacts(brain);
    },
    phaseId
  );
}

/** Bump the cycle counter after a question round has been issued to the user. */
export function incrementCycle(
  sessionId: string,
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      brain.cycleCount = Math.min(brain.cycleCount + 1, MAX_QUESTION_CYCLES);
    },
    phaseId
  );
}

export function setConfidence(
  sessionId: string,
  confidenceScore: number,
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      brain.confidenceScore = confidenceScore;
    },
    phaseId
  );
}

export function recordHumanInput(
  sessionId: string,
  text: string,
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      brain.humanInputs.push({ text: text.trim(), at: new Date().toISOString() });
    },
    phaseId
  );
}

export function recordUnderstandingSummary(
  sessionId: string,
  summary: UnderstandingSummary,
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      brain.understandingSummary = { ...summary, generatedAt: new Date().toISOString() };
      brain.confidenceScore = summary.confidenceScore;
      if (summary.confirmedFacts.length > 0) {
        brain.confirmedFacts = dedupe([...deriveConfirmedFacts(brain), ...summary.confirmedFacts]);
      }
      if (summary.assumptions.length > 0) brain.assumptions = dedupe(summary.assumptions);
      brain.openItems = dedupe(summary.openItems);
    },
    phaseId
  );
}

export function approve(sessionId: string, phaseId: string = DEFAULT_PHASE_ID): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      brain.approval = { status: 'approved', approvedAt: new Date().toISOString() };
    },
    phaseId
  );
}

export function recordGeneratedStories(
  sessionId: string,
  result: EpicStoriesResult,
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      brain.generatedStories = result;
    },
    phaseId
  );
}

/**
 * Record what the reviewer did to a section. Regeneration feedback is the most
 * valuable part: it is the designer's / architect's own words about what was
 * wrong, and every later section prompt reads it from here.
 */
export function recordSectionEvent(
  sessionId: string,
  phaseId: string,
  entry: Omit<SectionLogEntry, 'at'>
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      brain.sectionLog = [...(brain.sectionLog ?? []), { ...entry, at: new Date().toISOString() }];
    },
    phaseId
  );
}

/** Replace the knowledge blocks with these headings; other headings are kept. */
export function recordKnowledge(
  sessionId: string,
  phaseId: string,
  blocks: Omit<PhaseKnowledgeBlock, 'updatedAt'>[]
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      const now = new Date().toISOString();
      const incoming = new Set(blocks.map((b) => b.heading));
      brain.knowledge = [
        ...(brain.knowledge ?? []).filter((b) => !incoming.has(b.heading)),
        ...blocks.map((b) => ({ ...b, updatedAt: now })),
      ];
    },
    phaseId
  );
}

// ── Phase hand-off ─────────────────────────────────────────────────────────────

/**
 * Create (or refresh) a phase's own brain from what the previous phase produced.
 *
 * The hand-off is a copy, not a reference: the new phase starts from the previous
 * phase's output document, confirmed facts, assumptions and open items, recorded
 * under "Input from Previous Phase". From that point the two brains evolve
 * independently — the new phase's Q&A never mutates the brain it inherited from.
 *
 * Idempotent: re-running it on a phase that has already started refreshes the
 * inherited block without touching the phase's own Q&A, approval or cycle count.
 */
export function initPhaseBrain(
  sessionId: string,
  phaseId: string,
  inputFromPreviousPhase: PhaseInputFromPreviousPhase
): SecondBrainData {
  return updateBrain(
    sessionId,
    (brain) => {
      brain.phaseId = phaseId;
      brain.inputFromPreviousPhase = {
        ...inputFromPreviousPhase,
        importedAt: inputFromPreviousPhase.importedAt ?? new Date().toISOString(),
      };
      for (const doc of inputFromPreviousPhase.documents ?? []) {
        if (!brain.sourceDocuments.includes(doc)) brain.sourceDocuments.push(doc);
      }
      // Inherited facts seed this phase's picture but stay attributed to the phase
      // they came from, so the agent can tell "confirmed upstream" from
      // "confirmed here".
      brain.openItems = dedupe([...brain.openItems, ...(inputFromPreviousPhase.openItems ?? [])]);
    },
    phaseId
  );
}

/** Has a phase been started (i.e. does it have a brain of its own)? */
export function phaseStarted(sessionId: string, phaseId: string): boolean {
  return exists(sessionId, phaseId);
}

// ── Derived views ──────────────────────────────────────────────────────────────

export function getStatus(
  sessionId: string,
  phaseId: string = DEFAULT_PHASE_ID
): SecondBrainStatus {
  const brain = readBrain(sessionId, phaseId);
  if (!brain) {
    return {
      exists: false,
      cycleCount: 0,
      maxCycles: MAX_QUESTION_CYCLES,
      questionsExhausted: false,
      approvalStatus: 'pending',
      hasSummary: false,
      hasStories: false,
      confidenceScore: 0,
    };
  }
  return {
    exists: true,
    cycleCount: brain.cycleCount,
    maxCycles: MAX_QUESTION_CYCLES,
    questionsExhausted: brain.cycleCount >= MAX_QUESTION_CYCLES,
    approvalStatus: brain.approval.status,
    approvedAt: brain.approval.approvedAt,
    hasSummary: Boolean(brain.understandingSummary),
    hasStories: Boolean(brain.generatedStories),
    confidenceScore: brain.confidenceScore,
  };
}

/** Normalized text of every already-answered question, for dedupe checks. */
export function answeredQuestionKeys(
  sessionId: string,
  phaseId: string = DEFAULT_PHASE_ID
): Set<string> {
  const brain = readBrain(sessionId, phaseId);
  const keys = new Set<string>();
  for (const q of brain?.qna ?? []) keys.add(normalizeQuestion(q.question));
  return keys;
}

/**
 * Every question answered anywhere in the lifecycle up to and including `phaseId`.
 * This is what stops the architecture agent re-asking a question the business
 * analyst already put to the user.
 */
export function answeredQuestionKeysAcrossPhases(
  sessionId: string,
  phaseIds: string[]
): Set<string> {
  const keys = new Set<string>();
  for (const id of phaseIds) {
    for (const key of answeredQuestionKeys(sessionId, id)) keys.add(key);
  }
  return keys;
}

export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|is|are|do|does|will|would|should|what|which|who|whom|how|why|when|of|for|to|in|on|this|that|your|you|please|specify|provide)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── LLM context block ──────────────────────────────────────────────────────────

/**
 * The standard block prepended to EVERY LLM prompt in the system. It carries the
 * full second brain plus the non-negotiable rules that keep the agent from
 * re-asking, contradicting, or inventing.
 */
export function buildSecondBrainContextBlock(
  sessionId: string,
  phaseId: string = DEFAULT_PHASE_ID
): string {
  const md = readMarkdown(sessionId, phaseId);
  if (!md) return '';

  const brain = readBrain(sessionId, phaseId);
  const exhausted = (brain?.cycleCount ?? 0) >= MAX_QUESTION_CYCLES;

  return `
=== CONTEXT FROM SECOND BRAIN (SINGLE SOURCE OF TRUTH) ===
${md}
=== END SECOND BRAIN ===

RULES YOU MUST FOLLOW:
1. Never ask a question whose answer is in the Second Brain above.
2. Never assume anything not stated in the documents or the Second Brain.
3. Never contradict an answer already confirmed by the user in the Q&A History.
4. If something is unclear and the maximum question cycles have been reached, record it as an assumption or open item — do NOT ask.
${exhausted ? '5. The maximum of ' + MAX_QUESTION_CYCLES + ' question cycles has been REACHED. You may not ask any further questions.' : '5. Question cycles used: ' + (brain?.cycleCount ?? 0) + ' of ' + MAX_QUESTION_CYCLES + '.'}
`.trim();
}

/**
 * The context block for a phase: this phase's brain PLUS every earlier phase's
 * brain, each clearly labelled.
 *
 * Earlier phases are read-only history — the agent must treat their confirmed
 * facts as settled and must never re-open a question they already answered.
 *
 * `phaseOrder` is injected (rather than imported from the registry) to keep this
 * module free of a dependency on the phase layer, which imports it.
 */
export function buildFullContextBlock(
  sessionId: string,
  currentPhaseId: string,
  phaseOrder: { id: string; name: string }[]
): string {
  const idx = phaseOrder.findIndex((p) => p.id === currentPhaseId);
  const chain = idx < 0 ? [{ id: currentPhaseId, name: currentPhaseId }] : phaseOrder.slice(0, idx + 1);

  const blocks: string[] = [];

  for (const phase of chain) {
    const md = readMarkdown(sessionId, phase.id);
    if (!md) continue;
    const isCurrent = phase.id === currentPhaseId;
    blocks.push(
      [
        `=== SECOND BRAIN — ${phase.name.toUpperCase()} PHASE ${isCurrent ? '(CURRENT PHASE — you are working in this one)' : '(EARLIER PHASE — read-only history)'} ===`,
        md,
        `=== END ${phase.name.toUpperCase()} PHASE ===`,
      ].join('\n')
    );
  }

  if (blocks.length === 0) return '';

  const current = readBrain(sessionId, currentPhaseId);
  const exhausted = (current?.cycleCount ?? 0) >= MAX_QUESTION_CYCLES;
  const earlier = chain.filter((p) => p.id !== currentPhaseId).map((p) => p.name);

  return `
${blocks.join('\n\n')}

RULES YOU MUST FOLLOW:
1. Never ask a question whose answer appears in ANY of the Second Brains above — including the earlier phases.
2. Never assume anything not stated in the source material or the Second Brains.
3. Never contradict an answer the user already confirmed, in this phase or an earlier one.
4. ${earlier.length > 0 ? `The ${earlier.join(' and ')} phase${earlier.length > 1 ? 's are' : ' is'} CLOSED. ${earlier.length > 1 ? 'Their' : 'Its'} decisions are settled input, not open questions.` : 'This is the first phase of the lifecycle.'}
5. If something is unclear and the question cycles are spent, record it as an assumption or an open item — do NOT ask.
${exhausted ? '6. The maximum of ' + MAX_QUESTION_CYCLES + ' question cycles for THIS phase has been REACHED. You may not ask any further questions.' : '6. Question cycles used in this phase: ' + (current?.cycleCount ?? 0) + ' of ' + MAX_QUESTION_CYCLES + '.'}
`.trim();
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = (item ?? '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Every answered question is, by definition, a fact the user confirmed. These are
 * merged with any facts the approval summary adds.
 */
function deriveConfirmedFacts(brain: SecondBrainData): string[] {
  const fromQna = brain.qna.map((q) => `${stripTrailingPunctuation(q.question)} → ${q.answer}`);
  const manual = brain.understandingSummary?.confirmedFacts ?? [];
  return dedupe([...fromQna, ...manual]);
}

/** Story count from the inherited backlog, without trusting it to be well-formed. */
function countStories(storiesJson: string): number {
  try {
    const parsed = JSON.parse(storiesJson);
    return Array.isArray(parsed.stories) ? parsed.stories.length : 0;
  } catch {
    return 0;
  }
}

function stripTrailingPunctuation(text: string): string {
  return text.trim().replace(/[?:.\s]+$/, '');
}

function renderUnderstanding(u: ProjectUnderstanding): string {
  const list = (items: string[]) =>
    items && items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '- _None identified_';

  return [
    `**Project Overview:** ${u.projectOverview}`,
    '',
    `**Business Objective:** ${u.businessObjective}`,
    '',
    '**In Scope:**',
    list(u.scope?.inScope ?? []),
    '',
    '**Out of Scope:**',
    list(u.scope?.outOfScope ?? []),
    '',
    '**Unclear Scope:**',
    list(u.scope?.unclear ?? []),
    '',
    `**Stakeholders:** ${(u.stakeholders ?? []).join(', ') || 'NOT FOUND in documents'}`,
    `**Timeline:** ${u.timeline}`,
    `**Tech Stack:** ${u.techStack}`,
    '',
    '**Deliverables:**',
    list(u.deliverables ?? []),
    '',
    '**Constraints:**',
    list(u.constraints ?? []),
    '',
    '**Risks:**',
    list(u.risks ?? []),
    '',
    '**Dependencies:**',
    list(u.dependencies ?? []),
  ].join('\n');
}

export function renderMarkdown(brain: SecondBrainData): string {
  const lines: string[] = [];
  const phaseId = brain.phaseId ?? DEFAULT_PHASE_ID;

  lines.push('---');
  lines.push(`session_id: ${brain.sessionId}`);
  lines.push(`phase: ${phaseId}`);
  lines.push(`project_name: ${brain.projectName}`);
  lines.push(`created_at: ${brain.createdAt}`);
  lines.push(`last_updated: ${brain.lastUpdated}`);
  lines.push(`question_cycles_used: ${brain.cycleCount} of ${MAX_QUESTION_CYCLES}`);
  lines.push(`confidence_score: ${brain.confidenceScore}`);
  lines.push(`approval_status: ${brain.approval.status}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${brain.projectName} — Second Brain (${phaseId} phase)`);
  lines.push('');

  if (brain.inputFromPreviousPhase) {
    const input = brain.inputFromPreviousPhase;
    lines.push('## Input from Previous Phase');
    lines.push('');
    lines.push(`Received from: **${input.fromPhaseName ?? input.fromPhaseId ?? 'unknown phase'}**`);
    if (input.documentId) lines.push(`Source document: **${input.documentId}**`);
    lines.push(`Imported at: ${input.importedAt ?? '—'}`);
    lines.push('');

    lines.push('### Documents received');
    lines.push('');
    if ((input.documents ?? []).length === 0) lines.push('_None._');
    else for (const doc of input.documents) lines.push(`- ${doc}`);
    lines.push('');

    lines.push('### Facts confirmed in the previous phase (settled — do not re-ask)');
    lines.push('');
    if ((input.confirmedFacts ?? []).length === 0) lines.push('_None recorded._');
    else for (const fact of input.confirmedFacts) lines.push(`- ${fact}`);
    lines.push('');

    lines.push('### Assumptions carried forward');
    lines.push('');
    if ((input.assumptions ?? []).length === 0) lines.push('_None._');
    else for (const a of input.assumptions) lines.push(`- ${a}`);
    lines.push('');

    lines.push('### Open items carried forward');
    lines.push('');
    if ((input.openItems ?? []).length === 0) lines.push('_None._');
    else for (const item of input.openItems) lines.push(`- ${item}`);
    lines.push('');

    // The inherited document and backlog are kept in the JSON, not inlined here.
    // This markdown is injected into every prompt this phase makes; inlining a
    // 40KB requirement document would repeat it in each one, alongside the copy
    // the prompt already supplies as source material.
    if (input.previousPhaseDocument) {
      lines.push(
        `### Previous phase output document`,
        '',
        `The full text of ${input.documentId ?? 'the previous phase document'} (${input.previousPhaseDocument.length.toLocaleString()} characters) is supplied to this phase as source material alongside this brief.`,
        ''
      );
    }

    for (const earlier of input.earlierPhaseDocuments ?? []) {
      lines.push(
        `### ${earlier.phaseName} output document`,
        '',
        `The full text of ${earlier.documentId ?? `the ${earlier.phaseName} document`} (${earlier.markdown.length.toLocaleString()} characters) is also supplied as source material — it is the original source of the requirement ids this phase must trace to.`,
        ''
      );
    }

    if (input.storiesJson) {
      const count = countStories(input.storiesJson);
      lines.push(
        '### User stories from the requirement phase',
        '',
        `${count} user stories were generated and approved upstream; they are supplied with the source material.`,
        ''
      );
    }
  }

  lines.push('## Source Documents');
  lines.push('');
  if (brain.sourceDocuments.length === 0) lines.push('_No documents uploaded yet._');
  else for (const doc of brain.sourceDocuments) lines.push(`- ${doc}`);
  lines.push('');

  lines.push('## Document Understanding');
  lines.push('');
  lines.push(brain.documentUnderstanding || '_Not analyzed yet._');
  lines.push('');

  lines.push('## Q&A History (Complete Chain)');
  lines.push('');
  if (brain.qna.length === 0) {
    lines.push('_No questions answered yet._');
    lines.push('');
  } else {
    const cycles = [...new Set(brain.qna.map((q) => q.cycle))].sort((a, b) => a - b);
    for (const cycle of cycles) {
      lines.push(`### Cycle ${cycle}`);
      lines.push('');
      for (const q of brain.qna.filter((r) => r.cycle === cycle)) {
        lines.push(`**${q.questionId} — Q:** ${q.question}`);
        lines.push(`Category: ${q.category} / ${q.priority}`);
        lines.push(`**A:** ${q.answer}`);
        lines.push(`Answered at: ${q.answeredAt}`);
        lines.push('');
      }
    }
  }

  lines.push('## Confirmed Facts');
  lines.push('');
  const facts = deriveConfirmedFacts(brain);
  if (facts.length === 0) lines.push('_No facts confirmed by the user yet._');
  else for (const fact of facts) lines.push(`- ${fact}`);
  lines.push('');

  lines.push('## Assumptions (AI assumed — not confirmed by the user)');
  lines.push('');
  if (brain.assumptions.length === 0) lines.push('_None._');
  else for (const a of brain.assumptions) lines.push(`- ${a}`);
  lines.push('');

  lines.push('## Open Items');
  lines.push('');
  if (brain.openItems.length === 0) lines.push('_None outstanding._');
  else for (const item of brain.openItems) lines.push(`- ${item}`);
  lines.push('');

  lines.push('## Human Additional Input');
  lines.push('');
  if (brain.humanInputs.length === 0) lines.push('_None provided._');
  else
    for (const input of brain.humanInputs) {
      lines.push(`### Added at ${input.at}`);
      lines.push('');
      lines.push(input.text);
      lines.push('');
    }
  lines.push('');

  lines.push('## Human Approval');
  lines.push('');
  lines.push(`Status: ${brain.approval.status === 'approved' ? 'Approved' : 'Pending'}`);
  lines.push(`Approved at: ${brain.approval.approvedAt ?? '—'}`);
  lines.push('');

  if (brain.understandingSummary) {
    const s = brain.understandingSummary;
    lines.push('## Understanding Summary (presented for approval)');
    lines.push('');
    lines.push(`**Overview:** ${s.projectOverview}`);
    lines.push('');
    lines.push(`**Confidence:** ${s.confidenceScore}%  |  **Ready to generate:** ${s.readyToGenerate ? 'Yes' : 'No'}`);
    lines.push('');
  }

  if ((brain.knowledge ?? []).length > 0) {
    lines.push('## Phase Decisions (distilled from the approved document)');
    lines.push('');
    for (const block of brain.knowledge!) {
      lines.push(`### ${block.heading}`);
      lines.push('');
      if (block.lines.length === 0) lines.push('_None recorded._');
      else for (const line of block.lines) lines.push(`- ${line}`);
      lines.push('');
    }
  }

  if ((brain.sectionLog ?? []).length > 0) {
    lines.push('## Reviewer Trail (section approvals and feedback)');
    lines.push('');
    for (const e of brain.sectionLog!) {
      const version = e.version ? ` v${e.version}` : '';
      const feedback = e.feedback ? ` — reviewer feedback: "${e.feedback}"` : '';
      lines.push(`- ${e.at} · §${e.sectionNumber} ${e.title}${version} · ${e.action}${feedback}`);
    }
    lines.push('');
  }

  if (brain.diagram && brain.diagram.mermaid.trim()) {
    const d = brain.diagram;
    lines.push('## System Diagram');
    lines.push('');
    lines.push(`Status: ${d.status} | Revision: ${d.revision} | Last updated: ${d.updatedAt ?? '—'}`);
    lines.push('');
    lines.push('```mermaid');
    lines.push(d.mermaid.trim());
    lines.push('```');
    lines.push('');
  }

  if (brain.generatedStories) {
    const { epic, stories, generatedAt, totalStoryPoints } = brain.generatedStories;
    lines.push('## Generated Stories');
    lines.push('');
    lines.push(`Generated at: ${generatedAt}`);
    lines.push('');
    lines.push(`### Epic: ${epic.title}`);
    lines.push('');
    lines.push(epic.description);
    lines.push('');
    lines.push(`**Business Value:** ${epic.businessValue}`);
    lines.push('');
    lines.push('**Epic Acceptance Criteria:**');
    for (const ac of epic.acceptanceCriteria) lines.push(`- ${ac}`);
    lines.push('');
    lines.push(`### User Stories (${stories.length} stories, ${totalStoryPoints} points)`);
    lines.push('');
    for (const s of stories) {
      lines.push(`#### ${s.id} — ${s.title}`);
      lines.push(`${s.userStory}`);
      lines.push(`Points: ${s.storyPoints} | Priority: ${s.priority} | Component: ${s.component} | Labels: ${s.labels.join(', ')}`);
      lines.push('Acceptance Criteria:');
      for (const ac of s.acceptanceCriteria) lines.push(`- ${ac}`);
      lines.push('');
    }
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify({ epic, stories }, null, 2));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}
