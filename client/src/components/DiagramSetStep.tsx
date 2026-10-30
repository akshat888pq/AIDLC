import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiagramStatus, PhaseDiagram } from '../types';
import * as phaseApi from '../services/phaseApi';
import { mermaidToJpg } from '../services/mermaidImage';
import DiagramViewer from './DiagramViewer';

/**
 * The diagram step for a phase that keeps a SET of diagrams (the design phase):
 * the navigation map, one diagram per user flow, and the component hierarchy.
 *
 * Each diagram is reviewed on its own in the same DiagramViewer the architecture
 * phase uses. Approving one also stores a JPG of it in the phase package — Mermaid
 * only renders in a browser, so the browser is where the image is made.
 */

interface Props {
  phaseId: string;
  sessionId: string;
  /** Prefix for downloaded file names, e.g. the document id. */
  filePrefix: string;
  /** The set's overall status after every change, for the parent's gating. */
  onChange?: (status: DiagramStatus) => void;
  footer?: React.ReactNode;
}

const SAVE_DEBOUNCE_MS = 800;

const KIND_LABEL: Record<string, string> = {
  navigation: 'Navigation',
  'user-flow': 'User flow',
  'component-hierarchy': 'Components',
};

const STATUS_CHIP: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-700',
  draft: 'bg-amber-100 text-amber-700',
  skipped: 'bg-slate-100 text-slate-500',
  none: 'bg-slate-100 text-slate-500',
};

function overallStatus(diagrams: PhaseDiagram[]): DiagramStatus {
  if (diagrams.length === 0) return 'none';
  const live = diagrams.filter((d) => d.status !== 'skipped');
  if (live.length === 0) return 'skipped';
  return live.every((d) => d.status === 'approved') ? 'approved' : 'draft';
}

