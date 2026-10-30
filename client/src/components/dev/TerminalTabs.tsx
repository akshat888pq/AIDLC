import { useEffect, useRef, useState } from 'react';
import * as devApi from '../../services/devApi';
import TerminalPanel, { type TerminalHandle } from './TerminalPanel';

interface Props {
  sessionId: string;
  visible: boolean;
  onActiveChange: (terminalId: string) => void;
}

interface Tab {
  id: string;
  label: string;
}

const MAX_TABS = 8;

/** Several shells per project, each in the workspace with the project's isolated environment. */
export default function TerminalTabs({ sessionId, visible, onActiveChange }: Props) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string>('main');
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const refs = useRef<Record<string, TerminalHandle | null>>({});
  const counter = useRef(1);

  // Shells outlive the page, so reopen the tabs that are still running on the server.
  useEffect(() => {
    let cancelled = false;
    devApi
      .listTerminals(sessionId)
      .catch(() => [])
      .then((list) => {
        if (cancelled) return;
        const ids = list.length ? list.map((t) => t.id) : ['main'];
        counter.current = ids.length;
        setTabs(ids.map((id, i) => ({ id, label: `Terminal ${i + 1}` })));
        setActive(ids[0]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    onActiveChange(active);
  }, [active, onActiveChange]);

  const addTab = () => {
    if (tabs.length >= MAX_TABS) return;
    counter.current += 1;
    const id = `t${Date.now().toString(36)}`;
    setTabs((prev) => [...prev, { id, label: `Terminal ${counter.current}` }]);
    setActive(id);
  };

  const closeTab = (id: string) => {
    void devApi.closeTerminal(sessionId, id).catch(() => {});
    delete refs.current[id];
    let remaining = tabs.filter((t) => t.id !== id);
    if (!remaining.length) {
      counter.current += 1;
      remaining = [{ id: `t${Date.now().toString(36)}`, label: `Terminal ${counter.current}` }];
    }
    if (active === id || !remaining.some((t) => t.id === active)) {
      const index = Math.max(0, tabs.findIndex((t) => t.id === id) - 1);
      setActive(remaining[Math.min(index, remaining.length - 1)].id);
    }
    setTabs(remaining);
  };

  return (
    <div className="h-full flex flex-col bg-[#0f172a]">
      <div className="flex items-center justify-between h-8 border-b border-slate-800 shrink-0 pl-1 pr-3">
        <div className="flex items-center min-w-0 overflow-x-auto h-full">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`group h-full flex items-center gap-1.5 px-2.5 text-[11.5px] cursor-pointer whitespace-nowrap border-r border-slate-800 ${
                active === tab.id ? 'text-white bg-slate-800/70' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connected[tab.id] ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              <span>⌨ {tab.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="ml-0.5 w-4 text-slate-500 hover:text-red-400 opacity-60 group-hover:opacity-100"
                title="Close terminal (stops its shell)"
                aria-label={`Close ${tab.label}`}
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={addTab}
            disabled={tabs.length >= MAX_TABS}
            className="px-2.5 h-full text-slate-400 hover:text-white text-[14px] disabled:opacity-30"
            title={tabs.length >= MAX_TABS ? `At most ${MAX_TABS} terminals` : 'New terminal'}
            aria-label="New terminal"
          >
            +
          </button>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={() => refs.current[active]?.clear()} className="text-[11px] text-slate-400 hover:text-white">
            Clear
          </button>
          <button onClick={() => refs.current[active]?.restart()} className="text-[11px] text-slate-400 hover:text-white">
            Restart
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {tabs.map((tab) => (
          <TerminalPanel
            key={tab.id}
            ref={(h) => {
              refs.current[tab.id] = h;
            }}
            sessionId={sessionId}
            terminalId={tab.id}
            visible={visible && active === tab.id}
            onConnectedChange={(c) => setConnected((prev) => (prev[tab.id] === c ? prev : { ...prev, [tab.id]: c }))}
          />
        ))}
      </div>
    </div>
  );
}
