import { RELEASE_SECTION_TEMPLATES } from './templates.js';

export interface ReleaseSectionContext {
  requirementContent: string;
  architectureContent: string;
  designContent: string;
  testContent: string;
  previousSections: Record<string, string>;
  userFeedback?: string;
  projectName: string;
  requirementId: string;
  architectureId: string;
  designId: string;
  testId: string;
  releaseId: string;
}

const BASE_INSTRUCTION = `You are a Release Manager and Technical Writer working within the AIDLC (AI Delivery Lifecycle) framework.
You have been given approved requirement, architecture, solution design, and test plan documents. Your job is to create comprehensive release notes that communicate what was built, how to deploy it, and what to watch out for.

CRITICAL RULES:
1. Every feature and change MUST trace to a requirement (FR-XXX or NFR-XXX).
2. Write for multiple audiences: end users want plain English, developers want technical detail, ops wants deployment steps.
3. Breaking changes MUST include step-by-step migration instructions.
4. Deployment steps must be specific and ordered — "deploy the service" is too vague; "Run \`npm run migrate\` then \`docker-compose up -d api\`" is correct.
5. NEVER invent features not in the requirements. Only document what was specified and designed.
6. Known issues must include workarounds where possible.
7. The traceability section must show the complete chain: requirement → architecture → design → test → release item.
8. Output ONLY the markdown content for this section — no preamble, no explanations, no wrapping.
9. Follow the exact template format provided.`;

export function getReleaseSectionPrompt(sectionNumber: number, context: ReleaseSectionContext): string {
  const template = RELEASE_SECTION_TEMPLATES.find((t) => t.number === sectionNumber);
  if (!template) throw new Error(`Unknown release section number: ${sectionNumber}`);

  const previousSectionsText = Object.entries(context.previousSections)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([num, content]) => {
      const t = RELEASE_SECTION_TEMPLATES.find((s) => s.number === Number(num));
      return `--- APPROVED SECTION ${num}: ${t?.title || ''} ---\n${content}`;
    })
    .join('\n\n');

  let prompt = `${BASE_INSTRUCTION}

You are generating SECTION ${template.number}: "${template.title}"
${template.description}

EXPECTED FORMAT:
${template.format}

---

RELEASE NOTES ID: ${context.releaseId}
SOURCE REQUIREMENT: ${context.requirementId}
SOURCE ARCHITECTURE: ${context.architectureId}
SOURCE DESIGN: ${context.designId}
SOURCE TEST PLAN: ${context.testId}
PROJECT: ${context.projectName}

--- APPROVED REQUIREMENT DOCUMENT ---
${context.requirementContent}

--- APPROVED ARCHITECTURE DOCUMENT ---
${context.architectureContent}

--- APPROVED SOLUTION DESIGN DOCUMENT ---
${context.designContent}

--- APPROVED TEST PLAN DOCUMENT ---
${context.testContent}`;

  if (previousSectionsText) {
    prompt += `\n\n--- PREVIOUSLY APPROVED RELEASE SECTIONS (maintain consistency) ---\n${previousSectionsText}`;
  }

  if (context.userFeedback) {
    prompt += `\n\n--- REVIEWER FEEDBACK ---
The reviewer has requested the following changes to this section:
"${context.userFeedback}"

Regenerate the section incorporating this feedback. Address every point.`;
  }

  if (sectionNumber === 1) {
    prompt += `\n\nUse today's date (${new Date().toISOString().split('T')[0]}), release notes ID ${context.releaseId}, requirement ${context.requirementId}, architecture ${context.architectureId}, design ${context.designId}, and test plan ${context.testId}. Determine the release type (Major/Minor/Patch) based on the scope of changes in the requirement.`;
  } else if (sectionNumber === 3) {
    prompt += `\n\nExtract every functional requirement from the requirement document and categorize each as a New Feature, Enhancement, or Bug Fix. Every FR-XXX must appear in one of these tables. If the requirement document contains no bug fixes, state: "No bug fixes in this release."`;
  } else if (sectionNumber === 4) {
    prompt += `\n\nDerive deployment steps from the architecture (infrastructure section) and design (component design). Include specific commands where the technology stack is known. The rollback plan must be realistic and tested.`;
  } else if (sectionNumber === 6) {
    prompt += `\n\nThis is the most critical section. Build the complete traceability chain: every requirement → its architecture component → its design section → its test cases → its release item. Flag any gaps in the chain. Calculate coverage percentages.`;
  }

  prompt += `\n\nGenerate ONLY the markdown content for Section ${sectionNumber}: "${template.title}". Do not include any text before or after the section content.`;

  return prompt;
}