export default function DiagramSetStep({ phaseId, sessionId, filePrefix, onChange, footer }: Props) {
  const [diagrams, setDiagrams] = useState<PhaseDiagram[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const diagramsRef = useRef(diagrams);
  diagramsRef.current = diagrams;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const saveTimer = useRef<number | null>(null);

  const applyList = useCallback((list: PhaseDiagram[]) => {
    setDiagrams(list);
    setActiveKey((current) =>
      current && list.some((d) => d.key === current)
        ? current
        : (list.find((d) => d.status !== 'approved' && d.status !== 'skipped') ?? list[0])?.key ?? null
    );
  }, []);

  const applyOne = useCallback((next: PhaseDiagram) => {
    setDiagrams((prev) => prev.map((d) => (d.key === next.key ? next : d)));
  }, []);

  // Tell the parent where the set stands after every change — from an effect, never
  // from inside a state updater, which React runs during render.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) onChangeRef.current?.(overallStatus(diagrams));
  }, [diagrams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    phaseApi
      .getDiagramSet(phaseId, sessionId)
      .then((list) => {
        if (cancelled) return;
        loaded.current = true;
        applyList(list);
      })
      .catch((err: any) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [phaseId, sessionId, applyList]);

  const handleBuild = useCallback(async () => {
    setBusy('build');
    setError(null);
    setWarning(null);
    try {
      applyList(await phaseApi.buildDiagramSet(phaseId, sessionId));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [phaseId, sessionId, applyList]);

  /** Render the approved source to JPG and store it. A failure here never undoes the approval. */
  const storeImage = useCallback(
    async (key: string, code: string) => {
      try {
        applyOne(await phaseApi.uploadSetDiagramImage(phaseId, sessionId, key, await mermaidToJpg(code)));
      } catch (err: any) {
        setWarning(`Approved, but the JPG could not be saved: ${err.message}. Use "Save JPG to package" to retry.`);
      }
    },
    [phaseId, sessionId, applyOne]
  );

  const approve = useCallback(
    async (key: string, code?: string) => {
      const approved = await phaseApi.approveSetDiagram(phaseId, sessionId, key, code);
      applyOne(approved);
      await storeImage(key, approved.mermaid);
      return approved;
    },
    [phaseId, sessionId, applyOne, storeImage]
  );

  const handleApprove = useCallback(
    async (code: string) => {
      if (!activeKey) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      setBusy(activeKey);
      setError(null);
      setWarning(null);
      try {
        await approve(activeKey, code);
        // Move the reviewer on to the next diagram that still needs a decision.
        const next = diagramsRef.current.find(
          (d) => d.key !== activeKey && d.status !== 'approved' && d.status !== 'skipped'
        );
        if (next?.key) setActiveKey(next.key);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setBusy(null);
      }
    },
    [activeKey, approve]
  );

  const handleApproveAll = useCallback(async () => {
    setBusy('all');
    setError(null);
    setWarning(null);
    try {
      for (const d of diagrams) {
        if (d.key && d.status !== 'approved' && d.status !== 'skipped') await approve(d.key);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [diagrams, approve]);

  const handleEdit = useCallback(
    (code: string) => {
      const key = activeKey;
      if (!key) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        setSaving(true);
        try {
          const next = await phaseApi.saveSetDiagram(phaseId, sessionId, key, code);
          // Keep the editor's own text — pushing the server copy back would fight the cursor.
          setDiagrams((prev) => prev.map((d) => (d.key === key ? { ...next, mermaid: code } : d)));
        } catch (err: any) {
          setError(`Could not save the edit: ${err.message}`);
        } finally {
          setSaving(false);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [activeKey, phaseId, sessionId]
  );

  const handleRegenerate = useCallback(
    async (feedback?: string) => {
      if (!activeKey) return;
      setBusy(activeKey);
      setError(null);
      try {
        applyOne(await phaseApi.regenerateSetDiagram(phaseId, sessionId, activeKey, feedback));
      } catch (err: any) {
        setError(err.message);
      } finally {
        setBusy(null);
      }
    },
    [activeKey, phaseId, sessionId, applyOne]
  );

  const handleSkip = useCallback(async () => {
    if (!activeKey) return;
    setBusy(activeKey);
    setError(null);
    try {
      applyOne(await phaseApi.skipSetDiagram(phaseId, sessionId, activeKey));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [activeKey, phaseId, sessionId, applyOne]);

  const handleSaveImage = useCallback(
    async (jpg: Blob) => {
      if (!activeKey) return;
      applyOne(await phaseApi.uploadSetDiagramImage(phaseId, sessionId, activeKey, jpg));
      setWarning(null);
    },
    [activeKey, phaseId, sessionId, applyOne]
  );

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center">
        <div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm text-slate-500">Loading the design diagrams…</p>
      </div>
    );
  }

  if (diagrams.length === 0) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
          <div className="text-3xl mb-3" aria-hidden="true">
            🗺️
          </div>
          <h3 className="text-lg font-semibold text-slate-800 mb-1">Generate the design diagrams</h3>
          <p className="text-sm text-slate-500 max-w-2xl mx-auto mb-5">
            The <strong>navigation map</strong> and each <strong>user flow</strong> are taken straight from the
            approved Information Architecture and User Flows sections — exactly what was reviewed. The{' '}
            <strong>component hierarchy</strong> is drawn from the design system and screen definitions. Each one is
            approved separately, and a JPG of it is stored with the package.
          </p>
          {error && (
            <div className="max-w-xl mx-auto bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4 text-left">
              <strong>Error:</strong> {error}
            </div>
          )}
          <button
            onClick={handleBuild}
            disabled={busy !== null}
            className="px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            {busy === 'build' ? 'Building diagrams…' : 'Generate Design Diagrams'}
          </button>
        </div>
        {footer}
      </div>
    );
  }

  const active = diagrams.find((d) => d.key === activeKey) ?? diagrams[0];
  const approvedCount = diagrams.filter((d) => d.status === 'approved').length;
  const pending = diagrams.filter((d) => d.status !== 'approved' && d.status !== 'skipped').length;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Design diagrams</h3>
          <p className="text-sm text-slate-500">
            {approvedCount} of {diagrams.length} approved
            {pending > 0 ? ` · ${pending} awaiting review` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleBuild}
            disabled={busy !== null}
            title="Re-read the approved sections. Diagrams whose source has not changed keep their approval."
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-lg text-xs font-medium transition-colors"
          >
            {busy === 'build' ? 'Rebuilding…' : 'Rebuild from sections'}
          </button>
          {pending > 0 && (
            <button
              onClick={handleApproveAll}
              disabled={busy !== null}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
            >
              {busy === 'all' ? 'Approving…' : `Approve all ${pending}`}
            </button>
          )}
        </div>
      </div>

      {warning && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">{warning}</div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <nav aria-label="Design diagrams" className="w-full lg:w-64 shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {diagrams.map((d) => {
              const selected = d.key === active.key;
              return (
                <li key={d.key}>
                  <button
                    onClick={() => setActiveKey(d.key ?? null)}
                    aria-current={selected ? 'true' : undefined}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selected ? 'bg-accent/5 border-l-2 border-accent' : 'hover:bg-slate-50 border-l-2 border-transparent'
                    }`}
                  >
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">
                      {KIND_LABEL[d.kind ?? ''] ?? 'Diagram'}
                      {d.origin === 'extracted' ? ' · from section' : ''}
                    </div>
                    <div className="text-sm font-medium text-slate-800 truncate">{d.title ?? d.key}</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${STATUS_CHIP[d.status]}`}>{d.status}</span>
                      {d.hasImage && <span className="text-[11px] text-slate-500">JPG ✓</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex-1 min-w-0 w-full">
          <DiagramViewer
            key={active.key}
            mermaidCode={active.mermaid}
            onEdit={handleEdit}
            onApprove={handleApprove}
            onRegenerate={handleRegenerate}
            onSkip={active.status === 'approved' || active.status === 'skipped' ? undefined : handleSkip}
            onSaveImage={handleSaveImage}
            imageSaved={Boolean(active.hasImage)}
            busy={busy !== null}
            error={error}
            approved={active.status === 'approved'}
            title={active.title ?? active.key}
            subtitle={
              active.status === 'approved'
                ? 'Approved — embedded in the finalized design package.'
                : active.status === 'skipped'
                ? 'Skipped — left out of the package. Approve it to include it.'
                : `Revision ${active.revision}${active.origin === 'extracted' ? ' · taken from the approved section' : ''}${
                    saving ? ' · saving…' : ''
                  }`
            }
            fileName={`${filePrefix}-${active.key}`}
          />
        </div>
      </div>

      {footer}
    </div>
  );
}
