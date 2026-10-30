import type { PhaseProgressEntry } from '../services/phaseApi';
import { phaseTheme } from './phaseTheme';

interface Props {
  phases: PhaseProgressEntry[];
  currentPhaseId: string;
  /** Jump to another phase of the same project. Locked phases are never clickable. */
  onSelectPhase?: (phaseId: string) => void;
}

const ICONS: Record<string, string> = {
  completed: '✅',
  'in-progress': '🔄',
  locked: '🔒',
  'not-started': '○',
};

/** The whole lifecycle as a breadcrumb: what is done, what is live, what is locked. */
export default function PhaseProgress({ phases, currentPhaseId, onSelectPhase }: Props) {
  return (
    <nav aria-label="Phase progress" className="flex items-center gap-1 overflow-x-auto pb-1">
      {phases.map((phase, i) => {
        const isCurrent = phase.phaseId === currentPhaseId;
        const locked = phase.status === 'locked';
        const theme = phaseTheme(phase.color);

        const tone = isCurrent
          ? `${theme.tile} ${theme.border} ${theme.text} font-semibold`
          : phase.status === 'completed'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : locked
          ? 'bg-slate-50 border-slate-200 text-slate-400'
          : 'bg-white border-slate-200 text-slate-600';

        return (
          <div key={phase.phaseId} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-slate-300 px-0.5">→</span>}
            <button
              type="button"
              onClick={locked || !onSelectPhase ? undefined : () => onSelectPhase(phase.phaseId)}
              disabled={locked || !onSelectPhase}
              title={locked ? phase.lockedReason : phase.statusLabel}
              className={`flex items-center gap-1.5 border rounded-full px-3 py-1.5 text-xs transition-colors ${tone} ${
                locked || !onSelectPhase ? 'cursor-default' : 'hover:shadow-sm cursor-pointer'
              }`}
            >
              <span aria-hidden="true">{ICONS[phase.status] ?? '○'}</span>
              <span>{phase.shortName}</span>
              {isCurrent && <span className="text-[10px] uppercase tracking-wide">current</span>}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
