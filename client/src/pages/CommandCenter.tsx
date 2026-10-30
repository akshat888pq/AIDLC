import { useCallback, useEffect, useState } from 'react';
import type { PhaseAgentSummary, Project } from '../types';
import type { PhaseProgressEntry } from '../services/phaseApi';
import * as phaseApi from '../services/phaseApi';
import * as devApi from '../services/devApi';
import Home from './Home';
import DevWorkspace from './DevWorkspace';
import PhaseWorkflow from '../components/PhaseWorkflow';
import Markdown from '../components/dev/Markdown';
import ProjectSettings from '../components/governance/ProjectSettings';
import QuotaWidget from '../components/governance/QuotaWidget';
import { setActiveProject } from '../services/identity';

interface Props {
  project: Project;
  workspaceSessionId: string;
  initialStage?: string;
  onExit: () => void;
  onOpenRequirementBuilder: () => void;
}

/** The human who signs each stage off, and what their gate is called. */
const GATES: Record<string, { gate: string; role: string }> = {
  requirement: { gate: 'BA sign-off', role: 'Business Analyst' },
  architecture: { gate: 'Architecture sign-off', role: 'Solution Architect' },
  design: { gate: 'UX sign-off', role: 'UX / UI Designer' },
  development: { gate: 'Code verified', role: 'Developer' },
  testing: { gate: 'QA sign-off', role: 'QA Lead' },
  release: { gate: 'Go / No-Go', role: 'Release Manager' },
};

const ROLES = ['Business Analyst', 'Solution Architect', 'UX / UI Designer', 'Developer', 'QA Lead', 'Release Manager'];

type GateState = 'passed' | 'open' | 'pending' | 'locked';

interface DevSummary {
  built: number;
  total: number;
  verify: string;
  stage: string;
  mockups: number;
  docs: number;
}

function readRole(): string {
  try {
    return localStorage.getItem('aidlc.viewingAs') || 'Business Analyst';
  } catch {
    return 'Business Analyst';
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('aidlc.sidebarCollapsed') === '1';
  } catch {
    return false;
  }
}

