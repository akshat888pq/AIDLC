import './env.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import uploadRouter from './routes/upload.js';
import analyzeRouter from './routes/analyze.js';
import questionsRouter from './routes/questions.js';
import exportRouter from './routes/export.js';
import chatRouter from './routes/chat.js';
import oauthRouter from './routes/oauth.js';
import connectionsRouter from './routes/connections.js';
import ticketsRouter from './routes/tickets.js';
import requirementsRouter from './routes/requirements.js';
import gitRouter from './routes/git.js';
import projectsRouter from './routes/projects.js';
import architectureRouter from './routes/architecture.js';
import designRouter from './routes/design.js';
import testsRouter from './routes/tests.js';
import releaseRouter from './routes/release.js';
import approvalRouter from './routes/approval.js';
import excelReportRouter from './routes/excelReport.js';
import { phaseEngineRouter, phaseHubRouter } from './routes/phaseEngine.js';
import devRouter from './routes/dev.js';
import { attachTerminalServer, shutdownTerminals } from './dev/terminal.js';
import { stopAllProcesses } from './dev/processes.js';
import governanceRouter from './routes/governance.js';
import { identityMiddleware } from './security/users.js';
import { confirmationMiddleware, rbacMiddleware } from './security/policy.js';
import { sanitizeBodyMiddleware } from './security/sanitize.js';
import { requestContextMiddleware } from './context/requestContext.js';
import { toolAuditMiddleware } from './audit/toolAudit.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

for (const dir of ['uploads', 'parsed', 'connections', 'requirements', 'projects', 'data', 'architecture', 'design', 'tests', 'release']) {
  const p = path.resolve(dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '10mb' }));

// ── Governance middleware, in order: who is calling → may they → have they
// confirmed → clean their input → scope the request → audit tool actions.
app.use(identityMiddleware);
app.use(rbacMiddleware);
app.use(confirmationMiddleware);
app.use(sanitizeBodyMiddleware);
app.use(requestContextMiddleware);
app.use(toolAuditMiddleware);
app.use('/api/governance', governanceRouter);

app.use('/api/upload', uploadRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/questions', questionsRouter);
app.use('/api/export', exportRouter);
app.use('/api/chat', chatRouter);
app.use('/api/oauth', oauthRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/requirements', requirementsRouter);
app.use('/api/git', gitRouter);
// Approval + Excel report hang off /api/projects/:sessionId/... — mounted after the
// projects router, which has no matching routes and so falls through to these.
app.use('/api/projects', approvalRouter);
app.use('/api/projects', excelReportRouter);
app.use('/api/projects', projectsRouter);
// The generic phase engine. One set of routes for every phase; the legacy
// requirement routes above stay mounted and keep working unchanged.
app.use('/api/phase', phaseEngineRouter);
app.use('/api/phases', phaseHubRouter);
app.use('/api/architecture', architectureRouter);
app.use('/api/design', designRouter);
app.use('/api/tests', testsRouter);
app.use('/api/release', releaseRouter);
app.use('/api/dev', devRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const server = app.listen(PORT, () => {
  console.log(`AIDLC server running on http://localhost:${PORT}`);
});
attachTerminalServer(server);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shutdownTerminals();
    stopAllProcesses();
    process.exit(0);
  });
}
