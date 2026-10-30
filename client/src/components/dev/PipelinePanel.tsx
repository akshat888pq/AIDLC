import { useEffect, useState } from 'react';
import type {
  Blueprint,
  BlueprintFile,
  HandoverManifest,
  Layer,
  PipelineState,
  ProcessInfo,
  Stage,
} from '../../services/devApi';
import * as devApi from '../../services/devApi';
import Markdown from './Markdown';

interface Props {
  sessionId: string;
  pipeline: PipelineState | null;
  manifest: HandoverManifest | null;
  processes: ProcessInfo[];
  agentBusy: boolean;
  agentMode: string;
  onOpenFile: (path: string) => void;
  onOpenMockups: () => void;
  onSyncContext: () => Promise<void>;
}

type View = 'context' | Stage;

const STEPS: { id: View; label: string }[] = [
  { id: 'context', label: 'Context' },
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'scaffold', label: 'Scaffold' },
  { id: 'build', label: 'Build' },
  { id: 'verify', label: 'Verify' },
  { id: 'done', label: 'Done' },
];

const LAYERS: Layer[] = ['config', 'backend', 'frontend', 'shared', 'test', 'docs'];
const LAYER_COLOR: Record<Layer, string> = {
  config: 'text-amber-300',
  backend: 'text-emerald-300',
  frontend: 'text-sky-300',
  shared: 'text-violet-300',
  test: 'text-pink-300',
  docs: 'text-slate-300',
};

const btn = 'px-3 py-1.5 rounded text-[12.5px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const primary = `${btn} bg-indigo-600 hover:bg-indigo-500 text-white`;
const secondary = `${btn} bg-slate-700 hover:bg-slate-600 text-slate-100`;
const card = 'rounded-lg border border-slate-700 bg-slate-800/50 p-4';

function stageIndex(view: View) {
  return STEPS.findIndex((s) => s.id === view);
}

