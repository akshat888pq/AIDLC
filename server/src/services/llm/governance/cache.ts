import { getRequestContext } from '../../../context/requestContext.js';
import { sha256 } from '../../../audit/auditStore.js';
import { assignmentFor } from '../modelConfig.js';
import type { LLMMiddleware } from './pipeline.js';
import { promptText } from './pipeline.js';

/**
 * Response cache: an identical prompt to the same model within the TTL returns
 * the stored answer without calling the LLM. Per project — the project id is part
 * of the key and each project's entries can be cleared on their own.
 *
 * In memory: a restart clears it, which is the safe failure for a cache.
 * A request can opt out with `x-aidlc-llm-cache: bypass` (e.g. "regenerate").
 */

interface Entry {
  value: string;
  expiresAt: number;
  model?: string;
  provider?: string;
}

const TTL_MS = Number(process.env.LLM_CACHE_TTL_SECONDS ?? 3600) * 1000;
const MAX_ENTRIES_PER_PROJECT = 500;
const UNSCOPED = '_unscoped';

const store = new Map<string, Map<string, Entry>>();

export function cacheEnabled(): boolean {
  return process.env.LLM_CACHE_ENABLED !== 'false';
}

export function clearCache(projectId?: string): number {
  if (!projectId) {
    const n = [...store.values()].reduce((sum, m) => sum + m.size, 0);
    store.clear();
    return n;
  }
  const n = store.get(projectId)?.size ?? 0;
  store.delete(projectId);
  return n;
}

export function cacheStats(projectId: string): { entries: number; ttlSeconds: number; enabled: boolean } {
  const bucket = store.get(projectId);
  const now = Date.now();
  let live = 0;
  for (const e of bucket?.values() ?? []) if (e.expiresAt > now) live++;
  return { entries: live, ttlSeconds: TTL_MS / 1000, enabled: cacheEnabled() };
}

export const cacheMiddleware: LLMMiddleware = async (call, next) => {
  const ctx = getRequestContext();
  if (!cacheEnabled() || ctx?.cacheBypass) return next(call);

  const projectId = ctx?.projectId ?? UNSCOPED;
  const model = assignmentFor('generation').model;
  const key = sha256(JSON.stringify([projectId, model, call.kind, promptText(call), call.options.json ?? false]));

  let bucket = store.get(projectId);
  const hit = bucket?.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    call.record.cacheHit = true;
    call.record.model = hit.model;
    call.record.provider = hit.provider;
    console.log(`[LLM cache] hit project=${projectId}`);
    return hit.value;
  }

  const value = await next(call);

  if (!bucket) store.set(projectId, (bucket = new Map()));
  if (bucket.size >= MAX_ENTRIES_PER_PROJECT) {
    // Maps iterate in insertion order: the first key is the oldest.
    bucket.delete(bucket.keys().next().value!);
  }
  bucket.set(key, { value, expiresAt: Date.now() + TTL_MS, model: call.record.model, provider: call.record.provider });
  return value;
};
