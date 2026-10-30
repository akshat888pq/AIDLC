interface Props {
  before: string;
  after: string;
  maxHeight?: number;
}

type Line = { type: 'same' | 'add' | 'del'; text: string; oldNo?: number; newNo?: number };

function diffLines(a: string[], b: string[]): Line[] {
  // Trim the common head and tail so the LCS table only covers the changed middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const out: Line[] = [];
  for (let i = 0; i < start; i++) out.push({ type: 'same', text: a[i], oldNo: i + 1, newNo: i + 1 });

  if (midA.length * midB.length > 4_000_000) {
    midA.forEach((t, i) => out.push({ type: 'del', text: t, oldNo: start + i + 1 }));
    midB.forEach((t, i) => out.push({ type: 'add', text: t, newNo: start + i + 1 }));
  } else {
    const n = midA.length;
    const m = midB.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        out.push({ type: 'same', text: midA[i], oldNo: start + i + 1, newNo: start + j + 1 });
        i++;
        j++;
      } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
        out.push({ type: 'add', text: midB[j], newNo: start + j + 1 });
        j++;
      } else {
        out.push({ type: 'del', text: midA[i], oldNo: start + i + 1 });
        i++;
      }
    }
  }

  const offset = endB - endA;
  for (let k = endA; k < a.length; k++) out.push({ type: 'same', text: a[k], oldNo: k + 1, newNo: k + 1 + offset });
  return out;
}

/** Collapse long unchanged runs to 3 lines of context either side. */
function withContext(lines: Line[], context = 3): (Line | { type: 'gap'; count: number })[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.type !== 'same') for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (Line | { type: 'gap'; count: number })[] = [];
  let gap = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (gap) out.push({ type: 'gap', count: gap });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ type: 'gap', count: gap });
  return out;
}

export default function DiffView({ before, after, maxHeight = 320 }: Props) {
  const lines = diffLines(before ? before.split(/\r?\n/) : [], after ? after.split(/\r?\n/) : []);
  const added = lines.filter((l) => l.type === 'add').length;
  const removed = lines.filter((l) => l.type === 'del').length;
  const rows = withContext(lines);

  return (
    <div className="rounded border border-slate-700 overflow-hidden">
      <div className="px-2 py-1 text-[11px] bg-slate-800 text-slate-400 flex gap-3">
        <span className="text-emerald-400">+{added}</span>
        <span className="text-red-400">−{removed}</span>
      </div>
      <div className="overflow-auto font-mono text-[11.5px] leading-[1.45] bg-slate-950" style={{ maxHeight }}>
        {rows.map((row, idx) =>
          row.type === 'gap' ? (
            <div key={idx} className="px-2 text-slate-500 bg-slate-900 select-none">⋯ {row.count} unchanged lines</div>
          ) : (
            <div
              key={idx}
              className={`flex whitespace-pre ${
                row.type === 'add' ? 'bg-emerald-900/40 text-emerald-200' : row.type === 'del' ? 'bg-red-900/40 text-red-200' : 'text-slate-400'
              }`}
            >
              <span className="w-9 shrink-0 text-right pr-1 text-slate-600 select-none">{row.oldNo ?? ''}</span>
              <span className="w-9 shrink-0 text-right pr-1 text-slate-600 select-none">{row.newNo ?? ''}</span>
              <span className="w-4 shrink-0 select-none">{row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}</span>
              <span>{row.text || ' '}</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
