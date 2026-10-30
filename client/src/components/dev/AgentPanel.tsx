import { useEffect, useRef, useState } from 'react';
import type { AgentState, PermissionMode, TranscriptItem } from '../../services/devApi';
import * as devApi from '../../services/devApi';
import DiffView from './DiffView';
import Markdown from './Markdown';

interface Props {
  sessionId: string;
  state: AgentState;
  onOpenFile: (path: string) => void;
}

const MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: 'plan', label: 'Plan', hint: 'Read-only. The agent investigates and proposes a plan; nothing is changed.' },
  { id: 'ask', label: 'Ask', hint: 'Every file change and command waits for your approval.' },
  { id: 'auto-edit', label: 'Auto-edit', hint: 'File changes apply automatically; commands still ask.' },
  { id: 'auto', label: 'Auto', hint: 'Edits and commands run automatically; destructive commands still ask.' },
];

const STATUS_TEXT: Record<AgentState['status'], string> = {
  idle: 'Ready',
  running: 'Working…',
  awaiting_approval: 'Waiting for your approval',
  awaiting_input: 'Waiting for your answer',
};

const QUICK_PROMPTS = [
  'Read secondbrain.md and scaffold the project structure it describes. Plan first.',
  'Explain how this codebase is organised and how to run it.',
  'Review the code for bugs and propose fixes.',
  'Add unit tests for the main logic and run them.',
];

const TOOL_LABEL: Record<string, string> = {
  list_files: 'List files',
  read_file: 'Read',
  search: 'Search',
  write_file: 'Write',
  edit_file: 'Edit',
  delete_file: 'Delete',
  run_command: 'Run',
  update_plan: 'Update plan',
  ask_user: 'Ask you',
};

function toolTarget(item: TranscriptItem): string {
  const a = item.args ?? {};
  if (item.tool === 'run_command') return String(a.command ?? '');
  if (item.tool === 'search') return `/${a.pattern ?? ''}/ ${a.path ?? ''}`;
  if (item.tool === 'update_plan') return `${(a.steps ?? []).length} steps`;
  return String(a.path ?? (item.tool === 'list_files' ? '.' : ''));
}

function commandPrefix(command: string): string {
  const tokens = command.trim().split(/\s+/);
  const multi = ['npm', 'npx', 'pnpm', 'yarn', 'git', 'python', 'python3', 'pip', 'node', 'dotnet', 'cargo', 'go'];
  return multi.includes(tokens[0]) && tokens[1] ? `${tokens[0]} ${tokens[1]}` : tokens[0];
}

