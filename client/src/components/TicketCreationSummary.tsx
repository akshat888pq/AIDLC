import type { TicketCreationSummary as Summary } from '../types';

interface Props {
  summary: Summary;
  onClose: () => void;
}

export default function TicketCreationSummary({ summary, onClose }: Props) {
  return (
    <div className="space-y-4">
      {/* Success banner */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">✓</span>
          <div>
            <p className="font-semibold text-green-800">Tickets Created Successfully</p>
            <p className="text-sm text-green-700 mt-0.5">
              Created {summary.epics > 0 ? `${summary.epics} Epic${summary.epics > 1 ? 's' : ''}, ` : ''}
              {summary.features > 0 ? `${summary.features} Feature${summary.features > 1 ? 's' : ''}, ` : ''}
              {summary.stories > 0 ? `${summary.stories} Stor${summary.stories > 1 ? 'ies' : 'y'}, ` : ''}
              {summary.tasks > 0 ? `${summary.tasks} Task${summary.tasks > 1 ? 's' : ''}` : ''}
              {' '}({summary.total} total)
            </p>
          </div>
        </div>
      </div>

      {/* Created tickets list */}
      {summary.created.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Created Tickets</h4>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-2 text-slate-500 font-medium">ID</th>
                  <th className="text-left px-4 py-2 text-slate-500 font-medium">Title</th>
                  <th className="text-left px-4 py-2 text-slate-500 font-medium">Type</th>
                  <th className="text-left px-4 py-2 text-slate-500 font-medium">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.created.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{t.key}</td>
                    <td className="px-4 py-2 text-slate-800">{t.title}</td>
                    <td className="px-4 py-2 text-slate-500 capitalize">{t.type}</td>
                    <td className="px-4 py-2">
                      <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline text-xs">
                        Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Failed tickets */}
      {summary.failed.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-red-700 mb-2">Failed ({summary.failed.length})</h4>
          <div className="space-y-2">
            {summary.failed.map((f, i) => (
              <div key={i} className="bg-red-50 border border-red-200 rounded-md p-3 text-sm">
                <p className="font-medium text-red-800">{f.title}</p>
                <p className="text-red-600 text-xs mt-0.5">{f.error}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onClose}
        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-sm font-medium transition-colors"
      >
        Done
      </button>
    </div>
  );
}
