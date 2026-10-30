import { Router, type Request, type Response } from 'express';
import * as ws from '../dev/workspace.js';
import { DevError } from '../dev/workspace.js';
import { TEMPLATES, applyTemplate, getTemplate } from '../dev/templates.js';
import * as agent from '../dev/agent.js';
import { localOnly } from '../dev/localOnly.js';
import { killTerminal, listTerminals, writeToTerminal } from '../dev/terminal.js';
import { getProjectBySessionId } from '../services/projectStore.js';
import * as pipeline from '../dev/pipeline.js';
import { readManifest, syncProjectContext } from '../dev/handover.js';
import * as fileDocs from '../dev/fileDocs.js';
import * as processes from '../dev/processes.js';

const router = Router();
router.use(localOnly);

function fail(res: Response, err: any, label: string) {
  const status = err instanceof DevError ? err.statusCode : 500;
  if (status >= 500) console.error(`[${label}] failed:`, err);
  res.status(status).json({ success: false, error: err.message || 'Unknown error' });
}

function sid(req: Request): string {
  return ws.assertSessionId(req.params.sessionId);
}

function safeRead(sessionId: string, p: string): string | null {
  try {
    return ws.readFile(sessionId, p);
  } catch {
    return null;
  }
}

function requireWorkspace(sessionId: string) {
  if (!ws.workspaceExists(sessionId)) throw new DevError('The workspace has not been created yet', 404);
}

router.get('/templates', (_req, res) => {
  res.json({
    success: true,
    data: TEMPLATES.map(({ files, ...t }) => ({ ...t, fileCount: Object.keys(files).length })),
  });
});

// ── Workspace ──

router.get('/:sessionId/workspace', (req, res) => {
  try {
    const sessionId = sid(req);
    const project = getProjectBySessionId(sessionId);
    const exists = ws.workspaceExists(sessionId);
    res.json({
      success: true,
      data: {
        exists,
        projectName: project?.name ?? 'Project',
        root: ws.workspaceRoot(sessionId),
        tree: exists ? ws.listTree(sessionId) : [],
      },
    });
  } catch (err) {
    fail(res, err, 'dev:workspace');
  }
});

router.post('/:sessionId/workspace/init', (req, res) => {
  try {
    const sessionId = sid(req);
    const { template } = req.body ?? {};
    ws.ensureWorkspace(sessionId);
    let scaffold: { written: string[]; skipped: string[] } | null = null;
    if (template) {
      if (!getTemplate(template)) throw new DevError(`Unknown template "${template}"`);
      scaffold = applyTemplate(sessionId, template);
      agent.notifyFsChange(sessionId, scaffold.written);
    }
    res.json({
      success: true,
      data: { tree: ws.listTree(sessionId), scaffold, postCreate: template ? getTemplate(template)?.postCreate : undefined },
    });
  } catch (err) {
    fail(res, err, 'dev:init');
  }
});

router.post('/:sessionId/secondbrain/sync', (req, res) => {
  try {
    const sessionId = sid(req);
    ws.ensureWorkspace(sessionId);
    const manifest = syncProjectContext(sessionId);
    agent.notifyFsChange(sessionId, [ws.SECOND_BRAIN_FILE]);
    res.json({ success: true, data: { content: ws.readSecondBrain(sessionId), manifest } });
  } catch (err) {
    fail(res, err, 'dev:secondbrain');
  }
});

/** What was carried over from the earlier phases. */
router.get('/:sessionId/handover', (req, res) => {
  try {
    res.json({ success: true, data: readManifest(sid(req)) });
  } catch (err) {
    fail(res, err, 'dev:handover');
  }
});

/** A carried-over mockup, served as a page with the same sandbox the design phase uses. */
router.get('/:sessionId/mockup', (req, res) => {
  try {
    const sessionId = sid(req);
    const rel = String(req.query.path ?? '');
    if (!rel.startsWith(`${ws.DOCS_DIR}/design/mockups/`) || !rel.endsWith('.html')) throw new DevError('Not a mockup path', 400);
    const html = ws.readFile(sessionId, rel);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-modals');
    res.send(html);
  } catch (err) {
    fail(res, err, 'dev:mockup');
  }
});

// ── Files ──

router.get('/:sessionId/files/tree', (req, res) => {
  try {
    const sessionId = sid(req);
    res.json({ success: true, data: ws.workspaceExists(sessionId) ? ws.listTree(sessionId) : [] });
  } catch (err) {
    fail(res, err, 'dev:tree');
  }
});

