import type { Repo, Branch, FileCommit, CommitResult, PullRequest } from '../../types/index.js';

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  url: string;
  files?: string[];
}

export interface GitProviderAdapter {
  name: string;
  getRepos(): Promise<Repo[]>;
  getBranches(repoId: string): Promise<Branch[]>;
  getFileContent(repoId: string, branch: string, path: string): Promise<string | null>;
  commitFile(repoId: string, branch: string, path: string, content: string, message: string): Promise<CommitResult>;
  commitMultipleFiles(repoId: string, branch: string, files: FileCommit[], message: string): Promise<CommitResult>;
  createBranch(repoId: string, sourceBranch: string, newBranch: string): Promise<Branch>;
  createPullRequest(repoId: string, sourceBranch: string, targetBranch: string, title: string, description: string): Promise<PullRequest>;
  getCommitHistory(repoId: string, branch: string, pathFilter?: string, limit?: number): Promise<GitCommit[]>;
  testConnection(): Promise<{ ok: boolean; user?: string; org?: string }>;
}
