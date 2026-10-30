import type { LLMAdapter } from '../../services/llm/adapter.js';
import type {
  AnalysisResult,
  ClarifyingQuestion,
  EarlierPhaseDocument,
  PhaseDiagram,
  PhaseDoc,
  PhaseImportSummary,
  PhaseRuntimeStatus,
  QnaRecord,
  UnderstandingSummary,
} from '../../types/index.js';
import type { PhaseConfig } from '../phaseConfig.js';
import { getPhase, getNextPhase, getPreviousPhase, getAllPhases, phasesUpTo } from '../registry.js';
import * as brain from '../../services/secondBrain.js';
import { MAX_QUESTION_CYCLES } from '../../services/secondBrain.js';
import { getLLM, loadSession, saveSession } from '../../state.js';
import { analyzeDocuments, flattenAnsweredQuestions } from '../../services/analyzer.js';
import { generateUnderstandingSummary } from '../../services/approvalService.js';
import { getSectionPrompt } from '../../prompts/sections/index.js';
import { parseLlmJson, readParsedDocuments } from '../../services/sessionContext.js';
import { getProjectBySessionId } from '../../services/projectStore.js';
import { devStatus } from '../../dev/workspace.js';
import {
  markPhaseCompleted,
  markPhaseStarted,
  readProgress,
  updatePhaseRecord,
} from '../../services/phaseProgressStore.js';
import {
  buildPhaseAnalysisPrompt,
  buildPhaseApprovalPrompt,
  buildPhaseSectionPrompt,
} from './prompts.js';
import { buildDiagramPrompt, extractMermaid, looksLikeMermaid } from '../../prompts/diagramPrompt.js';
import {
  approveDiagram,
  listDiagramSet,
  readDiagram,
  summarizeDiagramSet,
  saveEditedDiagram,
  saveGeneratedDiagram,
  skipDiagram,
} from '../../services/diagramStore.js';
import {
  getOrCreatePhaseState,
  latestAnalysis,
  readPhaseState,
  updatePhaseState,
} from './phaseState.js';
import {
  approveSection as approveDocSection,
  assemblePhaseDoc,
  finalizePhaseDoc,
  getPhaseDoc,
  initPhaseDoc,
  readPhaseOutput,
  revertSection as revertDocSection,
  setSectionContent,
  skipSection as skipDocSection,
} from './phaseDocStore.js';

/**
 * The phase engine: one implementation of the AIDLC workflow, driven by a
 * PhaseConfig.
 *
 * Every phase runs the same shape — import (or upload) → analyze → at most two
 * question cycles against its Second Brain → human approval → section-by-section
 * generation with per-section approval → finalize → deliverables → hand off.
 *
 * Where the requirement phase already has a working implementation, the engine
 * delegates to it rather than re-implementing it. That is deliberate: the
 * requirement pipeline is in production use, and the engine must be a second way
 * of driving the same machinery, never a second copy of it.
 */

export class PhaseError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

export function requirePhase(phaseId: string): PhaseConfig {
  const config = getPhase(phaseId);
  if (!config) throw new PhaseError(`Unknown phase "${phaseId}"`, 404);
  return config;
}

function requireBuildablePhase(phaseId: string): PhaseConfig {
  const config = requirePhase(phaseId);
  if (config.comingSoon) {
    throw new PhaseError(`The ${config.name} phase is not available yet.`, 409);
  }
  return config;
}

function requireLLM(): LLMAdapter {
  const llm = getLLM();
  if (!llm) {
    throw new PhaseError(
      'No LLM configured. Set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY in your .env file.',
      500
    );
  }
  return llm;
}

const isRequirement = (phaseId: string) => phaseId === brain.DEFAULT_PHASE_ID;

/** The lifecycle, as buildFullContextBlock needs it. */
function phaseOrderForContext(): { id: string; name: string }[] {
  return getAllPhases().map((p) => ({ id: p.id, name: p.name }));
}

/** This phase's brain plus every earlier phase's brain. */
export function phaseContextBlock(sessionId: string, phaseId: string): string {
  return brain.buildFullContextBlock(sessionId, phaseId, phaseOrderForContext());
}

function projectIdFor(sessionId: string): string {
  return getProjectBySessionId(sessionId)?.id ?? sessionId;
}

function projectNameFor(sessionId: string, fallback: string): string {
  return getProjectBySessionId(sessionId)?.name ?? fallback;
}

// ── Start / import ─────────────────────────────────────────────────────────────

/**
 * Begin a phase: pull everything the previous phase produced into this phase's own
 * Second Brain, under "Input from Previous Phase".
 *
 * Idempotent — re-running it refreshes the inherited block without disturbing any
 * Q&A, approval or sections the phase has already accumulated.
 */
export function startPhase(sessionId: string, phaseId: string): PhaseImportSummary | null {
  const config = requireBuildablePhase(phaseId);
  const previous = config.requiresPhase ? getPhase(config.requiresPhase) : undefined;

  if (previous) {
    const previousStatus = brain.getStatus(sessionId, previous.id);
    if (!previousStatus.exists || previousStatus.approvalStatus !== 'approved') {
      throw new PhaseError(
        `The ${previous.name} phase must be completed and approved before ${config.name} can start.`,
        403
      );
    }
  }

  const imported = previous ? importFromPreviousPhase(sessionId, config, previous) : null;

  if (!previous) {
    // The first phase has no hand-off; just make sure it has a brain.
    brain.getOrCreateBrain(sessionId, phaseId);
  }

  getOrCreatePhaseState(sessionId, phaseId);

  const projectId = projectIdFor(sessionId);
  brain.setProjectName(sessionId, projectNameFor(sessionId, 'Untitled Project'), phaseId);
  markPhaseStarted(sessionId, phaseId, projectId);

  return imported;
}

