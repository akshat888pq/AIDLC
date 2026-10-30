import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from '../storage/mongo.js';

/**
 * The audit trail: one entry per LLM call and per tool action (Git commit, ticket
 * sync, file export). Prompts and outputs are stored as hashes only — enough to
 * prove which inputs produced which output, without keeping the content.
 *
 * Lives in the `audit_logs` MongoDB collection when MONGODB_URI is set, otherwise
 * in data/audit/audit_logs.jsonl.
 */

export interface AuditEntry {
  id: string;
  timestamp: string;
  kind: 'llm' | 'tool';
  /** LLM: 'analyze' | 'chat'. Tool: e.g. 'git.commit', 'tickets.create'. */
  action: string;
  status: 'success' | 'error' | 'blocked' | 'cache-hit';
  projectId: string | null;
  phase: string | null;
  sectionId: string | null;
  userId: string;
  userName: string;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** True when the provider did not report usage and tokens were estimated. */
  tokensEstimated?: boolean;
  promptHash: string | null;
  outputHash: string | null;
  sourceDocuments: string[];
  durationMs: number;
  fellBack?: boolean;
  injectionFindings?: number;
  leakageDetected?: boolean;
  error?: string;
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function newAuditId(): string {
  return crypto.randomUUID();
}

const AUDIT_FILE = path.resolve('data', 'audit', 'audit_logs.jsonl');

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const db = await getDb();
    if (db) {
      await db.collection<AuditEntry>('audit_logs').insertOne({ ...entry });
      return;
    }
    await fs.promises.mkdir(path.dirname(AUDIT_FILE), { recursive: true });
    await fs.promises.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err: any) {
    // An audit failure must be visible, but must not take down the request it records.
    console.error(`[audit] failed to write entry ${entry.id}: ${err.message}`);
  }
}

export interface AuditQuery {
  projectId?: string;
  phase?: string;
  userId?: string;
  kind?: 'llm' | 'tool';
  from?: string;
  to?: string;
  sortBy?: keyof AuditEntry;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

const SORTABLE = new Set<keyof AuditEntry>([
  'timestamp', 'phase', 'userName', 'model', 'provider', 'inputTokens', 'outputTokens', 'action', 'status', 'durationMs',
]);

export async function queryAudit(q: AuditQuery): Promise<{ total: number; entries: AuditEntry[] }> {
  const sortBy = q.sortBy && SORTABLE.has(q.sortBy) ? q.sortBy : 'timestamp';
  const dir = q.order === 'asc' ? 1 : -1;
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
  const offset = Math.max(q.offset ?? 0, 0);

  const db = await getDb();
  if (db) {
    const filter: Record<string, unknown> = {};
    if (q.projectId) filter.projectId = q.projectId;
    if (q.phase) filter.phase = q.phase;
    if (q.userId) filter.userId = q.userId;
    if (q.kind) filter.kind = q.kind;
    if (q.from || q.to) {
      filter.timestamp = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    }
    const col = db.collection<AuditEntry>('audit_logs');
    const [total, entries] = await Promise.all([
      col.countDocuments(filter),
      col.find(filter, { projection: { _id: 0 } }).sort({ [sortBy]: dir }).skip(offset).limit(limit).toArray(),
    ]);
    return { total, entries };
  }

  let all: AuditEntry[] = [];
  try {
    const raw = await fs.promises.readFile(AUDIT_FILE, 'utf-8');
    all = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return { total: 0, entries: [] };
  }
  const matched = all.filter(
    (e) =>
      (!q.projectId || e.projectId === q.projectId) &&
      (!q.phase || e.phase === q.phase) &&
      (!q.userId || e.userId === q.userId) &&
      (!q.kind || e.kind === q.kind) &&
      (!q.from || e.timestamp >= q.from) &&
      (!q.to || e.timestamp <= q.to)
  );
  matched.sort((a, b) => {
    const av = a[sortBy] ?? '';
    const bv = b[sortBy] ?? '';
    return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
  });
  return { total: matched.length, entries: matched.slice(offset, offset + limit) };
}
