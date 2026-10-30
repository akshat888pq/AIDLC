import fs from 'fs';
import path from 'path';
import type { ProjectPhaseProgress, PhaseStatusRecord, PhaseStatusValue } from '../types/index.js';
import { ensureDir } from './secondBrain.js';

/**
 * Which phases of a project are done, running, or still locked.
 *
 * One project owns one session id, and that session hosts every phase (see the
 * layout note in secondBrain.ts). So progress is a single file per session:
 *
 *   projects/<sessionId>/phase-progress.json
 *
 * This file is a *cache of state the phase artifacts already imply* — it exists so
 * the Agent Hub can count projects per phase without opening every brain on disk.
 * Anything derived here is re-derivable from the phase directories.
 */

const PROJECTS_DIR = path.resolve('projects');

function progressPath(sessionId: string): string {
  return path.join(PROJECTS_DIR, sessionId, 'phase-progress.json');
}

function emptyProgress(sessionId: string, projectId: string): ProjectPhaseProgress {
  return { projectId, sessionId, phases: {} };
}

export function readProgress(sessionId: string, projectId = sessionId): ProjectPhaseProgress {
  const fp = progressPath(sessionId);
  if (!fs.existsSync(fp)) return emptyProgress(sessionId, projectId);
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8')) as ProjectPhaseProgress;
    return {
      projectId: parsed.projectId || projectId,
      sessionId,
      phases: parsed.phases ?? {},
    };
  } catch (err: any) {
    console.error(`[phaseProgress] corrupt progress for session=${sessionId}: ${err.message}`);
    return emptyProgress(sessionId, projectId);
  }
}

function writeProgress(progress: ProjectPhaseProgress): ProjectPhaseProgress {
  ensureDir(path.join(PROJECTS_DIR, progress.sessionId));
  fs.writeFileSync(progressPath(progress.sessionId), JSON.stringify(progress, null, 2), 'utf-8');
  return progress;
}

export function getPhaseRecord(sessionId: string, phaseId: string): PhaseStatusRecord | undefined {
  return readProgress(sessionId).phases[phaseId];
}

/**
 * Merge a patch into one phase's record. Timestamps are written once and never
 * moved: a phase that has been completed keeps its original completedAt even if it
 * is later reopened and re-approved, unless the caller clears it explicitly.
 */
export function updatePhaseRecord(
  sessionId: string,
  phaseId: string,
  patch: Partial<PhaseStatusRecord>,
  projectId?: string
): ProjectPhaseProgress {
  const progress = readProgress(sessionId, projectId ?? sessionId);
  if (projectId) progress.projectId = projectId;

  const existing = progress.phases[phaseId] ?? { status: 'not-started' as PhaseStatusValue };
  const merged: PhaseStatusRecord = { ...existing, ...patch, sessionId };

  if (patch.status === 'in-progress' && !merged.startedAt) {
    merged.startedAt = new Date().toISOString();
  }
  if (patch.status === 'completed' && !merged.completedAt) {
    merged.completedAt = new Date().toISOString();
  }

  progress.phases[phaseId] = merged;
  return writeProgress(progress);
}

export function markPhaseStarted(
  sessionId: string,
  phaseId: string,
  projectId?: string
): ProjectPhaseProgress {
  const existing = getPhaseRecord(sessionId, phaseId);
  // Never demote a finished phase back to in-progress just because it was reopened.
  if (existing?.status === 'completed') return readProgress(sessionId, projectId ?? sessionId);
  return updatePhaseRecord(sessionId, phaseId, { status: 'in-progress' }, projectId);
}

export function markPhaseCompleted(
  sessionId: string,
  phaseId: string,
  extra: { documentId?: string; confidenceScore?: number } = {},
  projectId?: string
): ProjectPhaseProgress {
  return updatePhaseRecord(sessionId, phaseId, { status: 'completed', ...extra }, projectId);
}
