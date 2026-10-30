import type { ApiResponse } from '../types';

/** Client for /api/governance — audit trail, quota, cache, users & roles. */

const BASE = '/api/governance';

export type Role = 'viewer' | 'contributor' | 'lead' | 'admin';
export const ROLES: Role[] = ['admin', 'lead', 'contributor', 'viewer'];

export interface GovUser {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
  lastSeenAt: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  kind: 'llm' | 'tool';
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
  tokensEstimated?: boolean;
  promptHash: string | null;
  outputHash: string | null;
  sourceDocuments: string[];
  durationMs: number;
  fellBack?: boolean;
  leakageDetected?: boolean;
  error?: string;
}

export interface AuditFilters {
  projectId?: string;
  phase?: string;
  userId?: string;
  kind?: 'llm' | 'tool' | '';
  from?: string;
  to?: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface QuotaStatus {
  day: string;
  used: number;
  limit: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  estimatedCostUsd: number;
  percent: number;
  state: 'ok' | 'warning' | 'blocked';
  resetsAt: string;
  cache: { entries: number; ttlSeconds: number; enabled: boolean };
}

async function handle<T>(res: Response): Promise<T> {
  const body: ApiResponse<T> = await res.json();
  if (!body.success) throw new Error(body.error || 'Unknown error');
  return body.data as T;
}

export async function getMe(): Promise<GovUser> {
  return handle(await fetch(`${BASE}/me`));
}

export async function getAudit(filters: AuditFilters): Promise<{ total: number; entries: AuditEntry[] }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') params.set(k, String(v));
  return handle(await fetch(`${BASE}/audit?${params}`));
}

export async function getQuota(projectId: string): Promise<QuotaStatus> {
  return handle(await fetch(`${BASE}/quota/${encodeURIComponent(projectId)}`));
}

export async function clearCache(projectId: string): Promise<{ cleared: number }> {
  return handle(await fetch(`${BASE}/cache/${encodeURIComponent(projectId)}`, { method: 'DELETE' }));
}

export async function listUsers(): Promise<GovUser[]> {
  return handle(await fetch(`${BASE}/users`));
}

export async function setUserRole(userId: string, role: Role): Promise<GovUser> {
  return handle(
    await fetch(`${BASE}/users/${encodeURIComponent(userId)}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
  );
}
