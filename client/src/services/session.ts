/**
 * Two different session scopes exist, and conflating them is what leaks one project's
 * context into another:
 *
 *   workspace session — identifies this browser to the server for things that are not
 *     owned by any project: OAuth tokens for Jira / Azure DevOps / GitHub / GitLab.
 *     One per browser, shared by every project, and persisted so connections survive
 *     a tab close.
 *
 *   project session — `project.sessionId`, minted by the server when the project is
 *     created. It namespaces everything the project knows: its Second Brain, uploaded
 *     documents, Q&A history, chat and requirement documents. Never derive it from the
 *     browser, and never fall back to the workspace session — that is precisely how two
 *     projects end up sharing one brain.
 */

const WORKSPACE_KEY = 'aidlc-workspace';
const LEGACY_KEY = 'aidlc-session';

let cached: string | null = null;

/** The browser-wide id used only for provider connections. */
export function getWorkspaceSessionId(): string {
  if (cached) return cached;

  let id = safeGet(localStorage, WORKSPACE_KEY);

  // Adopt the id from the old sessionStorage scheme so connections authorized before
  // this split keep working instead of silently appearing disconnected.
  if (!id) {
    id = safeGet(sessionStorage, LEGACY_KEY) ?? crypto.randomUUID();
    safeSet(localStorage, WORKSPACE_KEY, id);
  }

  cached = id;
  return id;
}

function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(store: Storage, key: string, value: string): void {
  try {
    store.setItem(key, value);
  } catch {
    // Private browsing or blocked storage — the id still works for this page load.
  }
}