function ApprovalCard({ item, sessionId, onOpenFile }: { item: TranscriptItem; sessionId: string; onOpenFile: (p: string) => void }) {
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCommand = item.category === 'command';
  const preview = item.preview ?? {};

  const decide = async (decision: 'allow' | 'allow_always' | 'deny') => {
    setBusy(true);
    setError(null);
    try {
      await devApi.approveAction(sessionId, item.id, decision, decision === 'deny' ? feedback.trim() || undefined : undefined);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-500/60 bg-amber-950/20 p-3 space-y-2">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">Permission needed</span>
        <span className="text-slate-300">
          {isCommand ? 'Run a command' : item.tool === 'delete_file' ? 'Delete' : item.tool === 'write_file' ? 'Write file' : 'Edit file'}
        </span>
      </div>

      {isCommand ? (
        <>
          <pre className="rounded bg-slate-950 border border-slate-700 px-2 py-1.5 text-[12px] text-emerald-200 whitespace-pre-wrap break-all">
            $ {preview.command}
          </pre>
          {preview.dangerous && (
            <p className="text-[12px] text-red-300">⚠ This command looks destructive. Check it carefully.</p>
          )}
        </>
      ) : (
        <>
          <button onClick={() => preview.path && onOpenFile(preview.path)} className="text-[12px] font-mono text-sky-300 hover:underline">
            {preview.path}
          </button>
          <DiffView before={preview.before ?? ''} after={preview.after ?? ''} />
        </>
      )}

      <input
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Optional: tell the agent what to do instead (sent if you deny)"
        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[12px] text-slate-200 placeholder:text-slate-500 outline-none focus:border-slate-500"
        onKeyDown={(e) => e.key === 'Enter' && void decide('deny')}
      />
      {error && <p className="text-[12px] text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => void decide('allow')} className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-medium disabled:opacity-50">
          Allow
        </button>
        {!preview.dangerous && (
          <button disabled={busy} onClick={() => void decide('allow_always')} className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-[12px] disabled:opacity-50">
            {isCommand ? `Always allow "${commandPrefix(preview.command ?? '')}"` : 'Allow all edits this session'}
          </button>
        )}
        <button disabled={busy} onClick={() => void decide('deny')} className="px-3 py-1 rounded bg-red-700/80 hover:bg-red-600 text-white text-[12px] disabled:opacity-50">
          Deny
        </button>
      </div>
    </div>
  );
}

function ToolRow({ item, onOpenFile }: { item: TranscriptItem; onOpenFile: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const isCommand = item.tool === 'run_command';
  const showOutput = open || (isCommand && item.status === 'running');
  const statusIcon =
    item.status === 'running' ? (
      <span className="inline-block w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
    ) : item.status === 'done' ? (
      <span className="text-emerald-400">✓</span>
    ) : item.status === 'denied' ? (
      <span className="text-amber-400">⊘</span>
    ) : (
      <span className="text-red-400">✕</span>
    );
  const path = item.args?.path as string | undefined;
  const fileTool = ['read_file', 'write_file', 'edit_file'].includes(item.tool ?? '');

  return (
    <div className="text-[12px]">
      <div className="flex items-center gap-2 group">
        <span className="w-4 flex justify-center">{statusIcon}</span>
        <span className="text-slate-400 shrink-0">{TOOL_LABEL[item.tool ?? ''] ?? item.tool}</span>
        {fileTool && path ? (
          <button onClick={() => onOpenFile(path)} className="font-mono text-sky-300 hover:underline truncate">
            {path}
          </button>
        ) : (
          <span className="font-mono text-slate-300 truncate">{toolTarget(item)}</span>
        )}
        {item.output && (
          <button onClick={() => setOpen((v) => !v)} className="ml-auto text-[11px] text-slate-500 hover:text-slate-300 shrink-0">
            {showOutput ? 'hide' : 'details'}
          </button>
        )}
      </div>
      {showOutput && item.output && (
        <pre className="mt-1 ml-6 max-h-60 overflow-auto rounded bg-slate-950 border border-slate-800 px-2 py-1 text-[11px] text-slate-300 whitespace-pre-wrap break-all">
          {item.output}
        </pre>
      )}
      {open && !isCommand && item.preview && item.preview.after !== undefined && item.status === 'done' && (
        <div className="mt-1 ml-6">
          <DiffView before={item.preview.before ?? ''} after={item.preview.after ?? ''} maxHeight={240} />
        </div>
      )}
    </div>
  );
}

export default function AgentPanel({ sessionId, state, onOpenFile }: Props) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = state.status !== 'idle';
  const pendingQuestion = state.status === 'awaiting_input';

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.items.length, state.items[state.items.length - 1]?.status, state.items[state.items.length - 1]?.output?.length]);

  const send = async (text = draft) => {
    if (!text.trim()) return;
    setError(null);
    try {
      await devApi.sendAgentMessage(sessionId, text);
      setDraft('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const changeMode = async (mode: PermissionMode) => {
    try {
      await devApi.setAgentMode(sessionId, mode);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const done = state.plan.filter((s) => s.status === 'done').length;
  const contextPct = Math.min(100, Math.round((state.contextTokens / 200_000) * 100));

  return (
    <div className="h-full flex flex-col bg-slate-900 text-slate-200">
      {/* Header */}
      <div className="px-3 pt-2 pb-2 border-b border-slate-800 space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Agent</span>
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded ${
                state.status === 'idle'
                  ? 'bg-slate-800 text-slate-400'
                  : state.status === 'running'
                  ? 'bg-sky-900/60 text-sky-300'
                  : 'bg-amber-900/60 text-amber-300'
              }`}
            >
              {STATUS_TEXT[state.status]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500" title="Approximate size of the context window sent to the model">
              ctx ~{(state.contextTokens / 1000).toFixed(1)}k
            </span>
            <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full ${contextPct > 80 ? 'bg-amber-400' : 'bg-sky-500'}`} style={{ width: `${contextPct}%` }} />
            </div>
            <button
              disabled={busy}
              onClick={() => window.confirm('Clear the conversation and plan? Files are not touched.') && void devApi.resetAgent(sessionId).catch((e) => setError(e.message))}
              className="text-[11px] text-slate-500 hover:text-slate-200 disabled:opacity-40"
              title="New conversation"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="flex rounded-md bg-slate-800 p-0.5" role="radiogroup" aria-label="Permission mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={state.mode === m.id}
              title={m.hint}
              onClick={() => void changeMode(m.id)}
              className={`flex-1 text-[11px] py-1 rounded transition-colors ${
                state.mode === m.id ? 'bg-slate-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[10.5px] text-slate-500 leading-snug">{MODES.find((m) => m.id === state.mode)?.hint}</p>
      </div>

      {/* Plan */}
      {state.plan.length > 0 && (
        <div className="px-3 py-2 border-b border-slate-800 shrink-0 max-h-44 overflow-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Plan</span>
            <span className="text-[10px] text-slate-500">{done}/{state.plan.length}</span>
          </div>
          <ul className="space-y-0.5">
            {state.plan.map((step, i) => (
              <li key={i} className="flex gap-2 text-[12px]">
                <span className={step.status === 'done' ? 'text-emerald-400' : step.status === 'in_progress' ? 'text-sky-400' : 'text-slate-600'}>
                  {step.status === 'done' ? '☑' : step.status === 'in_progress' ? '◐' : '☐'}
                </span>
                <span className={step.status === 'done' ? 'text-slate-500 line-through' : step.status === 'in_progress' ? 'text-white' : 'text-slate-300'}>
                  {step.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-3 space-y-3">
        {state.items.length === 0 && (
          <div className="space-y-3">
            <div className="text-[12.5px] text-slate-400 leading-relaxed">
              <p className="text-slate-200 font-medium mb-1">Development agent</p>
              The agent reads <span className="font-mono text-slate-300">secondbrain.md</span> and your workspace, plans,
              then edits files and runs commands. Changes go through the permission gate for your approval.
              {!state.llm && <p className="mt-2 text-red-300">No LLM key is configured on the server.</p>}
            </div>
            <div className="space-y-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => void send(p)}
                  className="w-full text-left text-[12px] px-2.5 py-1.5 rounded border border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-slate-300"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {state.items.map((item) => {
          switch (item.kind) {
            case 'user':
              return (
                <div key={item.id} className="flex justify-end">
                  <div className="max-w-[90%] rounded-lg bg-accent/90 text-white px-3 py-1.5 text-[13px] whitespace-pre-wrap">{item.text}</div>
                </div>
              );
            case 'thought':
              return (
                <p key={item.id} className="text-[12.5px] text-slate-400 italic leading-snug">
                  {item.text}
                </p>
              );
            case 'tool':
              return item.status === 'pending_approval' ? (
                <ApprovalCard key={item.id} item={item} sessionId={sessionId} onOpenFile={onOpenFile} />
              ) : (
                <ToolRow key={item.id} item={item} onOpenFile={onOpenFile} />
              );
            case 'final':
              return (
                <div key={item.id} className="rounded-lg bg-slate-800/70 border border-slate-700 px-3 py-2 text-slate-200">
                  <Markdown text={item.text ?? ''} />
                </div>
              );
            case 'question':
              return (
                <div key={item.id} className={`rounded-lg border px-3 py-2 ${item.answered ? 'border-slate-700 bg-slate-800/40' : 'border-sky-500/60 bg-sky-950/30'}`}>
                  <p className="text-[11px] font-semibold text-sky-300 mb-1">The agent asks</p>
                  <Markdown text={item.text ?? ''} />
                </div>
              );
            case 'error':
              return (
                <div key={item.id} className="rounded border border-red-800 bg-red-950/40 px-3 py-1.5 text-[12px] text-red-200">
                  {item.text}
                </div>
              );
            default:
              return (
                <p key={item.id} className="text-[11px] text-slate-500 text-center">
                  {item.text}
                </p>
              );
          }
        })}
        {state.status === 'running' && (
          <div className="flex items-center gap-2 text-[12px] text-slate-500">
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:120ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:240ms]" />
            </span>
            thinking
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-slate-800 p-2 shrink-0">
        {error && (
          <div className="mb-2 text-[12px] text-red-300 flex justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          placeholder={
            pendingQuestion
              ? 'Answer the agent…'
              : state.status === 'awaiting_approval'
              ? 'Type to deny the pending action and redirect the agent…'
              : busy
              ? 'Queue a follow-up…'
              : 'Ask the agent to build, fix or explain something…  (Enter to send, Shift+Enter for a new line)'
          }
          className="w-full resize-none bg-slate-800 border border-slate-700 rounded-md px-2.5 py-2 text-[13px] text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
        />
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10.5px] text-slate-500">
            {state.llm ? `Model: ${state.llm}` : 'No model configured'}
            {state.allowedCommandPrefixes.length > 0 && ` · auto-allowed: ${state.allowedCommandPrefixes.join(', ')}`}
          </span>
          <div className="flex gap-2">
            {busy && (
              <button onClick={() => void devApi.stopAgent(sessionId)} className="px-3 py-1 rounded bg-red-700/80 hover:bg-red-600 text-white text-[12px]">
                ■ Stop
              </button>
            )}
            <button
              onClick={() => void send()}
              disabled={!draft.trim()}
              className="px-3 py-1 rounded bg-accent hover:bg-accent-hover text-white text-[12px] font-medium disabled:opacity-40"
            >
              {pendingQuestion ? 'Answer' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
