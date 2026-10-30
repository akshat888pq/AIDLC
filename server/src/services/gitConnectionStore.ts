import fs from 'fs';
import path from 'path';
import type { GitProviderConnection, GitProvider } from '../types/index.js';
import { GitHubAdapter } from './git/github.js';
import { GitLabAdapter } from './git/gitlab.js';
import { AzureReposAdapter } from './git/azureRepos.js';
import type { GitProviderAdapter } from './git/adapter.js';
import { refreshGitLabToken } from './oauth/gitlabOAuth.js';

const CONNECTIONS_DIR = path.resolve('connections');

function ensureDir() {
  if (!fs.existsSync(CONNECTIONS_DIR)) fs.mkdirSync(CONNECTIONS_DIR, { recursive: true });
}

function filePath(sessionId: string): string {
  return path.join(CONNECTIONS_DIR, `git-${sessionId}.json`);
}

export function getGitConnections(sessionId: string): GitProviderConnection[] {
  ensureDir();
  const fp = filePath(sessionId);
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

export function saveGitConnection(sessionId: string, conn: GitProviderConnection): void {
  ensureDir();
  const connections = getGitConnections(sessionId);
  const idx = connections.findIndex((c) => c.provider === conn.provider);
  if (idx >= 0) connections[idx] = conn;
  else connections.push(conn);
  fs.writeFileSync(filePath(sessionId), JSON.stringify(connections, null, 2));
}

export function removeGitConnection(sessionId: string, provider: string): void {
  ensureDir();
  const connections = getGitConnections(sessionId).filter((c) => c.provider !== provider);
  fs.writeFileSync(filePath(sessionId), JSON.stringify(connections, null, 2));
}

export function getGitConnectionPublic(conn: GitProviderConnection): Partial<GitProviderConnection> {
  const { accessToken, refreshToken, ...safe } = conn;
  return safe;
}

export async function getGitAdapter(sessionId: string, provider: GitProvider, organizationUrl?: string): Promise<GitProviderAdapter | null> {
  const connections = getGitConnections(sessionId);
  let conn = connections.find((c) => c.provider === provider && c.connected);
  if (!conn || !conn.accessToken) return null;

  conn = await ensureFreshGitToken(sessionId, conn);

  switch (provider) {
    case 'github':
      return new GitHubAdapter(conn.accessToken!);
    case 'gitlab':
      return new GitLabAdapter(conn.accessToken!);
    case 'azure-repos':
      if (!organizationUrl) return null;
      return new AzureReposAdapter(organizationUrl, conn.accessToken!);
    default:
      return null;
  }
}

async function ensureFreshGitToken(sessionId: string, conn: GitProviderConnection): Promise<GitProviderConnection> {
  if (!conn.expiresAt || !conn.refreshToken) return conn;

  const expiresAt = new Date(conn.expiresAt).getTime();
  const buffer = 5 * 60 * 1000;
  if (Date.now() < expiresAt - buffer) return conn;

  try {
    if (conn.provider === 'gitlab') {
      const result = await refreshGitLabToken(conn.refreshToken);
      conn.accessToken = result.accessToken;
      conn.refreshToken = result.refreshToken;
      conn.expiresAt = new Date(Date.now() + result.expiresIn * 1000).toISOString();
      saveGitConnection(sessionId, conn);
    }
  } catch {
    conn.connected = false;
    saveGitConnection(sessionId, conn);
  }

  return conn;
}
