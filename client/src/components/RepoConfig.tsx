import { useState, useEffect } from 'react';
import type { GitProvider, Repo, Branch, GitRepoConfig } from '../types';
import * as api from '../services/api';
import { getWorkspaceSessionId } from '../services/session';

interface Props {
  projectId: string;
  provider: GitProvider;
  onConfigSaved: (config: GitRepoConfig) => void;
}

export default function RepoConfig({ projectId, provider, onConfigSaved }: Props) {
  // Repo listings come from the workspace git connection, not the project session.
  const sessionId = getWorkspaceSessionId();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [createAidlcBranch, setCreateAidlcBranch] = useState(true);
  const [autoCreatePR, setAutoCreatePR] = useState(false);
  const [basePath, setBasePath] = useState('aidlc');
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await api.getGitConfig(projectId);
        if (config) {
          setSelectedRepo(config.repoId);
          setSelectedBranch(config.branch);
          setCreateAidlcBranch(config.createAidlcBranch);
          setAutoCreatePR(config.autoCreatePR);
          setBasePath(config.basePath);
        }
      } catch {}
    }
    loadConfig();
  }, [projectId]);

  useEffect(() => {
    async function loadRepos() {
      setLoadingRepos(true);
      try {
        const data = await api.getGitRepos(sessionId, provider);
        setRepos(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoadingRepos(false);
      }
    }
    loadRepos();
  }, [sessionId, provider]);

  useEffect(() => {
    if (!selectedRepo) { setBranches([]); return; }
    async function loadBranches() {
      setLoadingBranches(true);
      try {
        const data = await api.getGitBranches(sessionId, provider, selectedRepo);
        setBranches(data);
        if (!selectedBranch) {
          const def = data.find((b) => b.isDefault);
          if (def) setSelectedBranch(def.name);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoadingBranches(false);
      }
    }
    loadBranches();
  }, [sessionId, provider, selectedRepo]);

  const handleSave = async () => {
    if (!selectedRepo || !selectedBranch) return;
    setSaving(true);
    setError(null);
    try {
      const repo = repos.find((r) => r.id === selectedRepo);
      const config: GitRepoConfig = {
        provider,
        repoId: selectedRepo,
        repoName: repo?.fullName || repo?.name || selectedRepo,
        branch: selectedBranch,
        createAidlcBranch,
        autoCreatePR,
        basePath,
      };
      await api.saveGitConfig(projectId, config);
      onConfigSaved(config);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Repository</label>
        {loadingRepos ? (
          <div className="text-sm text-slate-400">Loading repositories...</div>
        ) : (
          <select
            value={selectedRepo}
            onChange={(e) => { setSelectedRepo(e.target.value); setSelectedBranch(''); }}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="">Select a repository</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fullName} {r.private ? '(private)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedRepo && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Target Branch</label>
          {loadingBranches ? (
            <div className="text-sm text-slate-400">Loading branches...</div>
          ) : (
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <option value="">Select a branch</option>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} {b.isDefault ? '(default)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Base Path in Repo</label>
        <input
          type="text"
          value={basePath}
          onChange={(e) => setBasePath(e.target.value)}
          placeholder="aidlc"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <p className="text-xs text-slate-400 mt-1">
          Files will be committed to: /{basePath}/[project-name]/requirements/
        </p>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={createAidlcBranch}
            onChange={(e) => setCreateAidlcBranch(e.target.checked)}
            className="rounded border-slate-300"
          />
          Create a dedicated AIDLC branch for artifacts
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={autoCreatePR}
            onChange={(e) => setAutoCreatePR(e.target.checked)}
            className="rounded border-slate-300"
          />
          Auto-create Pull Request after commit
        </label>
      </div>

      <button
        onClick={handleSave}
        disabled={!selectedRepo || !selectedBranch || saving}
        className="w-full px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Configuration'}
      </button>
    </div>
  );
}
