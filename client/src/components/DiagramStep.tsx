import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhaseDiagram } from '../types';
import DiagramViewer from './DiagramViewer';

/**
 * The "generate a diagram before you finalize" step.
 *
 * The two architecture screens reach the server through different routes, so the
 * calls are injected rather than imported — everything else (the empty state, the
 * skip path, debounced saving, what a failure means) is identical and lives here
 * once. Design and testing get the same step by passing their own `api`.
 */

export interface DiagramApi {
  load(): Promise<PhaseDiagram>;
  generate(feedback?: string): Promise<PhaseDiagram>;
  save(mermaid: string): Promise<PhaseDiagram>;
  approve(mermaid: string): Promise<PhaseDiagram>;
  skip(): Promise<PhaseDiagram>;
}

interface Props {
  api: DiagramApi;
  /** Re-runs the load when this changes — e.g. the document being viewed. */
  resetKey?: string;
  title?: string;
  fileName?: string;
  /** Told what the diagram looks like after every change, for the parent's gating. */
  onChange?: (diagram: PhaseDiagram) => void;
  /** Rendered under the viewer once the diagram is approved or skipped. */
  footer?: React.ReactNode;
}

const SAVE_DEBOUNCE_MS = 800;

export default function DiagramStep({
  api,
  resetKey,
  title = 'System Architecture Diagram',
  fileName = 'architecture-diagram',
  onChange,
  footer,
}: Props) {
  const [diagram, setDiagram] = useState<PhaseDiagram | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The injected api is rebuilt on every parent render; holding it in a ref keeps
  // it out of the effect deps, so the step does not reload on every keystroke.
  const apiRef = useRef(api);
  apiRef.current = api;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const saveTimer = useRef<number | null>(null);

  const apply = useCallback((next: PhaseDiagram) => {
    setDiagram(next);
    onChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiRef.current
      .load()
      .then((next) => {
        if (!cancelled) apply(next);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [resetKey, apply]);

  const handleGenerate = useCallback(
    async (feedback?: string) => {
      setBusy(true);
      setError(null);
      try {
        apply(await apiRef.current.generate(feedback));
      } catch (err: any) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [apply]
  );

  const handleEdit = useCallback((code: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaving(true);
      try {
        // Don't call apply() — pushing the server's copy back into the viewer
        // would fight the cursor if the user is still typing.
        const next = await apiRef.current.save(code);
        setDiagram((prev) => (prev ? { ...prev, ...next, mermaid: prev.mermaid } : next));
        onChangeRef.current?.(next);
        setError(null);
      } catch (err: any) {
        setError(`Could not save the edit: ${err.message}`);
      } finally {
        setSaving(false);
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const handleApprove = useCallback(
    async (code: string) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      setBusy(true);
      setError(null);
      try {
        apply(await apiRef.current.approve(code));
      } catch (err: any) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [apply]
  );

  const handleSkip = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      apply(await apiRef.current.skip());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [apply]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center">
        <div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm text-slate-500">Loading the diagram…</p>
      </div>
    );
  }

  const hasCode = Boolean(diagram?.mermaid.trim());

  // Nothing generated yet — the recommendation, not a wall.
  if (!hasCode) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="text-3xl mb-3" aria-hidden="true">
          🗺️
        </div>
        <h3 className="text-lg font-semibold text-slate-800 mb-1">
          Recommended: Generate {title}
        </h3>
        <p className="text-sm text-slate-500 max-w-xl mx-auto mb-5">
          The agent reads every approved section and draws the components, data flow, external
          integrations and infrastructure boundaries as a Mermaid diagram. You can edit it, then
          approve it — it becomes the last section of the finalized document.
        </p>

        {error && (
          <div className="max-w-xl mx-auto bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4 text-left">
            <strong>Error:</strong> {error}
            <p className="mt-1 text-xs text-red-600">
              You can try again, or continue without a diagram — it is optional.
            </p>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={() => handleGenerate()}
            disabled={busy}
            className="px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            {busy ? 'Generating diagram…' : `Generate ${title}`}
          </button>
          <button
            onClick={handleSkip}
            disabled={busy}
            className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-800 underline disabled:opacity-50"
          >
            Skip and finalize without one
          </button>
        </div>

        {diagram?.status === 'skipped' && (
          <p className="text-xs text-slate-400 mt-4">
            Skipped — the document will be finalized without a diagram section.
          </p>
        )}
      </div>
    );
  }

  const approved = diagram?.status === 'approved';

  return (
    <div className="space-y-4">
      <DiagramViewer
        mermaidCode={diagram!.mermaid}
        onEdit={handleEdit}
        onApprove={handleApprove}
        onRegenerate={handleGenerate}
        onSkip={approved ? undefined : handleSkip}
        busy={busy}
        error={error}
        approved={approved}
        title={title}
        subtitle={
          approved
            ? 'Approved — this is embedded in the finalized document.'
            : `Revision ${diagram!.revision}${saving ? ' · saving…' : ''} — edit the source on the left, approve when it reads right.`
        }
        fileName={fileName}
      />

      {diagram?.status === 'skipped' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
          This diagram is marked as skipped, so it will not appear in the finalized document.
          Approve it to include it.
        </div>
      )}

      {footer}
    </div>
  );
}