router.get('/:sessionId/files/content', (req, res) => {
  try {
    const sessionId = sid(req);
    requireWorkspace(sessionId);
    const p = String(req.query.path ?? '');
    res.json({ success: true, data: { path: p, content: ws.readFile(sessionId, p) } });
  } catch (err) {
    fail(res, err, 'dev:read');
  }
});

router.put('/:sessionId/files/content', (req, res) => {
  try {
    const sessionId = sid(req);
    requireWorkspace(sessionId);
    const { path: p, content } = req.body ?? {};
    if (typeof p !== 'string' || typeof content !== 'string') throw new DevError('path and content are required');
    const before = ws.fileExists(sessionId, p) ? safeRead(sessionId, p) : null;
    ws.writeFile(sessionId, p, content);
    if (before !== content) {
      const docs = fileDocs.recordManualChange(sessionId, { path: p, before, after: content });
      if (docs.length) agent.notifyFsChange(sessionId, docs);
    }
    res.json({ success: true, data: { path: p } });
  } catch (err) {
    fail(res, err, 'dev:write');
  }
});

router.post('/:sessionId/files/create', (req, res) => {
  try {
    const sessionId = sid(req);
    requireWorkspace(sessionId);
    const { path: p, type } = req.body ?? {};
    if (typeof p !== 'string' || !p.trim()) throw new DevError('path is required');
    if (ws.fileExists(sessionId, p)) throw new DevError(`${p} already exists`, 409);
    if (type === 'dir') ws.createDir(sessionId, p);
    else ws.writeFile(sessionId, p, '');
    res.json({ success: true, data: ws.listTree(sessionId) });
  } catch (err) {
    fail(res, err, 'dev:create');
  }
});

router.post('/:sessionId/files/rename', (req, res) => {
  try {
    const sessionId = sid(req);
    requireWorkspace(sessionId);
    const { from, to } = req.body ?? {};
    if (typeof from !== 'string' || typeof to !== 'string') throw new DevError('from and to are required');
    ws.renamePath(sessionId, from, to);
    fileDocs.recordManualChange(sessionId, { path: to, before: null, after: '' }, from);
    res.json({ success: true, data: ws.listTree(sessionId) });
  } catch (err) {
    fail(res, err, 'dev:rename');
  }
});

router.delete('/:sessionId/files', (req, res) => {
  try {
    const sessionId = sid(req);
    requireWorkspace(sessionId);
    const p = String(req.query.path ?? '');
    const before = safeRead(sessionId, p);
    ws.deletePath(sessionId, p);
    fileDocs.recordManualChange(sessionId, { path: p, before, after: null });
    res.json({ success: true, data: ws.listTree(sessionId) });
  } catch (err) {
    fail(res, err, 'dev:delete');
  }
});

router.post('/:sessionId/terminal/run', (req, res) => {
  try {
    const sessionId = sid(req);
    const { command, terminalId } = req.body ?? {};
    if (typeof command !== 'string' || !command.trim()) throw new DevError('command is required');
    const sent = writeToTerminal(sessionId, `${command}\r`, typeof terminalId === 'string' ? terminalId : undefined);
    if (!sent) throw new DevError('The terminal is not running. Open the Terminal panel first.', 409);
    res.json({ success: true, data: { sent } });
  } catch (err) {
    fail(res, err, 'dev:terminal-run');
  }
});

router.get('/:sessionId/terminals', (req, res) => {
  try {
    res.json({ success: true, data: listTerminals(sid(req)) });
  } catch (err) {
    fail(res, err, 'dev:terminals');
  }
});

router.delete('/:sessionId/terminals/:terminalId', (req, res) => {
  try {
    const sessionId = sid(req);
    killTerminal(sessionId, req.params.terminalId);
    res.json({ success: true, data: listTerminals(sessionId) });
  } catch (err) {
    fail(res, err, 'dev:terminal-close');
  }
});

// ── Agent ──

