import type { Session } from './types/index.js';
import type { LLMAdapter } from './services/llm/adapter.js';
import { selectAdapter } from './services/llm/adapter.js';
import { GeminiAdapter } from './services/llm/gemini.js';
import { OpenAIAdapter } from './services/llm/openai.js';
import { AnthropicAdapter } from './services/llm/anthropic.js';
import { FailoverAdapter } from './services/llm/failover.js';
import { assignmentFor } from './services/llm/modelConfig.js';
import { withGovernance } from './services/llm/governance/index.js';
import { getStatus } from './services/secondBrain.js';
import { readSession, writeSession } from './services/sessionStore.js';

export const sessions = new Map<string, Session>();
export const chatHistories = new Map<string, { role: 'user' | 'model'; content: string }[]>();

/** The existing chain, unchanged: Gemini, then OpenAI if Gemini has no key. */
const adapters: LLMAdapter[] = [
  new GeminiAdapter(),
  new OpenAIAdapter(),
];
const anthropic = new AnthropicAdapter();

console.log('GEMINI_API_KEY length:', (process.env.GEMINI_API_KEY ?? '').length);
console.log(
  'LLM adapter configuration:',
  [anthropic, ...adapters].map((a) => `${a.name}=${a.isConfigured() ? 'configured' : 'not configured'}`).join(', ')
);
const fallbackAtStart = selectAdapter(adapters);
console.log(
  'LLM adapter selected:',
  anthropic.isConfigured()
    ? `claude (${assignmentFor('generation').model}), fallback ${fallbackAtStart?.name ?? 'none'}`
    : fallbackAtStart?.name ?? 'none'
);

/**
 * Claude ahead of the existing chain when ANTHROPIC_API_KEY is set; otherwise the
 * existing chain exactly as before. Either way, every call passes through the
 * governance middleware (audit, cache, rate limit, quota, output guard).
 */
export function getLLM(): LLMAdapter | null {
  const legacy = selectAdapter(adapters);
  const base = anthropic.isConfigured() ? new FailoverAdapter(anthropic, legacy) : legacy;
  return base ? withGovernance(base) : null;
}

/**
 * Sessions are cached in memory but owned by disk, so a project survives a server
 * restart and can be reopened weeks later to take a new document. Cycle count and
 * approval status are re-hydrated from the Second Brain, which stays authoritative
 * for both.
 */
export function createSession(sessionId: string): Session {
  const status = getStatus(sessionId);
  const session: Session = {
    id: sessionId,
    createdAt: new Date().toISOString(),
    files: [],
    analyses: [],
    currentStep: 'upload',
    cycleCount: status.cycleCount,
    approvalStatus: status.approvalStatus,
    approvedAt: status.approvedAt,
  };
  return saveSession(session);
}

/** Persist a session and refresh the in-memory cache. */
export function saveSession(session: Session): Session {
  sessions.set(session.id, session);
  writeSession(session);
  return session;
}

/**
 * The session for a project, or null if the project has never held a document.
 * Falls back to disk so a restarted server still knows the project's working set.
 */
export function loadSession(sessionId: string): Session | null {
  const cached = sessions.get(sessionId);
  if (cached) return hydrateStatus(cached);

  const stored = readSession(sessionId);
  if (!stored) return null;

  sessions.set(sessionId, stored);
  return hydrateStatus(stored);
}

export function getOrCreateSession(sessionId: string): Session {
  return loadSession(sessionId) ?? createSession(sessionId);
}

/** The Second Brain wins on cycle count and approval — it is the record of record. */
function hydrateStatus(session: Session): Session {
  const status = getStatus(session.id);
  if (status.exists) {
    session.cycleCount = status.cycleCount;
    session.approvalStatus = status.approvalStatus;
    session.approvedAt = status.approvedAt;
  }
  return session;
}
