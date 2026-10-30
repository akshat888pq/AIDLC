import { OPERATOR_PREAMBLE, splitPrompt } from '../promptLayout.js';
import type { LLMMiddleware } from './pipeline.js';

/**
 * Output validation: detects a response that reproduces our system prompt (the
 * operator preamble and the phase instructions) verbatim, and redacts those spans.
 * Project material is not checked — outputs are supposed to quote it.
 *
 * Detection: overlapping 80-character windows of the instructions, matched
 * whitespace-insensitively. Two or more hits counts as leakage, which keeps short
 * stock phrases from tripping it.
 */

const WINDOW = 80;
const STEP = 40;
const MIN_HITS = 2;
const REDACTED = '[redacted: system prompt]';

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function windows(instructions: string): string[] {
  const flat = instructions.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  for (let i = 0; i + WINDOW <= flat.length; i += STEP) out.push(flat.slice(i, i + WINDOW));
  return out;
}

export function redactLeakage(output: string, instructions: string): { text: string; hits: number } {
  let text = output;
  let hits = 0;
  for (const w of windows(instructions)) {
    const pattern = new RegExp(w.split(' ').map(escape).join('\\s+'), 'g');
    text = text.replace(pattern, () => {
      hits++;
      return REDACTED;
    });
  }
  return { text, hits };
}

export const outputGuardMiddleware: LLMMiddleware = async (call, next) => {
  const output = await next(call);
  const instructions = `${OPERATOR_PREAMBLE}\n\n${splitPrompt(call.systemPrompt).instructions}`;
  const { text, hits } = redactLeakage(output, instructions);
  if (hits < MIN_HITS) return output;

  call.record.leakageDetected = true;
  console.warn(`[output-guard] response reproduced system prompt text (${hits} window(s)) — redacted`);
  return text;
};
