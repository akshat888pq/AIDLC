interface SectionLike {
  number: number;
  title: string;
  status: string;
}

interface Props {
  sections: SectionLike[];
  activeSection: number;
  onSelect: (sectionNumber: number) => void;
}

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  pending: { icon: '', color: 'bg-slate-200' },
  generating: { icon: '...', color: 'bg-amber-400 animate-pulse' },
  draft: { icon: '', color: 'bg-blue-400' },
  approved: { icon: '✓', color: 'bg-emerald-500' },
  skipped: { icon: '—', color: 'bg-slate-300' },
};

export default function SectionNavigator({ sections, activeSection, onSelect }: Props) {
  const approved = sections.filter((s) => s.status === 'approved').length;
  const total = sections.length;
  const progress = Math.round((approved / total) * 100);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Progress */}
      <div className="px-4 py-3 border-b border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Progress
          </span>
          <span className="text-xs font-mono text-slate-400">
            {approved}/{total} sections
          </span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Section List */}
      <nav className="divide-y divide-slate-100 max-h-[calc(100vh-300px)] overflow-y-auto">
        {sections.map((section) => {
          const isActive = section.number === activeSection;
          const status = STATUS_ICONS[section.status] || STATUS_ICONS.pending;

          return (
            <button
              key={section.number}
              onClick={() => onSelect(section.number)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                isActive
                  ? 'bg-accent/5 border-l-2 border-accent'
                  : 'hover:bg-slate-50 border-l-2 border-transparent'
              }`}
            >
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white font-bold flex-shrink-0 ${status.color}`}>
                {status.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm truncate ${isActive ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                  {section.number}. {section.title}
                </p>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-slate-200 bg-slate-50">
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-200" /> Pending</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Draft</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Approved</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300" /> Skipped</span>
        </div>
      </div>
    </div>
  );
}
