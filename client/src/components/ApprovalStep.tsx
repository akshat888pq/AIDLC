import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { UnderstandingSummary } from '../types';
import * as api from '../services/api';
import * as phaseApi from '../services/phaseApi';
import ExcelDownload from './ExcelDownload';

interface Props {
  sessionId: string;
  /** Called once the human has signed off, so the parent can unlock downstream steps. */
  onApproved: () => void;
  onOpenRequirements?: () => void;
  /**
   * Which phase is being approved. Omitted for the requirement phase, which keeps
   * using its own routes; any other phase approves through the phase engine.
   */
  phaseId?: string;
  /** Copy overrides so the same gate reads correctly for any phase. */
  heading?: string;
  subheading?: string;
  approveLabel?: string;
  /** What approval unlocks, in words the phase's reviewer would use. */
  unlockedLabel?: string;
  nextActionLabel?: string;
  /** Replaces the requirement phase's Excel panel with this phase's deliverables. */
  deliverables?: ReactNode;
}

/** One shape for both entry points, so the component never has to know which it used. */
type ApprovalLike = {
  summary: UnderstandingSummary | null;
  approvalStatus: 'pending' | 'approved';
  approvedAt?: string;
  humanInputs: { text: string; at: string }[];
};

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <span className="text-sm font-semibold text-slate-700 tabular-nums w-12 text-right">
        {score}%
      </span>
    </div>
  );
}

function FactList({
  items,
  tone,
  icon,
  emptyText,
}: {
  items: string[];
  tone: 'confirmed' | 'assumption' | 'open';
  icon: string;
  emptyText: string;
}) {
  const styles = {
    confirmed: { row: 'bg-emerald-50/60 border-emerald-200', mark: 'text-emerald-600' },
    assumption: { row: 'bg-amber-50/60 border-amber-200', mark: 'text-amber-600' },
    open: { row: 'bg-red-50/60 border-red-200', mark: 'text-red-600' },
  }[tone];

  if (items.length === 0) {
    return <p className="text-sm text-slate-400 italic px-1">{emptyText}</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li
          key={i}
          className={`flex gap-2.5 text-sm text-slate-700 border rounded-lg px-3 py-2 leading-relaxed ${styles.row}`}
        >
          <span className={`font-semibold shrink-0 ${styles.mark}`}>{icon}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionHeading({
  title,
  count,
  hint,
}: {
  title: string;
  count: number;
  hint: string;
}) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <h4 className="text-sm font-semibold text-slate-800">
        {title} <span className="text-slate-400 font-normal">({count})</span>
      </h4>
      <span className="text-xs text-slate-400">{hint}</span>
    </div>
  );
}

