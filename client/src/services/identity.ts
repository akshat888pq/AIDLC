/**
 * Who this browser is, and the project it is working in — attached to every /api
 * request by one fetch interceptor, so no API helper has to pass them along.
 *
 * The user id is self-chosen and stored locally: it identifies, it does not
 * authenticate. SSO replaces this module when it lands.
 *
 * The interceptor also owns the destructive-action handshake: the server answers
 * 428 for a commit, ticket sync, delete etc.; we ask the human, then retry with
 * `x-aidlc-confirm: yes`.
 */

const USER_KEY = 'aidlc.user';

export interface LocalUser {
  id: string;
  name: string;
}

let user: LocalUser | null = null;
let activeProject: { sessionId: string; phase?: string } | null = null;

export function getLocalUser(): LocalUser {
  if (user) return user;
  try {
    const stored = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    if (stored?.id) user = stored;
  } catch {
    /* corrupt or blocked storage */
  }
  if (!user) {
    user = { id: crypto.randomUUID(), name: 'Local user' };
    save();
  }
  return user;
}

export function setLocalUserName(name: string): void {
  user = { ...getLocalUser(), name: name.trim() || 'Local user' };
  save();
}

function save() {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* private mode — the id still works for this page load */
  }
}

/** The command center sets this so workspace-scoped calls (Git, tickets) are attributed to a project. */
export function setActiveProject(sessionId: string | null, phase?: string): void {
  activeProject = sessionId ? { sessionId, phase } : null;
}

function isApi(url: string): boolean {
  return url.startsWith('/api') || url.startsWith(`${location.origin}/api`);
}

function cancelled(): Response {
  return new Response(JSON.stringify({ success: false, error: 'Cancelled — nothing was changed.' }), {
    status: 428,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function installApiInterceptor(): void {
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isApi(url)) return original(input, init);

    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const me = getLocalUser();
    headers.set('x-aidlc-user-id', me.id);
    headers.set('x-aidlc-user-name', encodeURIComponent(me.name));
    if (activeProject) {
      headers.set('x-aidlc-project', activeProject.sessionId);
      if (activeProject.phase) headers.set('x-aidlc-phase', activeProject.phase);
    }

    const res = await original(input, { ...init, headers });
    if (res.status !== 428) return res;

    const body = await res.clone().json().catch(() => null);
    if (!body?.confirmationRequired) return res;
    const ok = window.confirm(`${body.action}?\n\nThis changes something outside AIDLC or cannot be undone. Continue?`);
    if (!ok) return cancelled();

    headers.set('x-aidlc-confirm', 'yes');
    return original(input, { ...init, headers });
  };
}
