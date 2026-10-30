import { Router } from 'express';
import { loadSession } from '../state.js';

const router = Router();

router.get('/:sessionId/questions', (req, res) => {
  const session = loadSession(req.params.sessionId);
  if (!session || session.analyses.length === 0) {
    res.status(404).json({ success: false, error: 'No analysis found' });
    return;
  }

  const latest = session.analyses[session.analyses.length - 1];
  const projectName = latest.understanding.projectOverview.slice(0, 60) || 'Untitled Project';
  const date = new Date().toISOString().split('T')[0];

  const lines: string[] = [
    '# AIDLC Clarification Questions',
    `## Project: ${projectName}`,
    `## Generated: ${date}`,
    '',
  ];

  const priorities = ['critical', 'important', 'nice-to-have'] as const;
  const labels = {
    critical: 'Critical Questions (Must Answer)',
    important: 'Important Questions (Should Answer)',
    'nice-to-have': 'Nice-to-Have Questions (Optional)',
  };

  for (const priority of priorities) {
    const qs = latest.questions.filter((q) => q.priority === priority);
    if (qs.length === 0) continue;

    lines.push(`### ${labels[priority]}`, '');

    for (const q of qs) {
      lines.push(`#### ${q.id}: ${q.question}`);
      lines.push(`**Category:** ${q.category}`);
      lines.push(`**Context:** ${q.context}`);
      if (q.options && q.options.length > 0) {
        lines.push(`**Options:** ${q.options.join(' | ')}`);
      }
      lines.push('**Your Answer:**');
      lines.push('_[Type your answer here]_');
      lines.push('');
    }
  }

  const markdown = lines.join('\n');

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="aidlc-questions-${date}.md"`);
  res.send(markdown);
});

router.get('/:sessionId/understanding', (req, res) => {
  const session = loadSession(req.params.sessionId);
  if (!session || session.analyses.length === 0) {
    res.status(404).json({ success: false, error: 'No analysis found' });
    return;
  }

  const latest = session.analyses[session.analyses.length - 1];
  const u = latest.understanding;
  const date = new Date().toISOString().split('T')[0];

  const lines: string[] = [
    '# AIDLC Document Understanding Report',
    `## Generated: ${date}`,
    `## Confidence Score: ${latest.confidenceScore}%`,
    '',
    '### Project Overview',
    u.projectOverview,
    '',
    '### Business Objective',
    u.businessObjective,
    '',
    '### Scope',
    '**In Scope:**',
    ...u.scope.inScope.map((s) => `- ${s}`),
    '',
    '**Out of Scope:**',
    ...u.scope.outOfScope.map((s) => `- ${s}`),
    '',
    '**Unclear:**',
    ...u.scope.unclear.map((s) => `- ${s}`),
    '',
    '### Stakeholders',
    ...u.stakeholders.map((s) => `- ${s}`),
    '',
    '### Timeline',
    u.timeline,
    '',
    '### Tech Stack',
    u.techStack,
    '',
    '### Deliverables',
    ...u.deliverables.map((d) => `- ${d}`),
    '',
    '### Constraints',
    ...u.constraints.map((c) => `- ${c}`),
    '',
    '### Assumptions',
    ...u.assumptions.map((a) => `- ${a}`),
    '',
    '### Risks',
    ...u.risks.map((r) => `- ${r}`),
    '',
    '### Dependencies',
    ...u.dependencies.map((d) => `- ${d}`),
  ];

  const markdown = lines.join('\n');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="aidlc-understanding-${date}.md"`);
  res.send(markdown);
});

export default router;