function importFromPreviousPhase(
  sessionId: string,
  config: PhaseConfig,
  previous: PhaseConfig
): PhaseImportSummary {
  const previousBrain = brain.readBrain(sessionId, previous.id);
  const previousDoc = getPhaseDoc(sessionId, previous.id);
  const previousMarkdown = readPhaseOutput(sessionId, previous);
  const previousBrainMd = brain.readMarkdown(sessionId, previous.id) ?? '';

  // Every phase before the previous one, oldest first. The design phase needs the
  // requirement document itself — its FR ids are what every screen traces to — not
  // only the architecture's retelling of it.
  const earlierPhases = phasesUpTo(previous.id)
    .filter((id) => id !== previous.id)
    .map((id) => getPhase(id))
    .filter((p): p is PhaseConfig => Boolean(p && !p.comingSoon));

  const earlierPhaseDocuments: EarlierPhaseDocument[] = [];
  for (const phase of earlierPhases) {
    const markdown = readPhaseOutput(sessionId, phase);
    if (!markdown?.trim()) continue;
    earlierPhaseDocuments.push({
      phaseId: phase.id,
      phaseName: phase.name,
      documentId: getPhaseDoc(sessionId, phase.id)?.id,
      markdown,
    });
  }

  // The backlog is produced once (requirement phase) and must reach every phase
  // after it, however many phases sit in between.
  const upstreamBrains = [previous, ...[...earlierPhases].reverse()].map((p) => ({
    phase: p,
    data: brain.readBrain(sessionId, p.id),
  }));
  const stories = upstreamBrains.find((b) => b.data?.generatedStories)?.data?.generatedStories;

  const documents: string[] = [];
  for (const earlier of earlierPhaseDocuments) {
    documents.push(`${earlier.documentId ?? earlier.phaseName} — ${getPhase(earlier.phaseId)?.outputFileName}`);
  }
  if (previousDoc) documents.push(`${previousDoc.id} — ${previous.outputFileName}`);
  for (const b of [...upstreamBrains].reverse()) {
    if (b.data) documents.push(`${b.phase.name} second-brain.md`);
  }
  if (stories) documents.push(`Epic & ${stories.stories.length} user stories`);

  const storiesJson = stories
    ? JSON.stringify({ epic: stories.epic, stories: stories.stories }, null, 2)
    : undefined;

  // Facts from the immediate predecessor are carried verbatim; facts from phases
  // further back are labelled with their phase so the agent knows where they were
  // settled. Their full brains still reach every prompt via the context block.
  const labelled = (items: string[] | undefined, phase: PhaseConfig) =>
    (items ?? []).map((item) => `[${phase.shortName}] ${item}`);
  const confirmedFacts = dedupeStrings([
    ...(previousBrain?.confirmedFacts ?? []),
    ...upstreamBrains.slice(1).flatMap((b) => labelled(b.data?.confirmedFacts, b.phase)),
  ]);
  const assumptions = dedupeStrings([
    ...(previousBrain?.assumptions ?? []),
    ...upstreamBrains.slice(1).flatMap((b) => labelled(b.data?.assumptions, b.phase)),
  ]);
  const openItems = previousBrain?.openItems ?? [];

  brain.initPhaseBrain(sessionId, config.id, {
    fromPhaseId: previous.id,
    fromPhaseName: previous.name,
    documents,
    documentId: previousDoc?.id,
    previousPhaseDocument: previousMarkdown ?? undefined,
    secondBrainMd: previousBrainMd,
    confirmedFacts,
    assumptions,
    openItems,
    storiesJson,
    earlierPhaseDocuments: earlierPhaseDocuments.length > 0 ? earlierPhaseDocuments : undefined,
  });

  return {
    fromPhaseId: previous.id,
    fromPhaseName: previous.name,
    documents,
    documentId: previousDoc?.id,
    confirmedFacts,
    assumptions,
    openItems,
    storyCount: stories?.stories.length,
    importedAt: new Date().toISOString(),
  };
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What this phase received from the phase before it, for the Import step. */
export function getImportSummary(sessionId: string, phaseId: string): PhaseImportSummary | null {
  const data = brain.readBrain(sessionId, phaseId);
  const input = data?.inputFromPreviousPhase;
  if (!input) return null;
  return {
    fromPhaseId: input.fromPhaseId,
    fromPhaseName: input.fromPhaseName,
    documents: input.documents ?? [],
    documentId: input.documentId,
    confirmedFacts: input.confirmedFacts ?? [],
    assumptions: input.assumptions ?? [],
    openItems: input.openItems ?? [],
    storyCount: input.storiesJson ? (JSON.parse(input.storiesJson).stories ?? []).length : undefined,
    importedAt: input.importedAt,
  };
}

/** The raw material a phase reasons over: what the previous phase produced. */
async function buildSourceMaterial(sessionId: string, config: PhaseConfig): Promise<string> {
  if (isRequirement(config.id)) {
    const session = loadSession(sessionId);
    return session ? readParsedDocuments(session, 40_000) : '';
  }

  const data = brain.readBrain(sessionId, config.id);
  const input = data?.inputFromPreviousPhase;
  if (!input) return '';

  const parts: string[] = [];
  for (const earlier of input.earlierPhaseDocuments ?? []) {
    parts.push(
      `=== APPROVED ${earlier.phaseName.toUpperCase()} DOCUMENT${
        earlier.documentId ? ` (${earlier.documentId})` : ''
      } ===\n${earlier.markdown}`
    );
  }
  if (input.previousPhaseDocument) {
    parts.push(
      `=== APPROVED ${(input.fromPhaseName ?? 'PREVIOUS PHASE').toUpperCase()} DOCUMENT${
        input.documentId ? ` (${input.documentId})` : ''
      } ===\n${input.previousPhaseDocument}`
    );
  }
  if (input.storiesJson) {
    parts.push(`=== EPIC & USER STORIES FROM THE REQUIREMENT PHASE ===\n${input.storiesJson}`);
  }
  return parts.join('\n\n');
}

// ── Analyze ────────────────────────────────────────────────────────────────────

export interface PhaseAnalysisOutcome extends AnalysisResult {
  cycleCount: number;
  maxCycles: number;
  questionCycle: number | null;
  questionsExhausted: boolean;
  questionsWithheldReason?: string;
  readyForApproval: boolean;
  approvalStatus: 'pending' | 'approved';
}

export async function analyzePhase(
  sessionId: string,
  phaseId: string
): Promise<PhaseAnalysisOutcome> {
  const config = requireBuildablePhase(phaseId);
  const llm = requireLLM();

  // The requirement phase keeps its own, battle-tested analysis path. Running it
  // here means /api/phase/requirement/:id/analyze and /api/analyze/:id produce
  // byte-for-byte the same result from the same inputs.
  if (isRequirement(phaseId)) {
    return analyzeRequirementPhase(sessionId, llm);
  }

  const existing = brain.getOrCreateBrain(sessionId, phaseId);
  const cycleNumber = existing.cycleCount + 1;
  const willAskQuestions = existing.cycleCount < MAX_QUESTION_CYCLES;
  console.log(
    `[phase:${phaseId}] session=${sessionId} cycles used=${existing.cycleCount}/${MAX_QUESTION_CYCLES}, running as cycle ${cycleNumber} (${llm.name})`
  );

  const previous = config.requiresPhase ? getPhase(config.requiresPhase) : undefined;
  const sourceMaterial = await buildSourceMaterial(sessionId, config);

  if (!sourceMaterial.trim()) {
    throw new PhaseError(
      `Nothing to analyze. Start the ${config.name} phase so it can import the previous phase's output.`,
      400
    );
  }

  const prompt = buildPhaseAnalysisPrompt({
    config,
    cycleNumber,
    fullContextBlock: phaseContextBlock(sessionId, phaseId),
    previousAnswers: flattenPhaseAnswers(sessionId, phaseId),
    previousPhaseName: previous?.name,
  });

  const raw = await llm.analyze(prompt, sourceMaterial);
  const parsed = parseLlmJson<any>(raw, `${phaseId} analysis`);

  const understanding = normalizeUnderstanding(parsed.understanding);
  const confidenceScore = clampScore(parsed.confidenceScore);

  const rawQuestions: ClarifyingQuestion[] = (parsed.questions || []).map((q: any, i: number) => ({
    id: q.id || `Q${i + 1}`,
    category: q.category || 'other',
    question: q.question,
    context: q.context || '',
    priority: q.priority || 'important',
    answerType: q.answerType || 'text',
    options: q.options,
    status: 'pending' as const,
  }));

  const questions = enforceQuestionBudget(sessionId, config, cycleNumber, confidenceScore, rawQuestions);

  brain.recordUnderstanding(sessionId, understanding, confidenceScore, phaseId);

  if (willAskQuestions && questions.issued.length > 0) {
    brain.incrementCycle(sessionId, phaseId);
  }

  const analysis: AnalysisResult = {
    understanding,
    confidenceScore,
    questions: questions.issued,
  };

  updatePhaseState(sessionId, phaseId, (state) => {
    state.analyses.push(analysis);
    state.currentStep = questions.issued.length > 0 ? 'understanding' : 'approval';
  });

  const status = brain.getStatus(sessionId, phaseId);
  markPhaseStarted(sessionId, phaseId, projectIdFor(sessionId));

  return {
    ...analysis,
    cycleCount: status.cycleCount,
    maxCycles: MAX_QUESTION_CYCLES,
    questionCycle: questions.issued.length > 0 ? cycleNumber : null,
    questionsExhausted: status.cycleCount >= MAX_QUESTION_CYCLES || questions.exhausted,
    questionsWithheldReason: questions.withheldReason,
    readyForApproval: questions.issued.length === 0,
    approvalStatus: status.approvalStatus,
  };
}

async function analyzeRequirementPhase(
  sessionId: string,
  llm: LLMAdapter
): Promise<PhaseAnalysisOutcome> {
  const session = loadSession(sessionId);
  if (!session) throw new PhaseError('Session not found', 404);

  const readyFiles = session.files.filter((f) => f.status === 'ready');
  if (readyFiles.length === 0) {
    throw new PhaseError('No parsed files available. Upload a document first.', 400);
  }

  const existing = brain.getOrCreateBrain(sessionId);
  brain.recordDocuments(
    sessionId,
    readyFiles.map((f) => f.originalName)
  );

  const cycleNumber = existing.cycleCount + 1;
  const willAskQuestions = existing.cycleCount < MAX_QUESTION_CYCLES;
  const fullContent = await readParsedDocuments(session);

  const outcome = await analyzeDocuments(llm, fullContent, {
    sessionId,
    cycleNumber,
    previousAnswers: flattenAnsweredQuestions(sessionId),
  });

  brain.recordUnderstanding(sessionId, outcome.understanding, outcome.confidenceScore);
  if (existing.projectName === 'Untitled Project' && outcome.projectName) {
    brain.setProjectName(sessionId, outcome.projectName);
  }

  if (willAskQuestions && outcome.questions.length > 0) {
    brain.incrementCycle(sessionId);
    session.currentStep = 'understanding';
  } else {
    session.currentStep = outcome.questions.length > 0 ? 'understanding' : 'approval';
  }

  const analysis: AnalysisResult = {
    understanding: outcome.understanding,
    confidenceScore: outcome.confidenceScore,
    questions: outcome.questions,
  };
  session.analyses.push(analysis);
  session.cycleCount = brain.getStatus(sessionId).cycleCount;
  saveSession(session);

  const status = brain.getStatus(sessionId);
  markPhaseStarted(sessionId, brain.DEFAULT_PHASE_ID, projectIdFor(sessionId));

  return {
    ...analysis,
    cycleCount: status.cycleCount,
    maxCycles: MAX_QUESTION_CYCLES,
    questionCycle: outcome.questionCycle,
    questionsExhausted: status.cycleCount >= MAX_QUESTION_CYCLES || outcome.questionsExhausted,
    questionsWithheldReason: outcome.questionsWithheldReason,
    readyForApproval: outcome.questions.length === 0,
    approvalStatus: status.approvalStatus,
  };
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, important: 1, 'nice-to-have': 2 };

/** Below this confidence after cycle 1, a phase earns its one follow-up cycle. */
const CYCLE_2_CONFIDENCE_THRESHOLD = 70;

/**
 * Server-side enforcement of the question budget. The model is never trusted to
 * respect its own cycle limit, and a question already answered in THIS phase or in
 * ANY earlier phase is dropped before the user ever sees it.
 */
function enforceQuestionBudget(
  sessionId: string,
  config: PhaseConfig,
  cycleNumber: number,
  confidenceScore: number,
  questions: ClarifyingQuestion[]
): { issued: ClarifyingQuestion[]; exhausted: boolean; withheldReason?: string } {
  if (cycleNumber > MAX_QUESTION_CYCLES) {
    return {
      issued: [],
      exhausted: true,
      withheldReason: `Maximum of ${MAX_QUESTION_CYCLES} question cycles reached — proceeding to human approval.`,
    };
  }

  if (cycleNumber === 2 && confidenceScore >= CYCLE_2_CONFIDENCE_THRESHOLD) {
    return {
      issued: [],
      exhausted: true,
      withheldReason: `Confidence is ${confidenceScore}% (>= ${CYCLE_2_CONFIDENCE_THRESHOLD}%) after cycle 1 — no follow-up questions needed.`,
    };
  }

  const answeredAnywhere = brain.answeredQuestionKeysAcrossPhases(
    sessionId,
    getAllPhases()
      .slice(0, getAllPhases().findIndex((p) => p.id === config.id) + 1)
      .map((p) => p.id)
  );
  const seen = new Set<string>();

  const fresh = questions.filter((q) => {
    if (!q.question || !q.question.trim()) return false;
    const key = brain.normalizeQuestion(q.question);
    if (!key) return false;
    if (answeredAnywhere.has(key)) {
      console.log(`[phase:${config.id}] dropping already-answered question: "${q.question}"`);
      return false;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const limit = cycleNumber === 1 ? config.maxQuestionsRound1 : config.maxQuestionsRound2;
  const capped =
    fresh.length <= limit
      ? fresh
      : [...fresh]
          .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3))
          .slice(0, limit);

  if (capped.length === 0) {
    return {
      issued: [],
      exhausted: cycleNumber >= MAX_QUESTION_CYCLES,
      withheldReason:
        'The agent raised no new questions — everything it asked is already answered in the Second Brain.',
    };
  }

  return { issued: capped, exhausted: cycleNumber >= MAX_QUESTION_CYCLES };
}

function flattenPhaseAnswers(sessionId: string, phaseId: string): string | undefined {
  const data = brain.readBrain(sessionId, phaseId);
  if (!data || data.qna.length === 0) return undefined;
  return data.qna.map((q) => `[Cycle ${q.cycle}] Q: ${q.question}\nA: ${q.answer}`).join('\n\n');
}

function normalizeUnderstanding(raw: any) {
  return {
    projectOverview: raw?.projectOverview || 'NOT FOUND in the source material',
    businessObjective: raw?.businessObjective || 'NOT FOUND in the source material',
    scope: {
      inScope: raw?.scope?.inScope || [],
      outOfScope: raw?.scope?.outOfScope || [],
      unclear: raw?.scope?.unclear || [],
    },
    stakeholders: raw?.stakeholders || [],
    timeline: raw?.timeline || 'NOT FOUND in the source material',
    techStack: raw?.techStack || 'NOT FOUND in the source material',
    deliverables: raw?.deliverables || [],
    constraints: raw?.constraints || [],
    assumptions: raw?.assumptions || [],
    risks: raw?.risks || [],
    dependencies: raw?.dependencies || [],
  };
}

function clampScore(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ── Questions ──────────────────────────────────────────────────────────────────

export function getPhaseQuestions(sessionId: string, phaseId: string): ClarifyingQuestion[] {
  requirePhase(phaseId);
  const analysis = latestAnalysis(readPhaseState(sessionId, phaseId));
  if (!analysis) throw new PhaseError('No analysis found for this phase', 404);
  return analysis.questions;
}

export interface AnswerState {
  cycleCount: number;
  maxCycles: number;
  questionsExhausted: boolean;
  roundComplete: boolean;
  readyForApproval: boolean;
  approvalStatus: 'pending' | 'approved';
}

function answerState(sessionId: string, phaseId: string): AnswerState {
  const status = brain.getStatus(sessionId, phaseId);
  const analysis = latestAnalysis(readPhaseState(sessionId, phaseId));
  const complete = Boolean(analysis && analysis.questions.every((q) => q.status !== 'pending'));
  return {
    cycleCount: status.cycleCount,
    maxCycles: MAX_QUESTION_CYCLES,
    questionsExhausted: status.questionsExhausted,
    roundComplete: complete,
    readyForApproval: complete && status.questionsExhausted,
    approvalStatus: status.approvalStatus,
  };
}

function formatAnswer(answer: string | string[] | undefined): string {
  if (answer === undefined) return '';
  return Array.isArray(answer) ? answer.join(', ') : String(answer);
}

function toRecord(question: ClarifyingQuestion, cycle: number): QnaRecord {
  return {
    cycle,
    questionId: question.id,
    question: question.question,
    category: question.category,
    priority: question.priority,
    answer: formatAnswer(question.answer),
    answeredAt: new Date().toISOString(),
  };
}

export function answerPhaseQuestions(
  sessionId: string,
  phaseId: string,
  answers: { questionId: string; answer: string | string[] }[]
): { questions: ClarifyingQuestion[] } & AnswerState {
  requirePhase(phaseId);
  const state = readPhaseState(sessionId, phaseId);
  const analysis = latestAnalysis(state);
  if (!state || !analysis) throw new PhaseError('No analysis found for this phase', 404);

  // The cycle a question belongs to is the 1-based index of the round that produced
  // it, capped so a stray extra round cannot invent a cycle 3.
  const cycle = Math.min(state.analyses.length, MAX_QUESTION_CYCLES);
  const records: QnaRecord[] = [];

  for (const { questionId, answer } of answers) {
    const question = analysis.questions.find((q) => q.id === questionId);
    if (!question) continue;
    question.answer = answer;
    question.status = 'answered';
    if (formatAnswer(answer).trim()) records.push(toRecord(question, cycle));
  }

  if (records.length === 0) {
    throw new PhaseError('None of the supplied question ids matched this round', 404);
  }

  updatePhaseState(sessionId, phaseId, (s) => {
    s.analyses[s.analyses.length - 1] = analysis;
    s.currentStep = 'questions';
  });
  brain.recordAnswers(sessionId, records, phaseId);

  return { questions: analysis.questions, ...answerState(sessionId, phaseId) };
}

export function skipPhaseQuestion(
  sessionId: string,
  phaseId: string,
  questionId: string
): { question: ClarifyingQuestion } & AnswerState {
  requirePhase(phaseId);
  const state = readPhaseState(sessionId, phaseId);
  const analysis = latestAnalysis(state);
  if (!state || !analysis) throw new PhaseError('No analysis found for this phase', 404);

  const question = analysis.questions.find((q) => q.id === questionId);
  if (!question) throw new PhaseError('Question not found', 404);

  question.status = 'skipped';
  updatePhaseState(sessionId, phaseId, (s) => {
    s.analyses[s.analyses.length - 1] = analysis;
  });

  // A skipped question is an open item, not a confirmed fact.
  brain.updateBrain(
    sessionId,
    (b) => {
      const item = `Unanswered (skipped by user): ${question.question}`;
      if (!b.openItems.includes(item)) b.openItems.push(item);
    },
    phaseId
  );

  return { question, ...answerState(sessionId, phaseId) };
}

// ── Approval ───────────────────────────────────────────────────────────────────

export interface PhaseApprovalState {
  exists: boolean;
  cycleCount: number;
  maxCycles: number;
  questionsExhausted: boolean;
  approvalStatus: 'pending' | 'approved';
  approvedAt?: string;
  hasSummary: boolean;
  confidenceScore: number;
  summary: UnderstandingSummary | null;
  humanInputs: { text: string; at: string }[];
  projectName: string;
  sourceDocuments: string[];
  canGenerateSections: boolean;
}

export function phaseApprovalState(sessionId: string, phaseId: string): PhaseApprovalState {
  const status = brain.getStatus(sessionId, phaseId);
  const data = brain.readBrain(sessionId, phaseId);
  return {
    exists: status.exists,
    cycleCount: status.cycleCount,
    maxCycles: status.maxCycles,
    questionsExhausted: status.questionsExhausted,
    approvalStatus: status.approvalStatus,
    approvedAt: status.approvedAt,
    hasSummary: status.hasSummary,
    confidenceScore: status.confidenceScore,
    summary: data?.understandingSummary ?? null,
    humanInputs: data?.humanInputs ?? [],
    projectName: data?.projectName ?? 'Untitled Project',
    sourceDocuments: data?.sourceDocuments ?? [],
    canGenerateSections: status.approvalStatus === 'approved',
  };
}

export async function generatePhaseApprovalSummary(
  sessionId: string,
  phaseId: string,
  opts: { force?: boolean; humanInput?: string } = {}
): Promise<PhaseApprovalState> {
  const config = requireBuildablePhase(phaseId);
  const llm = requireLLM();

  const existing = brain.readBrain(sessionId, phaseId);
  if (!existing) throw new PhaseError('This phase has not been started yet', 404);

  if (existing.understandingSummary && !opts.force && !opts.humanInput) {
    return phaseApprovalState(sessionId, phaseId);
  }

  if (opts.humanInput?.trim()) {
    // Persist the human input FIRST so it is part of the context the summary reads.
    brain.recordHumanInput(sessionId, opts.humanInput.trim(), phaseId);
  }

  // The requirement phase's summary generator already reads the session's documents
  // and its brain; reuse it so both entry points produce identical summaries.
  if (isRequirement(phaseId)) {
    const session = loadSession(sessionId);
    if (!session) throw new PhaseError('Session not found', 404);
    const analysis = latestAnalysis(readPhaseState(sessionId, phaseId));
    const pending = analysis?.questions.filter((q) => q.status === 'pending') ?? [];
    if (pending.length > 0 && existing.cycleCount < MAX_QUESTION_CYCLES && !opts.force) {
      throw new PhaseError(
        `${pending.length} question(s) are still unanswered. Answer or skip them, or pass force:true to proceed anyway.`,
        400
      );
    }
    await generateUnderstandingSummary(llm, session, opts.humanInput?.trim());
    updatePhaseState(sessionId, phaseId, (s) => {
      s.currentStep = 'approval';
    });
    return phaseApprovalState(sessionId, phaseId);
  }

  const prompt = buildPhaseApprovalPrompt({
    config,
    fullContextBlock: phaseContextBlock(sessionId, phaseId),
    sourceMaterial: await buildSourceMaterial(sessionId, config),
    latestHumanInput: opts.humanInput?.trim(),
  });

  console.log(`[phase:${phaseId}] session=${sessionId} generating approval summary (${llm.name})`);
  const raw = await llm.analyze(prompt, '');
  const parsed = parseLlmJson<any>(raw, `${phaseId} understanding summary`);

  const summary: UnderstandingSummary = {
    projectOverview:
      (typeof parsed.projectOverview === 'string' && parsed.projectOverview.trim()) ||
      'No overview could be derived from the available material.',
    confirmedFacts: toStringArray(parsed.confirmedFacts),
    assumptions: toStringArray(parsed.assumptions),
    openItems: toStringArray(parsed.openItems),
    readyToGenerate: parsed.readyToGenerate !== false,
    confidenceScore: clampScore(parsed.confidenceScore) || existing.confidenceScore,
    generatedAt: new Date().toISOString(),
  };

  brain.recordUnderstandingSummary(sessionId, summary, phaseId);
  updatePhaseState(sessionId, phaseId, (s) => {
    s.currentStep = 'approval';
  });

  return phaseApprovalState(sessionId, phaseId);
}

export function approvePhaseUnderstanding(
  sessionId: string,
  phaseId: string,
  additionalInput?: string
): PhaseApprovalState {
  requireBuildablePhase(phaseId);
  const data = brain.readBrain(sessionId, phaseId);
  if (!data) throw new PhaseError('This phase has not been started yet', 404);
  if (!data.understandingSummary) {
    throw new PhaseError('Generate the understanding summary before approving', 400);
  }

  if (additionalInput?.trim()) {
    brain.recordHumanInput(sessionId, additionalInput.trim(), phaseId);
  }
  brain.approve(sessionId, phaseId);

  if (isRequirement(phaseId)) {
    const session = loadSession(sessionId);
    if (session) {
      session.approvalStatus = 'approved';
      session.approvedAt = new Date().toISOString();
      session.currentStep = 'approved';
      saveSession(session);
    }
  } else {
    updatePhaseState(sessionId, phaseId, (s) => {
      s.currentStep = 'sections';
    });
  }

  console.log(`[phase:${phaseId}] session=${sessionId} APPROVED by human`);
  return phaseApprovalState(sessionId, phaseId);
}

function toStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : JSON.stringify(v)))
    .filter((v) => v.length > 0);
}

