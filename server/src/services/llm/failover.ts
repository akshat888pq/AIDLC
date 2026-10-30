import Anthropic from '@anthropic-ai/sdk';
import type { ChatOptions, LLMAdapter } from './adapter.js';
import { currentCall } from './callScope.js';
import { modelAssignments } from './modelConfig.js';

/**
 * Claude first, the existing Gemini chain second.
 *
 * Falls back only when Claude is unavailable — 429 (rate limited), 503/529
 * (overloaded), 504 or a timeout / connection failure. A 400 or 401 means the
 * request or the key is wrong; trying another model would hide that, so those
 * abort with a message saying what to fix. Anything else aborts too.
 */

const RETRYABLE_STATUS = new Set([429, 503, 504, 529]);

/** Error types carried by SSE `error` events, which arrive mid-stream with no HTTP status. */
const RETRYABLE_STREAM_ERRORS = new Set(['overloaded_error', 'rate_limit_error']);

export function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return false;
  if (err instanceof Anthropic.APIConnectionError) return true; // includes APIConnectionTimeoutError
  if (!(err instanceof Anthropic.APIError)) return false;
  if (typeof err.status === 'number') return RETRYABLE_STATUS.has(err.status);
  const type = (err.error as { error?: { type?: string } } | undefined)?.error?.type;
  return !!type && RETRYABLE_STREAM_ERRORS.has(type);
}

function describe(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error('Claude authentication failed (401): ANTHROPIC_API_KEY is invalid or revoked. Fix the key in .env — not falling back to another model.');
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new Error(`Claude rejected the request (400): ${err.message}. Fix the request or model configuration — not falling back to another model.`);
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new Error(`Claude model not found (404): ${err.message}. Check ANTHROPIC_MODEL in .env.`);
  }
  if (err instanceof Anthropic.APIError) {
    return new Error(`Claude request failed (${err.status ?? 'no status'}): ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export class FailoverAdapter implements LLMAdapter {
  readonly name: string;

  constructor(private primary: LLMAdapter, private fallback: LLMAdapter | null) {
    this.name = primary.name;
  }

  isConfigured(): boolean {
    return this.primary.isConfigured();
  }

  analyze(systemPrompt: string, userContent: string): Promise<string> {
    return this.run(
      () => this.primary.analyze(systemPrompt, userContent),
      (fb) => fb.analyze(systemPrompt, userContent)
    );
  }

  chat(systemPrompt: string, messages: { role: 'user' | 'model'; content: string }[], options?: ChatOptions): Promise<string> {
    return this.run(
      () => this.primary.chat(systemPrompt, messages, options),
      (fb) => fb.chat(systemPrompt, messages, options)
    );
  }

  private async run(primary: () => Promise<string>, fallback: (fb: LLMAdapter) => Promise<string>): Promise<string> {
    try {
      return await primary();
    } catch (err) {
      if (!isRetryable(err) || !this.fallback) throw describe(err);

      const reason = err instanceof Anthropic.APIError && err.status ? err.status : 'timeout/connection';
      console.warn(`[LLM] Claude unavailable (${reason}) — falling back to ${this.fallback.name}`);

      const record = currentCall();
      record.fellBack = true;
      record.provider = this.fallback.name === 'gemini' ? 'google' : this.fallback.name;
      // The Gemini adapter walks its own chain and does not report which model
      // answered; record the chain's head.
      record.model = this.fallback.name === 'gemini' ? modelAssignments.fallback.model : this.fallback.name;
      record.usage = undefined;
      return fallback(this.fallback);
    }
  }
}
