import { Router } from 'express';
import { getLLM, loadSession, saveSession } from '../state.js';
import * as brain from '../services/secondBrain.js';
import { MAX_QUESTION_CYCLES } from '../services/secondBrain.js';
import { generateUnderstandingSummary } from '../services/approvalService.js';

const router = Router();

/**
 * Human-in-the-loop approval gate. Mounted under /api/projects, so:
 *   POST /api/projects/:sessionId/approval          generate (or regenerate) the summary
 *   POST /api/projects/:sessionId/approval/add-info  fold in human corrections, re-summarize
 *   POST /api/projects/:sessionId/approval/approve   sign off, unlocking generation
 *   GET  /api/projects/:sessionId/approval           read the stored summary + status
 *   GET  /api/projects/:sessionId/second-brain       read the raw second-brain.md
 */

function statusPayload(sessionId: string) {
  const status = brain.getStatus(sessionId);
  const data = brain.readBrain(sessionId);
  return {
    ...status,
    summary: data?.understandingSummary ?? null,
    humanInputs: data?.humanInputs ?? [],
    projectName: data?.projectName ?? 'Untitled Project',
    sourceDocuments: data?.sourceDocuments ?? [],
    canGenerateRequirements: status.approvalStatus === 'approved',
    canGenerateExcel: status.approvalStatus === 'approved',
  };
}

router.get('/:sessionId/approval', (req, res) => {
  res.json({ success: true, data: statusPayload(req.params.sessionId) });
});

router.get('/:sessionId/second-brain', (req, res) => {
  const markdown = brain.readMarkdown(req.params.sessionId);
  if (!markdown) {
    res.status(404).json({ success: false, error: 'No second brain exists for this session yet' });
    return;
  }
  res.json({ success: true, data: { markdown, path: brain.secondBrainMdPath(req.params.sessionId) } });
});

/** Generate the understanding summary for human review. */
router.post('/:sessionId/approval', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { force } = req.body ?? {};

    const session = loadSession(sessionId);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }
    if (session.analyses.length === 0) {
      res.status(400).json({ success: false, error: 'Documents must be analyzed before approval' });
      return;
    }

    const existingBrain = brain.readBrain(sessionId);
    if (!existingBrain) {
      res.status(404).json({ success: false, error: 'No second brain exists for this session' });
      return;
    }

    // Reuse the stored summary unless a regeneration is explicitly requested.
    if (existingBrain.understandingSummary && !force) {
      res.json({ success: true, data: statusPayload(sessionId) });
      return;
    }

    const llm = getLLM();
    if (!llm) {
      res.status(500).json({ success: false, error: 'No LLM configured' });
      return;
    }

    const pendingQuestions = session.analyses[session.analyses.length - 1].questions.filter(
      (q) => q.status === 'pending'
    );
    if (pendingQuestions.length > 0 && existingBrain.cycleCount < MAX_QUESTION_CYCLES && !force) {
      res.status(400).json({
        success: false,
        error: `${pendingQuestions.length} question(s) are still unanswered. Answer or skip them, or pass force:true to proceed anyway.`,
      });
      return;
    }

    console.log(`[approval] session=${sessionId} generating understanding summary (${llm.name})`);
    await generateUnderstandingSummary(llm, session);
    session.currentStep = 'approval';
    saveSession(session);

    res.json({ success: true, data: statusPayload(sessionId) });
  } catch (err: any) {
    console.error(`[approval] session=${req.params.sessionId} failed:`, err);
    res.status(500).json({ success: false, error: err.message || 'Failed to generate understanding summary' });
  }
});

/** The human adds information or corrections — re-run the summary, never ask questions. */
router.post('/:sessionId/approval/add-info', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { text } = req.body as { text?: string };

    if (!text || !text.trim()) {
      res.status(400).json({ success: false, error: 'text is required' });
      return;
    }

    const session = loadSession(sessionId);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }
    if (!brain.exists(sessionId)) {
      res.status(404).json({ success: false, error: 'No second brain exists for this session' });
      return;
    }

    const llm = getLLM();
    if (!llm) {
      res.status(500).json({ success: false, error: 'No LLM configured' });
      return;
    }

    // Persist the human input FIRST so it is part of the second brain context the
    // re-analysis reads.
    brain.recordHumanInput(sessionId, text);
    console.log(`[approval] session=${sessionId} human added ${text.trim().length} chars of input`);

    await generateUnderstandingSummary(llm, session, text.trim());
    session.currentStep = 'approval';
    saveSession(session);

    res.json({ success: true, data: statusPayload(sessionId) });
  } catch (err: any) {
    console.error(`[approval] session=${req.params.sessionId} add-info failed:`, err);
    res.status(500).json({ success: false, error: err.message || 'Failed to incorporate additional information' });
  }
});

/** Final human sign-off. Unlocks requirements + Excel generation. */
router.post('/:sessionId/approval/approve', (req, res) => {
  try {
    const { sessionId } = req.params;
    const { additionalInput } = req.body as { additionalInput?: string };

    const data = brain.readBrain(sessionId);
    if (!data) {
      res.status(404).json({ success: false, error: 'No second brain exists for this session' });
      return;
    }
    if (!data.understandingSummary) {
      res.status(400).json({
        success: false,
        error: 'Generate the understanding summary before approving',
      });
      return;
    }

    if (additionalInput && additionalInput.trim()) {
      brain.recordHumanInput(sessionId, additionalInput.trim());
    }

    brain.approve(sessionId);

    const session = loadSession(sessionId);
    if (session) {
      session.approvalStatus = 'approved';
      session.approvedAt = new Date().toISOString();
      session.currentStep = 'approved';
      saveSession(session);
    }

    console.log(`[approval] session=${sessionId} APPROVED by human`);
    res.json({ success: true, data: statusPayload(sessionId) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
