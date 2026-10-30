import type { PhaseConfig, PhaseSection } from '../phaseConfig.js';
import { MAX_QUESTION_CYCLES } from '../../services/secondBrain.js';

/**
 * Prompt construction for any phase.
 *
 * Everything phase-specific comes from the PhaseConfig; everything structural —
 * the JSON contract, the cycle budget rules, the "here is what the previous phase
 * handed you" framing — lives here, so a new phase inherits it for free.
 */

/** The response shape the engine parses. Appended unless the config already states it. */
const ANALYSIS_JSON_CONTRACT = `Output your response as JSON (no markdown fences, just raw JSON) with this exact structure:
{
  "projectName": "A short project name, 2-6 words, as a human would title it. Not a sentence.",
  "understanding": {
    "projectOverview": "Your 2-3 sentence summary of what this phase is working on",
    "businessObjective": "What this phase must achieve",
    "scope": {
      "inScope": ["what this phase clearly covers"],
      "outOfScope": ["what it clearly does not"],
      "unclear": ["where the boundary is ambiguous"]
    },
    "stakeholders": ["roles involved in this phase"],
    "timeline": "identified timeline or 'NOT FOUND in the source material'",
    "techStack": "identified technology or 'NOT FOUND in the source material'",
    "deliverables": ["what this phase will produce"],
    "constraints": ["constraints that bind this phase"],
    "assumptions": ["things you had to assume because they were not stated"],
    "risks": ["risks you identified"],
    "dependencies": ["dependencies mentioned or implied"]
  },
  "confidenceScore": 0-100,
  "questions": [
    {
      "id": "Q1",
      "category": "scope|timeline|technical|stakeholder|budget|risk|requirement|other",
      "question": "The specific question",
      "context": "Why this question matters — what gap it fills",
      "priority": "critical|important|nice-to-have",
      "answerType": "text|single-select|multi-select",
      "options": ["option1", "option2"]
    }
  ]
}

IMPORTANT RULES:
- If something has NO information in the source material, say "NOT FOUND in the source material" — do not guess
- Every question must reference what triggered the uncertainty
- Questions marked "critical" MUST be answered before proceeding
- For single-select and multi-select questions, provide clear, distinct options
- Respond ONLY with the JSON object, no additional text`;

function cycleRules(config: PhaseConfig, cycleNumber: number): string {
  if (cycleNumber <= 1) {
    return `CRITICAL RULE: This is question cycle 1 of maximum ${MAX_QUESTION_CYCLES}.

Ask ALL your questions NOW in a single batch — Critical AND Important together.
Be comprehensive: every doubt you have that this phase cannot resolve on its own
must be raised in this batch. Prioritize ruthlessly and ask a MAXIMUM OF
${config.maxQuestionsRound1} QUESTIONS.
You will get a maximum of ONE more chance to ask questions, and only if your
confidence after these answers is still below 70%. Anything you fail to ask now you
will have to proceed without.

Set "priority" to "critical" or "important" only — do not spend a question slot on a
"nice-to-have".`;
  }

  if (cycleNumber === 2) {
    return `CRITICAL RULE: This is question cycle 2 of maximum ${MAX_QUESTION_CYCLES} — your FINAL question cycle.

The user has already answered your first batch (see the Second Brain above).
Ask ONLY the most critical remaining questions. MAXIMUM ${config.maxQuestionsRound2} QUESTIONS.
Do NOT re-ask, rephrase, or split any question already answered — in this phase or in
any earlier phase.
After this cycle you must proceed with what you know: anything still unclear must be
recorded in "assumptions" or scope."unclear", NOT asked as a question.`;
  }

  return `CRITICAL RULE: The maximum of ${MAX_QUESTION_CYCLES} question cycles has been REACHED.

DO NOT generate any questions. Return "questions": [] exactly.
Produce your best final understanding from the source material, the Second Brains and
the human's additional input. Anything still unclear goes into "assumptions" or
scope."unclear". The phase now moves to the Human Approval step.`;
}