// ── Sections ───────────────────────────────────────────────────────────────────

export function initPhaseSections(sessionId: string, phaseId: string): PhaseDoc {
  const config = requireBuildablePhase(phaseId);

  // Human-in-the-loop gate: sections may only be generated from an understanding a
  // human has signed off on.
  const status = brain.getStatus(sessionId, phaseId);
  if (status.exists && status.approvalStatus !== 'approved') {
    throw new PhaseError(
      `The ${config.name} understanding must be approved by a human before the document can be generated.`,
      403
    );
  }

  const data = brain.readBrain(sessionId, phaseId);
  const doc = initPhaseDoc(sessionId, config, {
    projectName: projectNameFor(sessionId, data?.projectName ?? 'Untitled Project'),
    sourceDocuments: data?.sourceDocuments ?? [],
    confidenceScore: data?.confidenceScore ?? 0,
  });

  updatePhaseState(sessionId, phaseId, (s) => {
    s.currentStep = 'sections';
  });
  updatePhaseRecord(sessionId, phaseId, { documentId: doc.id }, projectIdFor(sessionId));
  return doc;
}

export async function generatePhaseSection(
  sessionId: string,
  phaseId: string,
  sectionNumber: number,
  feedback?: string
): Promise<{ sectionNumber: number; content: string; version: number; doc: PhaseDoc }> {
  const config = requireBuildablePhase(phaseId);
  const llm = requireLLM();

  const doc = getPhaseDoc(sessionId, phaseId);
  if (!doc) throw new PhaseError('Initialize the document before generating sections', 404);

  const section = config.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new PhaseError(`Invalid section number ${sectionNumber}`, 400);

  const previousSections: Record<string, string> = {};
  for (const s of doc.sections) {
    if (s.status === 'approved' && s.content) previousSections[String(s.number)] = s.content;
  }

  const qnaAnswers = flattenPhaseAnswers(sessionId, phaseId);
  let prompt: string;

  if (isRequirement(phaseId)) {
    // The requirement phase's section prompts carry section-specific wording that
    // its documents already depend on — keep using them verbatim.
    const session = loadSession(sessionId);
    prompt = getSectionPrompt(sectionNumber, {
      parsedDocuments: session ? await readParsedDocuments(session) : '',
      qnaAnswers: qnaAnswers ?? '',
      secondBrainContext: brain.buildSecondBrainContextBlock(sessionId),
      previousSections,
      userFeedback: feedback || undefined,
      sourceFileNames: doc.sourceDocuments,
      linkedTicketIds: doc.linkedTickets,
      requirementId: doc.id,
      confidenceScore: doc.confidenceScore,
    });
  } else {
    const previous = config.requiresPhase ? getPhase(config.requiresPhase) : undefined;
    const input = brain.readBrain(sessionId, phaseId)?.inputFromPreviousPhase;
    prompt = buildPhaseSectionPrompt({
      config,
      section,
      fullContextBlock: phaseContextBlock(sessionId, phaseId),
      previousPhaseDocument: input?.previousPhaseDocument,
      earlierPhaseDocuments: input?.earlierPhaseDocuments,
      previousPhaseName: previous?.name,
      previousPhaseDocumentId: input?.documentId,
      previousSections,
      qnaAnswers,
      userFeedback: feedback || undefined,
      documentId: doc.id,
      projectName: doc.projectName,
      confidenceScore: doc.confidenceScore,
    });
  }

  console.log(`[phase:${phaseId}] session=${sessionId} generating section ${sectionNumber} (${llm.name})`);
  const content = await llm.analyze(prompt, '');
  const updated = setSectionContent(sessionId, phaseId, sectionNumber, content.trim(), feedback);
  const updatedSection = updated.sections.find((s) => s.number === sectionNumber)!;

  if (feedback?.trim() && !isRequirement(phaseId)) {
    brain.recordSectionEvent(sessionId, phaseId, {
      sectionNumber,
      title: section.title,
      action: 'regenerated',
      version: updatedSection.versions.length,
      feedback: feedback.trim(),
    });
  }

  return {
    sectionNumber,
    content: updatedSection.content,
    version: updatedSection.versions.length,
    doc: updated,
  };
}

