import { ARCH_SECTION_TEMPLATES } from './templates.js';

export interface ArchSectionContext {
  requirementContent: string;
  previousSections: Record<string, string>;
  userFeedback?: string;
  projectName: string;
  requirementId: string;
  architectureId: string;
}

export const ARCH_SECTION_SYSTEM_PROMPT = `You are an Enterprise Solution Architect working within the AIDLC (AI Delivery Lifecycle) framework.
You have been given an approved requirement document. Your job is to design the technical architecture that fulfills these requirements.

CRITICAL RULES:
1. Every architecture decision MUST trace back to a specific requirement in the source document.
2. If a requirement is ambiguous, note the ambiguity and state your assumption clearly.
3. NEVER add requirements that don't exist in the source — you architect solutions, you don't create scope.
4. Be specific — name actual technologies, services, and patterns. Don't say "a suitable database" — say "PostgreSQL on Amazon RDS" and explain why.
5. If the requirement doesn't specify NFRs (performance, security, etc.), flag this as a gap and provide sensible defaults with clear labeling: "DEFAULT — not specified in requirements."
6. Generate Architecture Decision Records (ADRs) for every significant choice.
7. Output ONLY the markdown content for this section — no preamble, no explanations, no wrapping.
8. Follow the exact template format provided.
9. Use professional, precise language suitable for an enterprise architecture document.`;

export function getArchSectionPrompt(sectionNumber: number, context: ArchSectionContext): string {
  const template = ARCH_SECTION_TEMPLATES.find((t) => t.number === sectionNumber);
  if (!template) throw new Error(`Unknown architecture section number: ${sectionNumber}`);

  const previousSectionsText = Object.entries(context.previousSections)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([num, content]) => {
      const t = ARCH_SECTION_TEMPLATES.find((s) => s.number === Number(num));
      return `--- APPROVED SECTION ${num}: ${t?.title || ''} ---\n${content}`;
    })
    .join('\n\n');

  let prompt = `${ARCH_SECTION_SYSTEM_PROMPT}

You are generating SECTION ${template.number}: "${template.title}"
${template.description}

EXPECTED FORMAT:
${template.format}

---

ARCHITECTURE ID: ${context.architectureId}
SOURCE REQUIREMENT: ${context.requirementId}
PROJECT: ${context.projectName}

--- APPROVED REQUIREMENT DOCUMENT (source of truth) ---
${context.requirementContent}`;

  if (previousSectionsText) {
    prompt += `\n\n--- PREVIOUSLY APPROVED ARCHITECTURE SECTIONS (maintain consistency) ---\n${previousSectionsText}`;
  }

  if (context.userFeedback) {
    prompt += `\n\n--- REVIEWER FEEDBACK ---
The reviewer has requested the following changes to this section:
"${context.userFeedback}"

Regenerate the section incorporating this feedback while keeping all decisions consistent with the requirement document. Address every point in the feedback.`;
  }

  if (sectionNumber === 1) {
    prompt += `\n\nFor the Architecture Information table, use today's date (${new Date().toISOString().split('T')[0]}), the architecture ID ${context.architectureId}, and reference requirement ${context.requirementId}.`;
  } else if (sectionNumber === 4) {
    prompt += `\n\nBe specific about component boundaries. Each component should have a single clear responsibility. Name actual technologies for each component.`;
  } else if (sectionNumber === 8) {
    prompt += `\n\nIf the requirement document does not include security NFRs, explicitly flag this: "DEFAULT — no security requirements specified in ${context.requirementId}. Recommend adding security requirements before finalizing architecture." Then provide sensible enterprise defaults.`;
  } else if (sectionNumber === 9) {
    prompt += `\n\nFor each NFR in the requirement document, create an explicit mapping to an architecture decision. If NFRs are absent from the requirement, note: "DEFAULT — NFRs not specified in ${context.requirementId}. The following are sensible defaults." and provide industry-standard defaults.`;
  } else if (sectionNumber === 12) {
    prompt += `\n\nGenerate 3-5 ADRs covering the most significant architecture choices made in previous sections. Each ADR must reference the requirement that drove the decision.`;
  } else if (sectionNumber === 13) {
    prompt += `\n\nCreate a complete traceability matrix linking functional requirements (FR-xxx) and non-functional requirements to the architecture components and sections that address them.`;
  }

  prompt += `\n\nGenerate ONLY the markdown content for Section ${sectionNumber}: "${template.title}". Do not include any text before or after the section content.`;

  return prompt;
}
