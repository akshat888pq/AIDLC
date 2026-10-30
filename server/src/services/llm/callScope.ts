import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-LLM-call record. The LLMAdapter interface returns a plain string, so the
 * provider that actually served a call, its model and its token usage travel
 * back to the governance middleware through here instead.
 */
export interface CallRecord {
  provider?: string;
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  fellBack?: boolean;
  cacheHit?: boolean;
  leakageDetected?: boolean;
}

const scope = new AsyncLocalStorage<CallRecord>();

export function runInCallScope<T>(record: CallRecord, fn: () => Promise<T>): Promise<T> {
  return scope.run(record, fn);
}

/** The record for the call in flight, or a throwaway one outside a scope. */
export function currentCall(): CallRecord {
  return scope.getStore() ?? {};
}
