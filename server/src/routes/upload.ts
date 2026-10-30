import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { parseFile } from '../services/parser.js';
import { sanitizeDocument } from '../security/sanitize.js';
import { getOrCreateSession, loadSession, saveSession } from '../state.js';
import { initSecondBrain, reopenForNewDocuments, getStatus } from '../services/secondBrain.js';
import type { UploadedFile } from '../types/index.js';

const UPLOAD_DIR = path.resolve('uploads');

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.xlsx', '.xls', '.csv', '.md', '.txt', '.markdown'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} is not supported`));
    }
  },
});

const router = Router();

router.post('/:sessionId', upload.array('files', 20), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      res.status(400).json({ success: false, error: 'No files uploaded' });
      return;
    }

    const session = getOrCreateSession(sessionId);
    const documentNames = files.map((f) => f.originalname);

    // The Second Brain is created with the very first upload and lives for the
    // whole project from here on.
    const wasApproved = getStatus(sessionId).approvalStatus === 'approved';
    if (wasApproved) {
      // A document arriving after sign-off reopens the loop: the agent keeps
      // everything it already knows and earns fresh question cycles for the new
      // material, and the human approves the combined understanding again.
      reopenForNewDocuments(sessionId, documentNames);
      console.log(
        `[upload] session=${sessionId} received ${files.length} document(s) after approval — question cycles reset, approval back to pending`
      );
    } else {
      initSecondBrain(sessionId, { documents: documentNames });
    }

    const uploadedFiles: UploadedFile[] = [];

    for (const file of files) {
      const fileRecord: UploadedFile = {
        id: uuid(),
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        status: 'parsing',
      };

      try {
        // Neutralise prompt-injection patterns once, at ingestion, so no prompt
        // built from this document later can carry them.
        const text = sanitizeDocument(await parseFile(file.path, file.mimetype), file.originalname);
        fileRecord.status = 'ready';
        fileRecord.parsedTextPreview = text.slice(0, 500);

        const parsedDir = path.resolve('parsed');
        const { mkdir, writeFile } = await import('fs/promises');
        await mkdir(parsedDir, { recursive: true });
        await writeFile(path.join(parsedDir, `${fileRecord.id}.txt`), text, 'utf-8');
      } catch (err: any) {
        fileRecord.status = 'error';
        fileRecord.error = err.message;
      }

      session.files.push(fileRecord);
      uploadedFiles.push(fileRecord);
    }

    // The document list is part of the project's permanent scaffolding — a document
    // added today must still be there when the project is reopened next month.
    saveSession(session);

    res.json({ success: true, data: uploadedFiles });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:sessionId/files', (req, res) => {
  const session = loadSession(req.params.sessionId);
  if (!session) {
    res.json({ success: true, data: [] });
    return;
  }
  res.json({ success: true, data: session.files });
});

export default router;
