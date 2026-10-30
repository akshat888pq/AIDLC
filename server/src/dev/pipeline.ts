import fs from 'fs';
import path from 'path';
import { getLLM } from '../state.js';
import {
  DOCS_DIR,
  DevError,
  SECOND_BRAIN_FILE,
  devDataDir,
  ensureWorkspace,
  fileExists,
  readFile,
  readProjectDocs,
  readSecondBrain,
  writeFile,
  writeManagedBlock,
} from './workspace.js';
import * as agent from './agent.js';
import { docFor, registerBlueprint } from './fileDocs.js';
import { isLocalUrl, listProcesses, projectPorts } from './processes.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type Stage = 'blueprint' | 'scaffold' | 'build' | 'verify' | 'done';
const STAGES: Stage[] = ['blueprint', 'scaffold', 'build', 'verify', 'done'];
type Layer = 'config' | 'backend' | 'frontend' | 'shared' | 'test' | 'docs';
const LAYERS: Layer[] = ['config', 'backend', 'frontend', 'shared', 'test', 'docs'];

export interface BlueprintFile {
  path: string;
  layer: Layer;
  purpose: string;
  dependsOn: string[];
}

export interface RunSpec {
  name: string;
  command: string;
  cwd?: string;
  port?: number;
  healthUrl?: string;
}

export interface Blueprint {
  summary: string;
  scopeNote: string;
  stack: Record<string, string>;
  files: BlueprintFile[];
  commands: { install: string[]; build: string[]; test: string[] };
  run: RunSpec[];
  assumptions: string[];
}

export interface BuildFile extends BlueprintFile {
  status: 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';
  note?: string;
}

export interface PipelineState {
  stage: Stage;
  blueprint: Blueprint | null;
  blueprintStatus: 'none' | 'generating' | 'draft' | 'approved';
  blueprintError?: string;
  files: BuildFile[];
  building: boolean;
  autoContinue: boolean;
  verify: { status: 'idle' | 'running' | 'passed' | 'failed' | 'stopped'; runs: number; summary?: string };
  ports: ReturnType<typeof projectPorts>;
  updatedAt: string;
}

const STUB_MARKER = 'AIDLC-STUB';
const pipelines = new Map<string, PipelineState>();
const loops = new Set<string>();

// ── Persistence ──────────────────────────────────────────────────────────────

function filePath(sessionId: string) {
  return path.join(devDataDir(sessionId), 'pipeline.json');
}

export function getPipeline(sessionId: string): PipelineState {
  const cached = pipelines.get(sessionId);
  if (cached) return cached;

  let saved: Partial<PipelineState> = {};
  try {
    saved = JSON.parse(fs.readFileSync(filePath(sessionId), 'utf-8'));
  } catch {
    /* new pipeline */
  }
  // Anything mid-flight when the server stopped is back to waiting for a human.
  const state: PipelineState = {
    stage: saved.stage ?? 'blueprint',
    blueprint: saved.blueprint ?? null,
    blueprintStatus: saved.blueprintStatus === 'generating' ? (saved.blueprint ? 'draft' : 'none') : saved.blueprintStatus ?? 'none',
    blueprintError: saved.blueprintError,
    files: (saved.files ?? []).map((f) => (f.status === 'in_progress' ? { ...f, status: 'pending' } : f)),
    building: false,
    autoContinue: saved.autoContinue ?? true,
    verify: saved.verify?.status === 'running' ? { ...saved.verify, status: 'idle' } : saved.verify ?? { status: 'idle', runs: 0 },
    ports: projectPorts(sessionId),
    updatedAt: saved.updatedAt ?? new Date().toISOString(),
  };
  pipelines.set(sessionId, state);
  return state;
}

function save(sessionId: string) {
  const state = getPipeline(sessionId);
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(devDataDir(sessionId), { recursive: true });
  fs.writeFileSync(filePath(sessionId), JSON.stringify(state, null, 2), 'utf-8');
  agent.broadcast(sessionId, { type: 'pipeline', pipeline: state });
}

