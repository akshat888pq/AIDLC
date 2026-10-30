import type { ChatOptions, LLMAdapter } from '../adapter.js';
import type { CallRecord } from '../callScope.js';
import { runInCallScope } from '../callScope.js';

/**
 * LLM middleware: each module (audit, cache, rate limit, quota, output guard)
 * sees every call on the way in and its result on the way out, wrapping the
 * adapter rather than living inside it. Add or remove one in governance/index.ts.
 */

export interface LLMCall {
  kind: 'analyze' | 'chat';
  systemPrompt: string;
  userContent: string;
  messages: { role: 'user' | 'model'; content: string }[];
  options: ChatOptions;
  record: CallRecord;
}

export type Next = (call: LLMCall) => Promise<string>;
export type LLMMiddleware = (call: LLMCall, next: Next) => Promise<string>;

/** Thrown when a policy (rate limit, quota) refuses a call. */
export class LLMPolicyError extends Error {
  constructor(message: string, readonly statusCode = 429) {
    super(message);
  }
}

/** The whole prompt as one string, for hashing and size estimates. */
export function promptText(call: LLMCall): string {
  return call.kind === 'analyze'
    ? `${call.systemPrompt}\n\n${call.userContent}`
    : `${call.systemPrompt}\n\n${call.messages.map((m) => `${m.role}: ${m.content}`).join('\n\n')}`;
}

export function withMiddleware(adapter: LLMAdapter, middleware: LLMMiddleware[]): LLMAdapter {
  const terminal: Next = (c) =>
    c.kind === 'analyze' ? adapter.analyze(c.systemPrompt, c.userContent) : adapter.chat(c.systemPrompt, c.messages, c.options);
  const run = middleware.reduceRight<Next>((next, mw) => (c) => mw(c, next), terminal);

  const start = (call: Omit<LLMCall, 'record'>) => {
    const record: CallRecord = {};
    return runInCallScope(record, () => run({ ...call, record }));
  };

  return {
    name: adapter.name,
    isConfigured: () => adapter.isConfigured(),
    analyze: (systemPrompt, userContent) =>
      start({ kind: 'analyze', systemPrompt, userContent, messages: [], options: {} }),
    chat: (systemPrompt, messages, options = {}) =>
      start({ kind: 'chat', systemPrompt, userContent: '', messages, options }),
  };
}
