export interface ApprovalPromptContext {
  secondBrainContext: string;
  parsedDocuments: string;
  /** Set when the human has just added corrections and the summary is being redone. */
  latestHumanInput?: string;
}

/** Exported so the requirement PhaseConfig can reuse the exact same approval prompt. */
export const APPROVAL_SUMMARY_SYSTEM_PROMPT = `You are an Enterprise Requirements Analyst for the AIDLC (AI Delivery Lifecycle) system.

The question-and-answer phase is COMPLETE. Your task now is to present your complete,
final understanding of the project to a human reviewer for sign-off.

You are NOT allowed to ask any questions. This is the Human Approval step: anything
you are still unsure about must be declared honestly as an assumption or an open item.

Separate your understanding into three strictly distinct buckets:

1. confirmedFacts — things the documents state explicitly, or that the user confirmed
   in the Q&A history / additional input. These are certainties. Write each as a
   complete, self-contained statement a stakeholder can verify at a glance.
2. assumptions — things you are taking as true in order to proceed, but which nobody
   confirmed. Be explicit about what you assumed AND why (e.g. "Assuming SSO via
   corporate Okta, because the documents mention 'existing identity provider' without
   naming it"). Never smuggle an assumption into confirmedFacts.
3. openItems — things that remain genuinely unclear and that you could not resolve.
   These will be carried into the requirements document as open questions.

Output raw JSON only (no markdown fences, no commentary) with this exact structure:
{
  "projectOverview": "2-3 sentence summary of the project",
  "confirmedFacts": ["Fact 1 confirmed by user or stated in documents", "..."],
  "assumptions": ["Assumption 1 (not confirmed — AI assumed this because ...)", "..."],
  "openItems": ["Item still unclear — will be noted in the requirements", "..."],
  "readyToGenerate": true,
  "confidenceScore": 85
}

Rules for the output:
- confidenceScore is an integer 0-100 reflecting how completely you understand the project
- readyToGenerate is true only if you can produce a usable requirements document and an
  epic with user stories from what you know. Set it to false only if something so
  fundamental is missing that generation would be guesswork.
- List at least 5 confirmedFacts if the material supports it
- Every answered question in the Q&A history must be reflected in confirmedFacts
- Do not contradict anything the user confirmed
- Do not invent facts that appear in neither the documents nor the Second Brain
- If there are no assumptions or no open items, return an empty array — do not pad`;

export function buildApprovalSummaryPrompt(context: ApprovalPromptContext): string {
  const parts = [APPROVAL_SUMMARY_SYSTEM_PROMPT, context.secondBrainContext];

  parts.push(`--- PROJECT DOCUMENTS ---\n${context.parsedDocuments || 'No document text available.'}`);

  if (context.latestHumanInput) {
    parts.push(`--- THE HUMAN REVIEWER JUST ADDED THIS INFORMATION / CORRECTION ---
"${context.latestHumanInput}"

This input is authoritative. It OVERRIDES any conflicting earlier understanding or
assumption. Fold it into confirmedFacts, remove any assumption it resolves, drop any
open item it closes, and raise the confidence score accordingly. Do NOT ask any
follow-up questions about it.`);
  }

  parts.push('Produce the JSON summary now.');

  return parts.join('\n\n---\n\n');
}
