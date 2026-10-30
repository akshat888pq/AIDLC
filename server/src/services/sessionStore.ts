import fs from 'fs';
import path from 'path';
import type { Session } from '../types/index.js';

/**
 * The working state of a project session — which documents it holds and what the AI
 * has concluded from them — persisted next to the Second Brain.
 *
 * The Second Brain is the curated, human-readable record. This file is the raw
 * working set the pipeline needs to keep going: the document list (which points at
 * parsed/<fileId>.txt) and the analysis history. Keeping it on disk is what lets you
 * close a project, come back a week later with a new client document, and continue —
 * rather than losing the whole context to a server restart.
 */

const PROJECTS_DIR = path.resolve('projects');

function contextDir(sessionId: string): string {
  return path.join(PROJECTS_DIR, sessionId, 'context');
}

function sessionFilePath(sessionId: string): string {
  return path.join(contextDir(sessionId), 'session.json');
}

export function readSession(sessionId: string): Session | null {
  const fp = sessionFilePath(sessionId);
  if (!fs.existsSync(fp)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Session;
    // Defensive defaults — a file written by an older build may miss fields.
    return {
      ...parsed,
      id: sessionId,
      files: Array.isArray(parsed.files) ? parsed.files : [],
      analyses: Array.isArray(parsed.analyses) ? parsed.analyses : [],
      cycleCount: typeof parsed.cycleCount === 'number' ? parsed.cycleCount : 0,
      approvalStatus: parsed.approvalStatus ?? 'pending',
      currentStep: parsed.currentStep ?? 'upload',
    };
  } catch (err: any) {
    console.error(`[sessionStore] corrupt session for session=${sessionId}: ${err.message}`);
    return null;
  }
}

export function writeSession(session: Session): void {
  const dir = contextDir(session.id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionFilePath(session.id), JSON.stringify(session, null, 2), 'utf-8');
}

export function sessionExists(sessionId: string): boolean {
  return fs.existsSync(sessionFilePath(sessionId));
}
