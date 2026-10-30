import type { PhaseConfig } from './phaseConfig.js';
import { DOCUMENT_ANALYSIS_PROMPT } from '../prompts/documentAnalysis.js';
import { SECTION_TEMPLATES } from '../prompts/sections/templates.js';
import { SECTION_SYSTEM_PROMPT } from '../prompts/sections/index.js';
import { APPROVAL_SUMMARY_SYSTEM_PROMPT } from '../prompts/approvalSummary.js';

/**
 * The requirement phase, expressed as a PhaseConfig.
 *
 * This is a restructuring, not a rewrite: every prompt and template here is the
 * exact object the requirement pipeline already uses, imported from its original
 * home. The legacy routes keep calling those modules directly, so the requirement
 * phase behaves identically whether it is driven through /api/analyze… or through
 * /api/phase/requirement/….
 */
export const requirementPhaseConfig: PhaseConfig = {
  id: 'requirement',
  name: 'Requirements Analysis',
  shortName: 'Requirement',
  icon: '📋',
  color: 'indigo',
  roleOwner: 'Business Analyst',

  // The first phase: its input is uploaded documents or a ticket, not another phase.
  intake: 'upload',

  questionSystemPrompt: DOCUMENT_ANALYSIS_PROMPT,
  maxQuestionsRound1: 10,
  maxQuestionsRound2: 3,

  sections: SECTION_TEMPLATES.map((t) => ({
    number: t.number,
    key: t.key,
    title: t.title,
    description: t.description,
    format: t.format,
  })),
  sectionSystemPrompt: SECTION_SYSTEM_PROMPT,

  approvalSystemPrompt: APPROVAL_SUMMARY_SYSTEM_PROMPT,

  deliverables: [
    {
      id: 'epic-stories',
      name: 'Epic & User Stories (Excel)',
      type: 'excel',
      description:
        'One epic plus a backlog of user stories with acceptance criteria, points and priority, as a styled workbook.',
    },
    {
      id: 'tickets',
      name: 'Work item hierarchy',
      type: 'tickets',
      description:
        'Epic / feature / story hierarchy ready to be pushed into Jira or Azure DevOps from the ticket workflow.',
    },
  ],

  outputFileName: 'requirement.md',
  docIdPrefix: 'REQ',
};
