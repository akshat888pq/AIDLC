import { Fragment, useCallback, useEffect, useState } from 'react';
import * as gov from '../../services/governanceApi';
import type { AuditEntry, AuditFilters, GovUser } from '../../services/governanceApi';

interface Props {
  sessionId: string;
  phases: { id: string; name: string }[];
}

const PAGE = 50;

const COLUMNS: { key: keyof AuditEntry; label: string; align?: 'right' }[] = [
  { key: 'timestamp', label: 'Time' },
  { key: 'phase', label: 'Phase' },
  { key: 'action', label: 'Action' },
  { key: 'userName', label: 'User' },
  { key: 'model', label: 'Model' },
  { key: 'inputTokens', label: 'In', align: 'right' },
  { key: 'outputTokens', label: 'Out', align: 'right' },
  { key: 'status', label: 'Status' },
];

const STATUS_STYLE: Record<AuditEntry['status'], string> = {
  success: 'bg-teal-50 text-teal-800 border-teal-200',
  'cache-hit': 'bg-sky-50 text-sky-800 border-sky-200',
  blocked: 'bg-amber-50 text-amber-900 border-amber-200',
  error: 'bg-red-50 text-red-800 border-red-200',
};

/** Day boundaries in the viewer's timezone, sent as ISO instants. */
function startOfDay(date: string) {
  return date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
}
function endOfDay(date: string) {
  return date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined;
}

/** The trace of every AI call and tool action that produced this project's outputs. */
export default function AuditLog({ sessionId, phases }: Props) {
  const [users, setUsers] = useState<GovUser[]>([]);
  const [phase, setPhase] = useState('');
  const [userId, setUserId] = useState('');
  const [kind, setKind] = useState<AuditFilters['kind']>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sortBy, setSortBy] = useState<keyof AuditEntry>('timestamp');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; entries: AuditEntry[] } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    gov.listUsers().then(setUsers).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(
        await gov.getAudit({
          projectId: sessionId,
          phase,
          userId,
          kind,
          from: startOfDay(from),
          to: endOfDay(to),
          sortBy,
          order,
          limit: PAGE,
          offset,
        })
      );
    } catch (err: any) {
      setError(err.message);
    }
  }, [sessionId, phase, userId, kind, from, to, sortBy, order, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any filter or sort change starts again from the first page, in the same render
  // so only one request goes out.
  const filter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setOffset(0);
      set(v);
    };

  const sort = (key: keyof AuditEntry) => {
    setOffset(0);
    if (key === sortBy) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setOrder(key === 'timestamp' ? 'desc' : 'asc');
    }
  };

  const reset = () => {
    setOffset(0);
    setPhase('');
    setUserId('');
    setKind('');
    setFrom('');
    setTo('');
  };

  const select = 'bg-white border border-stone-300 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-teal-600/30';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block font-semibold uppercase tracking-wider">Phase</span>
          <select value={phase} onChange={(e) => filter(setPhase)(e.target.value)} className={select}>
            <option value="">All phases</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block font-semibold uppercase tracking-wider">User</span>
          <select value={userId} onChange={(e) => filter(setUserId)(e.target.value)} className={select}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block font-semibold uppercase tracking-wider">Type</span>
          <select value={kind} onChange={(e) => filter(setKind)(e.target.value as AuditFilters['kind'])} className={select}>
            <option value="">AI calls and tool actions</option>
            <option value="llm">AI calls</option>
            <option value="tool">Tool actions</option>
          </select>
        </label>
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block font-semibold uppercase tracking-wider">From</span>
          <input type="date" value={from} onChange={(e) => filter(setFrom)(e.target.value)} className={select} />
        </label>
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block font-semibold uppercase tracking-wider">To</span>
          <input type="date" value={to} onChange={(e) => filter(setTo)(e.target.value)} className={select} />
        </label>
        <button onClick={reset} className="text-sm px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-slate-700 hover:bg-stone-50">
          Reset
        </button>
        <button onClick={() => void load()} className="text-sm px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-slate-700 hover:bg-stone-50">
          Refresh
        </button>
      </div>

      {error && <div className="text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                  <button onClick={() => sort(c.key)} className="inline-flex items-center gap-1 hover:text-slate-800">
                    {c.label}
                    {sortBy === c.key && <span aria-hidden>{order === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data?.entries.map((e) => (
              <Fragment key={e.id}>
                <tr
                  onClick={() => setExpanded((x) => (x === e.id ? null : e.id))}
                  className="cursor-pointer hover:bg-stone-50"
                  aria-expanded={expanded === e.id}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{new Date(e.timestamp).toLocaleString()}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {e.phase ?? '—'}
                    {e.sectionId && <span className="text-slate-400"> · {e.sectionId}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-800">
                    <span className="text-xs text-slate-400 mr-1">{e.kind === 'llm' ? 'AI' : 'Tool'}</span>
                    {e.action}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{e.userName}</td>
                  <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                    {e.model ?? '—'}
                    {e.fellBack && <span className="ml-1 text-xs text-amber-700">(fallback)</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {e.inputTokens.toLocaleString()}
                    {e.tokensEstimated && <span className="text-slate-400">~</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{e.outputTokens.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[e.status]}`}>{e.status}</span>
                    {e.leakageDetected && <span className="ml-1 text-xs text-red-700">leak redacted</span>}
                  </td>
                </tr>
                {expanded === e.id && (
                  <tr className="bg-stone-50/60">
                    <td colSpan={COLUMNS.length} className="px-4 py-3">
                      <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-xs">
                        <dt className="text-slate-500">Provider</dt>
                        <dd className="text-slate-800">{e.provider ?? '—'}</dd>
                        <dt className="text-slate-500">Prompt hash</dt>
                        <dd className="font-mono text-slate-800 break-all">{e.promptHash ?? '—'}</dd>
                        <dt className="text-slate-500">Output hash</dt>
                        <dd className="font-mono text-slate-800 break-all">{e.outputHash ?? '—'}</dd>
                        <dt className="text-slate-500">Source documents</dt>
                        <dd className="text-slate-800">{e.sourceDocuments.length ? e.sourceDocuments.join(' · ') : '—'}</dd>
                        {(e.cacheReadTokens ?? 0) + (e.cacheWriteTokens ?? 0) > 0 && (
                          <>
                            <dt className="text-slate-500">Prompt cache</dt>
                            <dd className="text-slate-800">
                              {e.cacheReadTokens?.toLocaleString()} read · {e.cacheWriteTokens?.toLocaleString()} written
                            </dd>
                          </>
                        )}
                        <dt className="text-slate-500">Duration</dt>
                        <dd className="text-slate-800">{(e.durationMs / 1000).toFixed(1)}s</dd>
                        <dt className="text-slate-500">User id</dt>
                        <dd className="font-mono text-slate-800">{e.userId}</dd>
                        {e.error && (
                          <>
                            <dt className="text-slate-500">Error</dt>
                            <dd className="text-red-700">{e.error}</dd>
                          </>
                        )}
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {data && data.entries.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-slate-400">
                  No audit entries match these filters.
                </td>
              </tr>
            )}
            {!data && !error && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > PAGE && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            {offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(o - PAGE, 0))}
              className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={offset + PAGE >= data.total}
              onClick={() => setOffset((o) => o + PAGE)}
              className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-400">
        Prompts and outputs are stored as SHA-256 hashes only. “~” marks token counts estimated for providers that do not report usage.
      </p>
    </div>
  );
}
