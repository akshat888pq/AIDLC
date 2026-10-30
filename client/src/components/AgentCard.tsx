import type { PhaseAgentSummary } from '../types';
import { phaseTheme } from './phaseTheme';

interface Props {
  agent: PhaseAgentSummary;
  onOpen: () => void;
}

/** One agent on the hub: what it does, how much work sits in it, whether it is open. */
export default function AgentCard({ agent, onOpen }: Props) {
  const theme = phaseTheme(agent.color);
  const { totalProjects, inProgress, completed, available } = agent;
  const progress = totalProjects > 0 ? Math.round((completed / totalProjects) * 100) : 0;

  return (
    <button
      type="button"
      onClick={available ? onOpen : undefined}
      disabled={!available}
      aria-label={`${agent.name} — ${available ? `${totalProjects} project${totalProjects === 1 ? '' : 's'}` : 'coming soon'}`}
      className={`text-left w-full bg-white rounded-xl border p-5 transition-all ${
        available
          ? `border-slate-200 shadow-sm hover:shadow-md cursor-pointer ${theme.ring}`
          : 'border-dashed border-slate-200 opacity-70 cursor-not-allowed'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={`w-11 h-11 rounded-lg flex items-center justify-center text-xl ${theme.tile} ${theme.border} border`}
          aria-hidden="true"
        >
          {agent.icon}
        </div>
        {available ? (
          totalProjects > 0 ? (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${theme.chip}`}>
              {inProgress} active
            </span>
          ) : (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
              Ready
            </span>
          )
        ) : (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
            Coming Soon
          </span>
        )}
      </div>

      <h3 className="mt-3 text-base font-semibold text-slate-800">{agent.shortName}</h3>
      <p className="text-xs text-slate-500 mt-0.5">{agent.name}</p>
      <p className="text-xs text-slate-400 mt-2 leading-relaxed">{agent.roleOwner}</p>

      {available ? (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
            <span>
              {totalProjects} project{totalProjects === 1 ? '' : 's'}
            </span>
            <span className="tabular-nums">
              {completed} done · {inProgress} in progress
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${theme.bar}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[11px] text-slate-400">
          {agent.sections.length} sections defined — the agent itself is not wired up yet.
        </p>
      )}
    </button>
  );
}
