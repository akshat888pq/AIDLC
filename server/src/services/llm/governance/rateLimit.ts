import { getRequestContext } from '../../../context/requestContext.js';
import type { LLMMiddleware } from './pipeline.js';
import { LLMPolicyError } from './pipeline.js';

/**
 * At most LLM_RATE_LIMIT_PER_MINUTE real LLM calls per user in any 60-second
 * window (cache hits sit outside this middleware and are not counted).
 */

const WINDOW_MS = 60_000;
const calls = new Map<string, number[]>();

function limit(): number {
  const n = Number(process.env.LLM_RATE_LIMIT_PER_MINUTE ?? 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

export const rateLimitMiddleware: LLMMiddleware = async (call, next) => {
  const userId = getRequestContext()?.userId ?? 'system';
  const now = Date.now();
  const recent = (calls.get(userId) ?? []).filter((t) => t > now - WINDOW_MS);

  if (recent.length >= limit()) {
    const retryIn = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
    calls.set(userId, recent);
    throw new LLMPolicyError(
      `Rate limit reached: at most ${limit()} AI calls per minute per user. Try again in ${retryIn}s.`,
      429
    );
  }

  recent.push(now);
  calls.set(userId, recent);
  return next(call);
};