router.get('/:sessionId/agent/events', (req, res) => {
  let sessionId: string;
  try {
    sessionId = sid(req);
  } catch (err) {
    fail(res, err, 'dev:events');
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const unsubscribe = agent.subscribe(sessionId, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.get('/:sessionId/agent', (req, res) => {
  try {
    res.json({ success: true, data: agent.getPublicState(sid(req)) });
  } catch (err) {
    fail(res, err, 'dev:agent');
  }
});

router.post('/:sessionId/agent/message', (req, res) => {
  try {
    const sessionId = sid(req);
    ws.ensureWorkspace(sessionId);
    res.json({ success: true, data: agent.sendMessage(sessionId, req.body?.text) });
  } catch (err) {
    fail(res, err, 'dev:message');
  }
});

router.post('/:sessionId/agent/approve', (req, res) => {
  try {
    const { itemId, decision, feedback } = req.body ?? {};
    if (!['allow', 'allow_always', 'deny'].includes(decision)) throw new DevError('decision must be allow, allow_always or deny');
    res.json({ success: true, data: agent.resolveApproval(sid(req), String(itemId), decision, feedback) });
  } catch (err) {
    fail(res, err, 'dev:approve');
  }
});

router.post('/:sessionId/agent/mode', (req, res) => {
  try {
    res.json({ success: true, data: agent.setMode(sid(req), req.body?.mode) });
  } catch (err) {
    fail(res, err, 'dev:mode');
  }
});

router.post('/:sessionId/agent/stop', (req, res) => {
  try {
    res.json({ success: true, data: agent.stop(sid(req)) });
  } catch (err) {
    fail(res, err, 'dev:stop');
  }
});

router.post('/:sessionId/agent/reset', (req, res) => {
  try {
    res.json({ success: true, data: agent.reset(sid(req)) });
  } catch (err) {
    fail(res, err, 'dev:reset');
  }
});

// ── Pipeline: blueprint → scaffold → build → verify ──

function pipelineRoute(
  method: 'get' | 'post' | 'put',
  route: string,
  handler: (sessionId: string, body: any) => unknown
) {
  router[method](`/:sessionId/pipeline${route}`, (req, res) => {
    try {
      res.json({ success: true, data: handler(sid(req), req.body ?? {}) });
    } catch (err) {
      fail(res, err, `dev:pipeline${route}`);
    }
  });
}

pipelineRoute('get', '', (s) => pipeline.getPipeline(s));
pipelineRoute('get', '/docs', (s) => fileDocs.docMap(s));
pipelineRoute('post', '/blueprint/generate', (s, b) => pipeline.generateBlueprint(s, b.feedback));
pipelineRoute('put', '/blueprint', (s, b) => pipeline.updateBlueprint(s, b.blueprint));
pipelineRoute('post', '/blueprint/approve', (s, b) => pipeline.approveBlueprint(s, b.blueprint));
pipelineRoute('post', '/scaffold', (s) => pipeline.createScaffold(s));
pipelineRoute('post', '/build/start', (s, b) => pipeline.startBuild(s, b.mode === 'next' ? 'next' : 'all'));
pipelineRoute('post', '/build/pause', (s) => pipeline.pauseBuild(s));
pipelineRoute('post', '/build/auto', (s, b) => pipeline.setAutoContinue(s, b.autoContinue));
pipelineRoute('post', '/files/build', (s, b) => pipeline.buildSingle(s, String(b.path ?? '')));
pipelineRoute('post', '/files/status', (s, b) => pipeline.setFileStatus(s, String(b.path ?? ''), b.status));
pipelineRoute('post', '/verify', (s) => pipeline.startVerify(s));
pipelineRoute('post', '/stage', (s, b) => pipeline.setStage(s, b.stage));

// ── Background processes (the project's running services) ──

router.get('/:sessionId/processes', (req, res) => {
  try {
    res.json({ success: true, data: { processes: processes.listProcesses(sid(req)), ports: processes.projectPorts(sid(req)) } });
  } catch (err) {
    fail(res, err, 'dev:processes');
  }
});

router.get('/:sessionId/processes/:name/logs', (req, res) => {
  try {
    res.json({ success: true, data: { logs: processes.processLogs(sid(req), req.params.name, 20000) } });
  } catch (err) {
    fail(res, err, 'dev:process-logs');
  }
});

router.post('/:sessionId/processes/:name/stop', (req, res) => {
  try {
    res.json({ success: true, data: processes.stopProcess(sid(req), req.params.name) });
  } catch (err) {
    fail(res, err, 'dev:process-stop');
  }
});

/** Started by the human from the UI, so no permission gate. */
router.post('/:sessionId/processes/start', async (req, res) => {
  try {
    const { name, command, cwd, readyUrl } = req.body ?? {};
    if (typeof name !== 'string' || typeof command !== 'string') throw new DevError('name and command are required');
    res.json({ success: true, data: await processes.startProcess(sid(req), { name, command, cwd, readyUrl }) });
  } catch (err) {
    fail(res, err, 'dev:process-start');
  }
});

export default router;
