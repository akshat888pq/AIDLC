import { TEST_SECTION_TEMPLATES } from './templates.js';

export interface TestSectionContext {
  requirementContent: string;
  architectureContent: string;
  designContent: string;
  previousSections: Record<string, string>;
  userFeedback?: string;
  projectName: string;
  requirementId: string;
  architectureId: string;
  designId: string;
  testId: string;
}

const BASE_INSTRUCTION = `You are a Senior QA Engineer and Test Architect working within the AIDLC (AI Delivery Lifecycle) framework.
You have been given approved requirement, architecture, and solution design documents. Your job is to create a comprehensive test plan that ensures every requirement is verified.

CRITICAL RULES:
1. Every test case MUST link to a specific requirement (FR-XXX or NFR-XXX).
2. Every functional requirement MUST have at least one test case. If a requirement has no test, flag it explicitly.
3. Use Given/When/Then format for all test cases.
4. Be specific about test data: "a valid user" is too vague — "user with email test@example.com, role: admin, status: active" is correct.
5. Include negative test cases for every positive test case: what happens when input is invalid, unauthorized, missing, or malformed?
6. NEVER invent requirements to test. Only test what's in the requirement document.
7. Performance test targets must come from NFRs. If none exist, flag the gap and provide sensible defaults labeled: "DEFAULT TARGET — not specified in requirements."
8. Security test cases must cover OWASP Top 10 at minimum.
9. The traceability matrix is non-negotiable — every requirement must appear, every test must link back.
10. Output ONLY the markdown content for this section — no preamble, no explanations, no wrapping.
11. Follow the exact template format provided.`;

export function getTestSectionPrompt(sectionNumber: number, context: TestSectionContext): string {
  const template = TEST_SECTION_TEMPLATES.find((t) => t.number === sectionNumber);
  if (!template) throw new Error(`Unknown test section number: ${sectionNumber}`);

  const previousSectionsText = Object.entries(context.previousSections)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([num, content]) => {
      const t = TEST_SECTION_TEMPLATES.find((s) => s.number === Number(num));
      return `--- APPROVED SECTION ${num}: ${t?.title || ''} ---\n${content}`;
    })
    .join('\n\n');

  let prompt = `${BASE_INSTRUCTION}

You are generating SECTION ${template.number}: "${template.title}"
${template.description}

EXPECTED FORMAT:
${template.format}

---

TEST PLAN ID: ${context.testId}
SOURCE REQUIREMENT: ${context.requirementId}
SOURCE ARCHITECTURE: ${context.architectureId}
SOURCE DESIGN: ${context.designId}
PROJECT: ${context.projectName}

--- APPROVED REQUIREMENT DOCUMENT ---
${context.requirementContent}

--- APPROVED ARCHITECTURE DOCUMENT ---
${context.architectureContent}

--- APPROVED SOLUTION DESIGN DOCUMENT ---
${context.designContent}`;

  if (previousSectionsText) {
    prompt += `\n\n--- PREVIOUSLY APPROVED TEST SECTIONS (maintain consistency) ---\n${previousSectionsText}`;
  }

  if (context.userFeedback) {
    prompt += `\n\n--- REVIEWER FEEDBACK ---
The reviewer has requested the following changes to this section:
"${context.userFeedback}"

Regenerate the section incorporating this feedback. Address every point.`;
  }

  if (sectionNumber === 1) {
    prompt += `\n\nUse today's date (${new Date().toISOString().split('T')[0]}), test plan ID ${context.testId}, requirement ${context.requirementId}, architecture ${context.architectureId}, and design ${context.designId}.`;
  } else if (sectionNumber === 3) {
    prompt += `\n\nGenerate unit test cases for EVERY component/module from the design document. Every functional requirement (FR-XXX) must have at least one unit test. Include both positive and negative cases.`;
  } else if (sectionNumber === 6) {
    prompt += `\n\nIf the requirement document does not include performance NFRs, explicitly note: "DEFAULT TARGET — no performance requirements specified in ${context.requirementId}." Then provide sensible default performance test cases.`;
  } else if (sectionNumber === 7) {
    prompt += `\n\nYou MUST cover all OWASP Top 10 2021 categories. For each category, create at least one test case even if the security architecture is minimal.`;
  } else if (sectionNumber === 8) {
    prompt += `\n\nThis is the most critical section. EVERY functional requirement and NFR must appear in the traceability matrix. Flag any requirement with zero test coverage. Flag any test case with no requirement link. Calculate coverage percentages.`;
  }

  prompt += `\n\nGenerate ONLY the markdown content for Section ${sectionNumber}: "${template.title}". Do not include any text before or after the section content.`;

  return prompt;
}
