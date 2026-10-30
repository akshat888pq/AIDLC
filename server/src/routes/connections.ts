import { Router } from 'express';
import { getConnections, removeConnection, getAdapter, saveConnection } from '../services/connectionStore.js';

const router = Router();

router.get('/:sessionId', (req, res) => {
  const connections = getConnections(req.params.sessionId);
  const safe = connections.map((c) => ({
    provider: c.provider,
    connected: c.connected,
    orgName: c.orgName,
    userName: c.userName,
    organizationUrl: c.organizationUrl,
  }));
  res.json({ success: true, data: safe });
});

router.post('/:sessionId/test/:provider', async (req, res) => {
  try {
    const { sessionId, provider } = req.params;
    const adapter = await getAdapter(sessionId, provider);
    if (!adapter) {
      res.json({ success: true, data: { ok: false, error: 'Not connected' } });
      return;
    }
    const result = await adapter.testConnection();
    if (result.ok) {
      const connections = getConnections(sessionId);
      const conn = connections.find((c) => c.provider === provider);
      if (conn) {
        conn.userName = result.user;
        conn.orgName = result.org;
        saveConnection(sessionId, conn);
      }
    }
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:sessionId/azure-org', (req, res) => {
  try {
    const { sessionId } = req.params;
    const { organizationUrl } = req.body;
    if (!organizationUrl) {
      res.status(400).json({ success: false, error: 'organizationUrl required' });
      return;
    }
    const connections = getConnections(sessionId);
    const conn = connections.find((c) => c.provider === 'azure-devops');
    if (!conn) {
      res.status(404).json({ success: false, error: 'Azure DevOps not connected' });
      return;
    }
    conn.organizationUrl = organizationUrl;
    saveConnection(sessionId, conn);
    res.json({ success: true, data: { organizationUrl } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:sessionId/:provider', (req, res) => {
  const { sessionId, provider } = req.params;
  removeConnection(sessionId, provider);
  res.json({ success: true, data: { disconnected: provider } });
});

export default router;
