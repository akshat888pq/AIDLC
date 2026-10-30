import type { PhaseAgentSummary, PhaseProjectEntry } from '../types';
import { phaseTheme, STATUS_CHIP, STATUS_LABEL } from './phaseTheme';

interface Props {
  agent: PhaseAgentSummary;
  projects: PhaseProjectEntry[];
  onContinue: (project: PhaseProjectEntry) => void;
  onBack: () => void;
  /** Opens the classic project dashboard, still reachable from inside every agent. */
  onOpenAllProjects?: () => void;
}

/** Every project in one phase, with where each of them has got to. */
export default function PhaseProjectList({
  agent,
  projects,
  onContinue,
  onBack,
  onOpenAllProjects,
}: Props) {
  const theme = phaseTheme(agent.color);
  const actionable = projects.filter((p) => p.status !== 'locked');

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={onBack}
            aria-label="Back to the agent hub"
            className="text-slate-400 hover:text-slate-700 transition-colors mt-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <span aria-hidden="true">{agent.icon}</span>
              {agent.name} — Projects
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {agent.roleOwner}
              {agent.requiresPhase ? ` · requires the ${agent.requiresPhase} phase` : ''}
            </p>
          </div>
        </div>
        {onOpenAllProjects && (
          <button
            onClick={onOpenAllProjects}
            className="text-sm text-slate-500 hover:text-slate-800 underline whitespace-nowrap"
          >
            All projects
          </button>
        )}
      </div>

      {projects.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p className="text-sm text-slate-600">
            No projects yet. Create one from the Projects tab, then run it through the
            requirement phase.
          </p>
        </div>
      )}

      {projects.length > 0 && actionable.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          No project is ready for this phase yet. Complete and approve the previous phase first.
        </div>
      )}

      <div className="space-y-3">
        {projects.map((project) => {
          const locked = project.status === 'locked';
          return (
            <div
              key={project.projectId}
              className={`bg-white rounded-xl border p-5 ${
                locked ? 'border-dashed border-slate-200' : 'border-slate-200 shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className={`font-semibold ${locked ? 'text-slate-400' : 'text-slate-800'}`}>
                      {project.projectName}
                    </h3>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        STATUS_CHIP[project.status]
                      }`}
                    >
                      {STATUS_LABEL[project.status]}
                    </span>
                    {project.client && (
                      <span className="text-xs text-slate-400">{project.client}</span>
                    )}
                  </div>

                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex gap-2">
                      <dt className="text-slate-400 w-20 shrink-0">Status</dt>
                      <dd className="text-slate-600">{project.statusLabel}</dd>
                    </div>
                    {project.sourceLabel && (
                      <div className="flex gap-2">
                        <dt className="text-slate-400 w-20 shrink-0">Source</dt>
                        <dd className="text-slate-600">{project.sourceLabel}</dd>
                      </div>
                    )}
                    {project.documentId && (
                      <div className="flex gap-2">
                        <dt className="text-slate-400 w-20 shrink-0">Document</dt>
                        <dd className="text-slate-600 font-mono text-xs">{project.documentId}</dd>
                      </div>
                    )}
                    {typeof project.confidenceScore === 'number' && project.confidenceScore > 0 && (
                      <div className="flex gap-2 items-center">
                        <dt className="text-slate-400 w-20 shrink-0">Confidence</dt>
                        <dd className="flex items-center gap-2 flex-1 max-w-[220px]">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${theme.bar}`}
                              style={{ width: `${project.confidenceScore}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500 tabular-nums">
                            {project.confidenceScore}%
                          </span>
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>

                <button
                  onClick={() => onContinue(project)}
                  disabled={locked}
                  className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    locked
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'bg-accent hover:bg-accent-hover text-white'
                  }`}
                >
                  {locked
                    ? '🔒 Locked'
                    : project.status === 'not-started'
                    ? 'Start →'
                    : 'Continue →'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