export interface PhaseAnalysisPromptContext {
  config: PhaseConfig;
  cycleNumber: number;
  /** Combined second brain block for this phase and every phase before it. */
  fullContextBlock: string;
  /** Flattened Q&A from previous cycles of this phase. */
  previousAnswers?: string;
  /** Name of the phase this one inherits from, for framing. */
  previousPhaseName?: string;
}

export function buildPhaseAnalysisPrompt(ctx: PhaseAnalysisPromptContext): string {
  const parts: string[] = [ctx.config.questionSystemPrompt];

  // A config that already specifies its own JSON contract (the requirement phase
  // does) must not be given a second, conflicting one.
  if (!ctx.config.questionSystemPrompt.includes('"confidenceScore"')) {
    parts.push(ANALYSIS_JSON_CONTRACT);
  }

  if (ctx.fullContextBlock) parts.push(ctx.fullContextBlock);

  if (ctx.previousPhaseName) {
    parts.push(`The material below was produced and APPROVED in the ${ctx.previousPhaseName} phase.
It is your input, not your subject matter for debate. Do not question decisions it has
already settled; question only what you need in order to do this phase's own work.`);
  }

  parts.push(cycleRules(ctx.config, ctx.cycleNumber));

  if (ctx.previousAnswers) {
    parts.push(`The following questions have ALREADY been asked and answered in this phase. DO NOT ask
any of these again, in any form:
${ctx.previousAnswers}

Re-analyze the source material incorporating these answers. Update your understanding
and adjust the confidence score to reflect what you now know.`);
  }

  return parts.join('\n\n---\n\n');
}

export interface PhaseApprovalPromptContext {
  config: PhaseConfig;
  fullContextBlock: string;
  sourceMaterial: string;
  latestHumanInput?: string;
}

export function buildPhaseApprovalPrompt(ctx: PhaseApprovalPromptContext): string {
  const parts = [ctx.config.approvalSystemPrompt, ctx.fullContextBlock];

  parts.push(`--- SOURCE MATERIAL FOR THIS PHASE ---\n${ctx.sourceMaterial || 'No source material available.'}`);

  if (ctx.latestHumanInput) {
    parts.push(`--- THE HUMAN REVIEWER JUST ADDED THIS INFORMATION / CORRECTION ---
"${ctx.latestHumanInput}"

This input is authoritative. It OVERRIDES any conflicting earlier understanding or
assumption. Fold it into confirmedFacts, remove any assumption it resolves, drop any
open item it closes, and raise the confidence score accordingly. Do NOT ask any
follow-up questions about it.`);
  }

  parts.push('Produce the JSON summary now.');
  return parts.join('\n\n---\n\n');
}

export interface PhaseSectionPromptContext {
  config: PhaseConfig;
  section: PhaseSection;
  /** Combined second brain block for this phase and every phase before it. */
  fullContextBlock: string;
  /** The approved output of the previous phase — the source of truth to build on. */
  previousPhaseDocument?: string;
  /** Approved outputs of the phases before that one, oldest first. */
  earlierPhaseDocuments?: { phaseName: string; documentId?: string; markdown: string }[];
  previousPhaseName?: string;
  previousPhaseDocumentId?: string;
  /** Already-approved sections of THIS phase's document, keyed by section number. */
  previousSections: Record<string, string>;
  qnaAnswers?: string;
  userFeedback?: string;
  documentId: string;
  projectName: string;
  confidenceScore: number;
}