export function approvePhaseSection(
  sessionId: string,
  phaseId: string,
  sectionNumber: number,
  content?: string
): PhaseDoc {
  requireBuildablePhase(phaseId);
  const before = getPhaseDoc(sessionId, phaseId)?.sections.find((s) => s.number === sectionNumber);
  const doc = approveDocSection(sessionId, phaseId, sectionNumber, content);

  if (!isRequirement(phaseId)) {
    const section = doc.sections.find((s) => s.number === sectionNumber)!;
    brain.recordSectionEvent(sessionId, phaseId, {
      sectionNumber,
      title: section.title,
      action: content !== undefined && before && content !== before.content ? 'edited' : 'approved',
      version: section.versions.length,
    });
  }
  return doc;
}

export function skipPhaseSection(sessionId: string, phaseId: string, sectionNumber: number): PhaseDoc {
  requireBuildablePhase(phaseId);
  const doc = skipDocSection(sessionId, phaseId, sectionNumber);
  if (!isRequirement(phaseId)) {
    const section = doc.sections.find((s) => s.number === sectionNumber)!;
    brain.recordSectionEvent(sessionId, phaseId, { sectionNumber, title: section.title, action: 'skipped' });
  }
  return doc;
}

export function revertPhaseSection(
  sessionId: string,
  phaseId: string,
  sectionNumber: number,
  version: number
): PhaseDoc {
  requireBuildablePhase(phaseId);
  return revertDocSection(sessionId, phaseId, sectionNumber, version);
}