// ── Blueprint ────────────────────────────────────────────────────────────────

const BLUEPRINT_SYSTEM = `You are a principal software engineer. From the project's approved requirement, architecture and design documents you produce the implementation BLUEPRINT for the first runnable build of the product. A coding agent will then create exactly these files, one at a time, in this order, and verify the result by running it locally.

Return ONE JSON object, no prose, with this shape:
{
  "summary": "2-4 sentences: what this build delivers",
  "scope_note": "what is in this first build and what is deliberately left for later",
  "stack": {"frontend": "...", "backend": "...", "storage": "...", "testing": "...", "other": "..."},
  "files": [
    {"path": "backend/src/index.ts", "layer": "config|backend|frontend|shared|test|docs", "purpose": "precise: what the file contains/exports, which endpoints/screens/requirement IDs it covers", "depends_on": ["backend/src/app.ts"]}
  ],
  "commands": {"install": ["npm install --prefix backend"], "build": ["npm run build --prefix backend"], "test": ["npm test --prefix backend"]},
  "run": [{"name": "backend", "command": "npm run dev", "cwd": "backend", "port": 4100, "health_url": "http://localhost:4100/api/health"}],
  "assumptions": ["..."]
}

Rules:
- It must run on a developer laptop with only Node.js (and Python if the architecture demands it). No Docker, cloud accounts or paid APIs. Put external services (payments, maps, SMS, email, cloud storage) behind small adapter interfaces with local mock implementations.
- Storage: prefer zero-native-dependency options (an in-memory or JSON-file repository behind a repository interface) so the real database from the architecture can be swapped in later. Say so in assumptions.
- If the architecture specifies native mobile apps, deliver the MVP user experience as a responsive web frontend unless the documents require otherwise, and record that in assumptions.
- Layout: "backend/" and "frontend/" folders (plus "shared/" only if truly useful), each with its own package.json. A root README.md with run instructions.
- Use the PORTS given. The backend must expose GET /api/health. The frontend must call the backend on its port (proxy or CORS).
- 15-45 files. Order = build order: config/manifests first, then backend core (app, config, models, repositories, services, routes), then frontend (config, entry, api client, layout, pages/components), then tests, then README. Every file the code imports must be in the list (except npm packages).
- Cover the highest-priority user stories / requirements end to end rather than every feature shallowly. Reference requirement or story IDs in purposes where the documents provide them.
- Paths are relative, use forward slashes, no "..", no absolute paths.`;

function cleanPath(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const cleaned = p.trim().replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!cleaned || cleaned.includes('..') || /^[A-Za-z]:/.test(cleaned) || cleaned.startsWith('/')) return null;
  return cleaned;
}

function normalizeBlueprint(raw: any): Blueprint {
  if (!raw || typeof raw !== 'object') throw new DevError('The blueprint is not an object');
  const seen = new Set<string>();
  const files: BlueprintFile[] = [];
  for (const f of Array.isArray(raw.files) ? raw.files : []) {
    const p = cleanPath(f?.path);
    if (!p || seen.has(p) || p === SECOND_BRAIN_FILE) continue;
    seen.add(p);
    files.push({
      path: p,
      layer: LAYERS.includes(f.layer) ? f.layer : 'backend',
      purpose: String(f.purpose ?? '').trim() || 'See blueprint summary.',
      dependsOn: (Array.isArray(f.depends_on ?? f.dependsOn) ? f.depends_on ?? f.dependsOn : []).map(cleanPath).filter(Boolean) as string[],
    });
  }
  if (!files.length) throw new DevError('The blueprint has no files');
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);
  return {
    summary: String(raw.summary ?? '').trim(),
    scopeNote: String(raw.scope_note ?? raw.scopeNote ?? '').trim(),
    stack: Object.fromEntries(Object.entries(raw.stack ?? {}).map(([k, v]) => [k, String(v)])),
    files: files.slice(0, 80),
    commands: {
      install: list(raw.commands?.install),
      build: list(raw.commands?.build),
      test: list(raw.commands?.test),
    },
    run: (Array.isArray(raw.run) ? raw.run : [])
      .filter((r: any) => r && typeof r.command === 'string')
      .map((r: any) => ({
        name: String(r.name ?? 'app'),
        command: String(r.command),
        cwd: cleanPath(r.cwd) ?? undefined,
        port: Number(r.port) || undefined,
        healthUrl: typeof (r.health_url ?? r.healthUrl) === 'string' ? r.health_url ?? r.healthUrl : undefined,
      })),
    assumptions: list(raw.assumptions),
  };
}

