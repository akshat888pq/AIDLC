import { DESIGN_SECTION_TEMPLATES } from './templates.js';

export interface DesignSectionContext {
  requirementContent: string;
  architectureContent: string;
  previousSections: Record<string, string>;
  userFeedback?: string;
  projectName: string;
  requirementId: string;
  architectureId: string;
  designId: string;
}

const BASE_INSTRUCTION = `You are a Senior Solution Designer working within the AIDLC (AI Delivery Lifecycle) framework.
You have been given an approved requirement document and an approved architecture document. Your job is to create a detailed solution design that a developer can implement directly.

CRITICAL RULES:
1. Every design decision must trace to a requirement AND an architecture component.
2. Be implementation-specific: name actual libraries, frameworks, patterns. "Use a caching layer" is too vague — "Use Redis with a 15-minute TTL for session data, accessed via ioredis client" is correct.
3. API designs must include complete request/response schemas with field types.
4. Database designs must include field types, constraints, and index justifications.
5. NEVER add features not in the requirements. You design what was specified, nothing more.
6. If the architecture left a decision open, make it in the design and document it clearly as: "DESIGN DECISION — not specified in architecture."
7. If information is insufficient to design a component, write: "INSUFFICIENT DETAIL — need [specific info] from [requirement/architecture] to complete this design."
8. Output ONLY the markdown content for this section — no preamble, no explanations, no wrapping.
9. Follow the exact template format provided.`;

export function getDesignSectionPrompt(sectionNumber: number, context: DesignSectionContext): string {
  const template = DESIGN_SECTION_TEMPLATES.find((t) => t.number === sectionNumber);
  if (!template) throw new Error(`Unknown design section number: ${sectionNumber}`);

  const previousSectionsText = Object.entries(context.previousSections)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([num, content]) => {
      const t = DESIGN_SECTION_TEMPLATES.find((s) => s.number === Number(num));
      return `--- APPROVED SECTION ${num}: ${t?.title || ''} ---\n${content}`;
    })
    .join('\n\n');

  let prompt = `${BASE_INSTRUCTION}

You are generating SECTION ${template.number}: "${template.title}"
${template.description}

EXPECTED FORMAT:
${template.format}

---

DESIGN ID: ${context.designId}
SOURCE REQUIREMENT: ${context.requirementId}
SOURCE ARCHITECTURE: ${context.architectureId}
PROJECT: ${context.projectName}

--- APPROVED REQUIREMENT DOCUMENT ---
${context.requirementContent}

--- APPROVED ARCHITECTURE DOCUMENT ---
${context.architectureContent}`;

  if (previousSectionsText) {
    prompt += `\n\n--- PREVIOUSLY APPROVED DESIGN SECTIONS (maintain consistency) ---\n${previousSectionsText}`;
  }

  if (context.userFeedback) {
    prompt += `\n\n--- REVIEWER FEEDBACK ---
The reviewer has requested the following changes to this section:
"${context.userFeedback}"

Regenerate the section incorporating this feedback. Address every point.`;
  }

  if (sectionNumber === 1) {
    prompt += `\n\nUse today's date (${new Date().toISOString().split('T')[0]}), design ID ${context.designId}, requirement ${context.requirementId}, and architecture ${context.architectureId}.`;
  } else if (sectionNumber === 3) {
    prompt += `\n\nIf the requirements and architecture indicate a backend/API-only system with no frontend, state: "No UI component — backend/API only system" and skip wireframe descriptions. Otherwise, be thorough with screen inventory and user flows.`;
  } else if (sectionNumber === 4) {
    prompt += `\n\nInclude complete request/response JSON schemas for every endpoint. Every endpoint must trace to a functional requirement (FR-XXX).`;
  } else if (sectionNumber === 5) {
    prompt += `\n\nInclude field types, constraints (NOT NULL, UNIQUE, FK), and justify every index. Use the database technology specified in the architecture document.`;
  } else if (sectionNumber === 10) {
    prompt += `\n\nEvery functional requirement (FR-XXX) from the requirement document must appear in the traceability matrix. Flag any requirement that is not covered by the design.`;
  }

  prompt += `\n\nGenerate ONLY the markdown content for Section ${sectionNumber}: "${template.title}". Do not include any text before or after the section content.`;

  return prompt;
}
