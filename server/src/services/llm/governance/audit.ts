import { getRequestContext } from '../../../context/requestContext.js';
import { newAuditId, sha256, writeAudit } from '../../../audit/auditStore.js';
import type { LLMMiddleware } from './pipeline.js';
import { LLMPolicyError, promptText } from './pipeline.js';
import { usageOf } from './usage.js';

/** Labels in prompts that name the documents a call drew on. */
const SOURCE_MARKERS = [
  /=== FILE: (.+?) ===/g,
  /=== SECOND BRAIN — (.+?) PHASE/g,
  /--- APPROVED (.+?) DOCUMENT(?: \(([^)]+)\))?/g,
  /^DOCUMENT ID: (.+)$/gm,
];

function sourceDocuments(prompt: string): string[] {
  const found = new Set<string>();
  for (const pattern of SOURCE_MARKERS) {
    for (const m of prompt.matchAll(pattern)) {
      const label = m[2] ? `${m[1]} (${m[2]})` : m[1];
      found.add(label.trim().slice(0, 200));
    }
  }
  return [...found].slice(0, 50);
}

/** Outermost: records every call — served, cached, blocked or failed. */
export const auditMiddleware: LLMMiddleware = async (call, next) => {
  const started = Date.now();
  const ctx = getRequestContext();
  const prompt = promptText(call);

  let output: string | null = null;
  let error: unknown;
  try {
    output = await next(call);
    return output;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    const r = call.record;
    const usage = usageOf(call, output);
    void writeAudit({
      id: newAuditId(),
      timestamp: new Date().toISOString(),
      kind: 'llm',
      action: call.kind,
      status: error ? (error instanceof LLMPolicyError ? 'blocked' : 'error') : r.cacheHit ? 'cache-hit' : 'success',
      projectId: ctx?.projectId ?? null,
      phase: ctx?.phase ?? null,
      sectionId: ctx?.sectionId ?? null,
      userId: ctx?.userId ?? 'system',
      userName: ctx?.userName ?? 'System',
      provider: r.provider ?? null,
      model: r.model ?? null,
      inputTokens: r.cacheHit ? 0 : usage.inputTokens,
      outputTokens: r.cacheHit ? 0 : usage.outputTokens,
      cacheReadTokens: r.usage?.cacheReadTokens,
      cacheWriteTokens: r.usage?.cacheWriteTokens,
      tokensEstimated: !r.cacheHit && usage.estimated ? true : undefined,
      promptHash: sha256(prompt),
      outputHash: output !== null ? sha256(output) : null,
      sourceDocuments: sourceDocuments(prompt),
      durationMs: Date.now() - started,
      fellBack: r.fellBack,
      leakageDetected: r.leakageDetected,
      ...(error ? { error: error instanceof Error ? error.message.slice(0, 500) : String(error) } : {}),
    });
  }
};
