import type { Repo, Branch, FileCommit, CommitResult, PullRequest } from '../../types/index.js';
import type { GitProviderAdapter, GitCommit } from './adapter.js';

const API = 'https://api.github.com';

export class GitHubAdapter implements GitProviderAdapter {
  name = 'github';

  constructor(private token: string) {}

  private async request(path: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async getRepos(): Promise<Repo[]> {
    const data = await this.request('/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member');
    return data.map((r: any) => ({
      id: String(r.id),
      name: r.name,
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      url: r.html_url,
      private: r.private,
    }));
  }

  async getBranches(repoId: string): Promise<Branch[]> {
    const repo = await this.getRepoFullName(repoId);
    const data = await this.request(`/repos/${repo}/branches?per_page=100`);
    const repoInfo = await this.request(`/repos/${repo}`);
    return data.map((b: any) => ({
      name: b.name,
      sha: b.commit.sha,
      isDefault: b.name === repoInfo.default_branch,
    }));
  }

  async getFileContent(repoId: string, branch: string, path: string): Promise<string | null> {
    try {
      const repo = await this.getRepoFullName(repoId);
      const data = await this.request(`/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`);
      if (data.content) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
      return null;
    } catch {
      return null;
    }
  }

  async commitFile(repoId: string, branch: string, path: string, content: string, message: string): Promise<CommitResult> {
    const repo = await this.getRepoFullName(repoId);
    let sha: string | undefined;
    try {
      const existing = await this.request(`/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`);
      sha = existing.sha;
    } catch {}

    const body: any = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
    };
    if (sha) body.sha = sha;

    const data = await this.request(`/repos/${repo}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return {
      sha: data.commit.sha,
      url: data.commit.html_url,
      message,
    };
  }

  async commitMultipleFiles(repoId: string, branch: string, files: FileCommit[], message: string): Promise<CommitResult> {
    const repo = await this.getRepoFullName(repoId);

    const refData = await this.request(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    const baseCommitSha = refData.object.sha;

    const commitData = await this.request(`/repos/${repo}/git/commits/${baseCommitSha}`);
    const baseTreeSha = commitData.tree.sha;

    // Inline tree content must be UTF-8; binary files (JPGs) go up as blobs first.
    const tree = await Promise.all(
      files.map(async (f) => {
        if (f.encoding !== 'base64') {
          return { path: f.path, mode: '100644' as const, type: 'blob' as const, content: f.content };
        }
        const blob = await this.request(`/repos/${repo}/git/blobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: f.content, encoding: 'base64' }),
        });
        return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha as string };
      })
    );

    const newTree = await this.request(`/repos/${repo}/git/trees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTreeSha, tree }),
    });

    const newCommit = await this.request(`/repos/${repo}/git/commits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        tree: newTree.sha,
        parents: [baseCommitSha],
      }),
    });

    await this.request(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: newCommit.sha }),
    });

    return {
      sha: newCommit.sha,
      url: `https://github.com/${repo}/commit/${newCommit.sha}`,
      message,
    };
  }

  async createBranch(repoId: string, sourceBranch: string, newBranch: string): Promise<Branch> {
    const repo = await this.getRepoFullName(repoId);
    const refData = await this.request(`/repos/${repo}/git/ref/heads/${encodeURIComponent(sourceBranch)}`);

    const created = await this.request(`/repos/${repo}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: `refs/heads/${newBranch}`,
        sha: refData.object.sha,
      }),
    });

    return { name: newBranch, sha: created.object.sha, isDefault: false };
  }

  async createPullRequest(repoId: string, sourceBranch: string, targetBranch: string, title: string, description: string): Promise<PullRequest> {
    const repo = await this.getRepoFullName(repoId);
    const data = await this.request(`/repos/${repo}/pulls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        body: description,
        head: sourceBranch,
        base: targetBranch,
      }),
    });

    return {
      id: String(data.id),
      number: data.number,
      title: data.title,
      url: data.html_url,
      status: 'open',
    };
  }

  async getCommitHistory(repoId: string, branch: string, pathFilter?: string, limit = 20): Promise<GitCommit[]> {
    const repo = await this.getRepoFullName(repoId);
    let url = `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}`;
    if (pathFilter) url += `&path=${encodeURIComponent(pathFilter)}`;
    const data = await this.request(url);
    return data.map((c: any) => ({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: c.commit.message,
      author: c.commit.author?.name || c.author?.login || 'unknown',
      date: c.commit.author?.date || '',
      url: c.html_url,
    }));
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; org?: string }> {
    try {
      const user = await this.request('/user');
      return { ok: true, user: user.login, org: user.name || user.login };
    } catch {
      return { ok: false };
    }
  }

  private async getRepoFullName(repoId: string): Promise<string> {
    if (repoId.includes('/')) return repoId;
    const data = await this.request(`/repositories/${repoId}`);
    return data.full_name;
  }
}