export function buildPhaseSectionPrompt(ctx: PhaseSectionPromptContext): string {
  const { config, section } = ctx;

  const previousSectionsText = Object.entries(ctx.previousSections)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([num, content]) => {
      const t = config.sections.find((s) => s.number === Number(num));
      return `--- APPROVED SECTION ${num}: ${t?.title || ''} ---\n${content}`;
    })
    .join('\n\n');

  let prompt = `${config.sectionSystemPrompt}
${ctx.fullContextBlock ? `\n---\n\n${ctx.fullContextBlock}\n\n---\n` : ''}
You are generating SECTION ${section.number}: "${section.title}"
${section.description}

EXPECTED FORMAT:
${section.format}

---

DOCUMENT ID: ${ctx.documentId}
PROJECT: ${ctx.projectName}
CONFIDENCE SCORE: ${ctx.confidenceScore}%`;

  if (ctx.previousPhaseDocumentId) {
    prompt += `\nSOURCE ${(ctx.previousPhaseName ?? 'previous phase').toUpperCase()} DOCUMENT: ${ctx.previousPhaseDocumentId}`;
  }

  for (const earlier of ctx.earlierPhaseDocuments ?? []) {
    prompt += `\n\n--- APPROVED ${earlier.phaseName.toUpperCase()} DOCUMENT${
      earlier.documentId ? ` (${earlier.documentId})` : ''
    } (source of truth) ---\n${earlier.markdown}`;
  }

  if (ctx.previousPhaseDocument) {
    prompt += `\n\n--- APPROVED ${(ctx.previousPhaseName ?? 'PREVIOUS PHASE').toUpperCase()} DOCUMENT (source of truth) ---\n${ctx.previousPhaseDocument}`;
  }

  if (ctx.qnaAnswers) {
    prompt += `\n\n--- THIS PHASE'S Q&A ANSWERS ---\n${ctx.qnaAnswers}`;
  }

  if (previousSectionsText) {
    prompt += `\n\n--- PREVIOUSLY APPROVED SECTIONS OF THIS DOCUMENT (maintain consistency) ---\n${previousSectionsText}`;
  }

  if (ctx.userFeedback) {
    prompt += `\n\n--- REVIEWER FEEDBACK ---
The reviewer has requested the following changes to this section:
"${ctx.userFeedback}"

Regenerate the section incorporating this feedback while keeping every fact traceable
to the source material. Address every point in the feedback.`;
  }

  const extra = sectionSpecificInstruction(config, section, ctx);
  if (extra) prompt += `\n\n${extra}`;

  prompt += `\n\nGenerate ONLY the markdown content for Section ${section.number}: "${section.title}". Do not include any text before or after the section content.`;

  return prompt;
}

/**
 * Per-section nudges that used to live in the hand-written section prompt modules.
 * Keyed by section *key* rather than number so a config can reorder its sections
 * without silently attaching the wrong instruction to the wrong section.
 */