function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new DevError('The model did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Kicks off generation and returns at once; the result arrives as a pipeline event. */
export function generateBlueprint(sessionId: string, feedback?: string): PipelineState {
  const state = getPipeline(sessionId);
  if (state.blueprintStatus === 'generating') throw new DevError('A blueprint is already being generated', 409);
  const llm = getLLM();
  if (!llm) throw new DevError('No LLM is configured on the server', 500);
  ensureWorkspace(sessionId);

  const previous = state.blueprintStatus;
  state.blueprintStatus = 'generating';
  state.blueprintError = undefined;
  save(sessionId);

  const ports = state.ports;
  const content = [
    `PORTS: backend ${ports.backend}, frontend ${ports.frontend}, spare ${ports.extra.join(', ')}`,
    `# ${SECOND_BRAIN_FILE}\n${readSecondBrain(sessionId)}`,
    `# Full project documents\n${readProjectDocs(sessionId) || '(none — rely on secondbrain.md)'}`,
    state.blueprint ? `# Previous blueprint draft\n${JSON.stringify(state.blueprint, null, 2)}` : '',
    feedback?.trim() ? `# Reviewer feedback to apply (highest priority)\n${feedback.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  void (async () => {
    try {
      let raw: string;
      try {
        raw = await llm.chat(BLUEPRINT_SYSTEM, [{ role: 'user', content }], { json: true, maxOutputTokens: 32768, temperature: 0.2 });
      } catch (err: any) {
        throw new DevError(`Model call failed: ${err.message}`, 502);
      }
      state.blueprint = normalizeBlueprint(parseJson(raw));
      state.blueprintStatus = 'draft';
    } catch (err: any) {
      state.blueprintError = err.message;
      state.blueprintStatus = !state.blueprint ? 'none' : previous === 'approved' ? 'approved' : 'draft';
    }
    save(sessionId);
  })();

  return state;
}

export function updateBlueprint(sessionId: string, blueprint: unknown): PipelineState {
  const state = getPipeline(sessionId);
  if (state.blueprintStatus === 'generating') throw new DevError('Wait for generation to finish', 409);
  state.blueprint = normalizeBlueprint(toRaw(blueprint));
  if (state.blueprintStatus === 'approved') state.blueprintStatus = 'draft';
  save(sessionId);
  return state;
}

/** The client edits the camelCase shape; accept it as well as the model's snake_case. */
function toRaw(b: any) {
  return {
    ...b,
    files: (b?.files ?? []).map((f: any) => ({ ...f, depends_on: f.dependsOn ?? f.depends_on })),
    run: (b?.run ?? []).map((r: any) => ({ ...r, health_url: r.healthUrl ?? r.health_url })),
    scope_note: b?.scopeNote ?? b?.scope_note,
  };
}

function blueprintMarkdown(bp: Blueprint, ports: PipelineState['ports']): string {
  const rows = bp.files.map((f, i) => `| ${i + 1} | \`${f.path}\` | ${f.layer} | ${f.purpose.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
  return `# Implementation Blueprint

${bp.summary}

**Scope:** ${bp.scopeNote || '—'}

## Stack
${Object.entries(bp.stack).map(([k, v]) => `- **${k}:** ${v}`).join('\n')}

## Ports
- backend: ${ports.backend}
- frontend: ${ports.frontend}

## Files (build order)
| # | Path | Layer | Purpose |
|---|------|-------|---------|
${rows.join('\n')}

## Commands
- Install: ${bp.commands.install.map((c) => `\`${c}\``).join(', ') || '—'}
- Build: ${bp.commands.build.map((c) => `\`${c}\``).join(', ') || '—'}
- Test: ${bp.commands.test.map((c) => `\`${c}\``).join(', ') || '—'}

## Run
${bp.run.map((r) => `- **${r.name}:** \`${r.command}\`${r.cwd ? ` in \`${r.cwd}\`` : ''}${r.healthUrl ? ` — health: ${r.healthUrl}` : ''}`).join('\n') || '—'}

## Assumptions
${bp.assumptions.map((a) => `- ${a}`).join('\n') || '—'}
`;
}

export function approveBlueprint(sessionId: string, blueprint?: unknown): PipelineState {
  const state = getPipeline(sessionId);
  if (blueprint) state.blueprint = normalizeBlueprint(toRaw(blueprint));
  if (!state.blueprint) throw new DevError('There is no blueprint to approve');

  // Keep progress on files that survive a re-approval.
  const previous = new Map(state.files.map((f) => [f.path, f]));
  state.files = state.blueprint.files.map((f) => {
    const old = previous.get(f.path);
    return { ...f, status: old && ['done', 'skipped'].includes(old.status) ? old.status : 'pending' };
  });
  state.blueprintStatus = 'approved';
  state.blueprintError = undefined;
  state.stage = 'scaffold';

  writeFile(sessionId, `${DOCS_DIR}/BLUEPRINT.md`, blueprintMarkdown(state.blueprint, state.ports));
  registerBlueprint(sessionId, state.files);
  const bp = state.blueprint;
  writeManagedBlock(
    sessionId,
    'BLUEPRINT',
    'Development blueprint (approved)',
    `${bp.summary}\n\n${Object.entries(bp.stack).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\nPorts: backend ${state.ports.backend}, frontend ${state.ports.frontend}.\nRun: ${bp.run.map((r) => `${r.name} → \`${r.command}\`${r.cwd ? ` (in ${r.cwd})` : ''}`).join('; ')}\nFull file list and purposes: \`${DOCS_DIR}/BLUEPRINT.md\`.`
  );
  agent.notifyFsChange(sessionId, [`${DOCS_DIR}/BLUEPRINT.md`, SECOND_BRAIN_FILE]);
  save(sessionId);
  return state;
}

// ── Scaffold ─────────────────────────────────────────────────────────────────

function stubContent(file: BlueprintFile): string {
  const name = path.basename(file.path).toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop()! : name;
  const text = `${STUB_MARKER}: ${file.purpose.replace(/\s+/g, ' ').slice(0, 300)}`;
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'java', 'go', 'cs', 'dart', 'kt', 'swift', 'rs', 'c', 'cpp', 'scss'].includes(ext)) return `// ${text}\n`;
  if (ext === 'css') return `/* ${text} */\n`;
  if (['py', 'sh', 'yml', 'yaml', 'toml', 'txt', 'env', 'gitignore', 'dockerfile', 'ini', 'cfg'].includes(ext) || name.startsWith('.env')) return `# ${text}\n`;
  if (['html', 'htm', 'md', 'xml', 'svg', 'vue'].includes(ext)) return `<!-- ${text} -->\n`;
  return '';
}

