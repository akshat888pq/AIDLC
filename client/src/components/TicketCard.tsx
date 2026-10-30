import type { Ticket } from '../types';

interface Props {
  ticket: Ticket;
  onWorkOn?: (ticket: Ticket) => void;
  compact?: boolean;
}

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  epic: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Epic' },
  feature: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Feature' },
  story: { bg: 'bg-green-100', text: 'text-green-700', label: 'Story' },
  task: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Task' },
  subtask: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Sub-task' },
  bug: { bg: 'bg-red-100', text: 'text-red-700', label: 'Bug' },
};

const PRIORITY_DOTS: Record<string, string> = {
  Highest: 'text-red-500',
  High: 'text-orange-500',
  Medium: 'text-yellow-500',
  Low: 'text-blue-400',
  '1': 'text-red-500',
  '2': 'text-orange-500',
  '3': 'text-yellow-500',
  '4': 'text-blue-400',
};

export default function TicketCard({ ticket, onWorkOn, compact }: Props) {
  const typeStyle = TYPE_STYLES[ticket.type] || TYPE_STYLES.task;

  return (
    <div className={`border border-slate-200 rounded-lg bg-white hover:border-slate-300 transition-colors ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-mono text-slate-400">{ticket.key}</span>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${typeStyle.bg} ${typeStyle.text}`}>
              {typeStyle.label}
            </span>
            <span className={`text-sm ${PRIORITY_DOTS[ticket.priority] || 'text-slate-400'}`}>●</span>
            <span className="text-xs text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">{ticket.status}</span>
          </div>
          <p className={`font-medium text-slate-800 ${compact ? 'text-sm' : 'text-sm'} truncate`}>
            {ticket.title}
          </p>
          {!compact && ticket.assignee && (
            <p className="text-xs text-slate-400 mt-1">Assignee: {ticket.assignee}</p>
          )}
          {!compact && ticket.storyPoints != null && (
            <span className="inline-block text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded mt-1">
              {ticket.storyPoints} SP
            </span>
          )}
        </div>
        {onWorkOn && (
          <button
            onClick={() => onWorkOn(ticket)}
            className="shrink-0 px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition-colors"
          >
            Work on this
          </button>
        )}
      </div>
    </div>
  );
}
