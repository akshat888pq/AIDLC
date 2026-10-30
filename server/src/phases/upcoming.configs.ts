import type { PhaseConfig } from './phaseConfig.js';
import { TEST_SECTION_TEMPLATES } from '../prompts/testSections/templates.js';
import { RELEASE_SECTION_TEMPLATES } from '../prompts/releaseSections/templates.js';

/**
 * Phases that exist in the lifecycle and on the Agent Hub, but are not yet wired
 * for the full agent workflow. They are registered so the hub, the progress bar
 * and the phase-ordering logic all know about them; `comingSoon` stops the engine
 * starting one.
 *
 * Promoting one is the exercise described in the phase engine docs: write its
 * question / section / approval prompts, drop `comingSoon`, and it inherits the
 * entire workflow. Their section templates are already real — the existing
 * design/test/release builders use these same templates.
 */

const PLACEHOLDER = 'This phase is not yet available in the phase engine.';

function stub(
  partial: Omit<PhaseConfig, 'questionSystemPrompt' | 'sectionSystemPrompt' | 'approvalSystemPrompt' | 'comingSoon'>
): PhaseConfig {
  return {
    ...partial,
    questionSystemPrompt: PLACEHOLDER,
    sectionSystemPrompt: PLACEHOLDER,
    approvalSystemPrompt: PLACEHOLDER,
    comingSoon: true,
  };
}

export const testingPhaseConfig: PhaseConfig = stub({
  id: 'testing',
  name: 'Test Cases',
  shortName: 'Testing',
  icon: '🧪',
  color: 'emerald',
  roleOwner: 'QA Lead',
  requiresPhase: 'development',
  intake: 'import',
  maxQuestionsRound1: 6,
  maxQuestionsRound2: 3,
  sections: TEST_SECTION_TEMPLATES.map((t) => ({
    number: t.number,
    key: t.key,
    title: t.title,
    description: t.description,
    format: t.format,
  })),
  deliverables: [],
  outputFileName: 'test-plan.md',
  docIdPrefix: 'TEST',
});

export const releasePhaseConfig: PhaseConfig = stub({
  id: 'release',
  name: 'Release Notes',
  shortName: 'Release',
  icon: '🚀',
  color: 'amber',
  roleOwner: 'Release Manager',
  requiresPhase: 'testing',
  intake: 'import',
  maxQuestionsRound1: 5,
  maxQuestionsRound2: 3,
  sections: RELEASE_SECTION_TEMPLATES.map((t) => ({
    number: t.number,
    key: t.key,
    title: t.title,
    description: t.description,
    format: t.format,
  })),
  deliverables: [],
  outputFileName: 'release-notes.md',
  docIdPrefix: 'REL',
});
