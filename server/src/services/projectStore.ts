import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Project, ProjectStats } from '../types/index.js';
import { ownedBy, projectOutputDirName } from './artifactFiles.js';

const DATA_DIR = path.resolve('data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const REQUIREMENTS_DIR = path.resolve('requirements');
const PROJECTS_DIR = path.resolve('projects');

/**
 * Directories holding per-project artifacts, keyed by the owning id. Session-scoped
 * stores are keyed by `project.sessionId`; the rest by `project.id`.
 */
const SESSION_SCOPED_DIRS = [REQUIREMENTS_DIR];
const PROJECT_SCOPED_DIRS = [
  path.resolve('architecture'),
  path.resolve('design'),
  path.resolve('tests'),
  path.resolve('release'),
];

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Every project owns exactly one session id, and that id namespaces all of its
 * context: the Second Brain, uploads, chat history and requirement documents. A
 * project written by an older build may predate that rule — backfill it here so no
 * code path can ever fall back to a shared, browser-wide session.
 */
function normalizeProjects(projects: Project[]): { projects: Project[]; changed: boolean } {
  let changed = false;
  for (const project of projects) {
    if (!project.sessionId) {
      project.sessionId = crypto.randomUUID();
      changed = true;
    }
  }
  return { projects, changed };
}

function readProjects(): Project[] {
  ensureDir();
  if (!fs.existsSync(PROJECTS_FILE)) return [];
  const raw: Project[] = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
  const { projects, changed } = normalizeProjects(raw);
  if (changed) writeProjects(projects);
  return projects;
}

function writeProjects(projects: Project[]): void {
  ensureDir();
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

export function getAllProjects(): Project[] {
  return readProjects().filter((p) => p.status !== 'archived');
}

export function getProject(projectId: string): Project | null {
  return readProjects().find((p) => p.id === projectId) || null;
}

/** The project that owns a session, or null for a session with no project. */
export function getProjectBySessionId(sessionId: string): Project | null {
  return readProjects().find((p) => p.sessionId === sessionId) || null;
}

export function createProject(data: {
  name: string;
  description?: string;
  client?: string;
  ticketProvider?: string;
  ticketProjectId?: string;
  gitProvider?: string;
  gitRepoId?: string;
  gitBranch?: string;
}): Project {
  const projects = readProjects();
  const now = new Date().toISOString();

  const project: Project = {
    id: crypto.randomUUID(),
    name: data.name,
    description: data.description || '',
    client: data.client,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    // Minted here, never accepted from the client: a caller-supplied session id is
    // how two projects would end up sharing one Second Brain.
    sessionId: crypto.randomUUID(),
    ticketProvider: data.ticketProvider as any,
    ticketProjectId: data.ticketProjectId,
    gitProvider: data.gitProvider as any,
    gitRepoId: data.gitRepoId,
    gitBranch: data.gitBranch,
    requirementCount: 0,
    approvedCount: 0,
    ticketCount: 0,
    lastActivity: now,
  };

  projects.push(project);
  writeProjects(projects);
  return project;
}

export function updateProject(projectId: string, updates: Partial<Project>): Project | null {
  const projects = readProjects();
  const idx = projects.findIndex((p) => p.id === projectId);
  if (idx < 0) return null;

  // id, createdAt and sessionId are identity — changing sessionId would repoint the
  // project at another project's context.
  const { id, createdAt, sessionId, ...safeUpdates } = updates as any;
  Object.assign(projects[idx], safeUpdates, { updatedAt: new Date().toISOString() });
  writeProjects(projects);
  return projects[idx];
}

export function archiveProject(projectId: string): boolean {
  const projects = readProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return false;
  project.status = 'archived';
  project.updatedAt = new Date().toISOString();
  writeProjects(projects);
  return true;
}

/**
 * Permanently remove a project and everything namespaced under it: its Second Brain,
 * requirement documents, and architecture/design/test/release artifacts. Leaving any
 * of it behind would let a later project inherit stale context through a reused id.
 */
export function deleteProject(projectId: string): Project | null {
  const projects = readProjects();
  const idx = projects.findIndex((p) => p.id === projectId);
  if (idx < 0) return null;

  const [project] = projects.splice(idx, 1);
  writeProjects(projects);

  for (const dir of SESSION_SCOPED_DIRS) {
    removeMatchingFiles(dir, project.sessionId);
  }
  for (const dir of PROJECT_SCOPED_DIRS) {
    removeMatchingFiles(dir, project.id);
  }

  // Second Brain, reports and finalized markdown all live under projects/.
  removeDir(path.join(PROJECTS_DIR, project.sessionId ?? ''));
  removeDir(path.join(PROJECTS_DIR, projectOutputDirName(project.name, project.id)));

  return project;
}

function removeMatchingFiles(dir: string, ownerId?: string) {
  if (!ownerId || !fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (!ownedBy(file, ownerId)) continue;
    try {
      fs.rmSync(path.join(dir, file), { force: true });
    } catch {}
  }
}

function removeDir(dir: string) {
  if (!dir || !fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

export function computeProjectStats(project: Project): Partial<Project> {
  let requirementCount = 0;
  let approvedCount = 0;

  if (!fs.existsSync(REQUIREMENTS_DIR)) return { requirementCount: 0, approvedCount: 0 };

  const sessionId = project.sessionId;
  if (!sessionId) return { requirementCount: 0, approvedCount: 0 };

  const files = fs.readdirSync(REQUIREMENTS_DIR).filter((f) => ownedBy(f, sessionId));

  for (const file of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(REQUIREMENTS_DIR, file), 'utf-8'));
      requirementCount++;
      if (doc.status === 'finalized' || doc.status === 'approved') approvedCount++;
    } catch {}
  }

  return { requirementCount, approvedCount };
}

export function getProjectStats(): ProjectStats {
  const projects = getAllProjects();
  let activeRequirements = 0;
  let connectedTickets = 0;
  let pendingApprovals = 0;

  if (!fs.existsSync(REQUIREMENTS_DIR)) {
    return { totalProjects: projects.length, activeRequirements: 0, connectedTickets: 0, pendingApprovals: 0 };
  }

  // Only count requirements owned by a live project. Counting every file on disk
  // would fold in documents belonging to deleted or archived projects.
  const liveSessions = projects.map((p) => p.sessionId).filter(Boolean) as string[];
  const allReqFiles = fs
    .readdirSync(REQUIREMENTS_DIR)
    .filter((f) => liveSessions.some((sessionId) => ownedBy(f, sessionId)));

  for (const file of allReqFiles) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(REQUIREMENTS_DIR, file), 'utf-8'));
      activeRequirements++;
      if (doc.status === 'in-progress') pendingApprovals++;
      if (doc.linkedTickets?.length) connectedTickets += doc.linkedTickets.length;
    } catch {}
  }

  return {
    totalProjects: projects.length,
    activeRequirements,
    connectedTickets,
    pendingApprovals,
  };
}
