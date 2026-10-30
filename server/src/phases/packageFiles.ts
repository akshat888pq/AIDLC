import fs from 'fs';
import path from 'path';
import type { CommitResult, FileCommit, PullRequest } from '../types/index.js';
import type { PhaseConfig } from './phaseConfig.js';
import { phaseDir } from '../services/secondBrain.js';
import { getGitConfig } from '../services/git/gitConfig.js';
import { getGitAdapter } from '../services/gitConnectionStore.js';
import { getProjectBySessionId } from '../services/projectStore.js';
import { projectOutputDirName } from '../services/artifactFiles.js';
import { getPhaseDoc } from './engine/phaseDocStore.js';
import { PhaseError } from './engine/index.js';

/**
 * A phase's output as a set of files — what gets committed to git.
 *
 * Everything under projects/<sessionId>/phases/<phaseId>/ that a human would want in
 * the repository: the assembled document, per-section documents, the Second Brain,
 * diagrams (source and JPG), reports, rendered images and approved HTML mockups.
 * Working files (state.json, doc.json, deliverables.json, mockups.json…) and the
 * images .zip — a bundle of files already
 * listed — are left out.
 */

export interface PackageFile {
  /** Path relative to the phase folder, forward slashes. */
  path: string;
  size: number;
  binary: boolean;
}

const WORKING_FILES = new Set([
  'state.json',
  'doc.json',
  'deliverables.json',
  'diagram.json',
  'design-model.json',
  'mockups.json',
]);
const TEXT_EXT = new Set(['.md', '.mmd', '.json', '.txt', '.csv', '.html']);
const INCLUDED_EXT = new Set([...TEXT_EXT, '.xlsx', '.jpg', '.jpeg', '.png']);

function walk(dir: string, base: string, out: PackageFile[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      walk(abs, base, out);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!INCLUDED_EXT.has(ext)) continue;
    // Top-level working files only — diagrams/<key>.json and images/index.json stay.
    if (!rel.includes('/') && WORKING_FILES.has(entry.name)) continue;
    out.push({ path: rel, size: fs.statSync(abs).size, binary: !TEXT_EXT.has(ext) });
  }
}

export function listPackageFiles(sessionId: string, config: PhaseConfig): PackageFile[] {
  const base = phaseDir(sessionId, config.id);
  const files: PackageFile[] = [];
  walk(base, base, files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Resolve a package-relative path to disk, refusing anything outside the phase folder. */
export function resolvePackagePath(sessionId: string, config: PhaseConfig, relative: string): string {
  const base = path.resolve(phaseDir(sessionId, config.id));
  const abs = path.resolve(base, relative);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new PhaseError('Invalid path', 400);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new PhaseError('File not found', 404);
  return abs;
}

export interface PackageCommitResult {
  commit: CommitResult;
  pullRequest?: PullRequest;
  branch: string;
  repoName: string;
  files: string[];
}

/**
 * Commit the whole phase package in ONE commit, using the project's git
 * configuration and the workspace's git connection (credentials belong to the
 * workspace, not the project).
 */
export async function commitPhasePackage(
  sessionId: string,
  config: PhaseConfig,
  opts: { workspaceSessionId: string; message?: string; createPR?: boolean; orgUrl?: string }
): Promise<PackageCommitResult> {
  const project = getProjectBySessionId(sessionId);
  if (!project) throw new PhaseError('Project not found for this session', 404);

  const doc = getPhaseDoc(sessionId, config.id);
  if (!doc || doc.status !== 'finalized') {
    throw new PhaseError(`Finalize the ${config.name} before committing it.`, 409);
  }

  const gitConfig = getGitConfig(project.id);
  if (!gitConfig) {
    throw new PhaseError('No git repository is configured for this project. Configure one on the project page.', 400);
  }

  const adapter = await getGitAdapter(opts.workspaceSessionId, gitConfig.provider, opts.orgUrl);
  if (!adapter) throw new PhaseError(`No connected ${gitConfig.provider} account. Connect it under Connections.`, 400);

  const files = listPackageFiles(sessionId, config);
  if (files.length === 0) throw new PhaseError('The phase folder has nothing to commit.', 400);

  const root = [gitConfig.basePath?.replace(/^\/+|\/+$/g, ''), projectOutputDirName(project.name, project.id), config.id]
    .filter(Boolean)
    .join('/');

  const commits: FileCommit[] = files.map((f) => {
    const abs = resolvePackagePath(sessionId, config, f.path);
    return f.binary
      ? { path: `${root}/${f.path}`, content: fs.readFileSync(abs).toString('base64'), encoding: 'base64' }
      : { path: `${root}/${f.path}`, content: fs.readFileSync(abs, 'utf-8') };
  });

  let branch = gitConfig.branch;
  if (gitConfig.createAidlcBranch) {
    branch = `aidlc/${doc.id.toLowerCase()}`;
    try {
      await adapter.createBranch(gitConfig.repoId, gitConfig.branch, branch);
    } catch {
      // Already exists from an earlier commit of this document — commit on top of it.
    }
  }

  const message =
    opts.message?.trim() || `docs(${config.id}): ${doc.id} ${config.name}\n\nCommitted by AIDLC — ${files.length} files`;
  const commit = await adapter.commitMultipleFiles(gitConfig.repoId, branch, commits, message);

  let pullRequest: PullRequest | undefined;
  if (opts.createPR && gitConfig.createAidlcBranch) {
    pullRequest = await adapter.createPullRequest(
      gitConfig.repoId,
      branch,
      gitConfig.branch,
      `${config.shortName}: ${doc.id} ${config.name}`,
      `${config.name} ${doc.id} for ${project.name}.\n\n${files.map((f) => `- ${f.path}`).join('\n')}\n\nCommitted by AIDLC`
    );
  }

  console.log(`[phase:${config.id}] session=${sessionId} committed ${files.length} files to ${gitConfig.repoName}@${branch}`);
  return { commit, pullRequest, branch, repoName: gitConfig.repoName, files: commits.map((c) => c.path) };
}
