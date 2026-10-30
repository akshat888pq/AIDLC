import { useEffect, useState } from 'react';
import type { HandoverManifest } from '../../services/devApi';
import * as devApi from '../../services/devApi';

interface Props {
  sessionId: string;
  manifest: HandoverManifest | null;
  agentBusy: boolean;
  onOpenFile: (path: string) => void;
  onAskAgent: (text: string) => void;
}

const WIDTHS = [
  { id: 'desktop', label: 'Desktop', width: '100%' },
  { id: 'tablet', label: 'Tablet', width: '768px' },
  { id: 'mobile', label: 'Mobile', width: '390px' },
] as const;

const STATUS_CHIP: Record<string, string> = {
  approved: 'bg-emerald-900/60 text-emerald-300',
  draft: 'bg-amber-900/60 text-amber-300',
  pending: 'bg-slate-700 text-slate-300',
};

export default function MockupGallery({ sessionId, manifest, agentBusy, onOpenFile, onAskAgent }: Props) {
  const mockups = manifest?.mockups ?? [];
  const [selected, setSelected] = useState<string | null>(mockups[0]?.screenId ?? null);
  const [width, setWidth] = useState<(typeof WIDTHS)[number]['id']>('desktop');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!selected && mockups.length) setSelected(mockups[0].screenId);
  }, [mockups, selected]);

  if (!mockups.length) {
    return (
      <div className="h-full flex items-center justify-center text-center px-8 text-slate-400 text-sm">
        No live mockups were carried over. Generate them in the UX/UI Design phase, then press "⟳ Sync context".
      </div>
    );
  }

  const current = mockups.find((m) => m.screenId === selected) ?? mockups[0];
  const url = devApi.mockupUrl(sessionId, current.file);
  const frameWidth = WIDTHS.find((w) => w.id === width)!.width;

  return (
    <div className="h-full flex min-h-0 bg-slate-900">
      <aside className="w-64 shrink-0 border-r border-slate-800 overflow-auto">
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Screens ({mockups.length})
        </div>
        {mockups.map((m) => (
          <button
            key={m.screenId}
            onClick={() => setSelected(m.screenId)}
            className={`w-full text-left px-3 py-2 border-l-2 ${
              m.screenId === current.screenId ? 'border-sky-500 bg-slate-800' : 'border-transparent hover:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-slate-400">{m.screenId}</span>
              <span className={`text-[10px] px-1.5 rounded ${STATUS_CHIP[m.status] ?? STATUS_CHIP.pending}`}>{m.status}</span>
            </div>
            <div className="text-[12.5px] text-slate-200 leading-snug mt-0.5">{m.screenName}</div>
            {m.route && <div className="font-mono text-[10.5px] text-slate-500">{m.route}</div>}
          </button>
        ))}
      </aside>

      <section className="flex-1 min-w-0 flex flex-col">
        <div className="h-10 shrink-0 flex items-center justify-between gap-2 px-3 border-b border-slate-800">
          <div className="min-w-0 text-[12.5px] text-slate-200 truncate">
            <span className="font-mono text-slate-400 mr-2">{current.screenId}</span>
            {current.screenName}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex rounded bg-slate-800 p-0.5">
              {WIDTHS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setWidth(w.id)}
                  className={`px-2 py-0.5 text-[11px] rounded ${width === w.id ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <button onClick={() => setReloadKey((k) => k + 1)} className="px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 rounded" title="Reload">
              ⟳
            </button>
            <button onClick={() => onOpenFile(current.file)} className="px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 rounded">
              {'</>'} Source
            </button>
            <a href={url} target="_blank" rel="noreferrer" className="px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 rounded">
              ↗ New tab
            </a>
            <button
              disabled={agentBusy}
              onClick={() =>
                onAskAgent(
                  `Implement screen ${current.screenId} "${current.screenName}"${current.route ? ` (route ${current.route})` : ''} in the frontend so it matches the live mockup ${current.file}: same layout, components, copy, states and interactions, wired to the backend APIs from the blueprint. Read the mockup and the relevant user stories first, plan, then build.`
                )
              }
              className="px-2.5 py-1 text-[11px] rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40"
              title={agentBusy ? 'The agent is busy' : 'Ask the agent to build this screen'}
            >
              🤖 Build this screen
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-slate-200 flex justify-center">
          <iframe
            key={`${current.file}-${reloadKey}`}
            src={url}
            title={current.screenName}
            sandbox="allow-scripts allow-forms allow-modals"
            style={{ width: frameWidth, maxWidth: '100%' }}
            className="h-full bg-white border-x border-slate-300"
          />
        </div>
      </section>
    </div>
  );
}
