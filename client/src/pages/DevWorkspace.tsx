import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentState, HandoverManifest, PipelineState, ProcessInfo, TreeNode } from '../services/devApi';
import * as devApi from '../services/devApi';
import FileTree from '../components/dev/FileTree';
import CodeEditor from '../components/dev/CodeEditor';
import TerminalTabs from '../components/dev/TerminalTabs';
import AgentPanel from '../components/dev/AgentPanel';
import ScaffoldPicker from '../components/dev/ScaffoldPicker';
import PipelinePanel from '../components/dev/PipelinePanel';
import MockupGallery from '../components/dev/MockupGallery';

type Special = 'pipeline' | 'mockups' | null;

interface Props {
  sessionId: string;
  projectName: string;
  onBack: () => void;
  /** Rendered inside the Command Center: fill its stage area instead of the window. */
  embedded?: boolean;
}

interface Tab {
  path: string;
  content: string;
  saved: string;
  error?: string;
}

const EMPTY_AGENT: AgentState = {
  status: 'idle',
  mode: 'ask',
  items: [],
  plan: [],
  allowedCommandPrefixes: [],
  contextTokens: 0,
  llm: null,
};


function useDrag(initial: number, min: number, max: number, axis: 'x' | 'y', invert = false) {
  const [size, setSize] = useState(initial);
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    const origin = axis === 'x' ? e.clientX : e.clientY;
    const startSize = size;
    const move = (ev: MouseEvent) => {
      const delta = (axis === 'x' ? ev.clientX : ev.clientY) - origin;
      setSize(Math.min(max, Math.max(min, startSize + (invert ? -delta : delta))));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return [size, start] as const;
}

export default function DevWorkspace({ sessionId, projectName, onBack, embedded = false }: Props) {
  const fill = embedded ? 'h-full' : 'h-screen';
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);
  const [root, setRoot] = useState('');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentState>(EMPTY_AGENT);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [showTerminal, setShowTerminal] = useState(true);
  const [showScaffold, setShowScaffold] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scripts, setScripts] = useState<string[] | null>(null);
  const [special, setSpecial] = useState<Special>('pipeline');
  const [manifest, setManifest] = useState<HandoverManifest | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [activeTerminal, setActiveTerminal] = useState('main');

  const [leftWidth, startLeft] = useDrag(250, 160, 480, 'x');
  const [rightWidth, startRight] = useDrag(420, 300, 760, 'x', true);
  const [termHeight, startTerm] = useDrag(260, 120, 600, 'y', true);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const refreshTree = useCallback(async () => {
    try {
      setTree(await devApi.getTree(sessionId));
    } catch (err: any) {
      setError(err.message);
    }
  }, [sessionId]);

  /** Re-read open files the agent touched, unless the human has unsaved edits in them. */
  const reloadTabs = useCallback(
    async (paths: string[] | null) => {
      for (const tab of tabsRef.current) {
        if (paths && !paths.includes(tab.path)) continue;
        if (tab.content !== tab.saved) continue;
        try {
          const { content } = await devApi.readFile(sessionId, tab.path);
          setTabs((prev) => prev.map((t) => (t.path === tab.path && t.content === t.saved ? { ...t, content, saved: content } : t)));
        } catch {
          setTabs((prev) => prev.map((t) => (t.path === tab.path ? { ...t, error: 'This file no longer exists.' } : t)));
        }
      }
    },
    [sessionId]
  );

  /** Pull every earlier phase's output into the workspace and secondbrain.md. */
  const syncContext = useCallback(async () => {
    const { content, manifest: m } = await devApi.syncSecondBrain(sessionId);
    setManifest(m);
    setTabs((prev) => prev.map((t) => (t.path === 'secondbrain.md' && t.content === t.saved ? { ...t, content, saved: content } : t)));
    setTree(await devApi.getTree(sessionId));
    return m;
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ws = await devApi.getWorkspace(sessionId);
        if (cancelled) return;
        setExists(ws.exists);
        setRoot(ws.root);
        setTree(ws.tree);
        if (ws.exists) {
          const [m, pl, procs] = await Promise.all([
            devApi.getHandover(sessionId),
            devApi.getPipeline(sessionId),
            devApi.getProcesses(sessionId),
          ]);
          if (cancelled) return;
          setPipeline(pl);
          setProcesses(procs.processes);
          // A workspace opened before the hand-over existed gets it now.
          if (m) setManifest(m);
          else await syncContext();
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, syncContext]);

  useEffect(() => {
    return devApi.subscribeAgent(sessionId, (event) => {
      switch (event.type) {
        case 'snapshot':
          setAgent(event.state);
          break;
        case 'item':
          setAgent((prev) => {
            const idx = prev.items.findIndex((i) => i.id === event.item.id);
            const items = idx >= 0 ? prev.items.map((i, k) => (k === idx ? event.item : i)) : [...prev.items, event.item];
            return { ...prev, items };
          });
          break;
        case 'status':
          setAgent((prev) => ({ ...prev, status: event.status, mode: event.mode, contextTokens: event.contextTokens }));
          break;
        case 'plan':
          setAgent((prev) => ({ ...prev, plan: event.plan }));
          break;
        case 'fs':
          void refreshTree();
          void reloadTabs(event.paths.length ? event.paths : null);
          if (event.paths.length) setChanged((prev) => new Set([...prev, ...event.paths]));
          break;
        case 'pipeline':
          setPipeline(event.pipeline);
          break;
        case 'processes':
          setProcesses(event.processes);
          break;
      }
    });
  }, [sessionId, refreshTree, reloadTabs]);

  const openFile = useCallback(
    async (path: string) => {
      setActivePath(path);
      setSpecial(null);
      setChanged((prev) => {
        if (!prev.has(path)) return prev;
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      if (tabsRef.current.some((t) => t.path === path)) return;
      try {
        const { content } = await devApi.readFile(sessionId, path);
        setTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, content, saved: content }]));
      } catch (err: any) {
        setTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, content: '', saved: '', error: err.message }]));
      }
    },
    [sessionId]
  );

  const closeTab = (path: string) => {
    const tab = tabs.find((t) => t.path === path);
    if (tab && tab.content !== tab.saved && !window.confirm(`${path} has unsaved changes. Close anyway?`)) return;
    const remaining = tabs.filter((t) => t.path !== path);
    setTabs(remaining);
    if (activePath === path) {
      setActivePath(remaining.length ? remaining[remaining.length - 1].path : null);
      if (!remaining.length) setSpecial('pipeline');
    }
  };

  const saveActive = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.path === activePath);
    if (!tab || tab.error) return;
    try {
      await devApi.writeFile(sessionId, tab.path, tab.content);
      setTabs((prev) => prev.map((t) => (t.path === tab.path ? { ...t, saved: tab.content } : t)));
      void refreshTree();
    } catch (err: any) {
      setError(err.message);
    }
  }, [activePath, sessionId, refreshTree]);

  const initialise = async (choice: { template?: string; agent?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const result = await devApi.initWorkspace(sessionId, choice.template);
      setExists(true);
      setTree(result.tree);
      setShowScaffold(false);
      const [m, pl] = await Promise.all([devApi.getHandover(sessionId), devApi.getPipeline(sessionId)]);
      setManifest(m ?? (await syncContext()));
      setPipeline(pl);
      if (choice.agent) {
        // The guided pipeline: start at the carried-over context, then the blueprint.
        setSpecial('pipeline');
        return;
      }
      void openFile('secondbrain.md');
      if (result.scaffold) {
        setNotice(
          `Scaffolded ${result.scaffold.written.length} files${result.scaffold.skipped.length ? `, kept ${result.scaffold.skipped.length} existing` : ''}.${
            result.postCreate ? ` Next: run "${result.postCreate}" in the terminal.` : ''
          }`
        );
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const loadScripts = async () => {
    if (scripts) {
      setScripts(null);
      return;
    }
    try {
      const { content } = await devApi.readFile(sessionId, 'package.json');
      setScripts(Object.keys(JSON.parse(content).scripts ?? {}));
    } catch {
      setScripts([]);
    }
  };

  const runCommand = async (command: string) => {
    setScripts(null);
    setShowTerminal(true);
    try {
      await devApi.runInTerminal(sessionId, command, activeTerminal);
    } catch {
      // The terminal may still be connecting the first time it is shown.
      setTimeout(() => void devApi.runInTerminal(sessionId, command, activeTerminal).catch((e) => setError(e.message)), 800);
    }
  };

  const syncBrain = async () => {
    try {
      const m = await syncContext();
      const files = m.phases.reduce((n, p) => n + p.files.length, 0);
      setNotice(`Context synced: ${m.phases.length} phases, ${files} documents, ${m.mockups.length} mockups and ${m.storyCount} user stories carried into docs/aidlc/ and secondbrain.md.`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const activeTab = tabs.find((t) => t.path === activePath) ?? null;

  if (loading) {
    return (
      <div className={`${fill} flex items-center justify-center bg-slate-950`}>
        <div className="w-8 h-8 border-[3px] border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const topBar = (
    <header className="h-11 flex items-center justify-between px-3 bg-slate-950 border-b border-slate-800 shrink-0">
      {embedded ? (
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Development workspace</span>
      ) : (
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="text-slate-400 hover:text-white text-sm" aria-label="Back to agents">
            ←
          </button>
          <span className="text-sm font-bold text-white tracking-tight">AIDLC</span>
          <span className="text-slate-600">/</span>
          <span className="text-sm text-slate-300 truncate">{projectName}</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-900/60 text-indigo-300">💻 Development</span>
        </div>
      )}
      {exists && (
        <div className="flex items-center gap-1.5 relative">
          <button onClick={() => void openFile('secondbrain.md')} className="px-2 py-1 rounded text-[12px] text-slate-300 hover:bg-slate-800" title="Open the agent's project context">
            🧠 secondbrain.md
          </button>
          <button onClick={() => void syncBrain()} className="px-2 py-1 rounded text-[12px] text-slate-300 hover:bg-slate-800" title="Pull the latest requirement/architecture/design context into secondbrain.md">
            ⟳ Sync context
          </button>
          <button onClick={() => setShowScaffold(true)} className="px-2 py-1 rounded text-[12px] text-slate-300 hover:bg-slate-800">
            ⊞ Scaffold
          </button>
          <button onClick={() => void loadScripts()} className="px-2 py-1 rounded text-[12px] bg-emerald-700 hover:bg-emerald-600 text-white">
            ▶ Run
          </button>
          {scripts && (
            <div className="absolute right-0 top-9 z-20 w-56 rounded-md border border-slate-700 bg-slate-900 shadow-xl py-1">
              {scripts.length === 0 && <p className="px-3 py-1.5 text-[12px] text-slate-500">No package.json scripts found.</p>}
              {[...(scripts.length ? ['install'] : []), ...scripts].map((s) => (
                <button
                  key={s}
                  onClick={() => void runCommand(s === 'install' ? 'npm install' : `npm run ${s}`)}
                  className="w-full text-left px-3 py-1.5 text-[12px] font-mono text-slate-200 hover:bg-slate-800"
                >
                  {s === 'install' ? 'npm install' : `npm run ${s}`}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowTerminal((v) => !v)}
            className={`px-2 py-1 rounded text-[12px] ${showTerminal ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
          >
            ⌨ Terminal
          </button>
        </div>
      )}
    </header>
  );

  const banners = (
    <>
      {error && (
        <div className="px-3 py-1.5 bg-red-950 border-b border-red-900 text-[12px] text-red-200 flex justify-between shrink-0">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {notice && (
        <div className="px-3 py-1.5 bg-emerald-950 border-b border-emerald-900 text-[12px] text-emerald-200 flex justify-between shrink-0">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)}>✕</button>
        </div>
      )}
    </>
  );

  if (!exists) {
    return (
      <div className={`${fill} flex flex-col bg-slate-950 text-slate-200`}>
        {topBar}
        {banners}
        <div className="flex-1 overflow-auto">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
            <ScaffoldPicker variant="setup" busy={busy} onPick={(c) => void initialise(c)} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${fill} flex flex-col bg-slate-950 text-slate-200 overflow-hidden`}>
      {topBar}
      {banners}

      <div className="flex-1 flex min-h-0">
        {/* Explorer */}
        <aside style={{ width: leftWidth }} className="shrink-0 min-w-0 border-r border-slate-800">
          <FileTree
            tree={tree}
            activePath={activePath}
            changedPaths={changed}
            onOpen={(p) => void openFile(p)}
            onRefresh={() => void refreshTree()}
            onCreate={async (p, type) => setTree(await devApi.createPath(sessionId, p, type))}
            onRename={async (from, to) => {
              setTree(await devApi.renamePath(sessionId, from, to));
              setTabs((prev) => prev.filter((t) => t.path !== from && !t.path.startsWith(`${from}/`)));
            }}
            onDelete={async (p) => {
              setTree(await devApi.deletePath(sessionId, p));
              setTabs((prev) => prev.filter((t) => t.path !== p && !t.path.startsWith(`${p}/`)));
              if (activePath === p || activePath?.startsWith(`${p}/`)) setActivePath(null);
            }}
          />
        </aside>
        <div onMouseDown={startLeft} className="w-1 cursor-col-resize hover:bg-sky-600/60 shrink-0" />

        {/* Editor + terminal */}
        <section className="flex-1 min-w-0 flex flex-col">
          <div className="h-9 flex items-end bg-slate-900 border-b border-slate-800 overflow-x-auto shrink-0">
            {([
              ['pipeline', '🧭 Pipeline'],
              ['mockups', `🖼 Mockups${manifest?.mockups.length ? ` (${manifest.mockups.length})` : ''}`],
            ] as const).map(([id, label]) => (
              <div
                key={id}
                onClick={() => setSpecial(id)}
                className={`h-full flex items-center px-3 text-[12.5px] border-r border-slate-800 cursor-pointer whitespace-nowrap font-medium ${
                  special === id ? 'bg-slate-900 text-white border-t-2 border-t-indigo-500' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </div>
            ))}
            {tabs.map((tab) => {
              const dirty = tab.content !== tab.saved;
              const active = !special && tab.path === activePath;
              return (
                <div
                  key={tab.path}
                  onClick={() => {
                    setActivePath(tab.path);
                    setSpecial(null);
                  }}
                  className={`group h-full flex items-center gap-2 px-3 text-[12.5px] border-r border-slate-800 cursor-pointer whitespace-nowrap ${
                    active ? 'bg-[#1e1e1e] text-white border-t-2 border-t-sky-500' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={tab.path}
                >
                  <span>{tab.path.split('/').pop()}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.path);
                    }}
                    className="w-4 text-center text-slate-500 hover:text-white"
                    aria-label={`Close ${tab.path}`}
                  >
                    {dirty ? <span className="group-hover:hidden">●</span> : null}
                    <span className={dirty ? 'hidden group-hover:inline' : ''}>×</span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex-1 min-h-0 bg-[#1e1e1e]">
            {special === 'pipeline' ? (
              <PipelinePanel
                sessionId={sessionId}
                pipeline={pipeline}
                manifest={manifest}
                processes={processes}
                agentBusy={agent.status !== 'idle'}
                agentMode={agent.mode}
                onOpenFile={(p) => void openFile(p)}
                onOpenMockups={() => setSpecial('mockups')}
                onSyncContext={syncBrain}
              />
            ) : special === 'mockups' ? (
              <MockupGallery
                sessionId={sessionId}
                manifest={manifest}
                agentBusy={agent.status !== 'idle'}
                onOpenFile={(p) => void openFile(p)}
                onAskAgent={(text) => void devApi.sendAgentMessage(sessionId, text).catch((e) => setError(e.message))}
              />
            ) : activeTab ? (
              activeTab.error ? (
                <div className="p-6 text-sm text-slate-400">{activeTab.error}</div>
              ) : (
                <CodeEditor
                  path={activeTab.path}
                  value={activeTab.content}
                  onChange={(value) => setTabs((prev) => prev.map((t) => (t.path === activeTab.path ? { ...t, content: value } : t)))}
                  onSave={() => void saveActive()}
                />
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 text-slate-500 gap-2">
                <p className="text-sm">Open a file from the explorer, or ask the agent to build something.</p>
                <p className="text-[12px]">
                  <kbd className="px-1 rounded bg-slate-800 text-slate-300">Ctrl</kbd>+<kbd className="px-1 rounded bg-slate-800 text-slate-300">S</kbd> saves the active file.
                </p>
                <p className="text-[11px] font-mono text-slate-600 break-all">{root}</p>
              </div>
            )}
          </div>

          <div onMouseDown={startTerm} className={`h-1 cursor-row-resize hover:bg-sky-600/60 shrink-0 ${showTerminal ? '' : 'hidden'}`} />
          <div style={{ height: termHeight }} className={`shrink-0 border-t border-slate-800 ${showTerminal ? '' : 'hidden'}`}>
            <TerminalTabs sessionId={sessionId} visible={showTerminal} onActiveChange={setActiveTerminal} />
          </div>

          <footer className="h-6 flex items-center justify-between px-3 bg-sky-800 text-[11px] text-sky-50 shrink-0">
            <span>{activeTab ? `${activeTab.path}${activeTab.content !== activeTab.saved ? ' • unsaved' : ''}` : 'No file open'}</span>
            <span>
              Agent: {agent.status.replace('_', ' ')} · mode {agent.mode}
            </span>
          </footer>
        </section>

        <div onMouseDown={startRight} className="w-1 cursor-col-resize hover:bg-sky-600/60 shrink-0" />
        {/* Agent */}
        <aside style={{ width: rightWidth }} className="shrink-0 min-w-0 border-l border-slate-800">
          <AgentPanel sessionId={sessionId} state={agent} onOpenFile={(p) => void openFile(p)} />
        </aside>
      </div>

      {showScaffold && (
        <div className="fixed inset-0 z-30 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowScaffold(false)}>
          <div className="w-full max-w-3xl max-h-[90vh] overflow-auto rounded-xl bg-slate-900 border border-slate-700 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-1">Scaffold into this workspace</h2>
            <p className="text-[12.5px] text-slate-400 mb-4">Templates never overwrite existing files.</p>
            <ScaffoldPicker variant="dialog" busy={busy} onPick={(c) => void initialise(c)} onClose={() => setShowScaffold(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
