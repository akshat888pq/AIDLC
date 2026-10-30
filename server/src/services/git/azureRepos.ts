import type { Repo, Branch, FileCommit, CommitResult, PullRequest } from '../../types/index.js';
import type { GitProviderAdapter, GitCommit } from './adapter.js';

export class AzureReposAdapter implements GitProviderAdapter {
  name = 'azure-repos';

  constructor(
    private organizationUrl: string,
    private token: string,
  ) {}

  private get baseUrl(): string {
    return this.organizationUrl.replace(/\/$/, '');
  }

  private async request(path: string, opts: RequestInit = {}): Promise<any> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${sep}api-version=7.1`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Azure Repos API ${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async getRepos(): Promise<Repo[]> {
    const data = await this.request('/_apis/git/repositories');
    return (data.value || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      fullName: `${r.project.name}/${r.name}`,
      defaultBranch: (r.defaultBranch || 'refs/heads/main').replace('refs/heads/', ''),
      url: r.webUrl || r.remoteUrl,
      private: true,
    }));
  }

  async getBranches(repoId: string): Promise<Branch[]> {
    const [branches, repo] = await Promise.all([
      this.request(`/_apis/git/repositories/${repoId}/refs?filter=heads/`),
      this.request(`/_apis/git/repositories/${repoId}`),
    ]);
    const defaultBranch = (repo.defaultBranch || 'refs/heads/main').replace('refs/heads/', '');
    return (branches.value || []).map((b: any) => {
      const name = b.name.replace('refs/heads/', '');
      return {
        name,
        sha: b.objectId,
        isDefault: name === defaultBranch,
      };
    });
  }

  async getFileContent(repoId: string, branch: string, path: string): Promise<string | null> {
    try {
      const url = `/_apis/git/repositories/${repoId}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${encodeURIComponent(branch)}&versionDescriptor.versionType=branch&includeContent=true`;
      const res = await fetch(`${this.baseUrl}${url}&api-version=7.1`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'text/plain',
        },
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  async commitFile(repoId: string, branch: string, path: string, content: string, message: string): Promise<CommitResult> {
    return this.commitMultipleFiles(repoId, branch, [{ path, content }], message);
  }

  async commitMultipleFiles(repoId: string, branch: string, files: FileCommit[], message: string): Promise<CommitResult> {
    const refData = await this.request(`/_apis/git/repositories/${repoId}/refs?filter=heads/${encodeURIComponent(branch)}`);
    const oldObjectId = refData.value?.[0]?.objectId;
    if (!oldObjectId) throw new Error(`Branch ${branch} not found`);

    const changes = await Promise.all(
      files.map(async (f) => {
        const existing = await this.getFileContent(repoId, branch, f.path);
        return {
          changeType: existing !== null ? 'edit' : 'add',
          item: { path: f.path.startsWith('/') ? f.path : `/${f.path}` },
          newContent: { content: f.content, contentType: f.encoding === 'base64' ? 'base64encoded' : 'rawtext' },
        };
      }),
    );

    const data = await this.request(`/_apis/git/repositories/${repoId}/pushes`, {
      method: 'POST',
      body: JSON.stringify({
        refUpdates: [{ name: `refs/heads/${branch}`, oldObjectId }],
        commits: [{ comment: message, changes }],
      }),
    });

    const commitId = data.commits?.[0]?.commitId || '';
    return {
      sha: commitId,
      url: `${this.baseUrl}/_git/${repoId}/commit/${commitId}`,
      message,
    };
  }

  async createBranch(repoId: string, sourceBranch: string, newBranch: string): Promise<Branch> {
    const refData = await this.request(`/_apis/git/repositories/${repoId}/refs?filter=heads/${encodeURIComponent(sourceBranch)}`);
    const sha = refData.value?.[0]?.objectId;
    if (!sha) throw new Error(`Source branch ${sourceBranch} not found`);

    const data = await this.request(`/_apis/git/repositories/${repoId}/refs`, {
      method: 'POST',
      body: JSON.stringify([
        {
          name: `refs/heads/${newBranch}`,
          oldObjectId: '0000000000000000000000000000000000000000',
          newObjectId: sha,
        },
      ]),
    });

    return { name: newBranch, sha, isDefault: false };
  }

  async createPullRequest(repoId: string, sourceBranch: string, targetBranch: string, title: string, description: string): Promise<PullRequest> {
    const data = await this.request(`/_apis/git/repositories/${repoId}/pullrequests`, {
      method: 'POST',
      body: JSON.stringify({
        sourceRefName: `refs/heads/${sourceBranch}`,
        targetRefName: `refs/heads/${targetBranch}`,
        title,
        description,
      }),
    });

    return {
      id: String(data.pullRequestId),
      number: data.pullRequestId,
      title: data.title,
      url: `${this.baseUrl}/_git/${repoId}/pullrequest/${data.pullRequestId}`,
      status: 'open',
    };
  }

  async getCommitHistory(repoId: string, branch: string, pathFilter?: string, limit = 20): Promise<GitCommit[]> {
    let url = `/_apis/git/repositories/${repoId}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(branch)}&searchCriteria.itemVersion.versionType=branch&$top=${limit}`;
    if (pathFilter) url += `&searchCriteria.itemPath=${encodeURIComponent(pathFilter)}`;
    const data = await this.request(url);
    return (data.value || []).map((c: any) => ({
      sha: c.commitId,
      shortSha: c.commitId.slice(0, 7),
      message: c.comment || '',
      author: c.author?.name || 'unknown',
      date: c.author?.date || '',
      url: c.remoteUrl || `${this.baseUrl}/_git/${repoId}/commit/${c.commitId}`,
    }));
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; org?: string }> {
    try {
      const profile = await fetch('https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!profile.ok) return { ok: false };
      const data = await profile.json();
      const orgPart = this.organizationUrl.split('/').filter(Boolean).pop() || '';
      return { ok: true, user: data.displayName, org: orgPart };
    } catch {
      return { ok: false };
    }
  }
}
