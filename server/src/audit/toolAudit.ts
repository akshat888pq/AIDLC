import type { NextFunction, Request, Response } from 'express';
import type { RequestContext } from '../context/requestContext.js';
import { newAuditId, sha256, writeAudit } from './auditStore.js';

/**
 * Audits tool actions — Git commits, ticket sync, file exports — flagged in the
 * route policy. Logged when the response finishes, with the same shape as LLM
 * entries: the request body is hashed as the "prompt", nothing stored in clear.
 */
export function toolAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const tool = (res.locals.policy as { tool?: string } | undefined)?.tool;
  if (!tool) return next();

  const started = Date.now();
  const inputHash = req.body && Object.keys(req.body).length ? sha256(JSON.stringify(req.body)) : null;
  const files: string[] = [];
  if (typeof req.body?.path === 'string') files.push(req.body.path);
  if (Array.isArray(req.body?.files)) {
    for (const f of req.body.files) if (typeof f?.path === 'string') files.push(f.path);
  }

  res.on('finish', () => {
    const ctx = res.locals.ctx as RequestContext | undefined;
    void writeAudit({
      id: newAuditId(),
      timestamp: new Date().toISOString(),
      kind: 'tool',
      action: tool,
      status: res.statusCode < 400 ? 'success' : res.statusCode === 428 ? 'blocked' : 'error',
      projectId: ctx?.projectId ?? null,
      phase: ctx?.phase ?? null,
      sectionId: ctx?.sectionId ?? null,
      userId: ctx?.userId ?? 'anonymous',
      userName: ctx?.userName ?? 'Anonymous',
      provider: typeof req.body?.provider === 'string' ? req.body.provider : null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      promptHash: inputHash,
      outputHash: null,
      sourceDocuments: files,
      durationMs: Date.now() - started,
      ...(res.statusCode >= 400 ? { error: `HTTP ${res.statusCode}` } : {}),
    });
  });
  next();
}
