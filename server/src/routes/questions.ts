import { Router } from 'express';
import { loadSession, saveSession } from '../state.js';
import * as brain from '../services/secondBrain.js';
import { MAX_QUESTION_CYCLES } from '../services/secondBrain.js';
import type { ClarifyingQuestion, QnaRecord, Session } from '../types/index.js';

const router = Router();

function formatAnswer(answer: string | string[] | undefined): string {
  if (answer === undefined) return '';
  return Array.isArray(answer) ? answer.join(', ') : String(answer);
}

/**
 * The cycle a question belongs to is the 1-based index of the analysis round that
 * produced it, capped at the maximum so a stray extra round can't invent a cycle 3.
 */
function cycleForAnalysisIndex(index: number): number {
  return Math.min(index + 1, MAX_QUESTION_CYCLES);
}

function toRecord(question: ClarifyingQuestion, cycle: number): QnaRecord {
  return {
    cycle,
    questionId: question.id,
    question: question.question,
    category: question.category,
    priority: question.priority,
    answer: formatAnswer(question.answer),
    answeredAt: new Date().toISOString(),
  };
}

/** Push every answered question in the session into the Second Brain. */
function syncAnswersToBrain(session: Session) {
  const records: QnaRecord[] = [];
  session.analyses.forEach((analysis, index) => {
    const cycle = cycleForAnalysisIndex(index);
    for (const q of analysis.questions) {
      if (q.status === 'answered' && formatAnswer(q.answer).trim()) {
        records.push(toRecord(q, cycle));
      }
    }
  });
  if (records.length > 0) brain.recordAnswers(session.id, records);
}

/** True once every question in the latest round has been answered or skipped. */
function roundComplete(session: Session): boolean {
  const latest = session.analyses[session.analyses.length - 1];
  return latest.questions.every((q) => q.status !== 'pending');
}

function answerState(session: Session) {
  const status = brain.getStatus(session.id);
  const complete = roundComplete(session);
  return {
    cycleCount: status.cycleCount,
    maxCycles: MAX_QUESTION_CYCLES,
    questionsExhausted: status.questionsExhausted,
    roundComplete: complete,
    /** The UI moves to the approval gate when no further questions are possible. */
    readyForApproval: complete && status.questionsExhausted,
    approvalStatus: status.approvalStatus,
  };
}

router.get('/:sessionId', (req, res) => {
  const session = loadSession(req.params.sessionId);
  if (!session || session.analyses.length === 0) {
    res.status(404).json({ success: false, error: 'No analysis found' });
    return;
  }
  const latest = session.analyses[session.analyses.length - 1];
  res.json({ success: true, data: latest.questions });
});

router.post('/:sessionId/answer', (req, res) => {
  const session = loadSession(req.params.sessionId);
  if (!session || session.analyses.length === 0) {
    res.status(404).json({ success: false, error: 'No analysis found' });
    return;
  }

  const { questionId, answer } = req.body;
  if (!questionId || answer === undefined) {
    res.status(400).json({ success: false, error: 'questionId and answer are required' });
    return;
  }

  const latest = session.analyses[session.analyses.length - 1];
  const question = latest.questions.find((q) => q.id === questionId);
  if (!question) {
    res.status(404).json({ success: false, error: 'Question not found' });
    return;
  }

  question.answer = answer;
  question.status = 'answered';
  session.currentStep = 'questions';
  saveSession(session);

  brain.recordAnswers(session.id, [
    toRecord(question, cycleForAnalysisIndex(session.analyses.length - 1)),
  ]);

  res.json({ success: true, data: { question, ...answerState(session) } });
});

router.post('/:sessionId/answer-bulk', (req, res) => {
  const session = loadSession(req.params.sessionId);
  if (!session || session.analyses.length === 0) {
    res.status(404).json({ success: false, error: 'No analysis found' });
    return;
  }

  const { answers } = req.body as { answers: { questionId: string; answer: string | string[] }[] };
  if (!answers || !Array.isArray(answers)) {
    res.status(400).json({ success: false, error: 'answers array is required' });
    return;
  }

  const latest = session.analyses[session.analyses.length - 1];

  for (const { questionId, answer } of answers) {
    const question = latest.questions.find((q) => q.id === questionId);
    if (question) {
      question.answer = answer;
      question.status = 'answered';
    }
  }

  session.currentStep = 'questions';

  saveSession(session);
  syncAnswersToBrain(session);

  res.json({ success: true, data: { questions: latest.questions, ...answerState(session) } });
});

router.post('/:sessionId/skip', (req, res) => {
  const session = loadSession(req.params.sessionId);
  if (!session || session.analyses.length === 0) {
    res.status(404).json({ success: false, error: 'No analysis found' });
    return;
  }

  const { questionId } = req.body;
  const latest = session.analyses[session.analyses.length - 1];
  const question = latest.questions.find((q) => q.id === questionId);
  if (!question) {
    res.status(404).json({ success: false, error: 'Question not found' });
    return;
  }

  question.status = 'skipped';
  // A skipped question is an open item, not a confirmed fact.
  brain.updateBrain(session.id, (b) => {
    const item = `Unanswered (skipped by user): ${question.question}`;
    if (!b.openItems.includes(item)) b.openItems.push(item);
  });

  res.json({ success: true, data: { question, ...answerState(session) } });
});

router.post('/:sessionId/import-answers', (req, res) => {
  const session = loadSession(req.params.sessionId);
  if (!session || session.analyses.length === 0) {
    res.status(404).json({ success: false, error: 'No analysis found' });
    return;
  }

  const { markdown } = req.body as { markdown: string };
  if (!markdown) {
    res.status(400).json({ success: false, error: 'markdown content is required' });
    return;
  }

  const latest = session.analyses[session.analyses.length - 1];
  const answerPattern = /####\s+(\w+):\s+.*?\n\*\*Context:\*\*.*?\n\*\*Your Answer:\*\*\s*\n([\s\S]*?)(?=\n####|\n###|$)/g;

  let match;
  let count = 0;
  while ((match = answerPattern.exec(markdown)) !== null) {
    const id = match[1];
    const rawAnswer = match[2].trim().replace(/^_\[/, '').replace(/\]_$/, '');

    if (rawAnswer && rawAnswer !== 'Type your answer here') {
      const question = latest.questions.find((q) => q.id === id);
      if (question) {
        question.answer = rawAnswer;
        question.status = 'answered';
        count++;
      }
    }
  }

  if (count > 0) syncAnswersToBrain(session);

  res.json({
    success: true,
    data: { importedCount: count, questions: latest.questions, ...answerState(session) },
  });
});

export default router;
