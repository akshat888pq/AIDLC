import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import { getLLM } from '../state.js';
import {
  DevError,
  SECOND_BRAIN_FILE,
  devDataDir,
  ensureWorkspace,
  deletePath,
  fileExists,
  readFile,
  readSecondBrain,
  searchWorkspace,
  treeAsText,
  workspaceRoot,
  writeFile,
} from './workspace.js';
import {
  httpRequest,
  isolatedEnv,
  killTree,
  onProcessesChanged,
  processLogs,
  projectPorts,
  startProcess,
  stopProcess,
  listProcesses,
  type ProcessInfo,
} from './processes.js';
import { DEV_DOCS_DIR, docFor, updateDocs, type FileChange } from './fileDocs.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type PermissionMode = 'plan' | 'ask' | 'auto-edit' | 'auto';
export type AgentStatus = 'idle' | 'running' | 'awaiting_approval' | 'awaiting_input';
type ToolCategory = 'read' | 'edit' | 'command' | 'meta';
type ToolStatus = 'pending_approval' | 'running' | 'done' | 'denied' | 'error';
export type ApprovalDecision = 'allow' | 'allow_always' | 'deny';

export interface TranscriptItem {
  id: string;
  at: string;
  kind: 'user' | 'thought' | 'tool' | 'final' | 'question' | 'error' | 'system';
  text?: string;
  tool?: string;
  category?: ToolCategory;
  args?: Record<string, any>;
  status?: ToolStatus;
  output?: string;
  /** What the human reviews at the permission gate. */
  preview?: { path?: string; before?: string; after?: string; command?: string; dangerous?: boolean; reason?: string };
  answered?: boolean;
}

export interface PlanStep {
  text: string;
  status: 'pending' | 'in_progress' | 'done';
}

interface HistoryMessage {
  role: 'user' | 'model';
  content: string;
}

interface AgentState {
  sessionId: string;
  status: AgentStatus;
  mode: PermissionMode;
  items: TranscriptItem[];
  plan: PlanStep[];
  history: HistoryMessage[];
  allowedCommandPrefixes: string[];
  // Runtime only
  abort: boolean;
  queue: string[];
  child: ChildProcess | null;
  pendingApproval: { itemId: string; resolve: (d: { decision: ApprovalDecision; feedback?: string }) => void } | null;
  pendingInput: { itemId: string; resolve: (text: string) => void } | null;
  listeners: Set<(event: AgentEvent) => void>;
  contextTokens: number;
  /** Files changed during the current task: first "before", latest "after". */
  changes: Map<string, FileChange>;
}

export type AgentEvent =
  | { type: 'snapshot'; state: PublicState }
  | { type: 'item'; item: TranscriptItem }
  | { type: 'status'; status: AgentStatus; mode: PermissionMode; contextTokens: number }
  | { type: 'plan'; plan: PlanStep[] }
  | { type: 'fs'; paths: string[] }
  | { type: 'processes'; processes: ProcessInfo[] }
  | { type: 'pipeline'; pipeline: unknown };

export type RunOutcome = 'final' | 'stopped' | 'error' | 'limit';

export interface PublicState {
  status: AgentStatus;
  mode: PermissionMode;
  items: TranscriptItem[];
  plan: PlanStep[];
  allowedCommandPrefixes: string[];
  contextTokens: number;
  llm: string | null;
}

const MAX_STEPS = 40;
const MAX_TOOL_RESULT_CHARS = 12_000;
const HISTORY_CHAR_BUDGET = 160_000;
const MAX_ITEMS_PERSISTED = 600;
const DEFAULT_COMMAND_TIMEOUT = 120;

const TOOL_CATEGORY: Record<string, ToolCategory> = {
  list_files: 'read',
  read_file: 'read',
  search: 'read',
  write_file: 'edit',
  edit_file: 'edit',
  delete_file: 'edit',
  run_command: 'command',
  start_process: 'command',
  stop_process: 'meta',
  process_logs: 'read',
  http_request: 'read',
  update_plan: 'meta',
  ask_user: 'meta',
};

