import fs from 'fs';
import path from 'path';
import type { AnalysisResult, PhaseStepKey } from '../../types/index.js';
import { ensureDir, phaseDir, DEFAULT_PHASE_ID } from '../../services/secondBrain.js';
import { loadSession, saveSession, getOrCreateSession } from '../../state.js';

/**
 * A phase's working state: the analysis rounds it has run and which step of the
 * workflow it is on. The Second Brain remains authoritative for cycle count and
 * approval; this file holds the transient working set (the current question round).
 *
 * The requirement phase does NOT get a file of its own. Its working state is the
 * Session that the existing upload/analyze/questions routes already read and write,
 * and having two copies of it would be two things to keep in sync. So every read
 * and write for `requirement` is delegated to the session store, and the engine
 * therefore operates on exactly the same data as the legacy routes.
 */

export interface PhaseState {
  sessionId: string;
  phaseId: string;
  createdAt: string;
  analyses: AnalysisResult[];
  currentStep: PhaseStepKey;
}

function statePath(sessionId: string, phaseId: string): string {
  return path.join(phaseDir(sessionId, phaseId), 'state.json');
}

function isLegacyPhase(phaseId: string): boolean {
  return phaseId === DEFAULT_PHASE_ID;
}

/** Map the legacy Session.currentStep vocabulary onto the phase step vocabulary. */
function toPhaseStep(step: string): PhaseStepKey {
  switch (step) {
    case 'upload':
      return 'upload';
    case 'analyzing':
      return 'analyzing';
    case 'understanding':
      return 'understanding';
    case 'questions':
      return 'questions';
    case 'approval':
      return 'approval';
    case 'approved':
    case 'refined':
      return 'sections';
    default:
      return 'upload';
  }
}

export function readPhaseState(sessionId: string, phaseId: string): PhaseState | null {
  if (isLegacyPhase(phaseId)) {
    const session = loadSession(sessionId);
    if (!session) return null;
    return {
      sessionId,
      phaseId,
      createdAt: session.createdAt,
      analyses: session.analyses,
      currentStep: toPhaseStep(session.currentStep),
    };
  }

  const fp = statePath(sessionId, phaseId);
  if (!fs.existsSync(fp)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8')) as PhaseState;
    return {
      sessionId,
      phaseId,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      analyses: Array.isArray(parsed.analyses) ? parsed.analyses : [],
      currentStep: parsed.currentStep ?? 'import',
    };
  } catch (err: any) {
    console.error(`[phaseState] corrupt state for session=${sessionId} phase=${phaseId}: ${err.message}`);
    return null;
  }
}

export function getOrCreatePhaseState(sessionId: string, phaseId: string): PhaseState {
  const existing = readPhaseState(sessionId, phaseId);
  if (existing) return existing;

  if (isLegacyPhase(phaseId)) {
    const session = getOrCreateSession(sessionId);
    return {
      sessionId,
      phaseId,
      createdAt: session.createdAt,
      analyses: session.analyses,
      currentStep: toPhaseStep(session.currentStep),
    };
  }

  const fresh: PhaseState = {
    sessionId,
    phaseId,
    createdAt: new Date().toISOString(),
    analyses: [],
    currentStep: 'import',
  };
  return savePhaseState(fresh);
}

export function savePhaseState(state: PhaseState): PhaseState {
  if (isLegacyPhase(state.phaseId)) {
    const session = getOrCreateSession(state.sessionId);
    session.analyses = state.analyses;
    // 'sections' is the phase engine's name for what the session calls 'approved'.
    session.currentStep = state.currentStep === 'sections' || state.currentStep === 'export'
      ? 'approved'
      : (state.currentStep as any);
    saveSession(session);
    return state;
  }

  const dir = phaseDir(state.sessionId, state.phaseId);
  ensureDir(dir);
  fs.writeFileSync(statePath(state.sessionId, state.phaseId), JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

export function updatePhaseState(
  sessionId: string,
  phaseId: string,
  mutate: (state: PhaseState) => void
): PhaseState {
  const state = getOrCreatePhaseState(sessionId, phaseId);
  mutate(state);
  return savePhaseState(state);
}

/** The most recent analysis round, or null if the phase has not been analyzed yet. */
export function latestAnalysis(state: PhaseState | null): AnalysisResult | null {
  if (!state || state.analyses.length === 0) return null;
  return state.analyses[state.analyses.length - 1];
}
