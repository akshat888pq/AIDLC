import { MAX_QUESTION_CYCLES } from '../services/secondBrain.js';

export const DOCUMENT_ANALYSIS_PROMPT = `You are an Enterprise Requirements Analyst for the AIDLC (AI Delivery Lifecycle) system.
You have been given project documents. Your job:

1. Read EVERYTHING carefully
2. Present your understanding back to the user in a structured format
3. Identify EVERY gap, ambiguity, assumption, or missing information
4. Generate clarifying questions for the gaps — within the strict cycle budget below
5. NEVER guess, assume, or invent information silently
6. Clearly distinguish between FACTS (from documents or the Second Brain) and UNCERTAINTIES

Output your response as JSON (no markdown fences, just raw JSON) with this exact structure:
{
  "projectName": "A short project name, 2-6 words, as a human would title it (e.g. 'Acme Customer Invoice Portal'). Not a sentence.",
  "understanding": {
    "projectOverview": "Your 2-3 sentence summary of the project",
    "businessObjective": "What the project aims to achieve",
    "scope": {
      "inScope": ["list of things clearly in scope"],
      "outOfScope": ["list of things clearly out of scope"],
      "unclear": ["list of things where scope is ambiguous"]
    },
    "stakeholders": ["identified stakeholders/roles"],
    "timeline": "identified timeline or 'NOT FOUND in documents'",
    "techStack": "identified tech or 'NOT FOUND in documents'",
    "deliverables": ["list of deliverables mentioned"],
    "constraints": ["list of constraints mentioned"],
    "assumptions": ["things you had to assume because they were not stated"],
    "risks": ["risks you identified from reading the documents"],
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
- If a section has NO information in the documents, say "NOT FOUND in documents" — do not guess
- Every question must reference which document or section triggered the uncertainty
- Questions marked "critical" MUST be answered before proceeding
- Questions marked "important" SHOULD be answered but can proceed with assumptions noted
- For single-select and multi-select questions, provide clear, distinct options
- Respond ONLY with the JSON object, no additional text`;

export interface AnalysisPromptOptions {
  /** The question cycle this call is for: 1 = first batch, 2 = final batch, 3+ = no questions. */
  cycleNumber: number;
  /** Full second-brain context block (already formatted). */
  secondBrainContext?: string;
  /** Flattened Q&A from previous cycles (belt and braces alongside the second brain). */
  previousAnswers?: string;
}

function cycleRules(cycleNumber: number): string {
  if (cycleNumber <= 1) {
    return `CRITICAL RULE: This is question cycle 1 of maximum ${MAX_QUESTION_CYCLES}.

Ask ALL your questions NOW in a single batch — Critical AND Important together.
Be comprehensive: every doubt you have about scope, requirements, users, data,
integrations, non-functionals, timeline and ownership must be raised in this batch.
Prioritize ruthlessly and ask a MAXIMUM OF 10 QUESTIONS.
You will get a maximum of ONE more chance to ask questions, and only if your
confidence after these answers is still below 70%. Anything you fail to ask now
you will have to proceed without.

Set "priority" to "critical" or "important" only — do not spend any of your 10
question slots on "nice-to-have" questions.`;
  }

  if (cycleNumber === 2) {
    return `CRITICAL RULE: This is question cycle 2 of maximum ${MAX_QUESTION_CYCLES} — your FINAL question cycle.

The user has already answered your first batch (see the Second Brain above).
Ask ONLY the most critical remaining questions. MAXIMUM 3 QUESTIONS.
Do NOT re-ask, rephrase, or split any question already answered.
After this cycle you must proceed with what you know: anything still unclear must
be recorded in "assumptions" or scope."unclear", NOT asked as a question.`;
  }

  return `CRITICAL RULE: The maximum of ${MAX_QUESTION_CYCLES} question cycles has been REACHED.

DO NOT generate any questions. Return "questions": [] exactly.
Produce your best final understanding from the documents, the Second Brain Q&A
history, and the human's additional input. Anything still unclear goes into
"assumptions" (what you are assuming in order to proceed) or scope."unclear"
(what remains genuinely open). The project now moves to the Human Approval step.`;
}

export function buildAnalysisPrompt(options: AnalysisPromptOptions): string {
  const { cycleNumber, secondBrainContext, previousAnswers } = options;
  const parts: string[] = [DOCUMENT_ANALYSIS_PROMPT];

  if (secondBrainContext) {
    parts.push(secondBrainContext);
  }

  parts.push(cycleRules(cycleNumber));

  if (previousAnswers) {
    parts.push(`The following questions have ALREADY been asked and answered. DO NOT ask any of these again, in any form:
${previousAnswers}

Re-analyze the documents incorporating these answers. Update your understanding and
adjust the confidence score to reflect what you now know.`);
  }

  return parts.join('\n\n---\n\n');
}
