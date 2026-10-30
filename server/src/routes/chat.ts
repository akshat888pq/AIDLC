import { Router } from 'express';
import { chatHistories, getLLM, loadSession } from '../state.js';
import { CHAT_SYSTEM_PROMPT } from '../prompts/questionGeneration.js';
import { buildSecondBrainContextBlock } from '../services/secondBrain.js';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

router.post('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ success: false, error: 'message is required' });
      return;
    }

    const session = loadSession(sessionId);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    const llm = getLLM();
    if (!llm) {
      res.status(500).json({ success: false, error: 'No LLM configured' });
      return;
    }

    if (!chatHistories.has(sessionId)) {
      chatHistories.set(sessionId, []);
    }
    const history = chatHistories.get(sessionId)!;

    let contextPreamble = '';
    if (session.analyses.length > 0 && history.length === 0) {
      const latest = session.analyses[session.analyses.length - 1];
      contextPreamble = `Current analysis state:\n${JSON.stringify(latest.understanding, null, 2)}\nConfidence: ${latest.confidenceScore}%\n\n`;
    }

    if (session.files.length > 0 && history.length === 0) {
      const parsedDir = path.resolve('parsed');
      const readyFiles = session.files.filter((f) => f.status === 'ready');
      const contentParts: string[] = [];
      for (const file of readyFiles) {
        try {
          const text = await fs.readFile(path.join(parsedDir, `${file.id}.txt`), 'utf-8');
          contentParts.push(`=== FILE: ${file.originalName} ===\n${text.slice(0, 5000)}`);
        } catch {
          // skip unreadable files
        }
      }
      if (contentParts.length > 0) {
        contextPreamble += `Document excerpts:\n${contentParts.join('\n\n')}\n\n`;
      }
    }

    const userMessage = contextPreamble
      ? `${contextPreamble}User question: ${message}`
      : message;

    history.push({ role: 'user', content: userMessage });

    // Every LLM call in the system carries the Second Brain and its rules.
    const secondBrain = buildSecondBrainContextBlock(sessionId);
    const systemPrompt = secondBrain
      ? `${CHAT_SYSTEM_PROMPT}\n\n---\n\n${secondBrain}`
      : CHAT_SYSTEM_PROMPT;

    const response = await llm.chat(systemPrompt, history);
    history.push({ role: 'model', content: response });

    res.json({ success: true, data: { reply: response } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:sessionId/history', (req, res) => {
  const history = chatHistories.get(req.params.sessionId) || [];
  const cleaned = history.map((m) => ({
    role: m.role === 'model' ? 'agent' : 'user',
    content: m.content,
  }));
  res.json({ success: true, data: cleaned });
});

export default router;
