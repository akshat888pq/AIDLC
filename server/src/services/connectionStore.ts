import fs from 'fs';
import path from 'path';
import type { TicketProviderConnection } from '../types/index.js';
import { AzureDevOpsAdapter } from './tickets/azureDevOps.js';
import { JiraAdapter } from './tickets/jira.js';
import type { TicketProviderAdapter } from './tickets/adapter.js';
import { refreshAzureToken } from './oauth/azureOAuth.js';
import { refreshJiraToken } from './oauth/jiraOAuth.js';

const CONNECTIONS_DIR = path.resolve('connections');

function ensureDir() {
  if (!fs.existsSync(CONNECTIONS_DIR)) fs.mkdirSync(CONNECTIONS_DIR, { recursive: true });
}

function filePath(sessionId: string): string {
  return path.join(CONNECTIONS_DIR, `${sessionId}.json`);
}

export function getConnections(sessionId: string): TicketProviderConnection[] {
  ensureDir();
  const fp = filePath(sessionId);
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

export function saveConnection(sessionId: string, conn: TicketProviderConnection): void {
  ensureDir();
  const connections = getConnections(sessionId);
  const idx = connections.findIndex((c) => c.provider === conn.provider);
  if (idx >= 0) connections[idx] = conn;
  else connections.push(conn);
  fs.writeFileSync(filePath(sessionId), JSON.stringify(connections, null, 2));
}

export function removeConnection(sessionId: string, provider: string): void {
  ensureDir();
  const connections = getConnections(sessionId).filter((c) => c.provider !== provider);
  fs.writeFileSync(filePath(sessionId), JSON.stringify(connections, null, 2));
}

export async function getAdapter(sessionId: string, provider: string): Promise<TicketProviderAdapter | null> {
  const connections = getConnections(sessionId);
  const conn = connections.find((c) => c.provider === provider && c.connected);
  if (!conn || !conn.accessToken) return null;

  const tokenConn = await ensureFreshToken(sessionId, conn);

  if (provider === 'azure-devops' && tokenConn.organizationUrl) {
    return new AzureDevOpsAdapter(tokenConn.organizationUrl, tokenConn.accessToken!);
  }
  if (provider === 'jira' && tokenConn.cloudId) {
    return new JiraAdapter(tokenConn.cloudId, tokenConn.accessToken!);
  }
  return null;
}

async function ensureFreshToken(
  sessionId: string,
  conn: TicketProviderConnection,
): Promise<TicketProviderConnection> {
  if (!conn.expiresAt || !conn.refreshToken) return conn;

  const expiresAt = new Date(conn.expiresAt).getTime();
  const buffer = 5 * 60 * 1000;
  if (Date.now() < expiresAt - buffer) return conn;

  try {
    let result: { accessToken: string; refreshToken: string; expiresIn: number };

    if (conn.provider === 'azure-devops') {
      result = await refreshAzureToken(conn.refreshToken);
    } else {
      result = await refreshJiraToken(conn.refreshToken);
    }

    conn.accessToken = result.accessToken;
    conn.refreshToken = result.refreshToken;
    conn.expiresAt = new Date(Date.now() + result.expiresIn * 1000).toISOString();
    saveConnection(sessionId, conn);
  } catch {
    conn.connected = false;
    saveConnection(sessionId, conn);
  }

  return conn;
}
