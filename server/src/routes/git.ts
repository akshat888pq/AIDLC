import { Router } from 'express';
import { getGitConnections, getGitConnectionPublic, getGitAdapter, saveGitConnection, removeGitConnection } from '../services/gitConnectionStore.js';
import { getGitConfig, saveGitConfig } from '../services/git/gitConfig.js';
import { getGitHubAuthUrl, exchangeGitHubCode } from '../services/oauth/githubOAuth.js';
import { getGitLabAuthUrl, exchangeGitLabCode } from '../services/oauth/gitlabOAuth.js';
import { getConnections } from '../services/connectionStore.js';
import { getProject } from '../services/projectStore.js';
import type { GitProvider, GitRepoConfig } from '../types/index.js';

const router = Router();

// ── OAuth Authorize URLs ──

router.get('/oauth/:provider/authorize', (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    const { provider } = req.params;
    if (!sessionId) { res.status(400).json({ success: false, error: 'sessionId required' }); return; }

    let url: string;
    if (provider === 'github') url = getGitHubAuthUrl(sessionId);
    else if (provider === 'gitlab') url = getGitLabAuthUrl(sessionId);
    else if (provider === 'azure-repos') {
      const ticketConns = getConnections(sessionId);
      const azure = ticketConns.find((c) => c.provider === 'azure-devops' && c.connected);
      if (azure) {
        saveGitConnection(sessionId, {
          provider: 'azure-repos',
          connected: true,
          accessToken: azure.accessToken,
          refreshToken: azure.refreshToken,
          expiresAt: azure.expiresAt,
          userName: azure.userName,
          orgName: azure.orgName,
        });
        res.json({ success: true, data: { url: null, autoConnected: true } });
        return;
      }
      res.status(400).json({ success: false, error: 'Connect Azure DevOps first (on Connections page) to use Azure Repos' });
      return;
    } else {
      res.status(400).json({ success: false, error: `Unknown provider: ${provider}` });
      return;
    }

    res.json({ success: true, data: { url } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── OAuth Callbacks ──

router.get('/oauth/github/callback', async (req, res) => {
  try {
    const code = req.query.code as string;
    const sessionId = req.query.state as string;
    if (!code || !sessionId) { res.status(400).send(callbackPage(false, 'Missing code or state')); return; }

    const { accessToken } = await exchangeGitHubCode(code);

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    const user = userRes.ok ? await userRes.json() : {};

    saveGitConnection(sessionId, {
      provider: 'github',
      connected: true,
      accessToken,
      userName: user.login,
      orgName: user.name || user.login,
      avatarUrl: user.avatar_url,
    });

    res.send(callbackPage(true));
  } catch (err: any) {
    res.status(500).send(callbackPage(false, err.message));
  }
});

router.get('/oauth/gitlab/callback', async (req, res) => {
  try {
    const code = req.query.code as string;
    const sessionId = req.query.state as string;
    if (!code || !sessionId) { res.status(400).send(callbackPage(false, 'Missing code or state')); return; }

    const tokens = await exchangeGitLabCode(code);

    const userRes = await fetch('https://gitlab.com/api/v4/user', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const user = userRes.ok ? await userRes.json() : {};

    saveGitConnection(sessionId, {
      provider: 'gitlab',
      connected: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      userName: user.username,
      orgName: user.name || user.username,
      avatarUrl: user.avatar_url,
    });

    res.send(callbackPage(true));
  } catch (err: any) {
    res.status(500).send(callbackPage(false, err.message));
  }
});

// ── Connections ──

router.get('/connections/:sessionId', (req, res) => {
  const connections = getGitConnections(req.params.sessionId);
  res.json({ success: true, data: connections.map(getGitConnectionPublic) });
});

router.post('/connections/:sessionId/test/:provider', async (req, res) => {
  try {
    const { sessionId, provider } = req.params;
    const orgUrl = req.query.orgUrl as string;
    const adapter = await getGitAdapter(sessionId, provider as GitProvider, orgUrl);
    if (!adapter) { res.status(404).json({ success: false, error: 'No connected adapter' }); return; }
    const result = await adapter.testConnection();
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/connections/:sessionId/:provider', (req, res) => {
  removeGitConnection(req.params.sessionId, req.params.provider);
  res.json({ success: true, data: null });
});

// ── Repos & Branches ──

router.get('/:sessionId/repos', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const provider = req.query.provider as GitProvider;
    const orgUrl = req.query.orgUrl as string;
    const adapter = await getGitAdapter(sessionId, provider, orgUrl);
    if (!adapter) { res.status(404).json({ success: false, error: 'No connected git provider' }); return; }
    const repos = await adapter.getRepos();
    res.json({ success: true, data: repos });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:sessionId/repos/:repoId/branches', async (req, res) => {
  try {
    const { sessionId, repoId } = req.params;
    const provider = req.query.provider as GitProvider;
    const orgUrl = req.query.orgUrl as string;
    const adapter = await getGitAdapter(sessionId, provider, orgUrl);
    if (!adapter) { res.status(404).json({ success: false, error: 'No connected git provider' }); return; }
    const branches = await adapter.getBranches(decodeURIComponent(repoId));
    res.json({ success: true, data: branches });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Config ──

router.get('/config/:projectId', (req, res) => {
  const config = getGitConfig(req.params.projectId);
  res.json({ success: true, data: config });
});

router.post('/config/:projectId', (req, res) => {
  try {
    const config: GitRepoConfig = req.body;
    saveGitConfig(req.params.projectId, config);
    res.json({ success: true, data: config });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Commit ──

router.post('/:sessionId/commit', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { provider, repoId, branch, path, content, message, orgUrl } = req.body;

    const adapter = await getGitAdapter(sessionId, provider as GitProvider, orgUrl);
    if (!adapter) { res.status(404).json({ success: false, error: 'No connected git provider' }); return; }

    const result = await adapter.commitFile(repoId, branch, path, content, message);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:sessionId/commit-multiple', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { provider, repoId, branch, files, message, orgUrl } = req.body;

    const adapter = await getGitAdapter(sessionId, provider as GitProvider, orgUrl);
    if (!adapter) { res.status(404).json({ success: false, error: 'No connected git provider' }); return; }

    const result = await adapter.commitMultipleFiles(repoId, branch, files, message);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Branch + PR ──

router.post('/:sessionId/branch', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { provider, repoId, sourceBranch, newBranch, orgUrl } = req.body;

    const adapter = await getGitAdapter(sessionId, provider as GitProvider, orgUrl);
    if (!adapter) { res.status(404).json({ success: false, error: 'No connected git provider' }); return; }

    const branch = await adapter.createBranch(repoId, sourceBranch, newBranch);
    res.json({ success: true, data: branch });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:sessionId/pull-request', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { provider, repoId, sourceBranch, targetBranch, title, description, orgUrl } = req.body;

    const adapter = await getGitAdapter(sessionId, provider as GitProvider, orgUrl);
    if (!adapter) { res.status(404).json({ success: false, error: 'No connected git provider' }); return; }

    const pr = await adapter.createPullRequest(repoId, sourceBranch, targetBranch, title, description);
    res.json({ success: true, data: pr });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── File content ──

router.get('/:sessionId/file', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { provider, repoId, branch, path: filePath, orgUrl } = req.query;

    const adapter = await getGitAdapter(sessionId, provider as GitProvider, orgUrl as string);
    if (!adapter) { res.status(404).json({ success: false, error: 'No connected git provider' }); return; }

    const content = await adapter.getFileContent(repoId as string, branch as string, filePath as string);
    res.json({ success: true, data: { content } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Commit History ──

router.get('/history/:projectId', async (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project) { res.status(404).json({ success: false, error: 'Project not found' }); return; }

    const config = getGitConfig(project.id);
    if (!config) { res.status(400).json({ success: false, error: 'No git config for this project' }); return; }

    const sessionId = project.sessionId;
    if (!sessionId) { res.status(400).json({ success: false, error: 'Project has no session' }); return; }

    const adapter = await getGitAdapter(sessionId, config.provider, undefined);
    if (!adapter) { res.status(404).json({ success: false, error: 'No connected git provider' }); return; }

    const pathFilter = config.basePath || undefined;
    const commits = await adapter.getCommitHistory(config.repoId, config.branch, pathFilter, 30);
    res.json({ success: true, data: commits });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function callbackPage(success: boolean, error?: string): string {
  return `<!DOCTYPE html>
<html><head><title>AIDLC Git OAuth</title></head>
<body>
<script>
  window.opener && window.opener.postMessage(
    ${JSON.stringify({ type: 'git-oauth-callback', success, error: error || null })},
    window.location.origin
  );
  setTimeout(() => window.close(), 1500);
</script>
<p>${success ? 'Git provider connected! This window will close.' : `Error: ${error || 'Unknown error'}`}</p>
</body></html>`;
}

export default router;
