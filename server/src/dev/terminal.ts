import { createRequire } from 'module';
import type { Server } from 'http';
import type { IPty } from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';
import { DevError, assertSessionId, ensureWorkspace } from './workspace.js';
import { isLocalRequest } from './localOnly.js';
import { isolatedEnv } from './processes.js';

const require = createRequire(import.meta.url);
const SCROLLBACK_LIMIT = 200_000;
const MAX_TERMINALS = 8;
export const MAIN_TERMINAL = 'main';
// /api/dev/terminal/:sessionId[/:terminalId]
const PATH_RE = /^\/api\/dev\/terminal\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]{1,40}))?\/?$/;

interface TerminalSession {
  id: string;
  pty: IPty | null;
  scrollback: string;
  clients: Set<WebSocket>;
  exited: boolean;
  createdAt: number;
}

/** Every open shell, per project: sessionId → terminalId → shell. */
const terminals = new Map<string, Map<string, TerminalSession>>();

function loadPty(): typeof import('node-pty') {
  return require('node-pty');
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] };
  return { file: process.env.SHELL || 'bash', args: ['-l'] };
}

function broadcast(term: TerminalSession, message: object) {
  const data = JSON.stringify(message);
  for (const client of term.clients) if (client.readyState === WebSocket.OPEN) client.send(data);
}

function append(term: TerminalSession, data: string) {
  term.scrollback = (term.scrollback + data).slice(-SCROLLBACK_LIMIT);
  broadcast(term, { type: 'output', data });
}

function spawnShell(sessionId: string, term: TerminalSession, cols = 100, rows = 30) {
  const cwd = ensureWorkspace(sessionId);
  const { file, args } = defaultShell();
  const env = isolatedEnv(sessionId);
  env.TERM = 'xterm-256color';

  const pty = loadPty().spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env });
  term.pty = pty;
  term.exited = false;
  pty.onData((data) => append(term, data));
  pty.onExit(({ exitCode }) => {
    if (term.pty !== pty) return;
    term.exited = true;
    term.pty = null;
    append(term, `\r\n\x1b[90m[process exited with code ${exitCode} — press Restart to open a new shell]\x1b[0m\r\n`);
    broadcast(term, { type: 'exit', code: exitCode });
  });
}

function projectTerminals(sessionId: string) {
  let map = terminals.get(sessionId);
  if (!map) {
    map = new Map();
    terminals.set(sessionId, map);
  }
  return map;
}

function getTerminal(sessionId: string, terminalId: string): TerminalSession {
  const map = projectTerminals(sessionId);
  let term = map.get(terminalId);
  if (!term) {
    if (map.size >= MAX_TERMINALS) throw new DevError(`A project can have at most ${MAX_TERMINALS} terminals open`, 409);
    term = { id: terminalId, pty: null, scrollback: '', clients: new Set(), exited: true, createdAt: Date.now() };
    map.set(terminalId, term);
  }
  return term;
}

/** The project's open terminals, oldest first, so tabs survive a page reload. */
export function listTerminals(sessionId: string): { id: string; running: boolean }[] {
  return [...projectTerminals(sessionId).values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((t) => ({ id: t.id, running: Boolean(t.pty) }));
}

/** Close a terminal for good: kill its shell and drop its scrollback. */
export function killTerminal(sessionId: string, terminalId: string): void {
  const map = projectTerminals(sessionId);
  const term = map.get(terminalId);
  if (!term) return;
  const pty = term.pty;
  term.pty = null;
  try {
    pty?.kill();
  } catch {
    /* already gone */
  }
  broadcast(term, { type: 'closed' });
  for (const client of term.clients) client.close();
  map.delete(terminalId);
}

/** Type into one of the project's shells on the user's behalf (used by "Run" buttons). */
export function writeToTerminal(sessionId: string, text: string, terminalId = MAIN_TERMINAL): boolean {
  const map = projectTerminals(sessionId);
  const term = map.get(terminalId)?.pty ? map.get(terminalId) : [...map.values()].find((t) => t.pty);
  if (!term?.pty) return false;
  term.pty.write(text);
  return true;
}

export function attachTerminalServer(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const match = PATH_RE.exec((req.url ?? '').split('?')[0]);
    if (!match) return;
    if (!isLocalRequest(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, assertSessionId(match[1]), match[2] ?? MAIN_TERMINAL));
  });
}

function onConnection(ws: WebSocket, sessionId: string, terminalId: string) {
  let term: TerminalSession;
  try {
    term = getTerminal(sessionId, terminalId);
  } catch (err: any) {
    ws.send(JSON.stringify({ type: 'output', data: `\x1b[31m${err.message}\x1b[0m\r\n` }));
    ws.close();
    return;
  }
  term.clients.add(ws);

  try {
    if (!term.pty) spawnShell(sessionId, term);
  } catch (err: any) {
    ws.send(JSON.stringify({ type: 'output', data: `\x1b[31mCould not start a shell: ${err.message}\x1b[0m\r\n` }));
  }
  if (term.scrollback) ws.send(JSON.stringify({ type: 'output', data: term.scrollback, replay: true }));

  ws.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'input' && typeof msg.data === 'string') term.pty?.write(msg.data);
    else if (msg.type === 'resize' && term.pty) {
      const cols = Math.max(20, Math.min(500, Number(msg.cols) || 100));
      const rows = Math.max(5, Math.min(200, Number(msg.rows) || 30));
      try {
        term.pty.resize(cols, rows);
      } catch {
        /* pty may have exited between messages */
      }
    } else if (msg.type === 'restart') {
      const old = term.pty;
      term.pty = null;
      try {
        old?.kill();
      } catch {
        /* already gone */
      }
      term.scrollback = '';
      broadcast(term, { type: 'clear' });
      try {
        spawnShell(sessionId, term, Number(msg.cols) || 100, Number(msg.rows) || 30);
      } catch (err: any) {
        append(term, `\x1b[31mCould not start a shell: ${err.message}\x1b[0m\r\n`);
      }
    }
  });

  ws.on('close', () => term.clients.delete(ws));
}

export function shutdownTerminals() {
  for (const map of terminals.values()) {
    for (const term of map.values()) {
      try {
        term.pty?.kill();
      } catch {
        /* ignore */
      }
    }
  }
}