export function isStub(sessionId: string, relative: string): boolean {
  if (!fileExists(sessionId, relative)) return true;
  try {
    const content = readFile(sessionId, relative);
    return !content.trim() || content.includes(STUB_MARKER);
  } catch {
    return false;
  }
}

export function createScaffold(sessionId: string): { state: PipelineState; created: string[]; kept: string[] } {
  const state = getPipeline(sessionId);
  if (state.blueprintStatus !== 'approved') throw new DevError('Approve the blueprint first', 409);
  const created: string[] = [];
  const kept: string[] = [];
  for (const file of state.files) {
    if (fileExists(sessionId, file.path)) {
      kept.push(file.path);
      continue;
    }
    writeFile(sessionId, file.path, stubContent(file));
    created.push(file.path);
  }
  state.stage = 'build';
  agent.notifyFsChange(sessionId, created);
  save(sessionId);
  return { state, created, kept };
}

// ── Build ────────────────────────────────────────────────────────────────────

function buildPrompt(sessionId: string, state: PipelineState, file: BuildFile): string {
  const bp = state.blueprint!;
  const done = state.files.filter((f) => f.status === 'done').map((f) => f.path);
  const listing = state.files
    .map((f) => `- ${f.path} [${f.path === file.path ? 'THIS FILE' : f.status === 'done' ? 'built' : 'not built yet'}] — ${f.purpose}`)
    .join('\n');

  return `PIPELINE TASK — implement ONE file of the approved blueprint.

FILE: ${file.path}
LAYER: ${file.layer}
PURPOSE: ${file.purpose}
DEPENDS ON: ${file.dependsOn.join(', ') || '(nothing listed)'}

BLUEPRINT SUMMARY: ${bp.summary}
STACK: ${Object.entries(bp.stack).map(([k, v]) => `${k}: ${v}`).join('; ')}
PORTS: backend ${state.ports.backend}, frontend ${state.ports.frontend}
ASSUMPTIONS: ${bp.assumptions.join(' | ') || 'none'}

ALL FILES (the agreed paths and responsibilities; keep imports consistent with them):
${listing}

Already built: ${done.length ? done.join(', ') : 'none yet'}

LIVING DOC: ${docFor(sessionId, file.path) ??'none yet; AIDLC creates it when you write the file'}

How to work:
0. If the file already has a living doc, read it first: it records earlier decisions and who depends on this file.
1. Read the built files this one depends on or is used by (and their living docs in docs/dev/), so names, exports and types match exactly.
2. Look up the relevant details in ${DOCS_DIR}/ (index: ${DOCS_DIR}/README.md; use search for requirement/story/screen names instead of reading whole documents).
   If this file renders UI, open the matching live mockup in ${DOCS_DIR}/design/mockups/ and reproduce its layout, components, copy and states.
3. Write the COMPLETE implementation of ${file.path} with write_file. No placeholders, no TODOs, no "${STUB_MARKER}" marker left behind.
4. Only touch another file if consistency strictly requires it, and say why in your final message.
5. Do not install packages or start servers in this task. Finish with a short final message: what the file does and anything the next files must know.`;
}