export default function CommandCenter({ project, workspaceSessionId, initialStage, onExit, onOpenRequirementBuilder }: Props) {
  const sessionId = project.sessionId!;
  const [stage, setStage] = useState(initialStage ?? 'requirement');
  const [progress, setProgress] = useState<PhaseProgressEntry[]>([]);
  const [agents, setAgents] = useState<PhaseAgentSummary[]>([]);
  const [dev, setDev] = useState<DevSummary | null>(null);
  const [role, setRole] = useState(readRole);
  const [panelOpen, setPanelOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Full screen: the stage fills the window; header, rail and context panel step aside.
  const [focus, setFocus] = useState(false);
  const [brain, setBrain] = useState<{ title: string; markdown: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Attribute workspace-scoped calls (Git, tickets) to this project in the audit trail.
  useEffect(() => {
    setActiveProject(sessionId, stage);
    return () => setActiveProject(null);
  }, [sessionId, stage]);

  const refresh = useCallback(async () => {
    try {
      setProgress(await phaseApi.getPhaseProgress(sessionId));
    } catch (err: any) {
      setError(err.message);
    }
    try {
      const [pipeline, manifest] = await Promise.all([devApi.getPipeline(sessionId), devApi.getHandover(sessionId)]);
      setDev({
        built: pipeline.files.filter((f) => f.status === 'done').length,
        total: pipeline.files.length,
        verify: pipeline.verify.status,
        stage: pipeline.blueprintStatus === 'approved' ? pipeline.stage : pipeline.blueprintStatus === 'none' ? 'not started' : 'blueprint',
        mockups: manifest?.mockups.length ?? 0,
        docs: manifest?.phases.reduce((n, p) => n + p.files.length, 0) ?? 0,
      });
    } catch {
      setDev(null);
    }
  }, [sessionId]);

  useEffect(() => {
    phaseApi.getAgents().then(setAgents).catch(() => {});
  }, []);

  // Stage screens change state on their own; keep the rail and stats current.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [refresh, stage]);

  useEffect(() => {
    try {
      localStorage.setItem('aidlc.sidebarCollapsed', collapsed ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem('aidlc.viewingAs', role);
    } catch {
      /* private mode */
    }
  }, [role]);

  const gateState = useCallback(
    (p: PhaseProgressEntry): GateState => {
      if (p.phaseId === 'development') {
        if (dev?.stage === 'done' || dev?.verify === 'passed') return 'passed';
        return dev && dev.stage !== 'not started' ? 'open' : 'pending';
      }
      if (p.status === 'completed') return 'passed';
      if (p.status === 'in-progress') return 'open';
      if (p.status === 'locked') return 'locked';
      return 'pending';
    },
    [dev]
  );

  const current = progress.find((p) => p.phaseId === stage);
  const agent = agents.find((a) => a.id === stage);
  const gate = GATES[stage] ?? { gate: 'Approval', role: agent?.roleOwner ?? 'Owner' };
  const ownsGate = role === gate.role;
  const stageIndex = progress.findIndex((p) => p.phaseId === stage);

  const openBrain = async () => {
    try {
      const { markdown } = await phaseApi.getPhaseSecondBrain(stage, sessionId);
      setBrain({ title: `${current?.name ?? stage} — Second Brain`, markdown });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleFocus = useCallback(() => {
    setFocus((on) => {
      const next = !on;
      try {
        if (next && !document.fullscreenElement) void document.documentElement.requestFullscreen?.();
        if (!next && document.fullscreenElement) void document.exitFullscreen?.();
      } catch {
        /* the browser refused real fullscreen; the in-page focus view still works */
      }
      return next;
    });
  }, []);

  // Esc / F11 leave browser fullscreen; keep the in-page state in step with it.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFocus(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focus && !document.fullscreenElement) setFocus(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
    };
  }, [focus]);

  const goToStage = (phaseId: string) => {
    setStage(phaseId);
    setError(null);
  };

  // ── Stage content ──────────────────────────────────────────────────────────

  const renderStage = () => {
    if (current?.status === 'locked' && stage !== 'development') {
      return (
        <Placeholder icon="🔒" title={`${current.name} is locked`}>
          {current.lockedReason ?? 'Complete the previous stage first.'}
        </Placeholder>
      );
    }
    if (stage === 'requirement') {
      return (
        <StageCanvas>
          <Home
            embedded
            sessionId={sessionId}
            workspaceSessionId={workspaceSessionId}
            projectName={project.name}
            onNavigateToRequirements={onOpenRequirementBuilder}
            onProceedToPhase={goToStage}
          />
        </StageCanvas>
      );
    }
    if (stage === 'development') {
      return <DevWorkspace embedded sessionId={sessionId} projectName={project.name} onBack={onExit} />;
    }
    if (current?.comingSoon) {
      return (
        <Placeholder icon={current.icon} title={`${current.name} — coming next`}>
          This stage's agent is not wired into the command center yet. Development hands over to it once its gate is passed.
        </Placeholder>
      );
    }
    return (
      <StageCanvas>
        <PhaseWorkflow
          embedded
          key={stage}
          phaseId={stage}
          sessionId={sessionId}
          projectName={project.name}
          onBack={onExit}
          onProceed={(next) => goToStage(next)}
          onSelectPhase={goToStage}
        />
      </StageCanvas>
    );
  };

  const stageLabel = (p: PhaseProgressEntry) =>
    p.shortName === 'Dev' ? 'Development' : p.name.replace(/ (Design|Analysis|Package)$/, '');

  return (
    <div className="h-screen flex bg-[#faf9f6] text-slate-800 overflow-hidden">
      {/* ── Sidebar ── */}
      {!focus && (
        <aside
          aria-label="Project navigation"
          className={`shrink-0 flex flex-col border-r border-stone-200 bg-[#f3f1ec] transition-[width] duration-200 ${
            collapsed ? 'w-[68px]' : 'w-72'
          }`}
        >
          {/* Brand + collapse */}
          <div className={`flex items-center px-3 ${collapsed ? 'flex-col gap-2 py-3' : 'h-16 justify-between'}`}>
            <div className="flex items-center gap-2.5 min-w-0 pl-1">
              <span className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center font-bold text-sm shrink-0" title="AIDLC STUDIO">A</span>
              {!collapsed && <span className="text-base font-bold tracking-wide text-slate-800 truncate">AIDLC STUDIO</span>}
            </div>
            <button
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="w-9 h-9 rounded-lg text-slate-500 hover:bg-stone-200 hover:text-slate-800 flex items-center justify-center"
            >
              <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
                <path d="M8 3.5v13" />
              </svg>
            </button>
          </div>

          {/* Back to projects */}
          <div className="px-3">
            <button
              onClick={onExit}
              title="Back to Projects"
              className={`w-full flex items-center gap-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-slate-700 text-sm font-medium h-11 ${
                collapsed ? 'justify-center' : 'px-3'
              }`}
            >
              <svg viewBox="0 0 20 20" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4l-6 6 6 6" />
              </svg>
              {!collapsed && 'Back to Projects'}
            </button>
          </div>

          {/* Project */}
          {!collapsed && (
            <div className="px-5 pt-5 pb-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Project</div>
              <div className="mt-1 text-base font-semibold text-slate-800 truncate">{project.name}</div>
              {project.client && <div className="text-sm text-slate-500 truncate">{project.client}</div>}
            </div>
          )}

          {/* Stages */}
          <nav aria-label="Lifecycle stages" className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-1">
            {!collapsed && <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Stages</div>}
            {progress.map((p, i) => {
              const state = gateState(p);
              const active = p.phaseId === stage;
              return (
                <button
                  key={p.phaseId}
                  onClick={() => goToStage(p.phaseId)}
                  title={`${i + 1}. ${stageLabel(p)} — ${GATES[p.phaseId]?.gate ?? 'Approval'}`}
                  className={`w-full flex items-center gap-3 rounded-xl text-left transition-colors ${
                    collapsed ? 'justify-center h-11' : 'px-3 py-2.5'
                  } ${active ? 'bg-white shadow-sm ring-1 ring-stone-200 text-slate-900' : 'text-slate-600 hover:bg-stone-200/70'} ${
                    state === 'locked' ? 'opacity-60' : ''
                  }`}
                >
                  <GateIcon state={state} index={i + 1} />
                  {!collapsed && (
                    <span className="min-w-0">
                      <span className={`block text-[15px] truncate ${active ? 'font-semibold' : 'font-medium'}`}>{stageLabel(p)}</span>
                      <span className="block text-xs text-slate-500 truncate">{GATES[p.phaseId]?.gate ?? 'Approval'}</span>
                    </span>
                  )}
                </button>
              );
            })}
            {!progress.length && !collapsed && <div className="text-sm text-slate-400 px-2 py-3">Loading stages…</div>}
          </nav>

          {/* Settings: usage, audit log, users & roles */}
          <div className="border-t border-stone-200 px-3 py-2">
            <button
              onClick={() => setSettingsOpen(true)}
              title="Project settings — usage, audit log, users & roles"
              className={`w-full flex items-center gap-2 rounded-xl text-slate-600 hover:bg-stone-200/70 text-sm font-medium h-10 ${
                collapsed ? 'justify-center' : 'px-3'
              }`}
            >
              <svg viewBox="0 0 20 20" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="10" cy="10" r="2.5" />
                <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
              </svg>
              {!collapsed && 'Project settings'}
            </button>
          </div>

          {/* Role */}
          {!collapsed && (
            <div className="border-t border-stone-200 px-4 py-3">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Viewing as</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-white border border-stone-300 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-teal-600/30"
              >
                {ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
          )}
        </aside>
      )}

      {/* ── Main column ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {focus && (
          <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-stone-200 bg-[#f3f1ec]">
            <div className="flex items-center gap-2 min-w-0 text-sm">
              <span className="font-bold text-slate-800">AIDLC STUDIO</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-600 truncate">{project.name}</span>
              <select
                value={stage}
                onChange={(e) => goToStage(e.target.value)}
                aria-label="Switch stage"
                className="ml-2 bg-white border border-stone-300 rounded-md px-2 py-1 text-sm text-slate-800 outline-none"
              >
                {progress.map((p, i) => (
                  <option key={p.phaseId} value={p.phaseId}>
                    {i + 1}. {stageLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <button onClick={toggleFocus} className="text-sm px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-slate-700 hover:bg-stone-50">
              Exit full screen (Esc)
            </button>
          </div>
        )}

        {/* Stage header */}
        {!focus && (
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-stone-200 bg-white">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-teal-700">Stage {stageIndex + 1}</div>
              <div className="text-lg font-semibold text-slate-800 truncate">
                {current?.name ?? 'Loading…'}
                <span className="text-sm font-normal text-slate-500"> — powered by the {current?.shortName ?? ''} agent</span>
              </div>
              <div className="text-sm text-slate-500 truncate">{current?.statusLabel}</div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-sm px-3 py-1.5 rounded-lg border ${
                  ownsGate ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-stone-200 bg-stone-50 text-slate-600'
                }`}
              >
                {ownsGate ? 'You own this approval gate' : `Gate owned by ${gate.role}`}
              </span>
              <button
                onClick={toggleFocus}
                title="Fill the screen with this stage"
                className="text-sm px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-slate-700 hover:bg-stone-50"
              >
                Full screen
              </button>
              {stage !== 'development' && (
                <button
                  onClick={() => setPanelOpen((v) => !v)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-slate-700 hover:bg-stone-50"
                >
                  {panelOpen ? 'Hide details' : 'Stage details'}
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="shrink-0 px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-800 flex justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">✕</button>
          </div>
        )}

        {/* Stage workspace + details panel */}
        <div className="flex-1 min-h-0 flex">
          <main key={stage} className="flex-1 min-w-0 min-h-0">
            {renderStage()}
          </main>

          {!focus && stage !== 'development' && panelOpen && current && (
            <aside className="w-80 shrink-0 border-l border-stone-200 bg-[#f7f5f1] overflow-auto p-5 space-y-5">
              <div className="text-xs font-bold uppercase tracking-wider text-teal-700">Stage details</div>

              <dl className="rounded-xl border border-stone-200 bg-white p-4 space-y-2.5 text-sm">
                <Row label="Active agent" value={`${current.name} agent`} />
                <Row label="Accountable" value={agent?.roleOwner ?? gate.role} />
                <Row label="Approval gate" value={`${gate.gate} · ${gate.role}`} />
                <Row label="Status" value={current.statusLabel} />
                {current.documentId && <Row label="Document" value={current.documentId} mono />}
              </dl>

              {typeof current.confidenceScore === 'number' && current.confidenceScore > 0 && (
                <div>
                  <div className="flex justify-between text-sm text-slate-600 mb-1.5">
                    <span>Agent confidence</span>
                    <span className="font-semibold text-slate-800">{current.confidenceScore}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
                    <div className="h-full bg-teal-600" style={{ width: `${current.confidenceScore}%` }} />
                  </div>
                </div>
              )}

              <QuotaWidget sessionId={sessionId} />

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Project memory</div>
                <button
                  onClick={() => void openBrain()}
                  className="w-full text-left text-sm px-4 py-3 rounded-xl border border-stone-200 bg-white hover:border-teal-400 hover:bg-teal-50/40"
                >
                  <span className="font-medium text-slate-800">Open this stage's Second Brain</span>
                  <span className="block text-xs text-slate-500 mt-0.5">Understanding, Q&amp;A, confirmed facts and decisions</span>
                </button>
              </div>
            </aside>
          )}
        </div>
      </div>

      {settingsOpen && (
        <ProjectSettings
          projectName={project.name}
          sessionId={sessionId}
          phases={progress.map((p) => ({ id: p.phaseId, name: stageLabel(p) }))}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {brain && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-center justify-center p-4" onClick={() => setBrain(null)}>
          <div
            className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-stone-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200">
              <h2 className="text-base font-semibold text-slate-800">{brain.title}</h2>
              <button onClick={() => setBrain(null)} className="text-slate-400 hover:text-slate-700" aria-label="Close">
                ✕
              </button>
            </div>
            <div className="overflow-auto px-6 py-5 text-slate-800">
              <Markdown text={brain.markdown} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StageCanvas({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-auto bg-[#faf9f6]">{children}</div>;
}

function Placeholder({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center rounded-2xl border border-stone-200 bg-white p-8">
        <div className="text-3xl mb-3">{icon}</div>
        <h2 className="text-base font-semibold text-slate-800 mb-1">{title}</h2>
        <p className="text-sm text-slate-500">{children}</p>
      </div>
    </div>
  );
}

function GateIcon({ state, index }: { state: GateState; index: number }) {
  const map: Record<GateState, [string, string]> = {
    passed: ['✓', 'bg-teal-600 text-white'],
    open: [String(index), 'bg-amber-100 text-amber-800 ring-1 ring-amber-300'],
    pending: [String(index), 'bg-stone-200 text-slate-600'],
    locked: ['🔒', 'bg-stone-200 text-slate-500'],
  };
  const [glyph, cls] = map[state];
  return (
    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${cls}`} title={state}>
      {glyph}
    </span>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500 shrink-0">{label}</dt>
      <dd className={`text-right text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
