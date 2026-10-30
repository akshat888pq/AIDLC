import { useEffect, useState } from 'react';
import AuditLog from './AuditLog';
import QuotaWidget from './QuotaWidget';
import UsersRoles from './UsersRoles';

interface Props {
  projectName: string;
  sessionId: string;
  phases: { id: string; name: string }[];
  onClose: () => void;
}

type Tab = 'usage' | 'audit' | 'users';

const TABS: { key: Tab; label: string }[] = [
  { key: 'usage', label: 'Usage & Quota' },
  { key: 'audit', label: 'Audit Log' },
  { key: 'users', label: 'Users & Roles' },
];

/** Project settings: AI usage, the audit trail, and who can do what. */
export default function ProjectSettings({ projectName, sessionId, phases, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('audit');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Project settings"
        className="w-full max-w-6xl h-[88vh] flex flex-col rounded-2xl border border-stone-200 bg-[#f7f5f1] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-4 border-b border-stone-200 bg-white rounded-t-2xl">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-teal-700">Project settings</div>
            <h2 className="text-base font-semibold text-slate-800">{projectName}</h2>
            <div className="flex gap-1 mt-3" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium relative ${tab === t.key ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  {t.label}
                  {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-700" />}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="self-start text-slate-400 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-6">
          {tab === 'usage' && (
            <div className="max-w-md">
              <QuotaWidget sessionId={sessionId} detailed />
            </div>
          )}
          {tab === 'audit' && <AuditLog sessionId={sessionId} phases={phases} />}
          {tab === 'users' && <UsersRoles />}
        </div>
      </div>
    </div>
  );
}
