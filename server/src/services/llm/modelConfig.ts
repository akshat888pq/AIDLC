/**
 * Which provider and model serves each kind of LLM work.
 *
 * Scaffold only: every task currently routes through the same Claude model. The
 * table exists so cheap tasks can later move to Haiku and review to a frontier
 * model without touching the phase engine or the adapters.
 *
 * Note: `claude-sonnet-4-20250514` was retired on 2026-06-15 and now 404s, so the
 * default is the current Sonnet. Override with ANTHROPIC_MODEL.
 */

export type TaskKind = 'qa-clarification' | 'generation' | 'review' | 'fallback';

export interface ModelAssignment {
  provider: 'anthropic' | 'google';
  model: string;
}

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

export const modelAssignments: Record<TaskKind, ModelAssignment> = {
  'qa-clarification': { provider: 'anthropic', model: CLAUDE_MODEL },
  generation: { provider: 'anthropic', model: CLAUDE_MODEL },
  review: { provider: 'anthropic', model: CLAUDE_MODEL },
  // The Gemini adapter walks its own MODEL_FALLBACK_CHAIN; this is its first entry.
  fallback: { provider: 'google', model: 'gemini-3.5-flash' },
};

/** Routing is not implemented yet: everything is "generation". */
export function assignmentFor(_task: TaskKind = 'generation'): ModelAssignment {
  return modelAssignments.generation;
}

/**
 * USD per million tokens, for the quota widget's cost estimate only. Gemini rates
 * are placeholders — set GEMINI_INPUT_PRICE / GEMINI_OUTPUT_PRICE to your contract.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

/**
 * `inputTokens` is the full prompt size; the cached portions within it are billed
 * at ~0.1x (reads) and ~1.25x (writes) of the input rate.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const price =
    PRICES[model] ??
    (model.startsWith('gemini')
      ? {
          input: Number(process.env.GEMINI_INPUT_PRICE ?? 0.3),
          output: Number(process.env.GEMINI_OUTPUT_PRICE ?? 2.5),
        }
      : { input: 0, output: 0 });
  const uncached = Math.max(inputTokens - cacheReadTokens - cacheWriteTokens, 0);
  const effectiveInput = uncached + cacheReadTokens * 0.1 + cacheWriteTokens * 1.25;
  return (effectiveInput * price.input + outputTokens * price.output) / 1_000_000;
}
