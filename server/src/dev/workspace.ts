import fs from 'fs';
import path from 'path';

export class DevError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

export const PROJECTS_DIR = path.resolve('projects');
export const SECOND_BRAIN_FILE = 'secondbrain.md';
export const DOCS_DIR = 'docs/aidlc';
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.cache', 'coverage']);
const MAX_READ_BYTES = 2 * 1024 * 1024;

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

export function assertSessionId(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) throw new DevError('Invalid session id', 400);
  return sessionId;
}

export function workspaceRoot(sessionId: string): string {
  return path.join(PROJECTS_DIR, assertSessionId(sessionId), 'workspace');
}

export function devDataDir(sessionId: string): string {
  return path.join(PROJECTS_DIR, assertSessionId(sessionId), 'phases', 'development');
}

export function workspaceExists(sessionId: string): boolean {
  return fs.existsSync(workspaceRoot(sessionId));
}

/** Resolve a workspace-relative path, refusing anything that escapes the workspace. */
export function resolveInWorkspace(sessionId: string, relative: string): string {
  const root = workspaceRoot(sessionId);
  const cleaned = String(relative ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(root, cleaned);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new DevError(`Path "${relative}" is outside the workspace`, 403);
  }
  return abs;
}

export function toRelative(sessionId: string, abs: string): string {
  return path.relative(workspaceRoot(sessionId), abs).split(path.sep).join('/');
}

export function listTree(sessionId: string, relative = '', maxDepth = 12): TreeNode[] {
  const start = resolveInWorkspace(sessionId, relative);
  if (!fs.existsSync(start)) return [];

  const walk = (dir: string, depth: number): TreeNode[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const nodes: TreeNode[] = [];
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = toRelative(sessionId, abs);
      if (entry.isDirectory()) {
        const ignored = IGNORED_DIRS.has(entry.name);
        nodes.push({
          name: entry.name,
          path: rel,
          type: 'dir',
          children: ignored || depth >= maxDepth ? [] : walk(abs, depth + 1),
        });
      } else if (entry.isFile()) {
        nodes.push({ name: entry.name, path: rel, type: 'file' });
      }
    }
    return nodes.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
    );
  };

  return walk(start, 0);
}

/** A compact indented listing for the model's context window. */
export function treeAsText(sessionId: string, relative = '', maxDepth = 3, maxLines = 300): string {
  const lines: string[] = [];
  const render = (nodes: TreeNode[], indent: number, depth: number) => {
    for (const node of nodes) {
      if (lines.length >= maxLines) return;
      const ignored = node.type === 'dir' && IGNORED_DIRS.has(node.name);
      lines.push(`${'  '.repeat(indent)}${node.name}${node.type === 'dir' ? '/' : ''}${ignored ? ' (not expanded)' : ''}`);
      if (node.children && depth < maxDepth) render(node.children, indent + 1, depth + 1);
    }
  };
  render(listTree(sessionId, relative, maxDepth), 0, 1);
  if (lines.length >= maxLines) lines.push('… (truncated)');
  return lines.join('\n') || '(empty)';
}

export function readFile(sessionId: string, relative: string): string {
  const abs = resolveInWorkspace(sessionId, relative);
  if (!fs.existsSync(abs)) throw new DevError(`File not found: ${relative}`, 404);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new DevError(`${relative} is a directory`, 400);
  if (stat.size > MAX_READ_BYTES) throw new DevError(`${relative} is too large to open (${stat.size} bytes)`, 413);
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) throw new DevError(`${relative} is a binary file`, 415);
  return buf.toString('utf-8');
}

