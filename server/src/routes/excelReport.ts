import { Router } from 'express';
import fs from 'fs';
import { getLLM, getOrCreateSession } from '../state.js';
import * as brain from '../services/secondBrain.js';
import { generateEpicAndStories } from '../services/storyGenerator.js';
import { buildEpicStoriesWorkbook } from '../services/excelBuilder.js';
import type { EpicStoriesResult } from '../types/index.js';

const router = Router();

/**
 * Epic + User Stories Excel report. Mounted under /api/projects, so:
 *   POST /api/projects/:sessionId/excel-report           generate stories + write the xlsx
 *   GET  /api/projects/:sessionId/excel-report           stored result / status
 *   GET  /api/projects/:sessionId/excel-report/download  stream the xlsx
 *
 * Generation is gated on human approval — the whole point of the approval step is
 * that nothing downstream is produced from an unreviewed understanding.
 */

function downloadUrl(sessionId: string): string {
  return `/api/projects/${sessionId}/excel-report/download`;
}

router.get('/:sessionId/excel-report', (req, res) => {
  const { sessionId } = req.params;
  const data = brain.readBrain(sessionId);
  const stories = data?.generatedStories;
  const fileExists = Boolean(stories?.filePath && fs.existsSync(stories.filePath));

  res.json({
    success: true,
    data: {
      exists: Boolean(stories),
      fileAvailable: fileExists,
      approvalStatus: data?.approval.status ?? 'pending',
      result: stories ?? null,
      downloadUrl: fileExists ? downloadUrl(sessionId) : null,
    },
  });
});

router.get('/:sessionId/excel-report/download', (req, res) => {
  const { sessionId } = req.params;
  const data = brain.readBrain(sessionId);
  const filePath = data?.generatedStories?.filePath;

  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ success: false, error: 'No Excel report has been generated for this session' });
    return;
  }

  const safeName = (data?.projectName ?? 'project')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50) || 'project';

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-epic-stories.xlsx"`);
  res.sendFile(filePath);
});

router.post('/:sessionId/excel-report', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { regenerate } = req.body ?? {};

    const data = brain.readBrain(sessionId);
    if (!data) {
      res.status(404).json({ success: false, error: 'No second brain exists for this session' });
      return;
    }

    // The Second Brain is the real input here — it already carries the understanding,
    // the Q&A chain and the confirmed facts. The session only supplies the raw
    // document text on top, so a project whose session predates persistence can still
    // produce its backlog rather than dead-ending on "Session not found".
    const session = getOrCreateSession(sessionId);

    if (data.approval.status !== 'approved') {
      res.status(403).json({
        success: false,
        error: 'The project understanding must be approved by a human before the Excel report can be generated.',
      });
      return;
    }

    // Serve the existing report unless a regeneration was explicitly requested.
    if (
      data.generatedStories &&
      !regenerate &&
      data.generatedStories.filePath &&
      fs.existsSync(data.generatedStories.filePath)
    ) {
      res.json({
        success: true,
        data: { ...data.generatedStories, downloadUrl: downloadUrl(sessionId), reused: true },
      });
      return;
    }

    const llm = getLLM();
    if (!llm) {
      res.status(500).json({ success: false, error: 'No LLM configured' });
      return;
    }

    console.log(`[excel-report] session=${sessionId} generating epic + stories (${llm.name})`);
    const { epic, stories } = await generateEpicAndStories(llm, session);

    const built = buildEpicStoriesWorkbook(sessionId, epic, stories);
    console.log(
      `[excel-report] session=${sessionId} wrote ${stories.length} stories (${built.totalStoryPoints} pts) to ${built.filePath}`
    );

    const result: EpicStoriesResult = {
      epic,
      stories,
      generatedAt: new Date().toISOString(),
      totalStoryPoints: built.totalStoryPoints,
      filePath: built.filePath,
      downloadUrl: downloadUrl(sessionId),
    };

    // The generated backlog becomes part of the project's permanent context.
    brain.recordGeneratedStories(sessionId, result);

    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error(`[excel-report] session=${req.params.sessionId} failed:`, err);
    res.status(500).json({ success: false, error: err.message || 'Failed to generate the Excel report' });
  }
});

export default router;
