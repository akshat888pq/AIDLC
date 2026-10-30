import fs from 'fs';
import path from 'path';
import { getLLM } from '../state.js';
import { DOCS_DIR, SECOND_BRAIN_FILE, devDataDir, writeFile } from './workspace.js';

/**
 * Living documentation: one markdown file per source file, numbered in build order
 * (docs/dev/001-backend-package.json.md). Created when the file is first written and
 * rewritten under the same name after every later change, with a change log. Deleted
 * files keep their doc, marked as removed. The agent reads it before touching the file.
 */

export const DEV_DOCS_DIR = 'docs/dev';
const INDEX_FILE = `${DEV_DOCS_DIR}/INDEX.md`;

export interface FileChange {
  path: string;
  before: string | null;
  after: string | null;
}

interface ChangeEntry {
  n: number;
  date: string;
  kind: 'created' | 'modified' | 'deleted' | 'renamed' | 'manual';
  summary: string;
  task: string;
  stats: string;
}

interface DocEntry {
  seq: number;
  path: string;
  doc: string;
  status: 'planned' | 'active' | 'deleted';
  layer?: string;
  purpose?: string;
  created?: string;
  updated?: string;
  sections: {
    whatItDoes: string;
    keyContents: string;
    dependsOn: string[];
    usedBy: string[];
    notes: string;
    traceability: string[];
  };
  changelog: ChangeEntry[];
}

interface Registry {
  nextSeq: number;
  files: Record<string, DocEntry>;
}

// ── Registry ─────────────────────────────────────────────────────────────────

function registryPath(sessionId: string) {
  return path.join(devDataDir(sessionId), 'filedocs.json');
}

function readRegistry(sessionId: string): Registry {
  try {
    return JSON.parse(fs.readFileSync(registryPath(sessionId), 'utf-8'));
  } catch {
    return { nextSeq: 1, files: {} };
  }
}

function writeRegistry(sessionId: string, reg: Registry) {
  fs.mkdirSync(devDataDir(sessionId), { recursive: true });
  fs.writeFileSync(registryPath(sessionId), JSON.stringify(reg, null, 2), 'utf-8');
}

/** Documentation, workspace notes and dependency folders are not documented themselves. */
export function isDocumentable(p: string): boolean {
  const norm = p.replace(/\\/g, '/');
  if (norm === SECOND_BRAIN_FILE || norm.startsWith('docs/')) return false;
  if (/(^|\/)(node_modules|\.git|dist|build|coverage|\.venv|__pycache__)\//.test(norm)) return false;
  if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(norm)) return false;
  return true;
}

function docName(seq: number, filePath: string) {
  const slug = filePath.replace(/[\\/]+/g, '-').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 90);
  return `${DEV_DOCS_DIR}/${String(seq).padStart(3, '0')}-${slug}.md`;
}

function emptyEntry(seq: number, filePath: string): DocEntry {
  return {
    seq,
    path: filePath,
    doc: docName(seq, filePath),
    status: 'planned',
    sections: { whatItDoes: '', keyContents: '', dependsOn: [], usedBy: [], notes: '', traceability: [] },
    changelog: [],
  };
}

function ensureEntry(reg: Registry, filePath: string): DocEntry {
  let entry = reg.files[filePath];
  if (!entry) {
    entry = emptyEntry(reg.nextSeq++, filePath);
    reg.files[filePath] = entry;
  }
  return entry;
}

/** Number every blueprint file in build order, so docs read in the order the code was built. */
export function registerBlueprint(sessionId: string, files: { path: string; layer: string; purpose: string; dependsOn: string[] }[]) {
  const reg = readRegistry(sessionId);
  for (const f of files) {
    if (!isDocumentable(f.path)) continue;
    const entry = ensureEntry(reg, f.path);
    entry.layer = f.layer;
    entry.purpose = f.purpose;
    if (!entry.sections.dependsOn.length) entry.sections.dependsOn = f.dependsOn;
  }
  writeRegistry(sessionId, reg);
  writeIndex(sessionId, reg);
}

/** Source path → its living doc, for every file that has one. */
export function docMap(sessionId: string): Record<string, { doc: string; seq: number; status: string; changes: number }> {
  const out: Record<string, { doc: string; seq: number; status: string; changes: number }> = {};
  for (const e of Object.values(readRegistry(sessionId).files)) {
    if (e.status !== 'planned') out[e.path] = { doc: e.doc, seq: e.seq, status: e.status, changes: e.changelog.length };
  }
  return out;
}