export function buildPromptPreview(sessionId: string, relative: string): string {
  const state = getPipeline(sessionId);
  const file = state.files.find((f) => f.path === relative);
  if (!file || !state.blueprint) throw new DevError('Unknown file', 404);
  return buildPrompt(sessionId, state, file);
}

async function buildOne(sessionId: string, file: BuildFile): Promise<boolean> {
  const state = getPipeline(sessionId);
  file.status = 'in_progress';
  file.note = undefined;
  save(sessionId);

  let outcome: agent.RunOutcome;
  try {
    outcome = await agent.startTask(sessionId, buildPrompt(sessionId, state, file),`🔨 Build ${file.path}`);
  } catch (err: any) {
    file.status = 'pending';
    file.note = err.message;
    save(sessionId);
    return false;
  }

  const stub = isStub(sessionId, file.path);
  if (outcome === 'final' && !stub) {
    file.status = 'done';
  } else if (outcome === 'stopped') {
    file.status = 'pending';
    file.note = 'Stopped by you.';
  } else {
    file.status = 'failed';
    file.note = stub ? 'The file was not written. Check the agent panel, then Retry (you can type guidance to the agent first).' : `The agent ended with "${outcome}".`;
  }
  save(sessionId);
  return file.status === 'done';
}

async function buildLoop(sessionId: string) {
  if (loops.has(sessionId)) return;
  loops.add(sessionId);
  const state = getPipeline(sessionId);
  try {
    while (state.building) {
      const next = state.files.find((f) => f.status === 'pending');
      if (!next) {
        state.building = false;
        if (state.files.every((f) => f.status === 'done' || f.status === 'skipped')) state.stage = 'verify';
        break;
      }
      const ok = await buildOne(sessionId, next);
      if (!ok || !state.autoContinue) state.building = false;
    }
  } finally {
    loops.delete(sessionId);
    state.building = false;
    save(sessionId);
  }
}

