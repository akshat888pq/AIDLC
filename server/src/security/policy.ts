import type { NextFunction, Request, Response } from 'express';
import type { Role } from './users.js';
import { roleAtLeast } from './users.js';

/**
 * Route policy, in one table: which role a route needs, which routes are
 * destructive (need explicit confirmation) and which are tool actions (audited).
 * First matching rule wins; unmatched GETs need viewer, other methods contributor.
 */

interface Rule {
  method: string | RegExp;
  path: RegExp;
  role: Role;
  /** Shown to the user in the confirmation prompt. */
  confirm?: string;
  /** Audit action name for tool actions. */
  tool?: string;
  /** Extra predicate on the request (e.g. body shape). */
  when?: (req: Request) => boolean;
}

const ANY = /.*/;
const WRITE = /^(POST|PUT|PATCH|DELETE)$/;

export const RULES: Rule[] = [
  // ── Admin: users, roles and settings ──
  { method: WRITE, path: /^\/api\/governance\/users/, role: 'admin' },
  { method: WRITE, path: /^\/api\/git\/config\//, role: 'admin' },
  { method: 'DELETE', path: /^\/api\/projects\/[^/]+$/, role: 'admin', confirm: 'Permanently delete this project' },
  { method: 'POST', path: /^\/api\/projects\/[^/]+\/archive$/, role: 'admin' },
  { method: 'DELETE', path: /^\/api\/(?:connections|git\/connections)\//, role: 'admin', confirm: 'Disconnect this provider' },

  // Approving the coding agent's own file write / command IS the confirmation step.
  { method: 'POST', path: /^\/api\/dev\/[^/]+\/agent\/approve$/, role: 'contributor' },

  // ── Lead: Git commits, ticket sync, finalize, approve / reject ──
  { method: 'POST', path: /^\/api\/git\/[^/]+\/commit$/, role: 'lead', confirm: 'Commit a file to the Git repository', tool: 'git.commit' },
  { method: 'POST', path: /^\/api\/git\/[^/]+\/commit-multiple$/, role: 'lead', confirm: 'Commit files to the Git repository', tool: 'git.commit' },
  { method: 'POST', path: /^\/api\/git\/[^/]+\/branch$/, role: 'lead', confirm: 'Create a branch in the Git repository', tool: 'git.branch' },
  { method: 'POST', path: /^\/api\/git\/[^/]+\/pull-request$/, role: 'lead', confirm: 'Open a pull request', tool: 'git.pull-request' },
  { method: 'POST', path: /^\/api\/phase\/[^/]+\/[^/]+\/git\/commit$/, role: 'lead', confirm: 'Commit this phase package to Git', tool: 'git.commit' },
  { method: 'POST', path: /^\/api\/tickets\/[^/]+\/create-tickets$/, role: 'lead', confirm: 'Create tickets in the external tracker (Jira / Azure DevOps)', tool: 'tickets.create' },
  { method: 'POST', path: /\/finalize$/, role: 'lead', tool: 'document.finalize' },
  { method: 'POST', path: /\/proceed$/, role: 'lead' },
  { method: 'POST', path: /\/approve$/, role: 'lead' },
  { method: 'POST', path: /\/revert$/, role: 'lead' },
  { method: 'POST', path: /\/governance\/cache\//, role: 'lead' },
  { method: 'DELETE', path: /^\/api\/governance\/cache\//, role: 'lead' },

  // ── Contributor: destructive workspace actions that still need confirmation ──
  {
    method: 'POST',
    path: /^\/api\/dev\/[^/]+\/agent\/mode$/,
    role: 'contributor',
    confirm: 'Let the coding agent write files and run commands without asking each time',
    when: (req) => req.body?.mode === 'auto' || req.body?.mode === 'auto-edit',
  },
  { method: 'DELETE', path: /^\/api\/dev\/[^/]+\/files$/, role: 'contributor', confirm: 'Delete this file from the workspace', tool: 'workspace.delete' },

  // ── Exports (audited, read-only) ──
  { method: 'GET', path: /\/(?:download|excel-report\/download|deliverables\/[^/]+\/download|mockups\/archive)$/, role: 'viewer', tool: 'file.export' },
  { method: 'GET', path: /^\/api\/export\//, role: 'viewer', tool: 'file.export' },

  // ── Defaults ──
  { method: 'GET', path: ANY, role: 'viewer' },
  { method: ANY, path: ANY, role: 'contributor' },
];

function matches(rule: Rule, req: Request): boolean {
  const methodOk = typeof rule.method === 'string' ? rule.method === req.method : rule.method.test(req.method);
  return methodOk && rule.path.test(req.path) && (!rule.when || rule.when(req));
}

export function resolvePolicy(req: Request): { role: Role; confirm?: string; tool?: string } {
  const rule = RULES.find((r) => matches(r, req));
  return { role: rule?.role ?? 'contributor', confirm: rule?.confirm, tool: rule?.tool };
}

/** OAuth redirects arrive from the provider with no identity headers. */
const PUBLIC = /^\/api\/(?:health$|oauth\/|git\/oauth\/)/;

/** RBAC. Must run after identityMiddleware. */
export function rbacMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS' || PUBLIC.test(req.path)) return next();
  const policy = resolvePolicy(req);
  res.locals.policy = policy;
  const role = (res.locals.user?.role ?? 'viewer') as Role;
  if (!roleAtLeast(role, policy.role)) {
    res.status(403).json({
      success: false,
      error: `This action needs the "${policy.role}" role; you are "${role}". Ask an admin to change your role in Settings → Users & Roles.`,
    });
    return;
  }
  next();
}

/**
 * Destructive actions answer 428 until the request carries `x-aidlc-confirm: yes`.
 * The client asks the human, then retries with the header. This guarantees a
 * deliberate second step in the UI; it is not an authentication control.
 */
export function confirmationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const confirm = (res.locals.policy as { confirm?: string } | undefined)?.confirm;
  if (!confirm || req.header('x-aidlc-confirm') === 'yes') return next();
  res.status(428).json({ success: false, confirmationRequired: true, action: confirm, error: `Confirmation required: ${confirm}` });
}
