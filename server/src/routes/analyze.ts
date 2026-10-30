import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { getLLM, loadSession, saveSession } from '../state.js';
import { analyzeDocuments, flattenAnsweredQuestions } from '../services/analyzer.js';
import * as brain from '../services/secondBrain.js';
import { MAX_QUESTION_CYCLES } from '../services/secondBrain.js';

const router = Router();

router.post('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = loadSession(sessionId);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    const readyFiles = session.files.filter((f) => f.status === 'ready');
    if (readyFiles.length === 0) {
      res.status(400).json({ success: false, error: 'No parsed files available' });
      return;
    }

    const llm = getLLM();
    if (!llm) {
      res.status(500).json({
        success: false,
        error: 'No LLM configured. Please set OPENAI_API_KEY or GEMINI_API_KEY in your .env file.',
      });
      return;
    }
    console.log(`[analyze] session=${sessionId} using LLM adapter: ${llm.name}`);

    session.currentStep = 'analyzing';

    // The Second Brain is authoritative for cycle count — the in-memory session is a mirror.
    const existing = brain.getOrCreateBrain(sessionId);
    brain.recordDocuments(sessionId, readyFiles.map((f) => f.originalName));
    session.cycleCount = existing.cycleCount;

    const cycleNumber = existing.cycleCount + 1;
    const willAskQuestions = existing.cycleCount < MAX_QUESTION_CYCLES;
    console.log(
      `[analyze] session=${sessionId} cycles used=${existing.cycleCount}/${MAX_QUESTION_CYCLES}, running as cycle ${cycleNumber}`
    );

    const parsedDir = path.resolve('parsed');
    const contentParts: string[] = [];

    for (const file of readyFiles) {
      try {
        const text = await fs.readFile(path.join(parsedDir, `${file.id}.txt`), 'utf-8');
        contentParts.push(`=== FILE: ${file.originalName} ===\n${text}`);
      } catch {
        // A ticket-sourced pseudo-file has no parsed text on disk — skip it.
      }
    }

    const fullContent = contentParts.join('\n\n');

    const outcome = await analyzeDocuments(llm, fullContent, {
      sessionId,
      cycleNumber,
      previousAnswers: flattenAnsweredQuestions(sessionId),
    });

    // Persist the refreshed understanding into the Second Brain.
    brain.recordUnderstanding(sessionId, outcome.understanding, outcome.confidenceScore);
    if (existing.projectName === 'Untitled Project' && outcome.projectName) {
      brain.setProjectName(sessionId, outcome.projectName);
    }

    // A cycle is only consumed when questions actually go out to the user.
    if (willAskQuestions && outcome.questions.length > 0) {
      const updated = brain.incrementCycle(sessionId);
      session.cycleCount = updated.cycleCount;
      session.currentStep = 'understanding';
    } else {
      // No questions left to ask — the flow moves to the human approval gate.
      session.cycleCount = brain.getStatus(sessionId).cycleCount;
      session.currentStep = outcome.questions.length > 0 ? 'understanding' : 'approval';
    }

    const analysis = {
      understanding: outcome.understanding,
      confidenceScore: outcome.confidenceScore,
      questions: outcome.questions,
    };
    session.analyses.push(analysis);
    saveSession(session);

    const status = brain.getStatus(sessionId);

    res.json({
      success: true,
      data: {
        ...analysis,
        cycleCount: status.cycleCount,
        maxCycles: MAX_QUESTION_CYCLES,
        questionCycle: outcome.questionCycle,
        questionsExhausted: status.cycleCount >= MAX_QUESTION_CYCLES || outcome.questionsExhausted,
        questionsWithheldReason: outcome.questionsWithheldReason,
        readyForApproval: outcome.questions.length === 0,
        approvalStatus: status.approvalStatus,
      },
    });
  } catch (err: any) {
    console.error(`[analyze] session=${req.params.sessionId} failed:`, err);
    res.status(500).json({ success: false, error: err.message || 'Unknown error during analysis' });
  }
});

router.get('/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = loadSession(sessionId);
  if (!session || session.analyses.length === 0) {
    res.status(404).json({ success: false, error: 'No analysis found' });
    return;
  }
  const latest = session.analyses[session.analyses.length - 1];
  const status = brain.getStatus(sessionId);
  res.json({
    success: true,
    data: {
      ...latest,
      cycleCount: status.cycleCount,
      maxCycles: MAX_QUESTION_CYCLES,
      questionsExhausted: status.questionsExhausted,
      readyForApproval: latest.questions.every((q) => q.status !== 'pending'),
      approvalStatus: status.approvalStatus,
    },
  });
});

/** Cycle / approval status without running an analysis. */
router.get('/:sessionId/status', (req, res) => {
  res.json({ success: true, data: brain.getStatus(req.params.sessionId) });
});

export default router;
