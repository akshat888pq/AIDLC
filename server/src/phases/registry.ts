import type { PhaseConfig } from './phaseConfig.js';

/**
 * Registry of every phase agent the system knows about.
 *
 * To add a phase: create its config and register it below. Ordering is explicit
 * (PHASE_ORDER) rather than insertion-based so the lifecycle reads the same way
 * everywhere, including for phases that are registered but not yet buildable.
 */

export const PHASE_ORDER = [
  'requirement',
  'architecture',
  'design',
  'development',
  'testing',
  'release',
] as const;

const phases: Map<string, PhaseConfig> = new Map();

export function registerPhase(config: PhaseConfig): void {
  if (!PHASE_ORDER.includes(config.id as (typeof PHASE_ORDER)[number])) {
    throw new Error(
      `Phase "${config.id}" is not in PHASE_ORDER. Add it there so the lifecycle knows where it sits.`
    );
  }
  phases.set(config.id, config);
}

export function getPhase(id: string): PhaseConfig | undefined {
  return phases.get(id);
}

/** Every registered phase, in lifecycle order. */
export function getAllPhases(): PhaseConfig[] {
  return PHASE_ORDER.map((id) => phases.get(id)).filter(Boolean) as PhaseConfig[];
}

export function getNextPhase(currentPhaseId: string): PhaseConfig | undefined {
  const idx = PHASE_ORDER.indexOf(currentPhaseId as (typeof PHASE_ORDER)[number]);
  if (idx < 0 || idx === PHASE_ORDER.length - 1) return undefined;
  return phases.get(PHASE_ORDER[idx + 1]);
}

export function getPreviousPhase(currentPhaseId: string): PhaseConfig | undefined {
  const idx = PHASE_ORDER.indexOf(currentPhaseId as (typeof PHASE_ORDER)[number]);
  if (idx <= 0) return undefined;
  return phases.get(PHASE_ORDER[idx - 1]);
}

/** Phase ids from the first phase up to and including `phaseId`, in order. */
export function phasesUpTo(phaseId: string): string[] {
  const idx = PHASE_ORDER.indexOf(phaseId as (typeof PHASE_ORDER)[number]);
  if (idx < 0) return [];
  return PHASE_ORDER.slice(0, idx + 1);
}

export function phaseIndex(phaseId: string): number {
  return PHASE_ORDER.indexOf(phaseId as (typeof PHASE_ORDER)[number]);
}
