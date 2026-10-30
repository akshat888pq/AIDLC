import { useCallback, useEffect, useState } from 'react';
import type { GitRepoConfig } from '../types';
import * as api from '../services/api';
import * as phaseApi from '../services/phaseApi';
import type { PackageCommitResult, PackageFile } from '../services/phaseApi';
import { getWorkspaceSessionId } from '../services/session';

/**
 * Commit a finalized phase's whole output folder — documents, Second Brain,
 * diagrams, reports and images — to the project's repository in one commit.
 */

interface Props {
  phaseId: string;
  sessionId: string;
  projectId?: string;
  finalized: boolean;
  documentId?: string;
  phaseName: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function PhaseGitCommit({ phaseId, sessionId, projectId, finalized, documentId, phaseName }: Props) {
  const [gitConfig, setGitConfig] = useState<GitRepoConfig | null>(null);
  const [files, setFiles] = useState<PackageFile[]>([]);
  const [message, setMessage] = useState('');
  const [createPR, setCreatePR] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PackageCommitResult | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api
      .getGitConfig(projectId)
      .then((config) => {
        setGitConfig(config);
        if (config) setCreatePR(config.autoCreatePR);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!finalized) return;
    phaseApi.getPackageFiles(phaseId, sessionId).then(setFiles).catch(() => {});
  }, [phaseId, sessionId, finalized]);

  useEffect(() => {
    setMessage(`docs(${phaseId}): ${documentId ?? phaseId} ${phaseName}`);
  }, [phaseId, documentId, phaseName]);

  const handleCommit = useCallback(async () => {
    setCommitting(true);
    setError(null);
    try {
      // Refresh the list first so the commit summary matches what is sent.
      setFiles(await phaseApi.getPackageFiles(phaseId, sessionId));
      setResult(
        await phaseApi.commitPhasePackage(phaseId, sessionId, {
          workspaceSessionId: getWorkspaceSessionId(),
          message,
          createPR,
        })
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  }, [phaseId, sessionId, message, createPR]);

  if (!gitConfig) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-4 text-sm text-slate-500">
        <strong className="text-slate-700">Git:</strong> no repository is configured for this project. Configure one on
        the project page to commit the {phaseName.toLowerCase()} package.
      </div>
    );
  }

  const totalSize = files.reduce((n, f) => n + f.size, 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
        <h3 className="text-base font-semibold text-slate-800">Commit to Git</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          {gitConfig.repoName} ·{' '}
          {gitConfig.createAidlcBranch ? `aidlc/${(documentId ?? phaseId).toLowerCase()}` : gitConfig.branch}
          {gitConfig.basePath ? ` · ${gitConfig.basePath}` : ''}
        </p>
      </div>

      {result ? (
        <div className="p-6 space-y-2 text-sm">
          <p className="text-emerald-700 font-medium">
            Committed {result.files.length} files to {result.repoName}@{result.branch}.
          </p>
          <a href={result.commit.url} target="_blank" rel="noreferrer" className="text-accent hover:underline font-mono text-xs">
            {result.commit.sha.slice(0, 10)}
          </a>
          {result.pullRequest && (
            <p>
              Pull request:{' '}
              <a href={result.pullRequest.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                {result.pullRequest.title}
              </a>
            </p>
          )}
          <button onClick={() => setResult(null)} className="text-xs text-slate-500 underline">
            Commit again
          </button>
        </div>
      ) : (
        <div className="p-6 space-y-4">
          <button
            onClick={() => setShowFiles((v) => !v)}
            disabled={files.length === 0}
            className="text-sm text-slate-600 hover:text-slate-900 disabled:text-slate-400"
          >
            {showFiles ? '▾' : '▸'} {files.length} files · {formatSize(totalSize)}
          </button>
          {showFiles && (
            <ul className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs font-mono">
              {files.map((f) => (
                <li key={f.path} className="px-3 py-1.5 flex justify-between gap-3">
                  <span className="truncate">{f.path}</span>
                  <span className="text-slate-400 shrink-0">{formatSize(f.size)}</span>
                </li>
              ))}
            </ul>
          )}

          <div>
            <label htmlFor={`commit-msg-${phaseId}`} className="block text-sm font-medium text-slate-700 mb-1">
              Commit message
            </label>
            <textarea
              id={`commit-msg-${phaseId}`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
            />
          </div>

          {gitConfig.createAidlcBranch && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={createPR} onChange={(e) => setCreatePR(e.target.checked)} className="rounded border-slate-300" />
              Also create a pull request
            </label>
          )}

          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

          <button
            onClick={handleCommit}
            disabled={!finalized || committing || !message.trim()}
            title={finalized ? undefined : 'Finalize the phase first'}
            className="px-5 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            {committing ? 'Committing…' : files.length > 0 ? `Commit ${files.length} files` : 'Commit'}
          </button>
        </div>
      )}
    </div>
  );
}
