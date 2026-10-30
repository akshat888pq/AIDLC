import type { ProjectStats as Stats } from '../types';

interface Props {
  stats: Stats;
}

const CARDS = [
  { key: 'totalProjects' as const, label: 'Total Projects', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'activeRequirements' as const, label: 'Requirements', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { key: 'connectedTickets' as const, label: 'Linked Tickets', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'pendingApprovals' as const, label: 'Pending Approvals', color: 'bg-amber-50 text-amber-700 border-amber-200' },
];

export default function ProjectStatsCards({ stats }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className={`rounded-xl border px-4 py-4 ${card.color}`}
        >
          <div className="text-2xl font-bold">{stats[card.key]}</div>
          <div className="text-xs font-medium opacity-80 mt-0.5">{card.label}</div>
        </div>
      ))}
    </div>
  );
}
