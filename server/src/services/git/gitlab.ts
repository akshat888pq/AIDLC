import type { Repo, Branch, FileCommit, CommitResult, PullRequest } from '../../types/index.js';
import type { GitProviderAdapter, GitCommit } from './adapter.js';

const API = 'https://gitlab.com/api/v4';

export class GitLabAdapter implements GitProviderAdapter {
  name = 'gitlab';

  constructor(private token: string) {}

  private async request(path: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitLab API ${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async getRepos(): Promise<Repo[]> {
    const data = await this.request('/projects?membership=true&order_by=updated_at&per_page=100');
    return data.map((r: any) => ({
      id: String(r.id),
      name: r.name,
      fullName: r.path_with_namespace,
      defaultBranch: r.default_branch || 'main',
      url: r.web_url,
      private: r.visibility === 'private',
    }));
  }

  async getBranches(repoId: string): Promise<Branch[]> {
    const [branches, project] = await Promise.all([
      this.request(`/projects/${encodeURIComponent(repoId)}/repository/branches?per_page=100`),
      this.request(`/projects/${encodeURIComponent(repoId)}`),
    ]);
    return branches.map((b: any) => ({
      name: b.name,
      sha: b.commit.id,
      isDefault: b.name === project.default_branch,
    }));
  }

  async getFileContent(repoId: string, branch: string, path: string): Promise<string | null> {
    try {
      const data = await this.request(
        `/projects/${encodeURIComponent(repoId)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      );
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }

  async commitFile(repoId: string, branch: string, path: string, content: string, message: string): Promise<CommitResult> {
    const existing = await this.getFileContent(repoId, branch, path);
    const action = existing !== null ? 'update' : 'create';

    const data = await this.request(`/projects/${encodeURIComponent(repoId)}/repository/commits`, {
      method: 'POST',
      body: JSON.stringify({
        branch,
        commit_message: message,
        actions: [{ action, file_path: path, content }],
      }),
    });

    return {
      sha: data.id,
      url: data.web_url,
      message,
    };
  }

  async commitMultipleFiles(repoId: string, branch: string, files: FileCommit[], message: string): Promise<CommitResult> {
    const actions = await Promise.all(
      files.map(async (f) => {
        const existing = await this.getFileContent(repoId, branch, f.path);
        return {
          action: existing !== null ? 'update' : 'create',
          file_path: f.path,
          content: f.content,
          ...(f.encoding === 'base64' ? { encoding: 'base64' } : {}),
        };
      }),
    );

    const data = await this.request(`/projects/${encodeURIComponent(repoId)}/repository/commits`, {
      method: 'POST',
      body: JSON.stringify({
        branch,
        commit_message: message,
        actions,
      }),
    });

    return {
      sha: data.id,
      url: data.web_url,
      message,
    };
  }

  async createBranch(repoId: string, sourceBranch: string, newBranch: string): Promise<Branch> {
    const data = await this.request(`/projects/${encodeURIComponent(repoId)}/repository/branches`, {
      method: 'POST',
      body: JSON.stringify({ branch: newBranch, ref: sourceBranch }),
    });
    return { name: data.name, sha: data.commit.id, isDefault: false };
  }

  async createPullRequest(repoId: string, sourceBranch: string, targetBranch: string, title: string, description: string): Promise<PullRequest> {
    const data = await this.request(`/projects/${encodeURIComponent(repoId)}/merge_requests`, {
      method: 'POST',
      body: JSON.stringify({
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title,
        description,
      }),
    });

    return {
      id: String(data.id),
      number: data.iid,
      title: data.title,
      url: data.web_url,
      status: 'open',
    };
  }

  async getCommitHistory(repoId: string, branch: string, pathFilter?: string, limit = 20): Promise<GitCommit[]> {
    let url = `/projects/${encodeURIComponent(repoId)}/repository/commits?ref_name=${encodeURIComponent(branch)}&per_page=${limit}`;
    if (pathFilter) url += `&path=${encodeURIComponent(pathFilter)}`;
    const data = await this.request(url);
    return data.map((c: any) => ({
      sha: c.id,
      shortSha: c.short_id,
      message: c.message,
      author: c.author_name || 'unknown',
      date: c.authored_date || c.created_at || '',
      url: c.web_url,
    }));
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; org?: string }> {
    try {
      const user = await this.request('/user');
      return { ok: true, user: user.username, org: user.name || user.username };
    } catch {
      return { ok: false };
    }
  }
}
