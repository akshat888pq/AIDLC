import fs from 'fs';
import path from 'path';
import { getRequestContext } from '../../../context/requestContext.js';
import { estimateCostUsd } from '../modelConfig.js';
import type { LLMMiddleware } from './pipeline.js';
import { LLMPolicyError } from './pipeline.js';
import { usageOf } from './usage.js';

/**
 * Per-project daily token budget (UTC day). Warns at 80%, blocks at 100%.
 * Usage is kept per day in data/quota/<YYYY-MM-DD>.json.
 */

export interface ProjectUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
  costUsd: number;
  warnedAt?: string;
}

const QUOTA_DIR = path.resolve('data', 'quota');
const UNSCOPED = '_unscoped';
const WARN_AT = 0.8;

export function dailyBudget(): number {
  const n = Number(process.env.PROJECT_DAILY_TOKEN_BUDGET ?? 2_000_000);
  return Number.isFinite(n) && n > 0 ? n : 2_000_000;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

let loadedDay = '';
let usage: Record<string, ProjectUsage> = {};

function load(): Record<string, ProjectUsage> {
  const day = today();
  if (day !== loadedDay) {
    loadedDay = day;
    try {
      usage = JSON.parse(fs.readFileSync(path.join(QUOTA_DIR, `${day}.json`), 'utf-8'));
    } catch {
      usage = {};
    }
  }
  return usage;
}

function persist(): void {
  try {
    fs.mkdirSync(QUOTA_DIR, { recursive: true });
    fs.writeFileSync(path.join(QUOTA_DIR, `${loadedDay}.json`), JSON.stringify(usage, null, 2));
  } catch (err: any) {
    console.error(`[quota] failed to persist usage: ${err.message}`);
  }
}

function nextResetIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

export function quotaStatus(projectId: string) {
  const u = load()[projectId] ?? { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 };
  const used = u.inputTokens + u.outputTokens;
  const limit = dailyBudget();
  const ratio = used / limit;
  return {
    day: loadedDay,
    used,
    limit,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    calls: u.calls,
    estimatedCostUsd: Math.round(u.costUsd * 10000) / 10000,
    percent: Math.min(Math.round(ratio * 1000) / 10, 100),
    state: ratio >= 1 ? 'blocked' : ratio >= WARN_AT ? 'warning' : 'ok',
    resetsAt: nextResetIso(),
  } as const;
}

export const quotaMiddleware: LLMMiddleware = async (call, next) => {
  const projectId = getRequestContext()?.projectId ?? UNSCOPED;
  const scoped = projectId !== UNSCOPED;

  if (scoped && quotaStatus(projectId).state === 'blocked') {
    throw new LLMPolicyError('Daily token quota reached — resets at midnight UTC', 429);
  }

  let output: string | null = null;
  try {
    output = await next(call);
    return output;
  } finally {
    // A call that failed after the provider billed it (refusal, empty reply) still counts.
    record(projectId, scoped, call, output);
  }
};

function record(projectId: string, scoped: boolean, call: Parameters<LLMMiddleware>[0], output: string | null): void {
  const { inputTokens, outputTokens } = usageOf(call, output);
  if (inputTokens === 0 && outputTokens === 0) return;
  const r = call.record;
  const all = load();
  const u = (all[projectId] ??= { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 });
  u.inputTokens += inputTokens;
  u.outputTokens += outputTokens;
  u.calls += 1;
  u.costUsd += estimateCostUsd(r.model ?? '', inputTokens, outputTokens, r.usage?.cacheReadTokens, r.usage?.cacheWriteTokens);

  if (scoped && !u.warnedAt && (u.inputTokens + u.outputTokens) / dailyBudget() >= WARN_AT) {
    u.warnedAt = new Date().toISOString();
    console.warn(`[quota] project ${projectId} has used 80% of its daily token budget (${dailyBudget()})`);
  }
  persist();
}
