import type { LLMAdapter } from './llm/adapter.js';
import type { Session, UnderstandingSummary } from '../types/index.js';
import { buildApprovalSummaryPrompt } from '../prompts/approvalSummary.js';
import { buildSecondBrainContextBlock, readBrain, recordUnderstandingSummary } from './secondBrain.js';
import { parseLlmJson, readParsedDocuments } from './sessionContext.js';

function toStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : JSON.stringify(v)))
    .filter((v) => v.length > 0);
}

function clampScore(value: any, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Builds the "here is my complete understanding" summary the human signs off on.
 * This step never produces questions — by the time it runs, the question budget
 * is spent by design.
 */
export async function generateUnderstandingSummary(
  llm: LLMAdapter,
  session: Session,
  latestHumanInput?: string
): Promise<UnderstandingSummary> {
  const brain = readBrain(session.id);
  const parsedDocuments = await readParsedDocuments(session, 40_000);

  const prompt = buildApprovalSummaryPrompt({
    secondBrainContext: buildSecondBrainContextBlock(session.id),
    parsedDocuments,
    latestHumanInput,
  });

  const raw = await llm.analyze(prompt, '');
  const parsed = parseLlmJson<any>(raw, 'understanding summary');

  const fallbackConfidence = brain?.confidenceScore ?? 0;
  const summary: UnderstandingSummary = {
    projectOverview:
      (typeof parsed.projectOverview === 'string' && parsed.projectOverview.trim()) ||
      'No project overview could be derived from the available material.',
    confirmedFacts: toStringArray(parsed.confirmedFacts),
    assumptions: toStringArray(parsed.assumptions),
    openItems: toStringArray(parsed.openItems),
    readyToGenerate: parsed.readyToGenerate !== false,
    confidenceScore: clampScore(parsed.confidenceScore, fallbackConfidence),
    generatedAt: new Date().toISOString(),
  };

  recordUnderstandingSummary(session.id, summary);
  return summary;
}
