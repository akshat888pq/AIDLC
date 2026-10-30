import { Router } from 'express';
import {
  getAllProjects,
  getProject,
  createProject,
  updateProject,
  archiveProject,
  deleteProject,
  computeProjectStats,
  getProjectStats,
} from '../services/projectStore.js';
import { sessions, chatHistories } from '../state.js';

const router = Router();

router.get('/', (_req, res) => {
  try {
    const projects = getAllProjects();
    const enriched = projects.map((p) => ({
      ...p,
      ...computeProjectStats(p),
    }));
    res.json({ success: true, data: enriched });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/stats', (_req, res) => {
  try {
    const stats = getProjectStats();
    res.json({ success: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:projectId', (req, res) => {
  const project = getProject(req.params.projectId);
  if (!project) { res.status(404).json({ success: false, error: 'Project not found' }); return; }
  const enriched = { ...project, ...computeProjectStats(project) };
  res.json({ success: true, data: enriched });
});

router.post('/', (req, res) => {
  try {
    const project = createProject(req.body);
    res.json({ success: true, data: project });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:projectId', (req, res) => {
  try {
    const updated = updateProject(req.params.projectId, req.body);
    if (!updated) { res.status(404).json({ success: false, error: 'Project not found' }); return; }
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Hide a project without destroying its work. */
router.post('/:projectId/archive', (req, res) => {
  try {
    const success = archiveProject(req.params.projectId);
    if (!success) { res.status(404).json({ success: false, error: 'Project not found' }); return; }
    res.json({ success: true, data: null });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Permanently delete a project and every artifact namespaced under it. The in-memory
 * session and chat history go too — otherwise a server that has not restarted would
 * still answer for the deleted project's session id.
 */
router.delete('/:projectId', (req, res) => {
  try {
    const deleted = deleteProject(req.params.projectId);
    if (!deleted) { res.status(404).json({ success: false, error: 'Project not found' }); return; }

    if (deleted.sessionId) {
      sessions.delete(deleted.sessionId);
      chatHistories.delete(deleted.sessionId);
    }

    console.log(`[projects] deleted project=${deleted.id} session=${deleted.sessionId} name="${deleted.name}"`);
    res.json({ success: true, data: { id: deleted.id, name: deleted.name } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
