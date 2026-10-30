import type { LLMCall } from './pipeline.js';
import { promptText } from './pipeline.js';

/**
 * Tokens a call used. Claude reports exact usage; the Gemini adapter does not
 * surface it, so those calls are estimated at ~4 characters per token.
 */
export function usageOf(call: LLMCall, output: string | null): { inputTokens: number; outputTokens: number; estimated: boolean } {
  const u = call.record.usage;
  if (u) return { inputTokens: u.inputTokens, outputTokens: u.outputTokens, estimated: false };
  if (output === null) return { inputTokens: 0, outputTokens: 0, estimated: false };
  return {
    inputTokens: Math.ceil(promptText(call).length / 4),
    outputTokens: Math.ceil(output.length / 4),
    estimated: true,
  };
}
