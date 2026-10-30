import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { DevError, ensureWorkspace, resolveInWorkspace } from './workspace.js';

/**
 * Long-running processes (dev servers, APIs) started for a project, so the agent can
 * run the app and probe it. Each project gets its own block of ports.
 */

export interface ProcessInfo {
  name: string;
  command: string;
  cwd: string;
  readyUrl?: string;
  status: 'starting' | 'ready' | 'running' | 'exited' | 'failed';
  exitCode?: number | null;
  startedAt: string;
  pid?: number;
}

interface ManagedProcess extends ProcessInfo {
  child: ChildProcess;
  logs: string;
}

const LOG_LIMIT = 60_000;
const processes = new Map<string, Map<string, ManagedProcess>>();
let listener: ((sessionId: string) => void) | null = null;

export function onProcessesChanged(fn: (sessionId: string) => void) {
  listener = fn;
}

function changed(sessionId: string) {
  listener?.(sessionId);
}

function sessionProcs(sessionId: string) {
  let map = processes.get(sessionId);
  if (!map) {
    map = new Map();
    processes.set(sessionId, map);
  }
  return map;
}

/** A stable block of 10 ports per project, so two projects never fight over one. */
export function projectPorts(sessionId: string) {
  let hash = 2166136261;
  for (const ch of sessionId) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  const base = 4100 + (hash % 90) * 10;
  return { backend: base, frontend: base + 1, extra: [base + 2, base + 3, base + 4] };
}

export function isolatedEnv(sessionId: string): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  for (const key of Object.keys(env)) if (/API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i.test(key)) delete env[key];
  const ports = projectPorts(sessionId);
  env.AIDLC_BACKEND_PORT = String(ports.backend);
  env.AIDLC_FRONTEND_PORT = String(ports.frontend);
  env.BROWSER = 'none';
  return env;
}

export function killTree(child: ChildProcess) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

function toInfo(p: ManagedProcess): ProcessInfo {
  const { child: _child, logs: _logs, ...info } = p;
  return info;
}

export function listProcesses(sessionId: string): ProcessInfo[] {
  return [...sessionProcs(sessionId).values()].map(toInfo);
}

export function processLogs(sessionId: string, name: string, tail = 8000): string {
  const p = sessionProcs(sessionId).get(name);
  if (!p) throw new DevError(`No process named "${name}"`, 404);
  return p.logs.slice(-tail);
}

export function stopProcess(sessionId: string, name: string): ProcessInfo {
  const p = sessionProcs(sessionId).get(name);
  if (!p) throw new DevError(`No process named "${name}"`, 404);
  killTree(p.child);
  p.status = 'exited';
  changed(sessionId);
  return toInfo(p);
}

export function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && ['http:', 'https:'].includes(u.protocol);
  } catch {
    return false;
  }
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Start (or restart) a named process and wait until it answers on readyUrl. */
export async function startProcess(
  sessionId: string,
  opts: { name: string; command: string; cwd?: string; readyUrl?: string; timeoutSec?: number }
): Promise<{ info: ProcessInfo; logTail: string }> {
  const name = opts.name.trim().replace(/[^\w.-]/g, '-').slice(0, 40) || 'app';
  if (opts.readyUrl && !isLocalUrl(opts.readyUrl)) throw new DevError('ready_url must point at localhost');
  ensureWorkspace(sessionId);
  const cwd = resolveInWorkspace(sessionId, opts.cwd ?? '');

  const existing = sessionProcs(sessionId).get(name);
  if (existing) killTree(existing.child);

  const child =
    process.platform === 'win32'
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', opts.command], {
          cwd,
          env: isolatedEnv(sessionId),
          windowsHide: true,
        })
      : spawn('bash', ['-lc', opts.command], { cwd, env: isolatedEnv(sessionId), detached: true });

  const proc: ManagedProcess = {
    name,
    command: opts.command,
    cwd: opts.cwd ?? '.',
    readyUrl: opts.readyUrl,
    status: 'starting',
    startedAt: new Date().toISOString(),
    pid: child.pid,
    child,
    logs: '',
  };
  sessionProcs(sessionId).set(name, proc);
  changed(sessionId);

  const onData = (chunk: Buffer) => {
    proc.logs = (proc.logs + chunk.toString('utf-8')).slice(-LOG_LIMIT);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('error', (err) => {
    proc.logs += `\n[failed to start: ${err.message}]`;
    proc.status = 'failed';
    changed(sessionId);
  });
  child.on('exit', (code) => {
    proc.exitCode = code;
    if (proc.status !== 'failed') proc.status = 'exited';
    changed(sessionId);
  });

  const deadline = Date.now() + Math.min(Math.max(opts.timeoutSec ?? 90, 5), 300) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    if (proc.status === 'exited' || proc.status === 'failed') break;
    if (!opts.readyUrl) {
      // Without a URL, "still alive after a few seconds" is the best signal we have.
      if (Date.now() > Date.parse(proc.startedAt) + 6000) {
        proc.status = 'running';
        break;
      }
      continue;
    }
    if (await probe(opts.readyUrl)) {
      proc.status = 'ready';
      break;
    }
  }
  if (proc.status === 'starting') proc.status = 'running';
  changed(sessionId);
  return { info: toInfo(proc), logTail: proc.logs.slice(-4000) };
}

/** A request against the project's own locally running services. */
export async function httpRequest(opts: { url: string; method?: string; body?: unknown; headers?: Record<string, string> }) {
  if (!isLocalUrl(opts.url)) throw new DevError('http_request may only call localhost');
  const method = (opts.method ?? 'GET').toUpperCase();
  const hasBody = opts.body !== undefined && method !== 'GET' && method !== 'HEAD';
  const res = await fetch(opts.url, {
    method,
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers ?? {}) },
    body: hasBody ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  return `${method} ${opts.url} → ${res.status} ${res.statusText}\ncontent-type: ${res.headers.get('content-type') ?? ''}\n\n${text.slice(0, 6000)}`;
}

export function stopAllProcesses() {
  for (const map of processes.values()) for (const p of map.values()) killTree(p.child);
}
