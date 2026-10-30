const BASE = '/api/dev';

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

export interface ScaffoldTemplate {
  id: string;
  name: string;
  description: string;
  stack: string[];
  postCreate?: string;
  fileCount: number;
}

export type PermissionMode = 'plan' | 'ask' | 'auto-edit' | 'auto';
export type AgentStatus = 'idle' | 'running' | 'awaiting_approval' | 'awaiting_input';

export interface TranscriptItem {
  id: string;
  at: string;
  kind: 'user' | 'thought' | 'tool' | 'final' | 'question' | 'error' | 'system';
  text?: string;
  tool?: string;
  category?: 'read' | 'edit' | 'command' | 'meta';
  args?: Record<string, any>;
  status?: 'pending_approval' | 'running' | 'done' | 'denied' | 'error';
  output?: string;
  preview?: { path?: string; before?: string; after?: string; command?: string; dangerous?: boolean };
  answered?: boolean;
}

export interface PlanStep {
  text: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface AgentState {
  status: AgentStatus;
  mode: PermissionMode;
  items: TranscriptItem[];
  plan: PlanStep[];
  allowedCommandPrefixes: string[];
  contextTokens: number;
  llm: string | null;
}

export type AgentEvent =
  | { type: 'snapshot'; state: AgentState }
  | { type: 'item'; item: TranscriptItem }
  | { type: 'status'; status: AgentStatus; mode: PermissionMode; contextTokens: number }
  | { type: 'plan'; plan: PlanStep[] }
  | { type: 'fs'; paths: string[] }
  | { type: 'processes'; processes: ProcessInfo[] }
  | { type: 'pipeline'; pipeline: PipelineState };

// ── Hand-over from the earlier phases ──

export interface MockupEntry {
  screenId: string;
  screenName: string;
  route?: string;
  status: string;
  file: string;
  orphaned?: boolean;
}

export interface HandoverManifest {
  generatedAt: string;
  projectName: string;
  phases: { id: string; name: string; status: string; files: { path: string; title: string; note?: string }[] }[];
  mockups: MockupEntry[];
  storyCount: number;
  warnings: string[];
}

// ── Pipeline ──

export type Stage = 'blueprint' | 'scaffold' | 'build' | 'verify' | 'done';
export type Layer = 'config' | 'backend' | 'frontend' | 'shared' | 'test' | 'docs';

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
  ports: { backend: number; frontend: number; extra: number[] };
  updatedAt: string;
}

export interface ProcessInfo {
  name: string;
  command: string;
  cwd: string;
  readyUrl?: string;
  status: 'starting' | 'ready' | 'running' | 'exited' | 'failed';
  exitCode?: number | null;
  startedAt: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!body.success) throw new Error(body.error || 'Request failed');
  return body.data as T;
}

function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

const s = (sessionId: string) => `${BASE}/${encodeURIComponent(sessionId)}`;

export const getTemplates = () => request<ScaffoldTemplate[]>(`${BASE}/templates`);

export const getWorkspace = (sessionId: string) =>
  request<{ exists: boolean; projectName: string; root: string; tree: TreeNode[] }>(`${s(sessionId)}/workspace`);

export const initWorkspace = (sessionId: string, template?: string) =>
  send<{ tree: TreeNode[]; scaffold: { written: string[]; skipped: string[] } | null; postCreate?: string }>(
    'POST',
    `${s(sessionId)}/workspace/init`,
    { template }
  );

export const syncSecondBrain = (sessionId: string) =>
  send<{ content: string; manifest: HandoverManifest }>('POST', `${s(sessionId)}/secondbrain/sync`);

export const getHandover = (sessionId: string) => request<HandoverManifest | null>(`${s(sessionId)}/handover`);

export const mockupUrl = (sessionId: string, file: string) => `${s(sessionId)}/mockup?path=${encodeURIComponent(file)}`;

const p = (sessionId: string) => `${s(sessionId)}/pipeline`;
export const getPipeline = (sessionId: string) => request<PipelineState>(p(sessionId));
export const generateBlueprint = (sessionId: string, feedback?: string) =>
  send<PipelineState>('POST', `${p(sessionId)}/blueprint/generate`, { feedback });
export const saveBlueprint = (sessionId: string, blueprint: Blueprint) =>
  send<PipelineState>('PUT', `${p(sessionId)}/blueprint`, { blueprint });
export const approveBlueprint = (sessionId: string, blueprint: Blueprint) =>
  send<PipelineState>('POST', `${p(sessionId)}/blueprint/approve`, { blueprint });