/** 'all' builds every remaining file in order; 'next' builds just the next one and stops. */
export function startBuild(sessionId: string, mode: 'all' | 'next' = 'all'): PipelineState {
  const state = getPipeline(sessionId);
  if (state.blueprintStatus !== 'approved') throw new DevError('Approve the blueprint first', 409);
  if (agent.isBusy(sessionId) || loops.has(sessionId)) throw new DevError('The agent is busy. Wait for it to finish or press Stop.', 409);
  agent.ensureEditMode(sessionId);
  registerBlueprint(sessionId, state.files);
  for (const f of state.files) if (f.status === 'failed') f.status = 'pending';
  state.autoContinue = mode === 'all';
  state.stage = 'build';
  state.building = true;
  save(sessionId);
  void buildLoop(sessionId);
  return state;
}

/** Finish the file in progress, then stop. */
export function pauseBuild(sessionId: string): PipelineState {
  const state = getPipeline(sessionId);
  state.building = false;
  save(sessionId);
  return state;
}

export function buildSingle(sessionId: string, relative: string): PipelineState {
  const state = getPipeline(sessionId);
  const file = state.files.find((f) => f.path === relative);
  if (!file) throw new DevError('That file is not in the blueprint', 404);
  if (agent.isBusy(sessionId) || loops.has(sessionId)) throw new DevError('The agent is busy', 409);
  agent.ensureEditMode(sessionId);
  registerBlueprint(sessionId, state.files);
  void buildOne(sessionId, file);
  return state;
}

export function setFileStatus(sessionId: string, relative: string, status: 'pending' | 'skipped' | 'done'): PipelineState {
  const state = getPipeline(sessionId);
  const file = state.files.find((f) => f.path === relative);
  if (!file) throw new DevError('That file is not in the blueprint', 404);
  if (file.status === 'in_progress') throw new DevError('That file is being built right now', 409);
  file.status = status;
  file.note = status === 'done' ? 'Marked done by you.' : undefined;
  save(sessionId);
  return state;
}

export function setAutoContinue(sessionId: string, value: boolean): PipelineState {
  const state = getPipeline(sessionId);
  state.autoContinue = Boolean(value);
  save(sessionId);
  return state;
}

// ── Verify ───────────────────────────────────────────────────────────────────

function verifyPrompt(state: PipelineState): string {
  const bp = state.blueprint!;
  const lines = (label: string, cmds: string[]) => `${label}: ${cmds.length ? cmds.map((c) => `\`${c}\``).join(', ') : '(none listed — infer from package.json)'}`;
  return `PIPELINE TASK — verify the project builds, runs locally and works functionally.

${lines('Install', bp.commands.install)}
${lines('Build / type-check', bp.commands.build)}
${lines('Test', bp.commands.test)}
Services: ${bp.run.map((r) => `${r.name}: \`${r.command}\`${r.cwd ? ` (cwd ${r.cwd})` : ''}${r.healthUrl ? ` ready at ${r.healthUrl}` : ''}`).join('; ') || '(none listed)'}
Ports: backend ${state.ports.backend}, frontend ${state.ports.frontend}

Steps:
1. update_plan with the checks below.
2. Install dependencies with run_command (timeout_sec 600).
3. Build / type-check. If it fails, read the errors, fix the code with edit_file, and re-run until it passes.
4. Run the tests the same way.
5. Start every service with start_process (use its ready_url). If one does not become ready, read process_logs, fix, restart.
6. Functional check: with http_request, exercise 3-6 core user flows from the requirements against the running backend (and load the frontend URL). Compare the responses with what the requirements expect; fix real defects.
7. Leave the services running for the human to try.
8. Final message: a markdown table "Check | Result | Notes", the URLs to open, anything that could not be verified and why, and on the LAST line exactly "VERIFY_RESULT: PASS" or "VERIFY_RESULT: FAIL".

