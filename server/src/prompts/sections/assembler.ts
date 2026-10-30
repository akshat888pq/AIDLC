import type { RequirementDoc } from '../../types/index.js';
import { SECTION_TEMPLATES } from './templates.js';

export function assembleRequirement(doc: RequirementDoc): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`requirement_id: ${doc.id}`);
  lines.push(`generated_by: AIDLC v1.0`);
  lines.push(`generated_date: ${doc.generatedDate}`);
  lines.push(`status: ${doc.status}`);
  lines.push(`source_documents: [${doc.sourceDocuments.map((d) => `"${d}"`).join(', ')}]`);
  lines.push(`linked_tickets: [${doc.linkedTickets.map((t) => `"${t}"`).join(', ')}]`);
  lines.push(`confidence_score: ${doc.confidenceScore}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${doc.projectName} — Requirement Document`);
  lines.push('');

  for (const template of SECTION_TEMPLATES) {
    const section = doc.sections.find((s) => s.number === template.number);
    if (section && section.content && section.status === 'approved') {
      lines.push(section.content);
    } else if (section && section.content) {
      lines.push(`<!-- Section ${template.number} status: ${section?.status || 'pending'} -->`);
      lines.push(section.content);
    } else {
      lines.push(`## ${template.number}. ${template.title}`);
      lines.push('');
      lines.push('_Section not yet generated._');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}
