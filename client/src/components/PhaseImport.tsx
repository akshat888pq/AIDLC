import { useState } from 'react';
import type { PhaseImportSummary } from '../types';

interface Props {
  imported: PhaseImportSummary | null;
  phaseName: string;
  busy?: boolean;
  onStart: () => void;
  onAnalyze: () => void;
  /** True once the phase has been analyzed at least once. */
  analyzed: boolean;
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-slate-400 italic">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="text-sm text-slate-700 flex gap-2">
          <span className="text-slate-300 shrink-0">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The import step — what this phase received from the phase before it.
 *
 * This is the equivalent of the requirement phase's upload step: it is where the
 * reviewer sees exactly what the agent is working from before it asks anything.
 */
export default function PhaseImport({
  imported,
  phaseName,
  busy,
  onStart,
  onAnalyze,
  analyzed,
}: Props) {
  const [showFacts, setShowFacts] = useState(true);

  if (!imported) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">1. Import from the previous phase</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Nothing has been imported into the {phaseName} phase yet.
          </p>
        </div>
        <div className="p-6 text-center">
          <p className="text-sm text-slate-600 mb-4">
            Starting this phase copies the previous phase's approved document, its Second Brain,
            its confirmed facts and its user stories into a Second Brain of this phase's own.
          </p>
          <button
            onClick={onStart}
            disabled={busy}
            className="px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors"
          >
            {busy ? 'Importing...' : `Start the ${phaseName} phase`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            1. Imported from {imported.fromPhaseName ?? 'the previous phase'}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Everything below is settled input. The agent will not re-open it.
          </p>
        </div>
        {imported.documentId && (
          <span className="shrink-0 font-mono text-xs bg-white border border-slate-200 text-slate-600 px-2.5 py-1 rounded-full">
            {imported.documentId}
          </span>
        )}
      </div>

      <div className="p-6 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Documents', value: imported.documents.length },
            { label: 'Confirmed facts', value: imported.confirmedFacts.length },
            { label: 'Assumptions', value: imported.assumptions.length },
            {
              label: 'User stories',
              value: imported.storyCount ?? 0,
            },
          ].map((stat) => (
            <div key={stat.label} className="border border-slate-200 rounded-lg px-3 py-2.5">
              <div className="text-lg font-semibold text-slate-800 tabular-nums">{stat.value}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">{stat.label}</div>
            </div>
          ))}
        </div>

        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Received
          </h3>
          <List items={imported.documents} empty="No documents were received." />
        </div>

        <div>
          <button
            onClick={() => setShowFacts((v) => !v)}
            className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5 hover:text-slate-700"
          >
            <span>{showFacts ? '▾' : '▸'}</span>
            Confirmed facts carried forward ({imported.confirmedFacts.length})
          </button>
          {showFacts && (
            <div className="max-h-72 overflow-y-auto pr-1">
              <List
                items={imported.confirmedFacts}
                empty="The previous phase confirmed no facts — unusual, check its Second Brain."
              />
            </div>
          )}
        </div>

        {imported.openItems.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Open items inherited ({imported.openItems.length})
            </h3>
            <List items={imported.openItems} empty="None." />
          </div>
        )}

        <div className="border-t border-slate-200 pt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={onAnalyze}
            disabled={busy}
            className="px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors"
          >
            {busy
              ? 'Analyzing...'
              : analyzed
              ? 'Re-analyze with the latest answers'
              : 'Analyze & ask questions'}
          </button>
          <button
            onClick={onStart}
            disabled={busy}
            className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-800 underline disabled:opacity-50"
          >
            Re-import from {imported.fromPhaseName ?? 'the previous phase'}
          </button>
          {imported.importedAt && (
            <span className="text-xs text-slate-400">
              Imported {new Date(imported.importedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
