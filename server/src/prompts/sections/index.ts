import { SECTION_TEMPLATES } from './templates.js';

export interface SectionContext {
  parsedDocuments: string;
  qnaAnswers: string;
  /** Full second-brain.md context block — the project's single source of truth. */
  secondBrainContext?: string;
  ticketData?: string;
  previousSections: Record<string, string>;
  userFeedback?: string;
  sourceFileNames: string[];
  linkedTicketIds: string[];
  requirementId: string;
  confidenceScore: number;
}

/** Exported so the requirement PhaseConfig can reuse the exact same section prompt. */
export const SECTION_SYSTEM_PROMPT = `You are an Enterprise Requirements Analyst generating a formal requirement document for the AIDLC (AI Delivery Lifecycle) system.

CRITICAL RULES:
1. Use ONLY facts from the provided context (documents, Q&A answers, ticket data)
2. NEVER invent, guess, or assume information that is not in the context
3. If information for any field is not available, write "Information not available — requires clarification from [Business Owner / Technical Lead / Stakeholder]"
4. Every statement must be traceable to source documents or Q&A answers
5. Output ONLY the markdown content for this section — no preamble, no explanations, no wrapping
6. Follow the exact template format provided
7. Use professional, precise language suitable for an enterprise requirement document`;

export function getSectionPrompt(sectionNumber: number, context: SectionContext): string {
  const template = SECTION_TEMPLATES.find((t) => t.number === sectionNumber);
  if (!template) throw new Error(`Unknown section number: ${sectionNumber}`);

  const previousSectionsText = Object.entries(context.previousSections)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([num, content]) => {
      const t = SECTION_TEMPLATES.find((s) => s.number === Number(num));
      return `--- APPROVED SECTION ${num}: ${t?.title || ''} ---\n${content}`;
    })
    .join('\n\n');

  let prompt = `${SECTION_SYSTEM_PROMPT}
${context.secondBrainContext ? `\n---\n\n${context.secondBrainContext}\n\n---\n` : ''}
You are generating SECTION ${template.number}: "${template.title}"
${template.description}

EXPECTED FORMAT:
${template.format}

---

REQUIREMENT ID: ${context.requirementId}
CONFIDENCE SCORE: ${context.confidenceScore}%
SOURCE DOCUMENTS: ${context.sourceFileNames.join(', ') || 'None'}
LINKED TICKETS: ${context.linkedTicketIds.join(', ') || 'None'}

--- PROJECT DOCUMENTS ---
${context.parsedDocuments}

--- Q&A ANSWERS ---
${context.qnaAnswers || 'No Q&A answers available.'}`;

  if (context.ticketData) {
    prompt += `\n\n--- TICKET DATA ---\n${context.ticketData}`;
  }

  if (previousSectionsText) {
    prompt += `\n\n--- PREVIOUSLY APPROVED SECTIONS (maintain consistency with these) ---\n${previousSectionsText}`;
  }

  if (context.userFeedback) {
    prompt += `\n\n--- REVIEWER FEEDBACK ---
The reviewer has requested the following changes to this section:
"${context.userFeedback}"

Regenerate the section incorporating this feedback while keeping all factual content from the source documents. Address every point in the feedback.`;
  }

  // Section-specific instructions
  if (sectionNumber === 1) {
    prompt += `\n\nFor the Requirement Information table, use today's date (${new Date().toISOString().split('T')[0]}) and the requirement ID ${context.requirementId}. Infer priority from the context.`;
  } else if (sectionNumber === 6) {
    prompt += `\n\nGenerate unique IDs (FR-001, FR-002, etc.) for each functional requirement. Include a user story for each. Prioritize using MoSCoW (Must Have, Should Have, Could Have, Won't Have). Reference the source document for each requirement.`;
  } else if (sectionNumber === 10) {
    prompt += `\n\nUse STRICT Given/When/Then format. Generate unique IDs (AC-001, AC-002, etc.). Each functional requirement from Section 6 should have at least one acceptance criterion.`;
  } else if (sectionNumber === 14) {
    prompt += `\n\nThis section should be as empty as possible if the Q&A was thorough. Only include genuinely unresolved questions. For any Q&A questions that were skipped or had insufficient answers, include them here.`;
  } else if (sectionNumber === 15) {
    prompt += `\n\nInclude all source documents from the upload. If tickets were created in Phase 2, include their IDs and URLs. Mark related artifacts as "Not Started" unless evidence shows otherwise.`;
  }

  prompt += `\n\nGenerate ONLY the markdown content for Section ${sectionNumber}: "${template.title}". Do not include any text before or after the section content.`;

  return prompt;
}