/** Absolute paths outside the workspace, or climbing out of it with "..". */
function escapesWorkspace(command: string, root: string): boolean {
  const normRoot = root.replace(/\\/g, '/').toLowerCase();
  if (/(^|[\s"'=;&|(])\.\.([\\/]|\s|$|["'])/.test(command)) return true;
  const absPaths = command.match(/(?:[A-Za-z]:[\\/][^\s"'|;&]*)|(?:(?<=[\s"'=])\/(?:[^\s"'|;&]+))/g) ?? [];
  return absPaths.some((p) => {
    const norm = p.replace(/\\/g, '/').toLowerCase();
    if (/^\/(dev\/null|tmp)/.test(norm)) return false;
    return !norm.startsWith(normRoot);
  });
}

const DANGEROUS_COMMAND =
  /\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\*|\.\.)|\bRemove-Item\b[^|;]*-Recurse[^|;]*(\\|\/|\.\.|[A-Za-z]:)|\bdel\s+\/[sq]|\brmdir\s+\/s|\bformat\s+[a-z]:|\bshutdown\b|\bmkfs\b|\bdd\s+if=|git\s+push\b[^|;]*(--force|-f\b)|git\s+reset\s+--hard|\b(curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(sh|bash|iex|Invoke-Expression)|:\(\)\s*\{/i;

// ── State ────────────────────────────────────────────────────────────────────

const states = new Map<string, AgentState>();

function statePath(sessionId: string) {
  return path.join(devDataDir(sessionId), 'agent.json');
}

function getState(sessionId: string): AgentState {
  let state = states.get(sessionId);
  if (state) return state;

  let saved: Partial<AgentState> = {};
  try {
    saved = JSON.parse(fs.readFileSync(statePath(sessionId), 'utf-8'));
  } catch {
    /* first run */
  }

  state = {
    sessionId,
    status: 'idle',
    mode: saved.mode ?? 'ask',
    // A transcript loaded from disk may hold a gate that was waiting when the server stopped.
    items: (saved.items ?? []).map((i) =>
      i.status === 'pending_approval' || i.status === 'running' ? { ...i, status: 'error', output: (i.output ?? '') + '\n[interrupted]' } : i
    ),
    plan: saved.plan ?? [],
    history: saved.history ?? [],
    allowedCommandPrefixes: saved.allowedCommandPrefixes ?? [],
    abort: false,
    queue: [],
    child: null,
    pendingApproval: null,
    pendingInput: null,
    listeners: new Set(),
    contextTokens: 0,
    changes: new Map(),
  };
  states.set(sessionId, state);
  return state;
}

function persist(state: AgentState) {
  fs.mkdirSync(devDataDir(state.sessionId), { recursive: true });
  const data = {
    mode: state.mode,
    items: state.items.slice(-MAX_ITEMS_PERSISTED),
    plan: state.plan,
    history: state.history,
    allowedCommandPrefixes: state.allowedCommandPrefixes,
  };
  fs.writeFileSync(statePath(state.sessionId), JSON.stringify(data, null, 2), 'utf-8');
}

function publicState(state: AgentState): PublicState {
  return {
    status: state.status,
    mode: state.mode,
    items: state.items,
    plan: state.plan,
    allowedCommandPrefixes: state.allowedCommandPrefixes,
    contextTokens: state.contextTokens,
    llm: getLLM()?.name ?? null,
  };
}

function emit(state: AgentState, event: AgentEvent) {
  for (const listener of state.listeners) listener(event);
}

function setStatus(state: AgentState, status: AgentStatus) {
  state.status = status;
  emit(state, { type: 'status', status, mode: state.mode, contextTokens: state.contextTokens });
}

function addItem(state: AgentState, item: Omit<TranscriptItem, 'id' | 'at'>): TranscriptItem {
  const full: TranscriptItem = { id: crypto.randomUUID(), at: new Date().toISOString(), ...item };
  state.items.push(full);
  emit(state, { type: 'item', item: full });
  return full;
}

function updateItem(state: AgentState, item: TranscriptItem, patch: Partial<TranscriptItem>) {
  Object.assign(item, patch);
  emit(state, { type: 'item', item });
}

// ── Public API ───────────────────────────────────────────────────────────────

export function subscribe(sessionId: string, listener: (event: AgentEvent) => void): () => void {
  const state = getState(sessionId);
  state.listeners.add(listener);
  listener({ type: 'snapshot', state: publicState(state) });
  return () => state.listeners.delete(listener);
}

export function getPublicState(sessionId: string): PublicState {
  return publicState(getState(sessionId));
}

export function setMode(sessionId: string, mode: PermissionMode): PublicState {
  if (!['plan', 'ask', 'auto-edit', 'auto'].includes(mode)) throw new DevError(`Unknown mode "${mode}"`);
  const state = getState(sessionId);
  state.mode = mode;
  persist(state);
  emit(state, { type: 'status', status: state.status, mode, contextTokens: state.contextTokens });
  return publicState(state);
}

/** A human message: starts a run, answers a question, or rejects the pending action with feedback. */
export function sendMessage(sessionId: string, text: string): PublicState {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) throw new DevError('Message is empty');
  const state = getState(sessionId);

  if (state.pendingInput) {
    const { resolve, itemId } = state.pendingInput;
    const question = state.items.find((i) => i.id === itemId);
    if (question) updateItem(state, question, { answered: true });
    addItem(state, { kind: 'user', text: trimmed });
    state.pendingInput = null;
    resolve(trimmed);
    return publicState(state);
  }

  if (state.pendingApproval) {
    addItem(state, { kind: 'user', text: trimmed });
    const { resolve } = state.pendingApproval;
    state.pendingApproval = null;
    resolve({ decision: 'deny', feedback: trimmed });
    return publicState(state);
  }

  if (state.status !== 'idle') {
    state.queue.push(trimmed);
    addItem(state, { kind: 'system', text: 'Message queued — it will be sent when the current task finishes.' });
    addItem(state, { kind: 'user', text: trimmed });
    return publicState(state);
  }

  addItem(state, { kind: 'user', text: trimmed });
  void run(state, trimmed, trimmed.slice(0, 120));
  return publicState(state);
}

export function resolveApproval(
  sessionId: string,
  itemId: string,
  decision: ApprovalDecision,
  feedback?: string
): PublicState {
  const state = getState(sessionId);
  if (!state.pendingApproval || state.pendingApproval.itemId !== itemId) {
    throw new DevError('That action is no longer waiting for approval', 409);
  }
  const { resolve } = state.pendingApproval;
  state.pendingApproval = null;
  resolve({ decision, feedback });
  return publicState(state);
}

export function stop(sessionId: string): PublicState {
  const state = getState(sessionId);
  state.abort = true;
  state.queue = [];
  if (state.pendingApproval) {
    const { resolve } = state.pendingApproval;
    state.pendingApproval = null;
    resolve({ decision: 'deny', feedback: 'The user stopped the task.' });
  }
  if (state.pendingInput) {
    const { resolve } = state.pendingInput;
    state.pendingInput = null;
    resolve('(The user stopped the task.)');
  }
  killChild(state);
  return publicState(state);
}

export function reset(sessionId: string): PublicState {
  const state = getState(sessionId);
  if (state.status !== 'idle') throw new DevError('Stop the running task before clearing the conversation', 409);
  state.items = [];
  state.history = [];
  state.plan = [];
  state.contextTokens = 0;
  persist(state);
  emit(state, { type: 'snapshot', state: publicState(state) });
  return publicState(state);
}

export function notifyFsChange(sessionId: string, paths: string[]) {
  const state = states.get(sessionId);
  if (state) emit(state, { type: 'fs', paths });
}

/** Push an event to every browser watching this project. */
export function broadcast(sessionId: string, event: AgentEvent) {
  emit(getState(sessionId), event);
}

onProcessesChanged((sessionId) => broadcast(sessionId, { type: 'processes', processes: listProcesses(sessionId) }));

export function lastFinalText(sessionId: string): string | undefined {
  const items = getState(sessionId).items;
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'final') return items[i].text;
  return undefined;
}

/** Building needs to write files; Plan mode would deny every write. */
export function ensureEditMode(sessionId: string) {
  const state = getState(sessionId);
  if (state.mode !== 'plan') return;
  state.mode = 'ask';
  addItem(state, { kind: 'system', text: 'Switched from Plan to Ask mode so files can be written. You approve each one.' });
  emit(state, { type: 'status', status: state.status, mode: state.mode, contextTokens: state.contextTokens });
  persist(state);
}

export function isBusy(sessionId: string): boolean {
  return getState(sessionId).status !== 'idle';
}

/**
 * Run one agent task on behalf of the pipeline. The transcript shows `label`; the
 * model receives the full `prompt`. Resolves when the agent finishes or is stopped.
 */
export function startTask(sessionId: string, prompt: string, label: string): Promise<RunOutcome> {
  const state = getState(sessionId);
  if (state.status !== 'idle') throw new DevError('The agent is busy. Wait for it to finish or press Stop.', 409);
  addItem(state, { kind: 'user', text: label });
  return run(state, prompt, label);
}

// ── The loop ─────────────────────────────────────────────────────────────────

async function run(state: AgentState, userText: string, label: string): Promise<RunOutcome> {
  const llm = getLLM();
  if (!llm) {
    addItem(state, { kind: 'error', text: 'No LLM is configured. Set GEMINI_API_KEY (or another provider key) in .env.' });
    return 'error';
  }

  ensureWorkspace(state.sessionId);
  state.abort = false;
  state.history.push({ role: 'user', content: `USER REQUEST:\n${userText}` });
  setStatus(state, 'running');

  let invalidReplies = 0;
  let outcome: RunOutcome = 'limit';

  try {
    for (let step = 0; step < MAX_STEPS && !state.abort; step++) {
      const system = buildSystemPrompt(state);
      const messages = compactHistory(state.history);
      state.contextTokens = Math.round((system.length + messages.reduce((n, m) => n + m.content.length, 0)) / 4);
      emit(state, { type: 'status', status: state.status, mode: state.mode, contextTokens: state.contextTokens });

      let reply: string;
      try {
        reply = await llm.chat(system, messages, { maxOutputTokens: 16384, temperature: 0.2, json: true });
      } catch (err: any) {
        addItem(state, { kind: 'error', text: `Model call failed: ${err.message}` });
        outcome = 'error';
        break;
      }
      if (state.abort) break;
      state.history.push({ role: 'model', content: reply });

      const parsed = parseReply(reply);
      if (!parsed) {
        invalidReplies++;
        if (invalidReplies > 2) {
          addItem(state, { kind: 'error', text: 'The model kept returning malformed replies. Try rephrasing the request.' });
          outcome = 'error';
          break;
        }
        state.history.push({
          role: 'user',
          content: 'SYSTEM: Your reply was not a single valid JSON object. Reply again with exactly one JSON object as specified.',
        });
        continue;
      }
      invalidReplies = 0;

      if (parsed.thought) addItem(state, { kind: 'thought', text: parsed.thought });

      if (typeof parsed.final === 'string') {
        addItem(state, { kind: 'final', text: parsed.final });
        outcome = 'final';
        break;
      }

      if (!parsed.action?.tool) {
        state.history.push({ role: 'user', content: 'SYSTEM: Reply with either an "action" or a "final" message.' });
        continue;
      }

      const result = await executeTool(state, parsed.action.tool, parsed.action.args ?? {});
      state.history.push({ role: 'user', content: `TOOL_RESULT ${parsed.action.tool}:\n${clip(result, MAX_TOOL_RESULT_CHARS)}` });
      persist(state);
    }

    if (state.abort) {
      outcome = 'stopped';
      addItem(state, { kind: 'system', text: 'Task stopped by you.' });
      state.history.push({ role: 'user', content: 'SYSTEM: The user stopped this task. Wait for the next request.' });
      state.history.push({ role: 'model', content: '{"thought":"Stopped.","final":"Stopped."}' });
    } else if (outcome === 'limit') {
      addItem(state, { kind: 'system', text: `Paused after ${MAX_STEPS} steps. Say "continue" to keep going.` });
      state.history.push({ role: 'model', content: '{"thought":"Step limit reached.","final":"Paused at the step limit."}' });
    }
  } catch (err: any) {
    outcome = 'error';
    addItem(state, { kind: 'error', text: `Agent error: ${err.message}` });
  } finally {
    // Keep the history alternating user/model so the next request starts cleanly.
    if (state.history.length && state.history[state.history.length - 1].role === 'user') {
      state.history.push({ role: 'model', content: '{"final":"(interrupted)"}' });
    }
    state.abort = false;
    state.child = null;
  }

  // Every file this task touched gets its living document refreshed, even if the task stopped early.
  if (state.changes.size) {
    const changes = [...state.changes.values()];
    state.changes = new Map();
    const note = addItem(state, { kind: 'system', text: `📝 Updating the living docs for ${changes.length} changed file(s)…` });
    try {
      const docs = await updateDocs(state.sessionId, changes, label, lastFinalText(state.sessionId));
      updateItem(state, note, { text: docs.length ? `📝 Docs updated: ${docs.filter((d) => !d.endsWith('INDEX.md')).join(', ')}` : '📝 No documentable files changed.' });
      if (docs.length) notifyFsChange(state.sessionId, docs);
    } catch (err: any) {
      updateItem(state, note, { text: `📝 Could not update the docs: ${err.message}` });
    }
  }

  setStatus(state, 'idle');
  persist(state);

  const next = state.queue.shift();
  if (next) void run(state, next, next.slice(0, 120));
  return outcome;
}

function parseReply(reply: string): { thought?: string; final?: string; action?: { tool: string; args?: any } } | null {
  let text = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  text = text.slice(start, end + 1);
  try {
    const obj = JSON.parse(text);
    if (typeof obj !== 'object' || obj === null) return null;
    // Tolerate {"tool": ..., "args": ...} at the top level.
    if (!obj.action && typeof obj.tool === 'string') obj.action = { tool: obj.tool, args: obj.args };
    // Models often flatten the arguments into the action, or name them differently.
    if (obj.action && typeof obj.action === 'object') {
      const { tool, args, arguments: args2, parameters, input, ...rest } = obj.action;
      const nested = [args, args2, parameters, input].find((a) => a && typeof a === 'object' && Object.keys(a).length);
      obj.action = { tool, args: { ...rest, ...(nested ?? {}) } };
    }
    return obj;
  } catch {
    return null;
  }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.3);
  return `${text.slice(0, head)}\n… [${text.length - max} characters omitted] …\n${text.slice(-(max - head))}`;
}