export const createScaffold = (sessionId: string) =>
  send<{ state: PipelineState; created: string[]; kept: string[] }>('POST', `${p(sessionId)}/scaffold`);
export const startBuild = (sessionId: string, mode: 'all' | 'next') =>
  send<PipelineState>('POST', `${p(sessionId)}/build/start`, { mode });
export const getFileDocs = (sessionId: string) =>
  request<Record<string, { doc: string; seq: number; status: string; changes: number }>>(`${p(sessionId)}/docs`);
export const pauseBuild = (sessionId: string) => send<PipelineState>('POST', `${p(sessionId)}/build/pause`);
export const setAutoContinue = (sessionId: string, autoContinue: boolean) =>
  send<PipelineState>('POST', `${p(sessionId)}/build/auto`, { autoContinue });
export const buildFile = (sessionId: string, path: string) =>
  send<PipelineState>('POST', `${p(sessionId)}/files/build`, { path });
export const setFileStatus = (sessionId: string, path: string, status: 'pending' | 'skipped' | 'done') =>
  send<PipelineState>('POST', `${p(sessionId)}/files/status`, { path, status });
export const startVerify = (sessionId: string) => send<PipelineState>('POST', `${p(sessionId)}/verify`);
export const setStage = (sessionId: string, stage: Stage) => send<PipelineState>('POST', `${p(sessionId)}/stage`, { stage });

export const getProcesses = (sessionId: string) =>
  request<{ processes: ProcessInfo[]; ports: PipelineState['ports'] }>(`${s(sessionId)}/processes`);
export const stopProcess = (sessionId: string, name: string) =>
  send<ProcessInfo>('POST', `${s(sessionId)}/processes/${encodeURIComponent(name)}/stop`);
export const getProcessLogs = (sessionId: string, name: string) =>
  request<{ logs: string }>(`${s(sessionId)}/processes/${encodeURIComponent(name)}/logs`);

export const getTree = (sessionId: string) => request<TreeNode[]>(`${s(sessionId)}/files/tree`);

export const readFile = (sessionId: string, path: string) =>
  request<{ path: string; content: string }>(`${s(sessionId)}/files/content?path=${encodeURIComponent(path)}`);

export const writeFile = (sessionId: string, path: string, content: string) =>
  send<{ path: string }>('PUT', `${s(sessionId)}/files/content`, { path, content });

export const createPath = (sessionId: string, path: string, type: 'file' | 'dir') =>
  send<TreeNode[]>('POST', `${s(sessionId)}/files/create`, { path, type });

export const renamePath = (sessionId: string, from: string, to: string) =>
  send<TreeNode[]>('POST', `${s(sessionId)}/files/rename`, { from, to });

/** The file tree asks "Delete …?" before calling this, which is the required confirmation. */
export const deletePath = (sessionId: string, path: string) =>
  request<TreeNode[]>(`${s(sessionId)}/files?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: { 'x-aidlc-confirm': 'yes' },
  });

export const runInTerminal = (sessionId: string, command: string, terminalId?: string) =>
  send<{ sent: boolean }>('POST', `${s(sessionId)}/terminal/run`, { command, terminalId });

export const listTerminals = (sessionId: string) => request<{ id: string; running: boolean }[]>(`${s(sessionId)}/terminals`);

export const closeTerminal = (sessionId: string, terminalId: string) =>
  request<{ id: string; running: boolean }[]>(`${s(sessionId)}/terminals/${encodeURIComponent(terminalId)}`, { method: 'DELETE' });

export const sendAgentMessage = (sessionId: string, text: string) =>
  send<AgentState>('POST', `${s(sessionId)}/agent/message`, { text });

export const approveAction = (
  sessionId: string,
  itemId: string,
  decision: 'allow' | 'allow_always' | 'deny',
  feedback?: string
) => send<AgentState>('POST', `${s(sessionId)}/agent/approve`, { itemId, decision, feedback });

export const setAgentMode = (sessionId: string, mode: PermissionMode) =>
  send<AgentState>('POST', `${s(sessionId)}/agent/mode`, { mode });

export const stopAgent = (sessionId: string) => send<AgentState>('POST', `${s(sessionId)}/agent/stop`);

export const resetAgent = (sessionId: string) => send<AgentState>('POST', `${s(sessionId)}/agent/reset`);

export function subscribeAgent(sessionId: string, onEvent: (event: AgentEvent) => void): () => void {
  const source = new EventSource(`${s(sessionId)}/agent/events`);
  source.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => source.close();
}

export function terminalUrl(sessionId: string, terminalId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${BASE}/terminal/${encodeURIComponent(sessionId)}/${encodeURIComponent(terminalId)}`;
}
