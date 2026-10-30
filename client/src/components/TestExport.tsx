import { useState, useEffect } from 'react';
import type { GitRepoConfig, CommitResult, PullRequest } from '../types';
import CommitDialog from './CommitDialog';
import * as api from '../services/api';

interface Props {
  projectId: string;
  testId: string;
  onFinalized: () => void;
  onGenerateReleaseNotes?: () => void;
}

export default function TestExport({ projectId, testId, onFinalized, onGenerateReleaseNotes }: Props) {
  const [finalizing, setFinalizing] = useState(false);
  const [finalized, setFinalized] = useState<{ savedPath: string; testId: string; markdown?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gitConfig, setGitConfig] = useState<GitRepoConfig | null>(null);
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [commitResult, setCommitResult] = useState<{ commit: CommitResult; pr?: PullRequest } | null>(null);

  useEffect(() => {
    api.getGitConfig(projectId).then(setGitConfig).catch(() => {});
  }, [projectId]);

  const handleFinalize = async () => {
    setFinalizing(true);
    setError(null);
    try {
      const result = await api.finalizeTest(projectId, testId);
      setFinalized(result);
      onFinalized();
      if (gitConfig && result.markdown) setShowCommitDialog(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFinalizing(false);
    }
  };

  const handleCommitted = (commit: CommitResult, pr?: PullRequest) => {
    setShowCommitDialog(false);
    setCommitResult({ commit, pr });
  };

  if (finalized) {
    return (
      <div className="space-y-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-center">
          <div className="text-3xl mb-3">&#9989;</div>
          <h3 className="text-lg font-semibold text-emerald-800 mb-2">Test Plan Finalized</h3>
          <p className="text-sm text-emerald-600 mb-4">{finalized.testId} has been saved to the project directory.</p>
          <p className="text-xs text-emerald-500 font-mono bg-emerald-100 rounded px-3 py-2 inline-block">{finalized.savedPath}</p>
        </div>

        {commitResult && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-blue-600 font-semibold text-sm">Committed to Git</span>
              <span className="font-mono text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{commitResult.commit.sha.slice(0, 7)}</span>
            </div>
            <a href={commitResult.commit.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
              View commit on {gitConfig?.provider}
            </a>
            {commitResult.pr && (
              <div className="mt-2">
                <a href={commitResult.pr.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                  PR #{commitResult.pr.number}: {commitResult.pr.title}
                </a>
              </div>
            )}
          </div>
        )}

        {!commitResult && !showCommitDialog && gitConfig && finalized.markdown && (
          <button onClick={() => setShowCommitDialog(true)} className="w-full px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-200">
            Commit to {gitConfig.provider}
          </button>
        )}

        {onGenerateReleaseNotes && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-center">
            <p className="text-sm text-indigo-700 mb-3">Test plan finalized. Ready to generate the release notes?</p>
            <button onClick={onGenerateReleaseNotes} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors">
              Generate Release Notes
            </button>
          </div>
        )}

        {showCommitDialog && gitConfig && finalized.markdown && (
          <CommitDialog
            config={gitConfig}
            filePath={`${gitConfig.basePath || 'aidlc'}/tests/${finalized.testId}.md`}
            content={finalized.markdown}
            defaultMessage={`feat(tests): Add ${finalized.testId}`}
            reqId={finalized.testId}
            onCommitted={handleCommitted}
            onCancel={() => setShowCommitDialog(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-slate-800 mb-4">Export & Finalize Test Plan</h3>
      <div className="space-y-4">
        <a href={api.getTestDownloadUrl(projectId, testId)} className="block text-center px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-200">
          Download as Markdown (.md)
        </a>
        <div className="border-t border-slate-200 pt-4">
          <p className="text-sm text-slate-600 mb-3">
            Finalizing saves the assembled test plan to the project directory and marks it as complete.
            {gitConfig && ' It will also prompt you to commit to Git.'}
          </p>
          <button onClick={handleFinalize} disabled={finalizing} className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {finalizing ? 'Finalizing...' : 'Finalize Test Plan'}
          </button>
        </div>
        {error && <div className="text-red-600 text-sm bg-red-50 rounded-lg p-3">Error: {error}</div>}
      </div>
    </div>
  );
}