export function assemblePhase(sessionId: string, phaseId: string): { markdown: string; doc: PhaseDoc } {
  const config = requirePhase(phaseId);
  const doc = getPhaseDoc(sessionId, phaseId);
  if (!doc) throw new PhaseError('No document exists for this phase', 404);
  return { markdown: assemblePhaseDoc(doc, config), doc };
}

export function finalizePhase(
  sessionId: string,
  phaseId: string
): { markdown: string; savedPath: string; documentId: string } {
  const config = requireBuildablePhase(phaseId);
  const doc = getPhaseDoc(sessionId, phaseId);
  if (!doc) throw new PhaseError('No document exists for this phase', 404);

  const { markdown, savedPath } = finalizePhaseDoc(doc, config);
  markPhaseCompleted(
    sessionId,
    phaseId,
    { documentId: doc.id, confidenceScore: doc.confidenceScore },
    projectIdFor(sessionId)
  );
  updatePhaseState(sessionId, phaseId, (s) => {
    s.currentStep = 'export';
  });

  console.log(`[phase:${phaseId}] session=${sessionId} finalized ${doc.id} → ${savedPath}`);
  return { markdown, savedPath, documentId: doc.id };
}

// ── Diagram ────────────────────────────────────────────────────────────────────

/**
 * Generate the phase's system diagram from everything it has approved.
 *
 * It reads the assembled document — every approved section, so the diagram is
 * drawn from the architecture the human signed off on, not from the requirement
 * it started as — plus this phase's Second Brain and every brain before it, so
 * the model has the same project context every other prompt gets.
 *
 * The result is a draft: nothing is embedded in the document until a human
 * approves it.
 */
