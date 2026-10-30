import type { ReactNode } from 'react';

function inline(text: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[1]) parts.push(<code key={key} className="px-1 py-0.5 rounded bg-slate-800 text-sky-200 text-[0.92em]">{m[1].slice(1, -1)}</code>);
    else if (m[2]) parts.push(<strong key={key} className="text-white">{m[2].slice(2, -2)}</strong>);
    else if (m[3]) {
      const label = m[3].slice(1, m[3].indexOf(']'));
      parts.push(<a key={key} href={m[4]} target="_blank" rel="noreferrer" className="text-sky-300 underline">{label}</a>);
    } else if (m[5]) parts.push(<em key={key}>{m[5].slice(1, -1)}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3);
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(
        <div key={k++} className="my-2 rounded border border-slate-700 bg-slate-950 overflow-hidden">
          {lang && <div className="px-2 py-0.5 text-[10px] text-slate-500 border-b border-slate-800">{lang}</div>}
          <pre className="px-2 py-1.5 overflow-x-auto text-[12px] text-slate-200"><code>{code.join('\n')}</code></pre>
        </div>
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const size = heading[1].length <= 2 ? 'text-[15px]' : 'text-[13.5px]';
      blocks.push(<p key={k++} className={`${size} font-semibold text-white mt-2 mb-1`}>{inline(heading[2], `h${k}`)}</p>);
      i++;
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={k++} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 my-1 space-y-0.5`}>
          {items.map((item, j) => <li key={j}>{inline(item, `l${k}-${j}`)}</li>)}
        </ListTag>
      );
      continue;
    }

    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={k++} className="my-2 overflow-x-auto">
          <table className="text-[12px] border-collapse">
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} className="text-left px-2 py-1 border-b border-slate-600 text-slate-200 font-semibold">{inline(c, `th${k}-${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j} className="px-2 py-1 border-b border-slate-800 align-top">{inline(c, `td${k}-${ri}-${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++} className="my-1">{inline(para.join(' '), `p${k}`)}</p>);
  }

  return <div className="text-[13px] leading-relaxed">{blocks}</div>;
}
