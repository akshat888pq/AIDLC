import type { PhaseConfig } from './phaseConfig.js';

const IDE_PHASE = 'The development phase runs in the IDE workspace, not the phase engine.';

export const developmentPhaseConfig: PhaseConfig = {
  id: 'development',
  name: 'Development',
  shortName: 'Dev',
  icon: '💻',
  color: 'indigo',
  roleOwner: 'Developer + Coding Agent',
  requiresPhase: 'design',
  workspace: 'ide',
  questionSystemPrompt: IDE_PHASE,
  sectionSystemPrompt: IDE_PHASE,
  approvalSystemPrompt: IDE_PHASE,
  maxQuestionsRound1: 0,
  maxQuestionsRound2: 0,
  sections: [],
  deliverables: [],
  outputFileName: 'workspace',
  docIdPrefix: 'DEV',
};
