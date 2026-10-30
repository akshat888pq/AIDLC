import { Router } from 'express';
import type { Response } from 'express';
import { queryAudit } from '../audit/auditStore.js';
import type { AuditEntry, AuditQuery } from '../audit/auditStore.js';
import { cacheStats, clearCache } from '../services/llm/governance/cache.js';
import { quotaStatus } from '../services/llm/governance/quota.js';
import { modelAssignments } from '../services/llm/modelConfig.js';
import { getProject } from '../services/projectStore.js';
import { isRole, listUsers, setUserRole } from '../security/users.js';
import { mongoConfigured } from '../storage/mongo.js';

/**
 * Governance API — audit trail, quota, response cache, users & roles.
 * Role requirements are enforced by the route policy (security/policy.ts).
 */
const router = Router();

function fail(res: Response, err: any) {
  res.status(err.statusCode ?? 500).json({ success: false, error: err.message || 'Unknown error' });
}

/** Accept either the project record id or its session id. */
function sessionIdOf(id: string): string {
  return getProject(id)?.sessionId ?? id;
}

router.get('/me', (_req, res) => {
  res.json({ success: true, data: res.locals.user });
});

router.get('/config', (_req, res) => {
  res.json({
    success: true,
    data: {
      modelAssignments,
      claudeConfigured: !!process.env.ANTHROPIC_API_KEY?.trim(),
      auditStorage: mongoConfigured() ? 'mongodb' : 'file',
      rateLimitPerMinute: Number(process.env.LLM_RATE_LIMIT_PER_MINUTE ?? 20),
    },
  });
});

router.get('/audit', async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const query: AuditQuery = {
      projectId: q.projectId ? sessionIdOf(q.projectId) : undefined,
      phase: q.phase || undefined,
      userId: q.userId || undefined,
      kind: q.kind === 'llm' || q.kind === 'tool' ? q.kind : undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      sortBy: (q.sortBy as keyof AuditEntry) || undefined,
      order: q.order === 'asc' ? 'asc' : 'desc',
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    };
    res.json({ success: true, data: await queryAudit(query) });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/quota/:projectId', (req, res) => {
  const projectId = sessionIdOf(req.params.projectId);
  res.json({ success: true, data: { ...quotaStatus(projectId), cache: cacheStats(projectId) } });
});

router.delete('/cache/:projectId', (req, res) => {
  const cleared = clearCache(sessionIdOf(req.params.projectId));
  res.json({ success: true, data: { cleared } });
});

router.get('/users', async (_req, res) => {
  try {
    res.json({ success: true, data: await listUsers() });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/users/:userId/role', async (req, res) => {
  try {
    const { role } = req.body ?? {};
    if (!isRole(role)) {
      res.status(400).json({ success: false, error: 'role must be one of admin, lead, contributor, viewer' });
      return;
    }
    res.json({ success: true, data: await setUserRole(req.params.userId, role) });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
