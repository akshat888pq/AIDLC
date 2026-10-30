import { useEffect, useState } from 'react';
import type { ScaffoldTemplate } from '../../services/devApi';
import * as devApi from '../../services/devApi';

interface Props {
  /** First-time setup shows the full intro; later it's a compact dialog. */
  variant: 'setup' | 'dialog';
  busy: boolean;
  onPick: (choice: { template?: string; agent?: boolean }) => void;
  onClose?: () => void;
}

export default function ScaffoldPicker({ variant, busy, onPick, onClose }: Props) {
  const [templates, setTemplates] = useState<ScaffoldTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    devApi.getTemplates().then(setTemplates).catch((e) => setError(e.message));
  }, []);

  const card = 'text-left rounded-lg border border-slate-700 bg-slate-800/60 hover:border-sky-500 hover:bg-slate-800 p-4 transition-colors disabled:opacity-50';

  return (
    <div className="space-y-5">
      {variant === 'setup' && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold text-white">Set up the development workspace</h2>
          <p className="text-sm text-slate-400 max-w-2xl">
            This project gets its own isolated workspace: a folder, a shell, reserved ports and a coding agent. Every
            earlier phase's output is copied into <span className="font-mono text-slate-200">docs/aidlc/</span> and indexed
            in <span className="font-mono text-slate-200">secondbrain.md</span>, which is loaded into the agent's context on
            every turn.
          </p>
          <ol className="flex flex-wrap gap-2 text-[12px] text-slate-300">
            {['secondbrain.md → context window', 'Model plans, then calls tools', 'Permission gate asks you', 'Tools edit files & run the shell'].map((s, i) => (
              <li key={s} className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700">
                <span className="text-slate-500 mr-1">{i + 1}.</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button disabled={busy} onClick={() => onPick({ agent: true })} className={`${card} border-sky-700/70 bg-sky-950/30 md:col-span-2`}>
          <div className="flex items-center gap-2">
            <span className="text-lg">🧭</span>
            <span className="font-semibold text-white">Guided development from the project's phases</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-800 text-sky-200">recommended</span>
          </div>
          <p className="text-[12.5px] text-slate-400 mt-1">
            Carries every phase (requirements, architecture, design package, user stories and live mockups) into the
            workspace, then walks you through Blueprint → Scaffold → Build file by file → Verify locally. You approve each
            step, every file and every command.
          </p>
        </button>

        {templates.map((t) => (
          <button key={t.id} disabled={busy} onClick={() => onPick({ template: t.id })} className={card}>
            <div className="font-semibold text-white">{t.name}</div>
            <p className="text-[12.5px] text-slate-400 mt-1">{t.description}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {t.stack.map((s) => (
                <span key={s} className="text-[10.5px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                  {s}
                </span>
              ))}
              <span className="text-[10.5px] text-slate-500 ml-1">{t.fileCount} files</span>
            </div>
          </button>
        ))}

        <button disabled={busy} onClick={() => onPick({})} className={card}>
          <div className="font-semibold text-white">Empty workspace</div>
          <p className="text-[12.5px] text-slate-400 mt-1">Just secondbrain.md. Start from scratch in the editor or the terminal.</p>
        </button>
      </div>

      {onClose && (
        <div className="flex justify-end">
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-white">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