function sectionSpecificInstruction(
  config: PhaseConfig,
  section: PhaseSection,
  ctx: PhaseSectionPromptContext
): string | null {
  const today = new Date().toISOString().split('T')[0];
  const sourceRef = ctx.previousPhaseDocumentId ?? 'the source document';

  switch (section.key) {
    // ── Shared: every phase's first section is its metadata table ──
    case 'architecture_info':
    case 'requirement_info':
      return `For the information table, use today's date (${today}) and the document ID ${ctx.documentId}${
        ctx.previousPhaseDocumentId ? `, and reference ${ctx.previousPhaseDocumentId}` : ''
      }. Infer priority from the context. The owner role for this phase is "${config.roleOwner}".`;

    // ── Architecture ──
    case 'component_architecture':
      return 'Be specific about component boundaries. Each component must have a single clear responsibility and a named technology. State, for each component, the requirement it exists to satisfy.';
    case 'security_architecture':
      return `If the source document does not include security NFRs, explicitly flag this: "DEFAULT — no security requirements specified in ${sourceRef}. Recommend adding security requirements before finalizing the architecture." Then provide sensible enterprise defaults, each labelled as a default.`;
    case 'nfr_mapping':
      return `For each NFR in the source document, create an explicit mapping to an architecture decision. If NFRs are absent, note: "DEFAULT — NFRs not specified in ${sourceRef}. The following are sensible defaults." and provide industry-standard defaults.`;
    case 'adrs':
      return 'Generate 3-5 ADRs covering the most significant architecture choices made in the previous sections. Each ADR must name the requirement that drove the decision, the options considered, and the consequences accepted.';

    // ── UX/UI Design ──
    case 'design_package_overview': {
      const reqId = ctx.earlierPhaseDocuments?.find((d) => d.documentId?.startsWith('REQ'))?.documentId;
      return `Use today's date (${today}) and the package ID ${ctx.documentId}. Linked requirement: ${
        reqId ?? 'the REQ id in the approved requirement document'
      }. Linked architecture: ${sourceRef}. The owner is "${config.roleOwner}". Name the design system and justify it from the architecture's frontend stack — if it is React + Tailwind, the choice is ShadCN/ui (the UX team's standard); cite the ADR or section that fixes the stack.`;
    }
    case 'user_personas':
      return 'Generate 2-4 personas ONLY for user types or stakeholders the requirement document names. For each, cite where in the requirement it comes from. Key tasks must cite FR ids. Do not invent demographic trivia; keep goals and frustrations grounded in the requirement and the Q&A.';
    case 'information_architecture':
      return 'List EVERY screen the requirements need, with a stable SCR-00n id, grouped by module. Include the "3.5 Navigation Map" Mermaid flowchart covering every screen, grouped into subgraphs by module, with user actions as quoted edge labels. Finish with the coverage-gap table: list every FR id from the requirement document that has no screen (or state that none are missing).';
    case 'user_flows':
      return 'Pick the 5-7 most critical journeys from the requirements. Each flow must start and end at a screen id from Section 3 and include its own ```mermaid flowchart TD``` block: happy-path nodes styled with the "happy" class (green) and error nodes with the "error" class (red), using classDef exactly as in the format. Decision nodes use {"..."}.';
    case 'wireframes':
      return 'Produce a wireframe for EVERY screen in the Section 3 inventory, in SCR id order, using the "#### SCR-00n: Name" heading exactly (the image renderer finds screens by it). Draw the layout with box-drawing characters inside a ``` block. Regions are stacked or placed in columns — describe proportions (e.g. "sidebar 16rem, main flexible"), never pixel coordinates.';
    case 'design_system':
      return 'Every token must be a concrete value: hex for colours, px AND rem for sizes, numeric weights, ms for durations. Use the brand colours confirmed in the Q&A; where none were given, use the defaults in the format and flag them as "DEFAULT — brand colour not supplied". State the contrast ratio of each text colour on its background. Map every token to its Tailwind class or ShadCN CSS variable.';
    case 'screen_definitions':
      return 'Produce a definition for EVERY screen in the Section 3 inventory, in SCR id order, using the "#### SCR-00n: Name" heading exactly. Each must name its FR ids, the architecture API/component each data call comes from (or "TBD in Developer Handoff"), and the design-system components from Section 6. Loading, empty and error states are mandatory for every screen that loads data.';
    case 'design_traceability':
      return `Build the matrix from Sections 2-7 only — every SCR id, UF id and P id must already exist there. Link architecture components by the names used in ${sourceRef}. Run all four coverage checks honestly and list real gaps; do not declare a pass you have not verified against the requirement document's FR list.`;

    // ── Requirement ──
    case 'functional_requirements':
      return 'Generate unique IDs (FR-001, FR-002, …) for each functional requirement. Include a user story for each. Prioritize using MoSCoW. Reference the source for each requirement.';
    case 'acceptance_criteria':
      return 'Use STRICT Given/When/Then format. Generate unique IDs (AC-001, AC-002, …). Each functional requirement should have at least one acceptance criterion.';
    case 'open_questions':
      return 'This section should be as short as possible if the Q&A was thorough. Only include genuinely unresolved items, including any question the user skipped.';

    // ── Shared: the last section of every phase ties back to its inputs ──
    case 'traceability':
      return `Create a complete traceability matrix linking this document's content back to ${sourceRef} — requirement IDs, story IDs and section numbers — and forward to the artifacts the next phase will produce. Do not invent IDs that do not appear in the source material.`;

    default:
      return null;
  }
}