/** Shrink old tool results first so the conversation fits the context budget. */
function compactHistory(history: HistoryMessage[]): HistoryMessage[] {
  const copy: HistoryMessage[] = [];
  for (const m of history) {
    const last = copy[copy.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else copy.push({ ...m });
  }
  while (copy.length && copy[0].role !== 'user') copy.shift();
  let total = copy.reduce((n, m) => n + m.content.length, 0);
  for (let i = 0; i < copy.length - 6 && total > HISTORY_CHAR_BUDGET; i++) {
    const m = copy[i];
    if (m.content.length > 600) {
      const shrunk = `${m.content.slice(0, 400)}\n… [older content compacted to save context] …`;
      total -= m.content.length - shrunk.length;
      m.content = shrunk;
    }
  }
  return copy;
}

const MODE_TEXT: Record<PermissionMode, string> = {
  plan: 'PLAN MODE — read-only. You may read, search and update_plan, but write/edit/delete/run_command will be denied. Investigate, then present a concrete implementation plan as your final message and ask the user to switch to an editing mode.',
  ask: 'ASK MODE — reads run automatically; every file change and every command waits for the human to approve it.',
  'auto-edit': 'AUTO-EDIT MODE — file changes are applied automatically; commands still wait for human approval.',
  auto: 'AUTO MODE — file changes and commands run automatically, except destructive commands, which always ask the human.',
};

function buildSystemPrompt(state: AgentState): string {
  const shell = process.platform === 'win32' ? 'Windows PowerShell' : 'bash';
  const secondBrain = readSecondBrain(state.sessionId);
  const ports = projectPorts(state.sessionId);
  const procs = listProcesses(state.sessionId);
  const plan = state.plan.length
    ? state.plan.map((s, i) => `${i + 1}. [${s.status}] ${s.text}`).join('\n')
    : '(no plan yet)';

  return `You are the AIDLC Development Agent: a senior software engineer working inside a project workspace that has an editor and a terminal, in the style of Claude Code or Kiro. Work in a loop: understand the request, plan, act with ONE tool at a time, check the result, verify your work, then report.

# Response format
Reply with exactly ONE JSON object and nothing else.
To call a tool:
{"thought": "one or two sentences the user will see about what you are doing and why", "action": {"tool": "<tool name>", "args": { ... }}}
When the task is done, or you need nothing further:
{"thought": "...", "final": "markdown summary for the user: what changed, how to run it, what is next"}
You will receive the tool's output as TOOL_RESULT in the next message.

# Tools
- list_files {"path": "dir (optional, default root)", "depth": 3}
- read_file {"path": "file", "start_line": 1, "end_line": 400}  (line range optional)
- search {"pattern": "regex", "path": "dir (optional)"}
- write_file {"path": "file", "content": "full file content"}  creates or overwrites; parent folders are created
- edit_file {"path": "file", "old_string": "exact existing text", "new_string": "replacement"}  old_string must match exactly once; include enough surrounding lines to be unique
- delete_file {"path": "file or dir"}
- run_command {"command": "shell command", "timeout_sec": 120}  runs in ${shell} at the workspace root and waits for it to finish
- start_process {"name": "backend", "command": "npm run dev", "cwd": "backend (optional)", "ready_url": "http://localhost:PORT/health (optional)", "timeout_sec": 90}  starts a long-running server in the background and waits until ready_url answers
- stop_process {"name": "backend"}
- process_logs {"name": "backend", "tail": 6000}  recent output of a background process
- http_request {"url": "http://localhost:PORT/...", "method": "GET", "body": {...}}  call the project's running services (localhost only) to check behaviour
- update_plan {"steps": [{"text": "...", "status": "pending|in_progress|done"}]}  replaces the whole plan
- ask_user {"question": "..."}  pauses until the human answers

# Rules
- All paths are relative to the workspace root. Never use absolute paths or "..".
- Read a file before you edit it. Use edit_file for targeted changes and write_file for new files.
- For anything with more than two steps, call update_plan first and keep statuses current as you go.
- Never start long-running processes (dev servers, watchers, "npm run dev", "uvicorn --reload") with run_command: it blocks until the timeout. Use start_process, then http_request to verify.
- Stay inside the workspace: never reference absolute paths or parent directories, never install packages globally.
- Verify your work where possible (type-check, build, run tests) using run_command.
- If the request is ambiguous or a decision belongs to the user (product behaviour, new dependency, data deletion), use ask_user instead of guessing.
- If a tool call is DENIED, read the human's feedback, adjust, and do not repeat the same call.
- Record significant technical decisions by editing the "## Development log" section of ${SECOND_BRAIN_FILE}.
- Every source file has a living document in ${DEV_DOCS_DIR}/ (index: ${DEV_DOCS_DIR}/INDEX.md), numbered in build order. Before modifying an existing file, read its document: it explains the file's purpose, dependents, decisions and change history. AIDLC rewrites these documents automatically after your changes, so never edit files under ${DEV_DOCS_DIR}/ yourself.
- Keep "thought" short. Put explanations for the user in "final".

# Environment
- OS shell: ${shell}
- Ports reserved for this project: backend ${ports.backend}, frontend ${ports.frontend}, spare ${ports.extra.join(', ')}. Use only these (also exposed as env AIDLC_BACKEND_PORT / AIDLC_FRONTEND_PORT).
- Background processes: ${procs.length ? procs.map((p) => `${p.name} [${p.status}] ${p.command}`).join('; ') : 'none running'}
- Permission mode: ${MODE_TEXT[state.mode]}

# Current plan
${plan}

# Workspace tree
${treeAsText(state.sessionId, '', 3, 250)}

# ${SECOND_BRAIN_FILE} (project context — requirements, architecture and design from earlier AIDLC phases, plus the team's rules)
${clip(secondBrain, 40_000) || '(empty)'}
`;
}

// ── Permission gate ──────────────────────────────────────────────────────────

function commandPrefix(command: string): string {
  const tokens = command.trim().split(/\s+/);
  const multi = ['npm', 'npx', 'pnpm', 'yarn', 'git', 'python', 'python3', 'pip', 'node', 'dotnet', 'cargo', 'go'];
  return multi.includes(tokens[0]) && tokens[1] ? `${tokens[0]} ${tokens[1]}` : tokens[0];
}

type GateResult = { allowed: true } | { allowed: false; reason: string };

async function permissionGate(state: AgentState, item: TranscriptItem): Promise<GateResult> {
  const category = item.category!;
  if (category === 'read' || category === 'meta') return { allowed: true };

  if (state.mode === 'plan') {
    return { allowed: false, reason: 'Denied: the session is in PLAN MODE (read-only). Present your plan in a final message instead.' };
  }

  if (category === 'edit' && (state.mode === 'auto-edit' || state.mode === 'auto')) return { allowed: true };

  if (category === 'command') {
    const command =
      item.tool === 'http_request'
        ? `${String(item.args?.method ?? 'GET').toUpperCase()} ${item.args?.url ?? ''}`
        : String(item.args?.command ?? '');
    const outside = item.tool !== 'http_request' && escapesWorkspace(command, workspaceRoot(state.sessionId));
    const dangerous = DANGEROUS_COMMAND.test(command) || outside;
    item.preview = {
      ...item.preview,
      command,
      dangerous,
      reason: outside ? 'This command references paths outside the project workspace.' : dangerous ? 'This command looks destructive.' : undefined,
    };
    if (!dangerous) {
      if (state.mode === 'auto') return { allowed: true };
      if (state.allowedCommandPrefixes.includes(commandPrefix(command))) return { allowed: true };
    }
  }

  // Ask the human.
  updateItem(state, item, { status: 'pending_approval' });
  setStatus(state, 'awaiting_approval');
  persist(state);

  const { decision, feedback } = await new Promise<{ decision: ApprovalDecision; feedback?: string }>((resolve) => {
    state.pendingApproval = { itemId: item.id, resolve };
  });

  setStatus(state, 'running');

  if (decision === 'deny') {
    return {
      allowed: false,
      reason: `DENIED by the human.${feedback ? ` Their feedback: ${feedback}` : ' No reason given — ask what they would prefer if unclear.'}`,
    };
  }

  if (decision === 'allow_always') {
    if (category === 'edit') {
      state.mode = 'auto-edit';
      addItem(state, { kind: 'system', text: 'Switched to Auto-edit: file changes will now apply without asking.' });
    } else if (category === 'command') {
      const prefix = commandPrefix(String(item.args?.command ?? ''));
      if (!state.allowedCommandPrefixes.includes(prefix)) state.allowedCommandPrefixes.push(prefix);
      addItem(state, { kind: 'system', text: `"${prefix}" commands will now run without asking.` });
    }
    emit(state, { type: 'status', status: state.status, mode: state.mode, contextTokens: state.contextTokens });
  }
  return { allowed: true };
}

// ── Tools ────────────────────────────────────────────────────────────────────

async function executeTool(state: AgentState, tool: string, args: Record<string, any>): Promise<string> {
  let category = TOOL_CATEGORY[tool];
  if (!category) return `ERROR: Unknown tool "${tool}". Available: ${Object.keys(TOOL_CATEGORY).join(', ')}`;
  // Reading a local endpoint is harmless; anything that can change state is a command.
  if (tool === 'http_request' && !['GET', 'HEAD'].includes(String(args.method ?? 'GET').toUpperCase())) category = 'command';

  const sessionId = state.sessionId;
  const item = addItem(state, { kind: 'tool', tool, category, args, status: 'running' });

  try {
    if (category === 'edit' && String(args.path ?? '').replace(/\\/g, '/').startsWith(`${DEV_DOCS_DIR}/`)) {
      throw new DevError(`${DEV_DOCS_DIR}/ is maintained by AIDLC and updated automatically after your changes. Change the source file instead.`);
    }
    // Build what the human will review before asking.
    if (tool === 'write_file') {
      const p = requireString(args.path, 'path');
      const before = fileExists(sessionId, p) ? safeRead(sessionId, p) : '';
      item.preview = { path: p, before, after: String(args.content ?? '') };
    } else if (tool === 'edit_file') {
      const p = requireString(args.path, 'path');
      const oldString = requireString(args.old_string, 'old_string');
      const newString = String(args.new_string ?? '');
      const before = readFile(sessionId, p);
      const count = before.split(oldString).length - 1;
      if (count === 0) throw new DevError(`old_string was not found in ${p}. Re-read the file and copy the text exactly.`);
      if (count > 1) throw new DevError(`old_string matches ${count} places in ${p}. Include more surrounding context so it is unique.`);
      item.preview = { path: p, before, after: before.replace(oldString, () => newString) };
    } else if (tool === 'delete_file') {
      const p = requireString(args.path, 'path');
      item.preview = { path: p, before: fileExists(sessionId, p) ? safeRead(sessionId, p) : '', after: '' };
    }

    const gate = await permissionGate(state, item);
    if (!gate.allowed) {
      updateItem(state, item, { status: 'denied', output: gate.reason });
      return gate.reason;
    }
    updateItem(state, item, { status: 'running' });

    const output = await runTool(state, item, tool, args);
    updateItem(state, item, { status: 'done', output: clip(output, 20_000) });
    return output;
  } catch (err: any) {
    const message = `ERROR: ${err.message}`;
    updateItem(state, item, { status: 'error', output: message });
    return message;
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new DevError(`"${name}" is required`);
  return value;
}

function safeRead(sessionId: string, p: string): string {
  try {
    return readFile(sessionId, p);
  } catch (err: any) {
    return `(${err.message})`;
  }
}

async function runTool(state: AgentState, item: TranscriptItem, tool: string, args: Record<string, any>): Promise<string> {
  const sessionId = state.sessionId;

  switch (tool) {
    case 'list_files': {
      const depth = Math.min(Math.max(Number(args.depth) || 3, 1), 6);
      return treeAsText(sessionId, String(args.path ?? ''), depth, 400);
    }
    case 'read_file': {
      const p = requireString(args.path, 'path');
      const lines = readFile(sessionId, p).split(/\r?\n/);
      const start = Math.max(1, Number(args.start_line) || 1);
      const end = Math.min(lines.length, Number(args.end_line) || start + 799);
      const body = lines
        .slice(start - 1, end)
        .map((l, i) => `${String(start + i).padStart(5)}  ${l}`)
        .join('\n');
      const more = end < lines.length ? `\n… ${lines.length - end} more lines (use start_line/end_line).` : '';
      const doc = docFor(sessionId, p);
      const docHint = doc ? `\n\n(Living doc for this file: ${doc}. Read it before changing the file.)` : '';
      return `${p} (lines ${start}-${end} of ${lines.length})\n${body}${more}${docHint}`;
    }
    case 'search': {
      const hits = searchWorkspace(sessionId, requireString(args.pattern, 'pattern'), String(args.path ?? ''));
      return hits.length ? hits.join('\n') : 'No matches.';
    }
    case 'write_file': {
      const p = item.preview!.path!;
      const existed = fileExists(sessionId, p);
      const content = String(args.content ?? '');
      writeFile(sessionId, p, content);
      trackChange(state, p, existed ? item.preview!.before ?? '' : null, content);
      notifyFsChange(sessionId, [p]);
      return `${existed ? 'Overwrote' : 'Created'} ${p} (${content.split('\n').length} lines).`;
    }
    case 'edit_file': {
      const p = item.preview!.path!;
      writeFile(sessionId, p, item.preview!.after!);
      trackChange(state, p, item.preview!.before ?? '', item.preview!.after!);
      notifyFsChange(sessionId, [p]);
      return `Edited ${p}.`;
    }
    case 'delete_file': {
      const p = requireString(args.path, 'path');
      deletePath(sessionId, p);
      trackChange(state, p, item.preview?.before ?? '', null);
      notifyFsChange(sessionId, [p]);
      return `Deleted ${p}.`;
    }
    case 'run_command':
      return runCommand(state, item, requireString(args.command, 'command'), Number(args.timeout_sec) || DEFAULT_COMMAND_TIMEOUT);
    case 'start_process': {
      const { info, logTail } = await startProcess(sessionId, {
        name: requireString(args.name, 'name'),
        command: requireString(args.command, 'command'),
        cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
        readyUrl: typeof args.ready_url === 'string' ? args.ready_url : undefined,
        timeoutSec: Number(args.timeout_sec) || undefined,
      });
      return `Process "${info.name}" is ${info.status}${info.exitCode !== undefined ? ` (exit code ${info.exitCode})` : ''}.${
        info.readyUrl ? ` Ready URL: ${info.readyUrl}` : ''
      }\nLog tail:\n${logTail || '(no output yet)'}`;
    }
    case 'stop_process':
      return `Stopped "${stopProcess(sessionId, requireString(args.name, 'name')).name}".`;
    case 'process_logs':
      return processLogs(sessionId, requireString(args.name, 'name'), Number(args.tail) || 6000) || '(no output)';
    case 'http_request':
      return httpRequest({
        url: requireString(args.url, 'url'),
        method: typeof args.method === 'string' ? args.method : 'GET',
        body: args.body,
        headers: typeof args.headers === 'object' && args.headers ? args.headers : undefined,
      });
    case 'update_plan': {
      const steps = Array.isArray(args.steps) ? args.steps : [];
      state.plan = steps
        .filter((s: any) => s && typeof s.text === 'string')
        .map((s: any) => ({
          text: s.text,
          status: ['pending', 'in_progress', 'done'].includes(s.status) ? s.status : 'pending',
        }));
      emit(state, { type: 'plan', plan: state.plan });
      return `Plan updated (${state.plan.length} steps).`;
    }
    case 'ask_user': {
      const question = requireString(args.question, 'question');
      const q = addItem(state, { kind: 'question', text: question, answered: false });
      setStatus(state, 'awaiting_input');
      persist(state);
      const answer = await new Promise<string>((resolve) => {
        state.pendingInput = { itemId: q.id, resolve };
      });
      setStatus(state, 'running');
      return `The human answered: ${answer}`;
    }
  }
  return `ERROR: Tool "${tool}" is not implemented.`;
}

function trackChange(state: AgentState, p: string, before: string | null, after: string | null) {
  const key = p.replace(/\\/g, '/');
  const existing = state.changes.get(key);
  state.changes.set(key, { path: key, before: existing ? existing.before : before, after });
}

function killChild(state: AgentState) {
  if (state.child) killTree(state.child);
}

function runCommand(state: AgentState, item: TranscriptItem, command: string, timeoutSec: number): Promise<string> {
  const cwd = ensureWorkspace(state.sessionId);
  const timeout = Math.min(Math.max(timeoutSec, 5), 600) * 1000;
  const env = isolatedEnv(state.sessionId);
  env.CI = 'true';
  env.FORCE_COLOR = '0';

  const child =
    process.platform === 'win32'
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd, env, windowsHide: true })
      : spawn('bash', ['-lc', command], { cwd, env });
  state.child = child;

  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let lastEmit = 0;

    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf-8');
      if (output.length > 200_000) output = output.slice(-150_000);
      const now = Date.now();
      if (now - lastEmit > 250) {
        lastEmit = now;
        updateItem(state, item, { output: clip(output, 20_000) });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.stdin?.end();

    const timer = setTimeout(() => {
      timedOut = true;
      killChild(state);
    }, timeout);

    const finish = (code: number | null, error?: Error) => {
      clearTimeout(timer);
      state.child = null;
      notifyFsChange(state.sessionId, []);
      const tail = output.trim() || '(no output)';
      const status = error
        ? `failed to start: ${error.message}`
        : timedOut
        ? `TIMED OUT after ${timeout / 1000}s and was killed. If this is a server or watcher, ask the user to run it in the Terminal panel.`
        : `exit code ${code}`;
      resolve(`$ ${command}\n${tail}\n[${status}]`);
    };
    child.on('error', (err) => finish(null, err));
    child.on('close', (code) => finish(code));
  });
}