export function writeFile(sessionId: string, relative: string, content: string): void {
  const abs = resolveInWorkspace(sessionId, relative);
  if (abs === workspaceRoot(sessionId)) throw new DevError('A file path is required', 400);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

export function fileExists(sessionId: string, relative: string): boolean {
  return fs.existsSync(resolveInWorkspace(sessionId, relative));
}

export function createDir(sessionId: string, relative: string): void {
  fs.mkdirSync(resolveInWorkspace(sessionId, relative), { recursive: true });
}

export function deletePath(sessionId: string, relative: string): void {
  const abs = resolveInWorkspace(sessionId, relative);
  if (abs === workspaceRoot(sessionId)) throw new DevError('Refusing to delete the workspace root', 403);
  if (!fs.existsSync(abs)) throw new DevError(`Not found: ${relative}`, 404);
  fs.rmSync(abs, { recursive: true, force: true });
}

export function renamePath(sessionId: string, from: string, to: string): void {
  const src = resolveInWorkspace(sessionId, from);
  const dest = resolveInWorkspace(sessionId, to);
  if (!fs.existsSync(src)) throw new DevError(`Not found: ${from}`, 404);
  if (fs.existsSync(dest)) throw new DevError(`${to} already exists`, 409);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
}

/** Regex search across text files; returns `path:line: text` hits. */
export function searchWorkspace(sessionId: string, pattern: string, relative = '', maxHits = 100): string[] {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'i');
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  const hits: string[] = [];
  const start = resolveInWorkspace(sessionId, relative);
  if (!fs.existsSync(start)) return hits;

  const visit = (abs: string) => {
    if (hits.length >= maxHits) return;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      if (IGNORED_DIRS.has(path.basename(abs))) return;
      for (const name of fs.readdirSync(abs)) visit(path.join(abs, name));
      return;
    }
    if (stat.size > 512 * 1024) return;
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return;
    const lines = buf.toString('utf-8').split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
      if (regex.test(lines[i])) hits.push(`${toRelative(sessionId, abs)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
    }
  };
  visit(start);
  return hits;
}

// ── Second Brain helpers ─────────────────────────────────────────────────────

/** Replace (or append) a section of secondbrain.md that the system owns, between markers. */
export function writeManagedBlock(sessionId: string, key: string, heading: string, content: string) {
  const abs = resolveInWorkspace(sessionId, SECOND_BRAIN_FILE);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : '';
  const start = `<!-- AIDLC:${key}:START -->`;
  const end = `<!-- AIDLC:${key}:END -->`;
  const block = `${start}\n${content.trim()}\n${end}`;
  const s = current.indexOf(start);
  const e = current.indexOf(end);
  const next =
    s >= 0 && e > s ? current.slice(0, s) + block + current.slice(e + end.length) : `${current.trimEnd()}\n\n## ${heading}\n${block}\n`;
  fs.writeFileSync(abs, next, 'utf-8');
}

/** Every text document in docs/aidlc (recursively), for one-off planning calls. Mockup HTML is summarised elsewhere. */
export function readProjectDocs(sessionId: string, maxChars = 400_000): string {
  const root = resolveInWorkspace(sessionId, DOCS_DIR);
  if (!fs.existsSync(root)) return '';
  let out = '';
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length > maxChars) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (/\.(md|mmd)$/i.test(entry.name) && entry.name !== 'BLUEPRINT.md') {
        out += `\n\n===== ${toRelative(sessionId, abs)} =====\n${fs.readFileSync(abs, 'utf-8')}`;
      }
    }
  };
  visit(root);
  return out.slice(0, maxChars);
}

export function readSecondBrain(sessionId: string): string {
  const abs = resolveInWorkspace(sessionId, SECOND_BRAIN_FILE);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : '';
}

/** Set by handover.ts: carries every earlier phase into a new workspace. */
let contextSyncer: ((sessionId: string) => void) | null = null;
export function registerContextSyncer(fn: (sessionId: string) => void) {
  contextSyncer = fn;
}

export function syncSecondBrain(sessionId: string): void {
  contextSyncer?.(sessionId);
}

export function ensureWorkspace(sessionId: string): string {
  const root = workspaceRoot(sessionId);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(devDataDir(sessionId), { recursive: true });
  if (!fs.existsSync(path.join(root, SECOND_BRAIN_FILE))) syncSecondBrain(sessionId);
  return root;
}

export function devStatus(sessionId: string): { exists: boolean; label: string } {
  if (!workspaceExists(sessionId)) return { exists: false, label: 'Not started' };
  const count = listTree(sessionId, '', 6).length;
  return { exists: true, label: `Workspace open — ${count} top-level item${count === 1 ? '' : 's'}` };
}