Honesty rules: a check passes only if you saw it pass in a TOOL_RESULT. If a tool call errored, was denied, or you did not run it, that check is FAIL or NOT VERIFIED, never PASS. AIDLC independently re-checks the services and file contents after you finish.`;
}

/** Objective checks: every built file is real code, and every service answers on its health URL. */
async function serverChecks(sessionId: string, state: PipelineState) {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const stubs = state.files.filter((f) => f.status !== 'skipped' && isStub(sessionId, f.path)).map((f) => f.path);
  checks.push({
    name: 'All blueprint files implemented',
    ok: stubs.length === 0,
    detail: stubs.length ? `Still placeholders: ${stubs.slice(0, 6).join(', ')}${stubs.length > 6 ? '…' : ''}` : `${state.files.length} files`,
  });
  const running = listProcesses(sessionId);
  for (const spec of state.blueprint?.run ?? []) {
    if (!spec.healthUrl || !isLocalUrl(spec.healthUrl)) continue;
    let ok = false;
    let detail = 'no response';
    try {
      const res = await fetch(spec.healthUrl, { signal: AbortSignal.timeout(5000) });
      ok = res.status < 400;
      detail = `HTTP ${res.status}`;
    } catch (err: any) {
      detail = err.cause?.code ?? err.message;
    }
    const proc = running.find((p) => p.name === spec.name);
    checks.push({
      name: `Service "${spec.name}" responds`,
      ok,
      detail: `${spec.healthUrl} → ${detail}${proc ? ` (process ${proc.status})` : ' (not started by the agent)'}`,
    });
  }
  return checks;
}

export function startVerify(sessionId: string): PipelineState {
  const state = getPipeline(sessionId);
  if (!state.blueprint) throw new DevError('Approve the blueprint first', 409);
  if (agent.isBusy(sessionId) || loops.has(sessionId)) throw new DevError('The agent is busy', 409);
  state.stage = 'verify';
  state.verify = { status: 'running', runs: state.verify.runs + 1 };
  save(sessionId);

  void (async () => {
    let outcome: agent.RunOutcome;
    try {
      outcome = await agent.startTask(sessionId, verifyPrompt(state), `🧪 Verify the project (run ${state.verify.runs})`);
    } catch (err: any) {
      state.verify = { ...state.verify, status: 'failed', summary: err.message };
      save(sessionId);
      return;
    }
    const final = agent.lastFinalText(sessionId) ?? '';
    const agentSaysPass = /VERIFY_RESULT:\s*PASS/i.test(final);
    // Never take the model's word for it: the server checks the services itself.
    const checks = await serverChecks(sessionId, state);
    const allHealthy = checks.every((c) => c.ok);
    const report = [
      outcome === 'final' ? final.replace(/VERIFY_RESULT:.*$/im, '').trim() : `The agent ended with "${outcome}".`,
      '',
      '**Independent checks by AIDLC**',
      '',
      '| Check | Result | Detail |',
      '| --- | --- | --- |',
      ...checks.map((c) => `| ${c.name} | ${c.ok ? 'PASS' : 'FAIL'} | ${c.detail} |`),
      ...(agentSaysPass && !allHealthy ? ['', 'The agent reported PASS, but the independent checks failed, so this run is marked as failed.'] : []),
    ].join('\n');
    state.verify = {
      ...state.verify,
      status: outcome === 'stopped' ? 'stopped' : outcome === 'final' && agentSaysPass && allHealthy ? 'passed' : 'failed',
      summary: report,
    };
    save(sessionId);
  })();
  return state;
}

// ── Navigation ───────────────────────────────────────────────────────────────

export function setStage(sessionId: string, stage: Stage): PipelineState {
  if (!STAGES.includes(stage)) throw new DevError(`Unknown stage "${stage}"`);
  const state = getPipeline(sessionId);
  if (stage !== 'blueprint' && state.blueprintStatus !== 'approved') throw new DevError('Approve the blueprint first', 409);
  state.stage = stage;
  save(sessionId);
  return state;
}
