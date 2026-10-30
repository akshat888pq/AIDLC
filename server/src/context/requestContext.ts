import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../security/users.js';
import { getProject } from '../services/projectStore.js';

/**
 * Who is asking, about which project, in which phase — carried implicitly through
 * every await of a request so LLM middleware (audit, quota, rate limit, cache) can
 * read it without the phase engine or any route passing it along.
 */
export interface RequestContext {
  requestId: string;
  userId: string;
  userName: string;
  role: Role;
  /** The project's session id — the key every project-scoped store uses. */
  projectId?: string;
  phase?: string;
  sectionId?: string;
  /** `x-aidlc-llm-cache: bypass` — skip the response cache for this request. */
  cacheBypass?: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Router prefix → the phase its routes belong to. */
const PHASE_OF_PREFIX: Record<string, string> = {
  analyze: 'requirement',
  questions: 'requirement',
  chat: 'requirement',
  upload: 'requirement',
  export: 'requirement',
  requirements: 'requirement',
  projects: 'requirement',
  architecture: 'architecture',
  design: 'design',
  tests: 'testing',
  release: 'release',
  dev: 'development',
};

/** Routes keyed by the browser's workspace session rather than a project. */
const WORKSPACE_SCOPED = new Set(['git', 'tickets', 'connections', 'oauth', 'governance']);

/**
 * Derive project / phase / section from the URL. Runs before routing, so it reads
 * the path rather than req.params. The client also sends the project it is
 * working in as a header, which is used only where the URL has none.
 */
export function deriveScope(req: Request): Pick<RequestContext, 'projectId' | 'phase' | 'sectionId'> {
  const parts = req.path.split('/').filter(Boolean); // ['api', prefix, ...]
  if (parts[0] !== 'api') return {};
  const prefix = parts[1];
  const header = (name: string) => {
    const v = req.header(name);
    return v ? v.slice(0, 200) : undefined;
  };
  const bodySection =
    req.body && typeof req.body === 'object' && req.body.sectionNumber !== undefined
      ? String(req.body.sectionNumber)
      : undefined;

  if (prefix === 'phase') {
    // /api/phase/:phaseId/:sessionId/(sections|diagrams|mockups)/:id/...
    const [phase, projectId, kind, id] = parts.slice(2);
    const sectionId = ['sections', 'diagrams', 'mockups', 'deliverables'].includes(kind) ? id : undefined;
    return { phase, projectId, sectionId };
  }

  if (prefix === 'phases') {
    return { projectId: parts[2] === 'progress' ? parts[3] : undefined };
  }

  if (WORKSPACE_SCOPED.has(prefix)) {
    return { projectId: header('x-aidlc-project'), phase: header('x-aidlc-phase') };
  }

  const phase = PHASE_OF_PREFIX[prefix];
  if (!phase) return {};
  let projectId: string | undefined = parts[2];
  if (prefix === 'requirements' && projectId === 'project') projectId = parts[3];
  if (prefix === 'dev' && projectId === 'templates') projectId = undefined;
  return { phase, projectId, sectionId: bodySection };
}

/**
 * Architecture / design / test / release routes key on the project record id; every
 * other store keys on the project's session id. Governance data uses the session id.
 */
function toSessionId(id: string | undefined): string | undefined {
  if (!id || id === 'stats') return undefined;
  return getProject(id)?.sessionId ?? id;
}

/** Express middleware: must run after identity resolution and body parsing. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user = res.locals.user as { id: string; name: string; role: Role };
  const scope = deriveScope(req);
  const ctx: RequestContext = {
    requestId: Math.random().toString(36).slice(2, 10),
    userId: user.id,
    userName: user.name,
    role: user.role,
    ...scope,
    projectId: toSessionId(scope.projectId),
    cacheBypass: req.header('x-aidlc-llm-cache') === 'bypass',
  };
  res.locals.ctx = ctx;
  runWithContext(ctx, next);
}
