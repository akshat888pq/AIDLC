import type { LLMAdapter } from './llm/adapter.js';
import type { AnalysisResult, ClarifyingQuestion } from '../types/index.js';
import { buildAnalysisPrompt } from '../prompts/documentAnalysis.js';
import {
  MAX_QUESTION_CYCLES,
  answeredQuestionKeys,
  buildSecondBrainContextBlock,
  normalizeQuestion,
  readBrain,
} from './secondBrain.js';
import { parseLlmJson } from './sessionContext.js';

const MAX_CHARS_PER_CHUNK = 100_000;

/** Question budget per cycle. Cycle 1 is a comprehensive batch, cycle 2 is a final top-up. */
export const QUESTION_LIMIT_BY_CYCLE: Record<number, number> = { 1: 10, 2: 3 };

/** Below this confidence after cycle 1, the agent earns its one follow-up cycle. */
export const CYCLE_2_CONFIDENCE_THRESHOLD = 70;

function chunkContent(content: string): string[] {
  if (content.length <= MAX_CHARS_PER_CHUNK) return [content];

  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    let end = start + MAX_CHARS_PER_CHUNK;
    if (end < content.length) {
      const breakPoint = content.lastIndexOf('\n', end);
      if (breakPoint > start) end = breakPoint;
    }
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks;
}

function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }
  return raw;
}

export interface AnalyzeOptions {
  sessionId: string;
  /** The cycle this analysis run is issuing questions for. >= 3 means no questions at all. */
  cycleNumber: number;
  previousAnswers?: string;
}

export interface AnalyzeOutcome extends AnalysisResult {
  /** Short human-style project title, used to name the second brain and reports. */
  projectName?: string;
  /** The cycle the returned questions belong to; null when no questions were issued. */
  questionCycle: number | null;
  /** True once no further questions can ever be asked for this session. */
  questionsExhausted: boolean;
  /** Human-readable reason questions were withheld, if they were. */
  questionsWithheldReason?: string;
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, important: 1, 'nice-to-have': 2 };

/**
 * Drops anything the user has already answered (per the Second Brain), then trims to
 * the cycle's budget keeping the highest-priority questions.
 */
function filterAndCapQuestions(
  questions: ClarifyingQuestion[],
  sessionId: string,
  cycleNumber: number
): ClarifyingQuestion[] {
  const alreadyAnswered = answeredQuestionKeys(sessionId);
  const seenThisBatch = new Set<string>();

  const fresh = questions.filter((q) => {
    if (!q.question || !q.question.trim()) return false;
    const key = normalizeQuestion(q.question);
    if (!key) return false;
    if (alreadyAnswered.has(key)) {
      console.log(`[analyzer] dropping already-answered question: "${q.question}"`);
      return false;
    }
    if (seenThisBatch.has(key)) return false;
    seenThisBatch.add(key);
    return true;
  });

  const limit = QUESTION_LIMIT_BY_CYCLE[cycleNumber] ?? 0;
  if (fresh.length <= limit) return fresh;

  const sorted = [...fresh].sort(
    (a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
  );
  console.log(`[analyzer] capping ${fresh.length} questions to ${limit} for cycle ${cycleNumber}`);
  return sorted.slice(0, limit);
}

export async function analyzeDocuments(
  llm: LLMAdapter,
  parsedContent: string,
  options: AnalyzeOptions
): Promise<AnalyzeOutcome> {
  const { sessionId, cycleNumber, previousAnswers } = options;

  const prompt = buildAnalysisPrompt({
    cycleNumber,
    secondBrainContext: buildSecondBrainContextBlock(sessionId),
    previousAnswers,
  });

  const chunks = chunkContent(parsedContent);
  const content =
    chunks.length === 1
      ? chunks[0]
      : chunks
          .map((chunk, i) => `--- DOCUMENT CHUNK ${i + 1} of ${chunks.length} ---\n${chunk}`)
          .join('\n\n');

  const rawResponse = await llm.analyze(prompt, content);
  const parsed = parseLlmJson<any>(rawResponse, 'document analysis');

  const understanding = {
    projectOverview: parsed.understanding?.projectOverview || 'NOT FOUND in documents',
    businessObjective: parsed.understanding?.businessObjective || 'NOT FOUND in documents',
    scope: {
      inScope: parsed.understanding?.scope?.inScope || [],
      outOfScope: parsed.understanding?.scope?.outOfScope || [],
      unclear: parsed.understanding?.scope?.unclear || [],
    },
    stakeholders: parsed.understanding?.stakeholders || [],
    timeline: parsed.understanding?.timeline || 'NOT FOUND in documents',
    techStack: parsed.understanding?.techStack || 'NOT FOUND in documents',
    deliverables: parsed.understanding?.deliverables || [],
    constraints: parsed.understanding?.constraints || [],
    assumptions: parsed.understanding?.assumptions || [],
    risks: parsed.understanding?.risks || [],
    dependencies: parsed.understanding?.dependencies || [],
  };

  const confidenceScore = clampScore(parsed.confidenceScore);

  const projectName =
    typeof parsed.projectName === 'string' && parsed.projectName.trim().length > 0
      ? parsed.projectName.trim().slice(0, 80)
      : undefined;

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

  // ── Cycle enforcement (server side, never trusting the model) ──

  if (cycleNumber > MAX_QUESTION_CYCLES) {
    return {
      understanding,
      projectName,
      confidenceScore,
      questions: [],
      questionCycle: null,
      questionsExhausted: true,
      questionsWithheldReason: `Maximum of ${MAX_QUESTION_CYCLES} question cycles reached — proceeding to human approval.`,
    };
  }

  // Cycle 2 is earned only when confidence after cycle 1 is still low.
  if (cycleNumber === 2 && confidenceScore >= CYCLE_2_CONFIDENCE_THRESHOLD) {
    return {
      understanding,
      projectName,
      confidenceScore,
      questions: [],
      questionCycle: null,
      questionsExhausted: true,
      questionsWithheldReason: `Confidence is ${confidenceScore}% (>= ${CYCLE_2_CONFIDENCE_THRESHOLD}%) after cycle 1 — no follow-up questions needed.`,
    };
  }

  const questions = filterAndCapQuestions(rawQuestions, sessionId, cycleNumber);

  if (questions.length === 0) {
    return {
      understanding,
      projectName,
      confidenceScore,
      questions: [],
      questionCycle: null,
      questionsExhausted: cycleNumber >= MAX_QUESTION_CYCLES,
      questionsWithheldReason: 'The agent raised no new questions — everything it asked is already answered in the Second Brain.',
    };
  }

  return {
    understanding,
    projectName,
    confidenceScore,
    questions,
    questionCycle: cycleNumber,
    questionsExhausted: cycleNumber >= MAX_QUESTION_CYCLES,
  };
}

function clampScore(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Flatten every answered question in the Second Brain for prompt injection. */
export function flattenAnsweredQuestions(sessionId: string): string | undefined {
  const brain = readBrain(sessionId);
  if (!brain || brain.qna.length === 0) return undefined;
  return brain.qna
    .map((q) => `[Cycle ${q.cycle}] Q: ${q.question}\nA: ${q.answer}`)
    .join('\n\n');
}
