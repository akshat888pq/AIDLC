import type { LLMAdapter } from '../adapter.js';
import { auditMiddleware } from './audit.js';
import { cacheMiddleware } from './cache.js';
import { outputGuardMiddleware } from './outputGuard.js';
import { withMiddleware } from './pipeline.js';
import { quotaMiddleware } from './quota.js';
import { rateLimitMiddleware } from './rateLimit.js';

/**
 * The governance chain every LLM call passes through, outermost first:
 *
 *   audit       records the call whatever happens below it
 *   cache       answers repeats without spending a call
 *   rate limit  per-user calls per minute (real calls only)
 *   quota       per-project daily token budget
 *   output      redacts system-prompt leakage before it is cached or returned
 */
export function withGovernance(adapter: LLMAdapter): LLMAdapter {
  return withMiddleware(adapter, [auditMiddleware, cacheMiddleware, rateLimitMiddleware, quotaMiddleware, outputGuardMiddleware]);
}