export function docFor(sessionId: string, filePath: string): string | null {
  const entry = readRegistry(sessionId).files[filePath.replace(/\\/g, '/')];
  return entry && entry.status !== 'planned' ? entry.doc : null;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function cell(text: string) {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function renderDoc(e: DocEntry): string {
  const s = e.sections;
  const list = (items: string[]) => (items.length ? items.map((i) => `- \`${i}\``).join('\n') : '- _None recorded_');
  return `# ${String(e.seq).padStart(3, '0')} · \`${e.path}\`${e.status === 'deleted' ? ' (removed)' : ''}

> Living document for this file, kept by AIDLC. It is rewritten after every change to the file.
> **Read it before modifying the file**, and check the change log for why things are the way they are.

| | |
|---|---|
| File | \`${e.path}\` |
| Status | ${e.status === 'deleted' ? '🗑 removed from the codebase' : e.status} |
| Layer | ${e.layer ?? '—'} |
| Build order | #${e.seq} |
| Created | ${e.created ?? '—'} |
| Last updated | ${e.updated ?? '—'} |
| Blueprint purpose | ${cell(e.purpose ?? '—')} |
| Traceability | ${s.traceability.length ? s.traceability.join(', ') : '—'} |

## What it does
${s.whatItDoes || '_Not documented yet._'}

## Key contents
${s.keyContents || '_Not documented yet._'}

## Dependencies
**Depends on**
${list(s.dependsOn)}

**Used by**
${list(s.usedBy)}

## Implementation notes & decisions
${s.notes || '_None._'}

## Change log
| # | Date | Change | Lines | Task |
|---|------|--------|-------|------|
${e.changelog.map((c) => `| ${c.n} | ${c.date.slice(0, 16).replace('T', ' ')} | **${c.kind}**: ${cell(c.summary)} | ${c.stats} | ${cell(c.task)} |`).join('\n') || '| — | — | — | — | — |'}
`;
}

function writeIndex(sessionId: string, reg: Registry) {
  const rows = Object.values(reg.files)
    .sort((a, b) => a.seq - b.seq)
    .map((e) => {
      const name = e.status === 'deleted' ? `~~\`${e.path}\`~~` : `\`${e.path}\``;
      const doc = e.status === 'planned' ? '_not built yet_' : `[${path.basename(e.doc)}](${path.basename(e.doc)})`;
      return `| ${String(e.seq).padStart(3, '0')} | ${name} | ${e.layer ?? '—'} | ${e.status} | ${e.updated?.slice(0, 10) ?? '—'} | ${e.changelog.length} | ${doc} |`;
    });
  writeFile(
    sessionId,
    INDEX_FILE,
    `# Code documentation index

One living document per source file, numbered in build order. Each is rewritten under the same name whenever its file changes.
Before changing a file, open its document here.

| # | File | Layer | Status | Last updated | Changes | Document |
|---|------|-------|--------|--------------|---------|----------|
${rows.join('\n')}
`
  );
}

// ── Updating ─────────────────────────────────────────────────────────────────

function lineStats(before: string | null, after: string | null): { added: number; removed: number; text: string } {
  const a = before ? before.split(/\r?\n/) : [];
  const b = after ? after.split(/\r?\n/) : [];
  const count = (lines: string[]) => lines.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
  const ca = count(a);
  const cb = count(b);
  let added = 0;
  let removed = 0;
  for (const [line, n] of cb) added += Math.max(0, n - (ca.get(line) ?? 0));
  for (const [line, n] of ca) removed += Math.max(0, n - (cb.get(line) ?? 0));
  return { added, removed, text: `+${added} / −${removed}` };
}

function kindOf(c: FileChange): ChangeEntry['kind'] {
  if (c.after === null) return 'deleted';
  return c.before === null || !c.before.trim() || c.before.includes('AIDLC-STUB') ? 'created' : 'modified';
}

const DOC_SYSTEM = `You maintain living documentation for individual source files in a codebase. For every file given, return what a developer must know before modifying it.

Reply with ONE JSON object: {"files": [{"path": "...", "what_it_does": "2-5 sentences", "key_contents": "markdown bullet list of exports / functions / components / routes / config keys with one line each", "depends_on": ["relative file paths this file imports"], "used_by": ["relative file paths known to import or call this file"], "notes": "markdown bullets: important decisions, constraints, edge cases, TODOs a maintainer must know (keep earlier notes that are still true)", "traceability": ["requirement / user story / screen IDs this file implements, e.g. US-003, SCR-002"], "change_summary": "one sentence describing what THIS change did to the file"}]}
Base everything on the actual file content. Paths are workspace-relative.`;

/**
 * Record a batch of changes (one agent task) and refresh each file's document.
 * One model call per batch; falls back to a plain change-log entry if it fails.
 */
export async function updateDocs(sessionId: string, changes: FileChange[], task: string, agentSummary?: string): Promise<string[]> {
  const relevant = changes.filter((c) => isDocumentable(c.path));
  if (!relevant.length) return [];
  const reg = readRegistry(sessionId);
  const now = new Date().toISOString();

  let generated = new Map<string, any>();
  const llm = getLLM();
  if (llm) {
    const payload = relevant
      .map((c) => {
        const entry = reg.files[c.path];
        const previous = entry?.sections.whatItDoes
          ? `Existing documentation:\nWhat it does: ${entry.sections.whatItDoes}\nNotes: ${entry.sections.notes}\nTraceability: ${entry.sections.traceability.join(', ')}`
          : 'No documentation yet.';
        return `===== FILE: ${c.path} (${kindOf(c)}) =====
Blueprint purpose: ${entry?.purpose ?? 'not in the blueprint'}
${previous}
${c.after === null ? 'The file was DELETED.' : `Current content:\n${c.after.slice(0, 14000)}`}
${c.before && c.after !== null && kindOf(c) === 'modified' ? `\nPrevious content (for the change summary):\n${c.before.slice(0, 6000)}` : ''}`;
      })
      .join('\n\n');
    try {
      const raw = await llm.chat(
        DOC_SYSTEM,
        [{ role: 'user', content: `TASK THAT MADE THESE CHANGES: ${task}\n${agentSummary ? `AGENT'S SUMMARY: ${agentSummary.slice(0, 2000)}\n` : ''}\n${payload}` }],
        { json: true, maxOutputTokens: 8192, temperature: 0.1 }
      );
      const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      generated = new Map((parsed.files ?? []).map((f: any) => [String(f.path).replace(/\\/g, '/'), f]));
    } catch (err: any) {
      console.warn(`[filedocs] model update failed, writing change log only: ${err.message}`);
    }
  }

  const written: string[] = [];
  for (const c of relevant) {
    const entry = ensureEntry(reg, c.path);
    const g = generated.get(c.path);
    const kind = kindOf(c);
    const stats = lineStats(c.before, c.after);
    const strs = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

    if (g) {
      entry.sections = {
        whatItDoes: String(g.what_it_does ?? entry.sections.whatItDoes),
        keyContents: String(g.key_contents ?? entry.sections.keyContents),
        dependsOn: strs(g.depends_on).length ? strs(g.depends_on) : entry.sections.dependsOn,
        usedBy: [...new Set([...entry.sections.usedBy, ...strs(g.used_by)])],
        notes: String(g.notes ?? entry.sections.notes),
        traceability: [...new Set([...entry.sections.traceability, ...strs(g.traceability)])],
      };
    }
    entry.status = kind === 'deleted' ? 'deleted' : 'active';
    entry.created ??= now.slice(0, 10);
    entry.updated = now.slice(0, 10);
    entry.changelog.push({
      n: entry.changelog.length + 1,
      date: now,
      kind,
      summary: g?.change_summary ? String(g.change_summary) : kind === 'deleted' ? 'File removed.' : kind === 'created' ? 'File implemented.' : 'File changed.',
      task,
      stats: stats.text,
    });
    writeFile(sessionId, entry.doc, renderDoc(entry));
    written.push(entry.doc);
  }

  // Record reverse links: a file that depends on X means X is used by it.
  for (const entry of Object.values(reg.files)) {
    for (const dep of entry.sections.dependsOn) {
      const target = reg.files[dep];
      if (target && !target.sections.usedBy.includes(entry.path)) {
        target.sections.usedBy.push(entry.path);
        if (target.status !== 'planned') writeFile(sessionId, target.doc, renderDoc(target));
      }
    }
  }

  writeRegistry(sessionId, reg);
  writeIndex(sessionId, reg);
  written.push(INDEX_FILE);
  return written;
}

/** A human edit from the editor or explorer: logged without a model call. */
export function recordManualChange(sessionId: string, change: FileChange, renamedFrom?: string): string[] {
  if (!isDocumentable(change.path)) return [];
  const reg = readRegistry(sessionId);
  if (renamedFrom && reg.files[renamedFrom]) {
    const entry = reg.files[renamedFrom];
    delete reg.files[renamedFrom];
    entry.path = change.path;
    reg.files[change.path] = entry;
  }
  const entry = reg.files[change.path];
  // Files the pipeline never documented get a doc on their next agent change instead.
  if (!entry || entry.status === 'planned') {
    writeRegistry(sessionId, reg);
    return [];
  }
  const now = new Date().toISOString();
  const kind: ChangeEntry['kind'] = renamedFrom ? 'renamed' : change.after === null ? 'deleted' : 'manual';
  entry.status = change.after === null ? 'deleted' : 'active';
  entry.updated = now.slice(0, 10);
  entry.changelog.push({
    n: entry.changelog.length + 1,
    date: now,
    kind,
    summary: renamedFrom ? `Renamed from \`${renamedFrom}\`.` : change.after === null ? 'Deleted from the explorer.' : 'Edited by hand in the editor.',
    task: 'Human edit',
    stats: lineStats(change.before, change.after).text,
  });
  writeFile(sessionId, entry.doc, renderDoc(entry));
  writeRegistry(sessionId, reg);
  writeIndex(sessionId, reg);
  return [entry.doc, INDEX_FILE];
}

export { DOCS_DIR };