export async function generatePhaseDiagram(
  sessionId: string,
  phaseId: string,
  feedback?: string
): Promise<PhaseDiagram> {
  const config = requireBuildablePhase(phaseId);
  const llm = requireLLM();

  const doc = getPhaseDoc(sessionId, phaseId);
  if (!doc) throw new PhaseError('No document exists for this phase yet', 404);

  const approved = doc.sections.filter((s) => s.status === 'approved');
  if (approved.length === 0) {
    throw new PhaseError('Approve at least one section before generating a diagram', 409);
  }

  const existing = readDiagram(sessionId, phaseId);

  const prompt = buildDiagramPrompt({
    documentMarkdown: assemblePhaseDoc(doc, config),
    contextBlock: phaseContextBlock(sessionId, phaseId),
    projectName: doc.projectName,
    documentId: doc.id,
    phaseName: config.name,
    feedback: feedback?.trim() || undefined,
    previousDiagram: feedback && existing.mermaid ? existing.mermaid : undefined,
  });

  const raw = await llm.analyze(prompt, '');
  const mermaid = extractMermaid(raw);

  if (!mermaid) {
    throw new PhaseError('The model returned an empty diagram. Try generating again.', 502);
  }
  if (!looksLikeMermaid(mermaid)) {
    throw new PhaseError(
      'The model did not return Mermaid syntax. Try generating again, or write the diagram by hand.',
      502
    );
  }

  const saved = saveGeneratedDiagram(sessionId, phaseId, mermaid);
  console.log(
    `[phase:${phaseId}] session=${sessionId} generated diagram revision ${saved.revision} (${mermaid.length} chars)`
  );
  return saved;
}

