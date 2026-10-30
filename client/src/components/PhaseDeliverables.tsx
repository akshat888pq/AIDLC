import { useCallback, useEffect, useState } from 'react';
import type { PhaseDeliverableState } from '../types';
import * as phaseApi from '../services/phaseApi';

interface Props {
  phaseId: string;
  sessionId: string;
  /** Deliverables are gated on human approval, exactly like section generation. */
  approved: boolean;
}

const TYPE_ICON: Record<string, string> = {
  excel: '📊',
  tickets: '🎫',
  document: '📄',
  images: '🖼',
};

/** Generate and download whatever artifacts this phase declares. */
export default function PhaseDeliverables({ phaseId, sessionId, approved }: Props) {
  const [deliverables, setDeliverables] = useState<PhaseDeliverableState[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await phaseApi.getPhaseDeliverables(phaseId, sessionId);
        if (!cancelled) setDeliverables(list);
      } catch {
        // Nothing declared, or the phase has not been started — nothing to show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phaseId, sessionId]);

  const handleGenerate = useCallback(
    async (id: string, regenerate: boolean) => {
      setBusyId(id);
      setError(null);
      try {
        const updated = await phaseApi.generatePhaseDeliverable(phaseId, sessionId, id, regenerate);
        setDeliverables((prev) => prev.map((d) => (d.id === id ? updated : d)));
      } catch (err: any) {
        setError(err.message);
      } finally {
        setBusyId(null);
      }
    },
    [phaseId, sessionId]
  );

  if (deliverables.length === 0) return null;

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-800">Deliverables</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Artifacts this phase produces alongside its document.
        </p>
      </div>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 border-b border-red-200 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline text-red-500">
            Dismiss
          </button>
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {deliverables.map((d) => (
          <div key={d.id} className="px-4 py-3.5 flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex gap-3">
              <span className="text-lg shrink-0" aria-hidden="true">
                {TYPE_ICON[d.type] ?? '📄'}
              </span>
              <div className="min-w-0">
                <h4 className="text-sm font-medium text-slate-800">{d.name}</h4>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{d.description}</p>
                {d.summary && (
                  <p className="text-xs text-emerald-700 mt-1.5 leading-relaxed">{d.summary}</p>
                )}
                {d.generatedAt && (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Generated {new Date(d.generatedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {d.fileAvailable && (
                <a
                  href={phaseApi.deliverableDownloadUrl(phaseId, sessionId, d.id)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Download
                </a>
              )}
              <button
                onClick={() => handleGenerate(d.id, d.generated)}
                disabled={!approved || busyId !== null}
                title={approved ? undefined : 'Approve the understanding first'}
                className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 rounded-lg text-xs font-medium transition-colors"
              >
                {busyId === d.id
                  ? 'Generating...'
                  : !approved
                  ? '🔒 Locked'
                  : d.generated
                  ? 'Regenerate'
                  : 'Generate'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
