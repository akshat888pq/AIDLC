import { useCallback, useEffect, useState } from 'react';
import * as gov from '../../services/governanceApi';
import type { QuotaStatus } from '../../services/governanceApi';

interface Props {
  sessionId: string;
  /** Full card with breakdown and cache controls, for the settings page. */
  detailed?: boolean;
}

const fmt = (n: number) => n.toLocaleString();

/** Today's AI token usage against the project's daily budget. */
export default function QuotaWidget({ sessionId, detailed }: Props) {
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQuota(await gov.getQuota(sessionId));
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);

  const clear = async () => {
    try {
      const { cleared } = await gov.clearCache(sessionId);
      setNotice(`Cleared ${cleared} cached response${cleared === 1 ? '' : 's'}.`);
      void load();
    } catch (err: any) {
      setNotice(err.message);
    }
  };

  if (error) return <div className="text-xs text-slate-400">AI usage unavailable: {error}</div>;
  if (!quota) return <div className="text-xs text-slate-400">Loading AI usage…</div>;

  const bar = quota.state === 'blocked' ? 'bg-red-600' : quota.state === 'warning' ? 'bg-amber-500' : 'bg-teal-600';
  const resets = new Date(quota.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-3 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-slate-800">AI usage today</span>
        <span className="text-xs text-slate-500">{quota.percent}%</span>
      </div>
      <div
        className="h-2 rounded-full bg-stone-200 overflow-hidden"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={quota.limit}
        aria-valuenow={quota.used}
        aria-label="Tokens used today"
      >
        <div className={`h-full ${bar}`} style={{ width: `${quota.percent}%` }} />
      </div>
      <div className="text-slate-700">
        <span className="font-semibold">{fmt(quota.used)}</span>
        <span className="text-slate-500"> / {fmt(quota.limit)} tokens</span>
      </div>
      <dl className="grid grid-cols-2 gap-y-1 text-xs">
        <dt className="text-slate-500">Estimated cost</dt>
        <dd className="text-right text-slate-800">${quota.estimatedCostUsd.toFixed(2)}</dd>
        <dt className="text-slate-500">AI calls</dt>
        <dd className="text-right text-slate-800">{fmt(quota.calls)}</dd>
        {detailed && (
          <>
            <dt className="text-slate-500">Input tokens</dt>
            <dd className="text-right text-slate-800">{fmt(quota.inputTokens)}</dd>
            <dt className="text-slate-500">Output tokens</dt>
            <dd className="text-right text-slate-800">{fmt(quota.outputTokens)}</dd>
            <dt className="text-slate-500">Cached responses</dt>
            <dd className="text-right text-slate-800">
              {quota.cache.enabled ? `${quota.cache.entries} (TTL ${Math.round(quota.cache.ttlSeconds / 60)} min)` : 'disabled'}
            </dd>
          </>
        )}
      </dl>
      {quota.state === 'warning' && (
        <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2">
          Over 80% of today's token budget is used. AI calls stop at 100% until midnight UTC.
        </p>
      )}
      {quota.state === 'blocked' && (
        <p className="text-xs rounded-lg bg-red-50 border border-red-200 text-red-800 px-3 py-2">
          Daily token quota reached — resets at midnight UTC ({resets} your time).
        </p>
      )}
      {detailed && (
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => void clear()}
            className="text-xs px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-slate-700 hover:bg-stone-50"
          >
            Clear response cache
          </button>
          {notice && <span className="text-xs text-slate-500">{notice}</span>}
        </div>
      )}
    </div>
  );
}