export default function PipelinePanel(props: Props) {
  const { sessionId, pipeline, manifest, agentBusy } = props;
  const [view, setView] = useState<View>('context');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Follow the pipeline forward as stages complete.
  useEffect(() => {
    if (pipeline && pipeline.blueprintStatus !== 'none') setView(pipeline.stage);
  }, [pipeline?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reached = (id: View) => {
    if (id === 'context' || id === 'blueprint') return true;
    if (!pipeline || pipeline.blueprintStatus !== 'approved') return false;
    return stageIndex(id) <= stageIndex(pipeline.stage);
  };

  return (
    <div className="h-full flex flex-col bg-slate-900 text-slate-200 min-h-0">
      {/* Stepper */}
      <div className="shrink-0 flex items-center gap-1 px-4 h-11 border-b border-slate-800 overflow-x-auto">
        {STEPS.map((step, i) => {
          const active = view === step.id;
          const current = pipeline?.stage === step.id;
          const done = pipeline && step.id !== 'context' && stageIndex(step.id) < stageIndex(pipeline.stage) && pipeline.blueprintStatus === 'approved';
          return (
            <div key={step.id} className="flex items-center gap-1 shrink-0">
              {i > 0 && <span className="text-slate-600 px-1">›</span>}
              <button
                disabled={!reached(step.id)}
                onClick={() => setView(step.id)}
                className={`px-2.5 py-1 rounded text-[12px] flex items-center gap-1.5 disabled:opacity-35 ${
                  active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${
                    done ? 'bg-emerald-600 text-white' : current ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {done ? '✓' : i}
                </span>
                {step.label}
              </button>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded bg-red-950 border border-red-800 text-[12px] text-red-200 flex justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="max-w-5xl mx-auto space-y-4">
          {view === 'context' && <ContextStep {...props} busy={busy} act={act} onNext={() => setView('blueprint')} />}
          {view === 'blueprint' && <BlueprintStep {...props} busy={busy} act={act} />}
          {view === 'scaffold' && pipeline && <ScaffoldStep {...props} pipeline={pipeline} busy={busy} act={act} />}
          {view === 'build' && pipeline && <BuildStep {...props} pipeline={pipeline} busy={busy} act={act} />}
          {(view === 'verify' || view === 'done') && pipeline && (
            <VerifyStep {...props} pipeline={pipeline} busy={busy} act={act} doneView={view === 'done'} />
          )}
          {!pipeline && view !== 'context' && <p className="text-sm text-slate-400">Loading pipeline…</p>}
          {agentBusy && view !== 'context' && (
            <p className="text-[11.5px] text-slate-500">
              The agent is working; follow it and approve its actions in the Agent panel on the right.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

type StepProps = Props & { busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> };

// ── 0. Context ───────────────────────────────────────────────────────────────

function ContextStep({ manifest, busy, act, onSyncContext, onOpenFile, onOpenMockups, onNext }: StepProps & { onNext: () => void }) {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Project context carried into development</h2>
          <p className="text-[12.5px] text-slate-400 mt-0.5 max-w-3xl">
            Everything the earlier phases produced is copied into <span className="font-mono">docs/aidlc/</span> in this
            workspace. <span className="font-mono">secondbrain.md</span> indexes it and is loaded into the agent's context on
            every turn.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button disabled={busy} onClick={() => act(onSyncContext)} className={secondary}>
            ⟳ Sync context
          </button>
          <button onClick={onNext} className={primary}>
            Next: Blueprint →
          </button>
        </div>
      </div>

      {!manifest && <div className={card}>No hand-over yet. Press "Sync context" to pull every phase's output into the workspace.</div>}

      {manifest && (
        <>
          {manifest.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-700 bg-amber-950/40 px-4 py-2.5 text-[12.5px] text-amber-200 space-y-0.5">
              {manifest.warnings.map((w) => (
                <p key={w}>⚠ {w}</p>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label="Phases carried over" value={manifest.phases.length} />
            <Stat label="Live mockups" value={manifest.mockups.length} action={manifest.mockups.length ? { label: 'View', onClick: onOpenMockups } : undefined} />
            <Stat label="User stories" value={manifest.storyCount} />
          </div>

          <div className="space-y-3">
            {manifest.phases.map((phase) => (
              <div key={phase.id} className={card}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-white text-[13.5px]">{phase.name}</h3>
                  <span className="text-[11px] text-slate-400">{phase.status}</span>
                </div>
                <ul className="space-y-1">
                  {phase.files.map((f) => (
                    <li key={f.path} className="text-[12.5px] flex flex-wrap gap-x-2">
                      <button onClick={() => onOpenFile(f.path)} className="font-mono text-sky-300 hover:underline">
                        {f.path.replace('docs/aidlc/', '')}
                      </button>
                      <span className="text-slate-400">{f.title}</span>
                      {f.note && <span className="text-slate-500 text-[11.5px]">({f.note})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">Synced {new Date(manifest.generatedAt).toLocaleString()}</p>
        </>
      )}
    </>
  );
}

function Stat({ label, value, action }: { label: string; value: number; action?: { label: string; onClick: () => void } }) {
  return (
    <div className={`${card} flex items-center justify-between`}>
      <div>
        <div className="text-2xl font-semibold text-white">{value}</div>
        <div className="text-[11.5px] text-slate-400">{label}</div>
      </div>
      {action && (
        <button onClick={action.onClick} className={secondary}>
          {action.label}
        </button>
      )}
    </div>
  );
}

// ── 1. Blueprint ─────────────────────────────────────────────────────────────

function BlueprintStep({ sessionId, pipeline, busy, act }: StepProps) {
  const [draft, setDraft] = useState<Blueprint | null>(pipeline?.blueprint ?? null);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (!dirty) setDraft(pipeline?.blueprint ?? null);
  }, [pipeline?.blueprint, dirty]);

  const status = pipeline?.blueprintStatus ?? 'none';
  const edit = (next: Blueprint) => {
    setDraft(next);
    setDirty(true);
  };
  const setFile = (i: number, patch: Partial<BlueprintFile>) =>
    draft && edit({ ...draft, files: draft.files.map((f, k) => (k === i ? { ...f, ...patch } : f)) });

  const generate = () =>
    act(async () => {
      await devApi.generateBlueprint(sessionId, feedback || undefined);
      setDirty(false);
      setFeedback('');
    });

  if (status === 'generating') {
    return (
      <div className={`${card} flex items-center gap-3`}>
        <span className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        <div>
          <p className="text-white text-sm font-medium">Drafting the implementation blueprint…</p>
          <p className="text-[12px] text-slate-400">
            Reading secondbrain.md and every carried-over document. This usually takes one to two minutes.
          </p>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className={`${card} space-y-3`}>
        <h2 className="text-lg font-semibold text-white">Blueprint</h2>
        <p className="text-[12.5px] text-slate-400 max-w-3xl">
          The agent reads the requirements, architecture, design package, mockups and stories, and proposes the first
          runnable build: stack, every file in build order (backend and frontend), install/build/test commands and how to
          run it locally on this project's ports. Nothing is created until you approve it.
        </p>
        {pipeline?.blueprintError && <p className="text-[12px] text-red-300">Last attempt failed: {pipeline.blueprintError}</p>}
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
          placeholder="Optional guidance, e.g. 'React + Express in TypeScript, start with the customer ordering flow, mock payments'"
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-[12.5px] outline-none focus:border-slate-500"
        />
        <button disabled={busy} onClick={generate} className={primary}>
          Generate blueprint
        </button>
      </div>
    );
  }

  const approved = status === 'approved' && !dirty;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            Blueprint
            <span className={`text-[11px] px-2 py-0.5 rounded ${approved ? 'bg-emerald-900 text-emerald-300' : 'bg-amber-900/70 text-amber-300'}`}>
              {approved ? 'approved' : dirty ? 'edited, not saved' : 'draft, awaiting your approval'}
            </span>
          </h2>
          <p className="text-[12.5px] text-slate-400 mt-0.5">Review and edit anything below, then approve. Approving writes docs/aidlc/BLUEPRINT.md and updates secondbrain.md.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {dirty && (
            <button disabled={busy} onClick={() => act(async () => { await devApi.saveBlueprint(sessionId, draft); setDirty(false); })} className={secondary}>
              Save edits
            </button>
          )}
          <button disabled={busy} onClick={() => act(async () => { await devApi.approveBlueprint(sessionId, draft); setDirty(false); })} className={primary}>
            {approved ? 'Re-approve' : 'Approve blueprint →'}
          </button>
        </div>
      </div>

      <div className={`${card} space-y-2`}>
        <Label>Summary</Label>
        <textarea value={draft.summary} onChange={(e) => edit({ ...draft, summary: e.target.value })} rows={3} className={inputCls} />
        <Label>Scope of this build</Label>
        <textarea value={draft.scopeNote} onChange={(e) => edit({ ...draft, scopeNote: e.target.value })} rows={2} className={inputCls} />
        <Label>Stack</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(draft.stack).map(([k, v]) => (
            <label key={k} className="text-[12px] text-slate-400">
              {k}
              <input value={v} onChange={(e) => edit({ ...draft, stack: { ...draft.stack, [k]: e.target.value } })} className={inputCls} />
            </label>
          ))}
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <Label>Files in build order ({draft.files.length})</Label>
          <button
            onClick={() => edit({ ...draft, files: [...draft.files, { path: 'frontend/src/NewFile.tsx', layer: 'frontend', purpose: '', dependsOn: [] }] })}
            className={secondary}
          >
            + Add file
          </button>
        </div>
        <div className="space-y-1.5">
          {draft.files.map((f, i) => (
            <div key={i} className="grid grid-cols-[2rem_minmax(0,16rem)_6.5rem_minmax(0,1fr)_auto] gap-2 items-start">
              <span className="text-[11px] text-slate-500 pt-1.5 text-right">{i + 1}</span>
              <input value={f.path} onChange={(e) => setFile(i, { path: e.target.value })} className={`${inputCls} font-mono text-[11.5px]`} />
              <select value={f.layer} onChange={(e) => setFile(i, { layer: e.target.value as Layer })} className={`${inputCls} ${LAYER_COLOR[f.layer]}`}>
                {LAYERS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <textarea value={f.purpose} onChange={(e) => setFile(i, { purpose: e.target.value })} rows={1} className={`${inputCls} resize-y`} />
              <div className="flex gap-0.5 pt-1">
                <IconBtn title="Move up" disabled={i === 0} onClick={() => edit({ ...draft, files: swap(draft.files, i, i - 1) })}>↑</IconBtn>
                <IconBtn title="Move down" disabled={i === draft.files.length - 1} onClick={() => edit({ ...draft, files: swap(draft.files, i, i + 1) })}>↓</IconBtn>
                <IconBtn title="Remove" onClick={() => edit({ ...draft, files: draft.files.filter((_, k) => k !== i) })}>✕</IconBtn>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${card} grid grid-cols-1 md:grid-cols-3 gap-3`}>
        {(['install', 'build', 'test'] as const).map((key) => (
          <label key={key} className="text-[12px] text-slate-400">
            {key} commands (one per line)
            <textarea
              value={draft.commands[key].join('\n')}
              onChange={(e) => edit({ ...draft, commands: { ...draft.commands, [key]: e.target.value.split('\n').filter((l) => l.trim()) } })}
              rows={3}
              className={`${inputCls} font-mono text-[11.5px]`}
            />
          </label>
        ))}
      </div>

      <div className={card}>
        <Label>How to run it (ports reserved: backend {pipeline?.ports.backend}, frontend {pipeline?.ports.frontend})</Label>
        <div className="space-y-1.5 mt-1">
          {draft.run.map((r, i) => (
            <div key={i} className="grid grid-cols-[7rem_minmax(0,1fr)_8rem_minmax(0,14rem)] gap-2">
              <input value={r.name} onChange={(e) => edit({ ...draft, run: draft.run.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} className={inputCls} />
              <input value={r.command} onChange={(e) => edit({ ...draft, run: draft.run.map((x, k) => (k === i ? { ...x, command: e.target.value } : x)) })} className={`${inputCls} font-mono text-[11.5px]`} />
              <input value={r.cwd ?? ''} placeholder="cwd" onChange={(e) => edit({ ...draft, run: draft.run.map((x, k) => (k === i ? { ...x, cwd: e.target.value || undefined } : x)) })} className={`${inputCls} font-mono text-[11.5px]`} />
              <input value={r.healthUrl ?? ''} placeholder="health URL" onChange={(e) => edit({ ...draft, run: draft.run.map((x, k) => (k === i ? { ...x, healthUrl: e.target.value || undefined } : x)) })} className={`${inputCls} font-mono text-[11.5px]`} />
            </div>
          ))}
        </div>
      </div>

      {draft.assumptions.length > 0 && (
        <div className={card}>
          <Label>Assumptions</Label>
          <ul className="list-disc pl-5 text-[12.5px] text-slate-300 space-y-0.5 mt-1">
            {draft.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={`${card} space-y-2`}>
        <Label>Not right? Tell the agent what to change and regenerate</Label>
        <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} className={inputCls} placeholder="e.g. Use PostgreSQL via an adapter, add the admin verification queue, fewer files" />
        <button disabled={busy || !feedback.trim()} onClick={generate} className={secondary}>
          Regenerate with feedback
        </button>
      </div>
    </>
  );
}

const inputCls = 'w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[12.5px] text-slate-100 outline-none focus:border-slate-500';

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</div>;
}

function IconBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className="w-6 h-6 rounded text-[11px] text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30">
      {children}
    </button>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const copy = [...list];
  [copy[a], copy[b]] = [copy[b], copy[a]];
  return copy;
}

// ── 2. Scaffold ──────────────────────────────────────────────────────────────

function ScaffoldStep({ sessionId, pipeline, busy, act }: StepProps & { pipeline: PipelineState }) {
  const [result, setResult] = useState<{ created: string[]; kept: string[] } | null>(null);
  const groups = new Map<string, string[]>();
  for (const f of pipeline.files) {
    const top = f.path.includes('/') ? f.path.split('/')[0] + '/' : '(root)';
    groups.set(top, [...(groups.get(top) ?? []), f.path]);
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Scaffold</h2>
          <p className="text-[12.5px] text-slate-400 mt-0.5 max-w-3xl">
            Creates every folder and file from the approved blueprint as a placeholder that names the file's purpose.
            Existing files are never overwritten. The Build step then fills them in one at a time.
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() => act(async () => setResult(await devApi.createScaffold(sessionId)))}
          className={primary}
        >
          Create scaffold ({pipeline.files.length} files) →
        </button>
      </div>
      {result && (
        <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-4 py-2 text-[12.5px] text-emerald-200">
          Created {result.created.length} files{result.kept.length ? `, kept ${result.kept.length} existing` : ''}.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[...groups.entries()].map(([dir, files]) => (
          <div key={dir} className={card}>
            <div className="font-mono text-[12.5px] text-white mb-1">📁 {dir}</div>
            <ul className="space-y-0.5">
              {files.map((p) => (
                <li key={p} className="font-mono text-[11.5px] text-slate-400">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}

// ── 3. Build ─────────────────────────────────────────────────────────────────

const FILE_STATUS: Record<string, { icon: string; cls: string }> = {
  pending: { icon: '○', cls: 'text-slate-500' },
  in_progress: { icon: '◐', cls: 'text-sky-400 animate-pulse' },
  done: { icon: '✓', cls: 'text-emerald-400' },
  skipped: { icon: '⤼', cls: 'text-slate-500' },
  failed: { icon: '✕', cls: 'text-red-400' },
};

function BuildStep({ sessionId, pipeline, busy, act, agentBusy, agentMode, onOpenFile }: StepProps & { pipeline: PipelineState }) {
  const total = pipeline.files.length;
  const done = pipeline.files.filter((f) => f.status === 'done' || f.status === 'skipped').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const queue = pipeline.files.filter((f) => f.status === 'pending' || f.status === 'failed');
  const next = queue[0];
  const [docs, setDocs] = useState<Record<string, { doc: string; seq: number; status: string; changes: number }>>({});

  useEffect(() => {
    devApi.getFileDocs(sessionId).then(setDocs).catch(() => {});
  }, [sessionId, pipeline.updatedAt, agentBusy]);

  const reviewEach = agentMode !== 'auto-edit' && agentMode !== 'auto';
  const locked = busy || agentBusy || pipeline.building;

  return (
    <>
      <div>
        <h2 className="text-lg font-semibold text-white">Build, file by file</h2>
        <p className="text-[12.5px] text-slate-400 mt-0.5 max-w-3xl">
          The agent implements each file in blueprint order. It reads the files it depends on, their living docs, the
          project documents and the matching mockup, then writes the file. When a file is done, AIDLC writes or updates its
          living doc in <span className="font-mono">docs/dev/</span>, numbered in build order.
        </p>
      </div>

      <div className={`${card} flex flex-wrap items-center gap-x-6 gap-y-3`}>
        <div>
          <Label>File changes</Label>
          <div className="flex rounded bg-slate-900 p-0.5 mt-1" role="radiogroup">
            {[
              { id: 'ask', label: 'Review each file', on: reviewEach },
              { id: 'auto-edit', label: 'Apply automatically', on: !reviewEach },
            ].map((o) => (
              <button
                key={o.id}
                role="radio"
                aria-checked={o.on}
                onClick={() => act(() => devApi.setAgentMode(sessionId, o.id as 'ask' | 'auto-edit'))}
                className={`px-2.5 py-1 rounded text-[12px] ${o.on ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {agentMode === 'plan' && <p className="text-[11px] text-amber-300 mt-1">The agent is in Plan mode; building switches it to "Review each file".</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {pipeline.building ? (
            <button disabled={busy} onClick={() => act(() => devApi.pauseBuild(sessionId))} className={secondary}>
              ⏸ Stop after this file
            </button>
          ) : next ? (
            <>
              <button disabled={locked} onClick={() => act(() => devApi.startBuild(sessionId, 'next'))} className={secondary} title={next.path}>
                ⏭ Build next file: <span className="font-mono">{next.path.split('/').pop()}</span>
              </button>
              <button disabled={locked} onClick={() => act(() => devApi.startBuild(sessionId, 'all'))} className={primary}>
                ▶ Build all remaining ({queue.length})
              </button>
            </>
          ) : (
            <button disabled={busy} onClick={() => act(() => devApi.setStage(sessionId, 'verify'))} className={primary}>
              Next: Verify →
            </button>
          )}
        </div>
      </div>

      <div>
        <div className="flex justify-between text-[11.5px] text-slate-400 mb-1">
          <span>
            {done}/{total} files
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {LAYERS.filter((l) => pipeline.files.some((f) => f.layer === l)).map((layer) => (
        <div key={layer} className={card}>
          <div className={`text-[11px] font-semibold uppercase tracking-wider mb-2 ${LAYER_COLOR[layer]}`}>{layer}</div>
          <ul className="space-y-1">
            {pipeline.files
              .filter((f) => f.layer === layer)
              .map((f) => {
                const st = FILE_STATUS[f.status];
                const order = pipeline.files.indexOf(f) + 1;
                const doc = docs[f.path];
                return (
                  <li key={f.path}>
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <span className="w-6 text-right text-[10.5px] text-slate-500 tabular-nums">{String(order).padStart(2, '0')}</span>
                      <span className={`w-4 text-center ${st.cls}`}>{st.icon}</span>
                      <button onClick={() => onOpenFile(f.path)} className="font-mono text-[12px] text-slate-200 hover:text-sky-300 hover:underline truncate">
                        {f.path}
                      </button>
                      {doc && (
                        <button
                          onClick={() => onOpenFile(doc.doc)}
                          className="text-[10.5px] px-1.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white shrink-0"
                          title={`Living doc, ${doc.changes} change(s) logged`}
                        >
                          📝 {doc.doc.split('/').pop()?.slice(0, 3)} · {doc.changes}
                        </button>
                      )}
                      <span className="text-slate-500 truncate flex-1 hidden xl:inline">{f.purpose}</span>
                      <span className="ml-auto flex gap-1 shrink-0">
                        {f.status !== 'in_progress' && (
                          <button disabled={locked} onClick={() => act(() => devApi.buildFile(sessionId, f.path))} className="text-[11px] px-1.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30">
                            {f.status === 'done' ? 'Rebuild' : f.status === 'failed' ? 'Retry' : 'Build'}
                          </button>
                        )}
                        {['pending', 'failed'].includes(f.status) && (
                          <>
                            <button onClick={() => act(() => devApi.setFileStatus(sessionId, f.path, 'skipped'))} className="text-[11px] px-1.5 rounded bg-slate-700 hover:bg-slate-600">
                              Skip
                            </button>
                            <button onClick={() => act(() => devApi.setFileStatus(sessionId, f.path, 'done'))} className="text-[11px] px-1.5 rounded bg-slate-700 hover:bg-slate-600" title="I wrote it myself">
                              Mark done
                            </button>
                          </>
                        )}
                        {f.status === 'skipped' && (
                          <button onClick={() => act(() => devApi.setFileStatus(sessionId, f.path, 'pending'))} className="text-[11px] px-1.5 rounded bg-slate-700 hover:bg-slate-600">
                            Unskip
                          </button>
                        )}
                      </span>
                    </div>
                    {f.note && <p className={`ml-12 text-[11.5px] ${f.status === 'failed' ? 'text-red-300' : 'text-slate-500'}`}>{f.note}</p>}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </>
  );
}

// ── 4. Verify / 5. Done ──────────────────────────────────────────────────────

function VerifyStep({ sessionId, pipeline, processes, busy, act, agentBusy, doneView }: StepProps & { pipeline: PipelineState; doneView: boolean }) {
  const bp = pipeline.blueprint;
  const v = pipeline.verify;
  const [logs, setLogs] = useState<{ name: string; text: string } | null>(null);

  const VERDICT: Record<string, string> = {
    idle: 'Not run yet',
    running: 'Running…',
    passed: '✓ Passed',
    failed: '✕ Issues found',
    stopped: 'Stopped',
  };

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">{doneView ? 'Development complete' : 'Verify locally'}</h2>
          <p className="text-[12.5px] text-slate-400 mt-0.5 max-w-3xl">
            {doneView
              ? 'The project is built and was verified on this machine. Keep iterating with the agent, or re-run verification after changes.'
              : 'The agent installs dependencies, builds, runs the tests, starts each service on its reserved port, then calls the running app to check the core user flows against the requirements. Every command asks your permission first, and it fixes what fails.'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button disabled={busy || agentBusy || v.status === 'running'} onClick={() => act(() => devApi.startVerify(sessionId))} className={doneView ? secondary : primary}>
            {v.runs ? '↻ Re-run verification' : '▶ Run verification'}
          </button>
          {!doneView && v.status === 'passed' && (
            <button disabled={busy} onClick={() => act(() => devApi.setStage(sessionId, 'done'))} className={primary}>
              Mark development complete ✓
            </button>
          )}
        </div>
      </div>

      <div className={`${card} flex items-center gap-3`}>
        <span
          className={`text-[12px] px-2 py-0.5 rounded ${
            v.status === 'passed' ? 'bg-emerald-900 text-emerald-300' : v.status === 'failed' ? 'bg-red-900/70 text-red-300' : 'bg-slate-700 text-slate-300'
          }`}
        >
          {VERDICT[v.status]}
        </span>
        <span className="text-[12px] text-slate-400">{v.runs} run{v.runs === 1 ? '' : 's'}</span>
      </div>

      {bp && (
        <div className={`${card} grid grid-cols-1 md:grid-cols-3 gap-3 text-[12px]`}>
          {(['install', 'build', 'test'] as const).map((k) => (
            <div key={k}>
              <Label>{k}</Label>
              {bp.commands[k].length ? (
                bp.commands[k].map((c) => (
                  <div key={c} className="font-mono text-[11.5px] text-slate-300 mt-1">
                    $ {c}
                  </div>
                ))
              ) : (
                <div className="text-slate-500 mt-1">—</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={card}>
        <Label>Running services</Label>
        {processes.length === 0 && <p className="text-[12.5px] text-slate-500 mt-1">Nothing is running for this project yet.</p>}
        <ul className="mt-1 space-y-1.5">
          {processes.map((proc) => (
            <li key={proc.name} className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span
                className={`w-2 h-2 rounded-full ${
                  proc.status === 'ready' ? 'bg-emerald-400' : proc.status === 'running' || proc.status === 'starting' ? 'bg-sky-400' : 'bg-slate-500'
                }`}
              />
              <span className="font-semibold text-white">{proc.name}</span>
              <span className="text-slate-400">{proc.status}</span>
              <span className="font-mono text-[11.5px] text-slate-500 truncate max-w-[18rem]">{proc.command}</span>
              {proc.readyUrl && (
                <a href={proc.readyUrl.replace(/\/api\/health\/?$/, '/')} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                  {proc.readyUrl.replace(/\/api\/health\/?$/, '')} ↗
                </a>
              )}
              <span className="ml-auto flex gap-1">
                <button
                  onClick={() => act(async () => setLogs({ name: proc.name, text: (await devApi.getProcessLogs(sessionId, proc.name)).logs }))}
                  className="text-[11px] px-1.5 rounded bg-slate-700 hover:bg-slate-600"
                >
                  Logs
                </button>
                {['ready', 'running', 'starting'].includes(proc.status) && (
                  <button onClick={() => act(() => devApi.stopProcess(sessionId, proc.name))} className="text-[11px] px-1.5 rounded bg-red-800 hover:bg-red-700">
                    Stop
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {logs && (
          <div className="mt-2">
            <div className="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>Logs: {logs.name}</span>
              <button onClick={() => setLogs(null)}>✕</button>
            </div>
            <pre className="max-h-64 overflow-auto rounded bg-slate-950 border border-slate-800 p-2 text-[11px] text-slate-300 whitespace-pre-wrap">{logs.text || '(empty)'}</pre>
          </div>
        )}
      </div>

      {v.summary && (
        <div className={card}>
          <Label>Verification report</Label>
          <div className="mt-1 text-slate-200">
            <Markdown text={v.summary} />
          </div>
        </div>
      )}
    </>
  );
}