export function getPhaseDiagram(sessionId: string, phaseId: string): PhaseDiagram {
  requirePhase(phaseId);
  return readDiagram(sessionId, phaseId);
}

export function savePhaseDiagram(sessionId: string, phaseId: string, mermaid: string): PhaseDiagram {
  requireBuildablePhase(phaseId);
  return saveEditedDiagram(sessionId, phaseId, mermaid);
}

export function approvePhaseDiagram(
  sessionId: string,
  phaseId: string,
  mermaid?: string
): PhaseDiagram {
  requireBuildablePhase(phaseId);
  return approveDiagram(sessionId, phaseId, mermaid);
}

export function skipPhaseDiagram(sessionId: string, phaseId: string): PhaseDiagram {
  requireBuildablePhase(phaseId);
  return skipDiagram(sessionId, phaseId);
}

// ── Status ─────────────────────────────────────────────────────────────────────

export function phaseStatus(sessionId: string, phaseId: string): PhaseRuntimeStatus {
  const config = requirePhase(phaseId);
  const status = brain.getStatus(sessionId, phaseId);
  const state = readPhaseState(sessionId, phaseId);
  const doc = getPhaseDoc(sessionId, phaseId);

  const approvedSections = doc?.sections.filter((s) => s.status === 'approved').length ?? 0;
  const totalSections = doc?.sections.length ?? config.sections.length;
  const diagram =
    config.diagramMode === 'set'
      ? summarizeDiagramSet(listDiagramSet(sessionId, phaseId))
      : (({ status, revision, mermaid }) => ({ status, revision, hasCode: Boolean(mermaid.trim()) }))(
          readDiagram(sessionId, phaseId)
        );

  return {
    phaseId,
    sessionId,
    exists: status.exists,
    started: status.exists,
    currentStep: state?.currentStep ?? (config.intake === 'upload' ? 'upload' : 'import'),
    cycleCount: status.cycleCount,
    maxCycles: status.maxCycles,
    questionsExhausted: status.questionsExhausted,
    approvalStatus: status.approvalStatus,
    approvedAt: status.approvedAt,
    confidenceScore: status.confidenceScore,
    hasSummary: status.hasSummary,
    doc: doc
      ? { id: doc.id, status: doc.status, approvedSections, totalSections }
      : null,
    imported: getImportSummary(sessionId, phaseId),
    completed: doc?.status === 'finalized',
    diagram,
  };
}

