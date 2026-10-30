import Anthropic from '@anthropic-ai/sdk';
import type { ChatOptions, LLMAdapter } from './adapter.js';
import { currentCall } from './callScope.js';
import { assignmentFor } from './modelConfig.js';
import { JSON_ONLY, OPERATOR_PREAMBLE, splitPrompt } from './promptLayout.js';

type TextBlock = Anthropic.Beta.BetaTextBlockParam;
type Message = Anthropic.Beta.BetaMessageParam;

const CACHE: TextBlock['cache_control'] = { type: 'ephemeral' };

/** Models that accept the server-side refusal fallback in its "default" form. */
const REFUSAL_FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);

/**
 * Claude, via the Messages API.
 *
 * Same contract as the Gemini adapter — a system prompt and user content in, the
 * model's text out — so the phase engine, Second Brain and Q&A code work
 * unchanged. Differences that matter:
 *
 *   - Only our own instructions go in `system`. The Second Brain and all
 *     user-derived material go in the user turn (see promptLayout.ts).
 *   - The Second Brain block carries `cache_control`, so the long context resent on
 *     every call in a phase is billed at the cache-read rate after the first.
 *   - No `temperature`: the API version this SDK sends rejects sampling parameters.
 *   - Requests stream, so 32k-token analyses do not hit HTTP timeouts.
 *
 * Errors are thrown as the SDK's typed errors; FailoverAdapter decides which of
 * them fall back to Gemini.
 */
export class AnthropicAdapter implements LLMAdapter {
  name = 'claude';
  private client: Anthropic | null = null;

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY?.trim();
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!.trim(),
        // The SDK retries 429/5xx itself before throwing; keep that short so a
        // genuinely unavailable Claude reaches the Gemini fallback quickly.
        maxRetries: Number(process.env.ANTHROPIC_MAX_RETRIES ?? 1),
        timeout: Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 600_000),
      });
    }
    return this.client;
  }

  async analyze(systemPrompt: string, userContent: string): Promise<string> {
    const layout = splitPrompt(systemPrompt);
    const material = [layout.material, userContent ? `DOCUMENTS:\n${userContent}` : ''].filter(Boolean).join('\n\n---\n\n');
    return this.send({
      system: layout.instructions,
      messages: [{ role: 'user', content: userBlocks(layout.secondBrain, material) }],
      // Matches the Gemini adapter: re-analysis output grows with the project.
      maxTokens: 32_768,
    });
  }

  async chat(
    systemPrompt: string,
    messages: { role: 'user' | 'model'; content: string }[],
    options: ChatOptions = {}
  ): Promise<string> {
    const layout = splitPrompt(systemPrompt);
    const converted: Message[] = messages.map((m) => ({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.content,
    }));

    // The context lives in front of the first user message, so it stays a stable,
    // cacheable prefix as the conversation grows.
    const context = userBlocks(layout.secondBrain, layout.material);
    if (context.length > 0) {
      if (converted[0]?.role === 'user') {
        converted[0] = { role: 'user', content: [...context, { type: 'text', text: converted[0].content as string }] };
      } else {
        converted.unshift({ role: 'user', content: context });
      }
    }

    return this.send({
      system: [layout.instructions, options.json ? JSON_ONLY : ''].filter(Boolean).join('\n\n'),
      messages: converted,
      maxTokens: options.maxOutputTokens ?? 4096,
    });
  }

  private async send(req: { system: string; messages: Message[]; maxTokens: number }): Promise<string> {
    const model = assignmentFor('generation').model;
    const record = currentCall();
    record.provider = 'anthropic';
    record.model = model;

    const system: TextBlock[] = [{ type: 'text', text: OPERATOR_PREAMBLE }];
    if (req.system) system.push({ type: 'text', text: req.system, cache_control: CACHE });
    else system[0].cache_control = CACHE;

    const effort = process.env.ANTHROPIC_EFFORT as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined;
    const refusalFallback = process.env.ANTHROPIC_REFUSAL_FALLBACK !== 'off' && REFUSAL_FALLBACK_MODELS.has(model);

    const stream = this.getClient().beta.messages.stream({
      model,
      system,
      messages: req.messages,
      // Adaptive thinking draws on max_tokens too; leave room for it so the
      // visible answer is not cut short.
      max_tokens: Math.max(req.maxTokens, 16_000),
      ...(effort ? { output_config: { effort } } : {}),
      ...(refusalFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    const response = await stream.finalMessage();

    const usage = response.usage;
    record.model = response.model;
    record.usage = {
      inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    };
    console.log(
      `[Claude] ${response.model} usage: input_tokens=${usage.input_tokens} output_tokens=${usage.output_tokens}` +
        ` cache_read=${usage.cache_read_input_tokens ?? 0} cache_write=${usage.cache_creation_input_tokens ?? 0}` +
        ` stop=${response.stop_reason}`
    );

    if (response.stop_reason === 'refusal') {
      const category = response.stop_details?.category ?? 'unspecified';
      throw new Error(`Claude declined this request (refusal, category: ${category}). Rephrase the input or review the source material.`);
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (response.stop_reason === 'max_tokens') {
      console.warn(`[Claude] ${response.model} hit max_tokens — the response is truncated`);
    }
    if (!text.trim()) throw new Error(`Claude returned an empty response (stop_reason: ${response.stop_reason})`);
    return text;
  }
}

/** Second Brain (cached) then the rest of the material, as separate blocks. */
function userBlocks(secondBrain: string, material: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  if (secondBrain) {
    blocks.push({ type: 'text', text: `<second_brain>\n${secondBrain}\n</second_brain>`, cache_control: CACHE });
  }
  if (material) blocks.push({ type: 'text', text: `<task_material>\n${material}\n</task_material>` });
  return blocks;
}
