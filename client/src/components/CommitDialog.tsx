import { useState } from 'react';
import type { GitRepoConfig, CommitResult, PullRequest, GitProvider } from '../types';
import * as api from '../services/api';
import { getWorkspaceSessionId } from '../services/session';

interface Props {
  config: GitRepoConfig;
  filePath: string;
  content: string;
  defaultMessage: string;
  reqId: string;
  onCommitted: (result: CommitResult, pr?: PullRequest) => void;
  onCancel: () => void;
}

export default function CommitDialog({
  config,
  filePath,
  content,
  defaultMessage,
  reqId,
  onCommitted,
  onCancel,
}: Props) {
  // Git credentials belong to the workspace, not to the project being committed.
  const sessionId = getWorkspaceSessionId();
  const [message, setMessage] = useState(defaultMessage);
  const [createPR, setCreatePR] = useState(config.autoCreatePR);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      let targetBranch = config.branch;

      if (config.createAidlcBranch) {
        const aidlcBranch = `aidlc/${reqId.toLowerCase()}`;
        try {
          await api.gitCreateBranch(sessionId, config.provider, config.repoId, config.branch, aidlcBranch);
        } catch {}
        targetBranch = aidlcBranch;
      }

      const commitResult = await api.gitCommitFile(
        sessionId,
        config.provider,
        config.repoId,
        targetBranch,
        filePath,
        content,
        message,
      );

      let pr: PullRequest | undefined;
      if (createPR && config.createAidlcBranch) {
        pr = await api.gitCreatePullRequest(
          sessionId,
          config.provider,
          config.repoId,
          targetBranch,
          config.branch,
          `feat(requirements): ${reqId}`,
          `Auto-generated requirement document ${reqId}\n\nCommitted by AIDLC`,
        );
      }

      onCommitted(commitResult, pr);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-800">Commit to Git</h3>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-slate-50 rounded-lg p-3 text-xs space-y-1">
            <div><span className="text-slate-400">Repository:</span> <span className="font-medium">{config.repoName}</span></div>
            <div><span className="text-slate-400">Branch:</span> <span className="font-medium">{config.createAidlcBranch ? `aidlc/${reqId.toLowerCase()}` : config.branch}</span></div>
            <div><span className="text-slate-400">File:</span> <span className="font-mono">{filePath}</span></div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Commit Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
            />
          </div>

          {config.createAidlcBranch && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={createPR}
                onChange={(e) => setCreatePR(e.target.checked)}
                className="rounded border-slate-300"
              />
              Also create Pull Request
            </label>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={committing}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={handleCommit}
            disabled={committing || !message.trim()}
            className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {committing ? 'Committing...' : 'Commit'}
          </button>
        </div>
      </div>
    </div>
  );
}
