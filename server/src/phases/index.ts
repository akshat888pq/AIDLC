import { registerPhase } from './registry.js';
import { requirementPhaseConfig } from './requirement.config.js';
import { architecturePhaseConfig } from './architecture.config.js';
import { designPhaseConfig } from './design.config.js';
import { testingPhaseConfig, releasePhaseConfig } from './upcoming.configs.js';
import { developmentPhaseConfig } from './development.config.js';

/**
 * Registration happens exactly once, at import time. Importing this module is what
 * makes the registry (and therefore every phase route) aware of a phase.
 *
 * To add a phase: write `<phase>.config.ts`, register it here, add its id to
 * PHASE_ORDER in registry.ts. Nothing else in the system needs to change.
 */
registerPhase(requirementPhaseConfig);
registerPhase(architecturePhaseConfig);
registerPhase(designPhaseConfig);
registerPhase(developmentPhaseConfig);
registerPhase(testingPhaseConfig);
registerPhase(releasePhaseConfig);

export * from './registry.js';
export * from './phaseConfig.js';
