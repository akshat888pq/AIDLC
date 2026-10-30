import { Router } from 'express';
import { getAzureAuthUrl, exchangeAzureCode } from '../services/oauth/azureOAuth.js';
import { getJiraAuthUrl, exchangeJiraCode, getJiraCloudId } from '../services/oauth/jiraOAuth.js';
import { saveConnection } from '../services/connectionStore.js';

const router = Router();

// Azure DevOps OAuth
router.get('/azure/authorize', (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) { res.status(400).json({ success: false, error: 'sessionId required' }); return; }
    const url = getAzureAuthUrl(sessionId);
    res.json({ success: true, data: { url } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/azure/callback', async (req, res) => {
  try {
    const code = req.query.code as string;
    const sessionId = req.query.state as string;

    if (!code || !sessionId) {
      res.status(400).send(callbackPage(false, 'Missing code or state'));
      return;
    }

    const tokens = await exchangeAzureCode(code);

    const orgUrl = (req.query.orgUrl as string) || '';

    saveConnection(sessionId, {
      provider: 'azure-devops',
      connected: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      organizationUrl: orgUrl || undefined,
    });

    res.send(callbackPage(true));
  } catch (err: any) {
    res.status(500).send(callbackPage(false, err.message));
  }
});

// Jira OAuth 2.0 (3LO)
router.get('/jira/authorize', (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) { res.status(400).json({ success: false, error: 'sessionId required' }); return; }
    const url = getJiraAuthUrl(sessionId);
    res.json({ success: true, data: { url } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/jira/callback', async (req, res) => {
  try {
    const code = req.query.code as string;
    const sessionId = req.query.state as string;

    if (!code || !sessionId) {
      res.status(400).send(callbackPage(false, 'Missing code or state'));
      return;
    }

    const tokens = await exchangeJiraCode(code);
    const { cloudId, siteName } = await getJiraCloudId(tokens.accessToken);

    saveConnection(sessionId, {
      provider: 'jira',
      connected: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      cloudId,
      orgName: siteName,
    });

    res.send(callbackPage(true));
  } catch (err: any) {
    res.status(500).send(callbackPage(false, err.message));
  }
});

function callbackPage(success: boolean, error?: string): string {
  return `<!DOCTYPE html>
<html><head><title>AIDLC OAuth</title></head>
<body>
<script>
  window.opener && window.opener.postMessage(
    ${JSON.stringify({ type: 'oauth-callback', success, error: error || null })},
    window.location.origin
  );
  setTimeout(() => window.close(), 1500);
</script>
<p>${success ? 'Connected successfully! This window will close.' : `Error: ${error || 'Unknown error'}`}</p>
</body></html>`;
}

export default router;