/** Human-readable one-liner for the phase project list. */
export function phaseStatusLabel(status: PhaseRuntimeStatus, config: PhaseConfig): string {
  if (!status.exists) return 'Not started';
  if (status.completed) return `Completed — ${status.doc?.id ?? config.docIdPrefix}`;
  if (status.doc) return `Sections ${status.doc.approvedSections}/${status.doc.totalSections} approved`;
  if (status.approvalStatus === 'approved') return 'Approved — ready to generate sections';
  if (status.hasSummary) return 'Awaiting human approval';
  if (status.cycleCount > 0) return `Q&A in progress (Cycle ${status.cycleCount})`;
  return 'Imported — ready to analyze';
}

// ── Transition ─────────────────────────────────────────────────────────────────

/**
 * Hand a project to the next phase. Always explicit — a human clicks "Proceed";
 * nothing here runs on its own.
 *
 * The next phase reuses the SAME session id: one project owns one session, and
 * that session holds every phase's brain and output side by side (see the layout
 * in secondBrain.ts). `nextSessionId` is returned regardless, so callers never
 * have to know that.
 */
export function proceedToNextPhase(
  sessionId: string,
  currentPhaseId: string
): { nextPhaseId: string; nextSessionId: string; nextPhaseUrl: string } {
  const config = requirePhase(currentPhaseId);
  const next = getNextPhase(currentPhaseId);

  if (!next) throw new PhaseError(`${config.name} is the last phase in the lifecycle.`, 400);
  if (next.comingSoon) throw new PhaseError(`The ${next.name} phase is not available yet.`, 409);

  const status = brain.getStatus(sessionId, currentPhaseId);
  if (status.approvalStatus !== 'approved') {
    throw new PhaseError(
      `The ${config.name} phase must be approved by a human before proceeding to ${next.name}.`,
      403
    );
  }

  startPhase(sessionId, next.id);

  return {
    nextPhaseId: next.id,
    nextSessionId: sessionId,
    nextPhaseUrl: `/api/phase/${next.id}/${sessionId}/status`,
  };
}

/** Whether each phase of this project is locked, available, running or done. */
export function projectPhaseProgress(sessionId: string) {
  const progress = readProgress(sessionId, projectIdFor(sessionId));
  const phases = getAllPhases();

  return phases.map((config, index) => {
    if (config.workspace === 'ide') {
      const dev = devStatus(sessionId);
      return {
        phaseId: config.id,
        name: config.name,
        shortName: config.shortName,
        icon: config.icon,
        color: config.color,
        comingSoon: false,
        status: (dev.exists ? 'in-progress' : 'not-started') as 'in-progress' | 'not-started',
        statusLabel: dev.label,
        documentId: undefined,
        confidenceScore: undefined,
        startedAt: undefined,
        completedAt: undefined,
        lockedReason: undefined,
      };
    }
    const status = phaseStatus(sessionId, config.id);
    const record = progress.phases[config.id];

    const previous = index > 0 ? phases[index - 1] : undefined;
    const previousApproved = previous
      ? brain.getStatus(sessionId, previous.id).approvalStatus === 'approved'
      : true;

    let value: 'not-started' | 'in-progress' | 'completed' | 'locked';
    if (status.completed || record?.status === 'completed') value = 'completed';
    else if (status.exists) value = 'in-progress';
    else if (config.comingSoon || !previousApproved) value = 'locked';
    else value = 'not-started';

    return {
      phaseId: config.id,
      name: config.name,
      shortName: config.shortName,
      icon: config.icon,
      color: config.color,
      comingSoon: Boolean(config.comingSoon),
      status: value,
      statusLabel: phaseStatusLabel(status, config),
      documentId: status.doc?.id ?? record?.documentId,
      confidenceScore: status.confidenceScore || record?.confidenceScore,
      startedAt: record?.startedAt,
      completedAt: record?.completedAt,
      lockedReason:
        value === 'locked'
          ? config.comingSoon
            ? 'Coming soon'
            : `Complete ${previous?.name ?? 'the previous phase'} first`
          : undefined,
    };
  });
}

export { getNextPhase, getPreviousPhase };