export default function ApprovalStep({
  sessionId,
  onApproved,
  onOpenRequirements,
  phaseId,
  heading = '5. Human Approval',
  subheading = 'Here is my complete understanding of your project — review it before anything is generated',
  approveLabel = '✓ Approve & Generate Requirements',
  unlockedLabel = 'Requirements generation and the Epic & Stories Excel report are now unlocked.',
  nextActionLabel = 'Generate Requirements',
  deliverables,
}: Props) {
  const [summary, setSummary] = useState<UnderstandingSummary | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<'pending' | 'approved'>('pending');
  const [approvedAt, setApprovedAt] = useState<string | undefined>();
  const [humanInputCount, setHumanInputCount] = useState(0);
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [showInfoBox, setShowInfoBox] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'summary' | 'add-info' | 'approve'>(null);
  const [error, setError] = useState<string | null>(null);

  const applyState = useCallback((state: ApprovalLike) => {
    setSummary(state.summary);
    setApprovalStatus(state.approvalStatus);
    setApprovedAt(state.approvedAt);
    setHumanInputCount(state.humanInputs.length);
  }, []);

  const loadApproval = useCallback(
    (): Promise<ApprovalLike> =>
      phaseId ? phaseApi.getPhaseApproval(phaseId, sessionId) : api.getApproval(sessionId),
    [phaseId, sessionId]
  );

  const requestSummary = useCallback(
    (force = false): Promise<ApprovalLike> =>
      phaseId
        ? phaseApi.generatePhaseApproval(phaseId, sessionId, force)
        : api.generateApprovalSummary(sessionId, force),
    [phaseId, sessionId]
  );

  // On mount: load an existing summary, or generate one if this is the first visit.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await loadApproval();
        if (cancelled) return;
        if (existing.summary) {
          applyState(existing);
          setLoading(false);
          return;
        }
        const generated = await requestSummary();
        if (cancelled) return;
        applyState(generated);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, applyState, loadApproval, requestSummary]);

  const handleRegenerate = useCallback(async () => {
    setBusy('summary');
    setError(null);
    try {
      applyState(await requestSummary(true));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [applyState, requestSummary]);

  const handleAddInfo = useCallback(async () => {
    if (!additionalInfo.trim()) {
      setShowInfoBox(true);
      return;
    }
    setBusy('add-info');
    setError(null);
    try {
      applyState(
        phaseId
          ? await phaseApi.addPhaseApprovalInfo(phaseId, sessionId, additionalInfo.trim())
          : await api.addApprovalInfo(sessionId, additionalInfo.trim())
      );
      setAdditionalInfo('');
      setShowInfoBox(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [sessionId, additionalInfo, applyState, phaseId]);

  const handleApprove = useCallback(async () => {
    setBusy('approve');
    setError(null);
    try {
      const trimmed = additionalInfo.trim() || undefined;
      const state = phaseId
        ? await phaseApi.approvePhase(phaseId, sessionId, trimmed)
        : await api.approveUnderstanding(sessionId, trimmed);
      applyState(state);
      setAdditionalInfo('');
      setShowInfoBox(false);
      onApproved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [sessionId, additionalInfo, applyState, onApproved, phaseId]);

  const isApproved = approvalStatus === 'approved';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{heading}</h2>
          <p className="text-sm text-slate-500 mt-0.5">{subheading}</p>
        </div>
        {isApproved ? (
          <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full">
            ✓ Approved
          </span>
        ) : (
          <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full">
            Awaiting your review
          </span>
        )}
      </div>

      <div className="p-6 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            <strong>Error:</strong> {error}
            <button
              onClick={() => setError(null)}
              className="ml-3 text-red-500 hover:text-red-700 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {loading && (
          <div className="py-12 text-center">
            <div className="inline-block w-9 h-9 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-slate-700 font-medium">Assembling my complete understanding...</p>
            <p className="text-sm text-slate-500 mt-1">
              Reading the project second brain — every document, every answer you gave
            </p>
          </div>
        )}

        {!loading && !summary && !error && (
          <div className="py-10 text-center">
            <p className="text-sm text-slate-600 mb-4">
              No understanding summary has been generated yet.
            </p>
            <button
              onClick={handleRegenerate}
              disabled={busy !== null}
              className="px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors"
            >
              {busy === 'summary' ? 'Generating...' : 'Generate Understanding Summary'}
            </button>
          </div>
        )}

        {!loading && summary && (
          <>
            {/* Project overview */}
            <div className="border border-slate-200 rounded-xl p-5 bg-slate-50/60">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Project Overview
              </h3>
              <p className="text-sm text-slate-800 leading-relaxed">{summary.projectOverview}</p>
            </div>

            {/* Confidence */}
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <h4 className="text-sm font-semibold text-slate-800">Confidence Score</h4>
                <span className="text-xs text-slate-400">
                  {summary.readyToGenerate
                    ? 'Ready to generate deliverables'
                    : 'Something fundamental is still missing'}
                </span>
              </div>
              <ConfidenceBar score={summary.confidenceScore} />
            </div>

            {/* Confirmed facts */}
            <div>
              <SectionHeading
                title="Confirmed Facts"
                count={summary.confirmedFacts.length}
                hint="From your documents and answers"
              />
              <FactList
                items={summary.confirmedFacts}
                tone="confirmed"
                icon="✓"
                emptyText="No facts were confirmed — this is unusual, consider regenerating."
              />
            </div>

            {/* Assumptions */}
            <div>
              <SectionHeading
                title="Assumptions"
                count={summary.assumptions.length}
                hint="Nobody confirmed these — the AI assumed them"
              />
              <FactList
                items={summary.assumptions}
                tone="assumption"
                icon="!"
                emptyText="No assumptions were needed."
              />
            </div>

            {/* Open items */}
            <div>
              <SectionHeading
                title="Open Items"
                count={summary.openItems.length}
                hint="Still unclear — will be carried into the generated document"
              />
              <FactList
                items={summary.openItems}
                tone="open"
                icon="?"
                emptyText="Nothing outstanding."
              />
            </div>

            {/* Additional information */}
            {(showInfoBox || !isApproved) && (
              <div className="border-t border-slate-200 pt-5">
                <label
                  htmlFor="approval-additional-info"
                  className="block text-sm font-semibold text-slate-800 mb-1"
                >
                  Add any additional information or corrections
                  <span className="ml-2 text-xs font-normal text-slate-400">(optional)</span>
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Anything you write here is treated as authoritative — it overrides the AI's
                  assumptions and is saved permanently to the project second brain. No further
                  questions will be asked.
                </p>
                <textarea
                  id="approval-additional-info"
                  value={additionalInfo}
                  onChange={(e) => setAdditionalInfo(e.target.value)}
                  rows={5}
                  placeholder="e.g. The payment provider is Stripe, not PayPal. Phase 1 is web only — mobile is out of scope."
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent resize-y"
                />
                {humanInputCount > 0 && (
                  <p className="text-xs text-slate-500 mt-2">
                    {humanInputCount} note{humanInputCount > 1 ? 's' : ''} already added to the
                    second brain.
                  </p>
                )}
              </div>
            )}

            {/* Actions */}
            {!isApproved && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  onClick={handleApprove}
                  disabled={busy !== null}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-semibold text-sm transition-colors"
                >
                  {busy === 'approve' ? 'Approving...' : approveLabel}
                </button>
                <button
                  onClick={handleAddInfo}
                  disabled={busy !== null}
                  className="px-6 py-3 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-lg font-semibold text-sm transition-colors"
                >
                  {busy === 'add-info' ? 'Re-analyzing...' : '✎ Add More Information'}
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={busy !== null}
                  className="px-4 py-3 text-sm text-slate-500 hover:text-slate-800 underline disabled:opacity-50"
                >
                  {busy === 'summary' ? 'Regenerating...' : 'Regenerate summary'}
                </button>
              </div>
            )}

            {busy === 'add-info' && (
              <p className="text-xs text-slate-500">
                Folding your input into the project second brain and re-running the final
                analysis. No new questions will be asked.
              </p>
            )}

            {/* Post-approval: unlocked deliverables */}
            {isApproved && (
              <div className="border-t border-slate-200 pt-5 space-y-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                  <p className="text-sm text-emerald-800 font-medium">
                    Understanding approved{approvedAt ? ` on ${new Date(approvedAt).toLocaleString()}` : ''}.
                  </p>
                  <p className="text-xs text-emerald-700 mt-0.5">{unlockedLabel}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {onOpenRequirements && (
                    <button
                      onClick={onOpenRequirements}
                      className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-semibold text-sm transition-colors"
                    >
                      {nextActionLabel}
                    </button>
                  )}
                  <button
                    onClick={() => setShowInfoBox((v) => !v)}
                    className="px-4 py-3 text-sm text-slate-500 hover:text-slate-800 underline"
                  >
                    {showInfoBox ? 'Hide' : 'Add'} more information
                  </button>
                  {showInfoBox && (
                    <button
                      onClick={handleAddInfo}
                      disabled={busy !== null || !additionalInfo.trim()}
                      className="px-5 py-3 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-lg font-semibold text-sm transition-colors"
                    >
                      {busy === 'add-info' ? 'Saving...' : 'Save & Re-analyze'}
                    </button>
                  )}
                </div>

                {deliverables ?? <ExcelDownload sessionId={sessionId} approved={isApproved} />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
