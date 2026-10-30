import { Router } from 'express';
import { getLLM } from '../state.js';
import { getReleaseSectionPrompt, type ReleaseSectionContext } from '../prompts/releaseSections/index.js';
import {
  createRelease,
  getRelease,
  getReleasesForProject,
  updateReleaseSectionContent,
  approveReleaseSection,
  skipReleaseSection,
  revertReleaseSection,
  finalizeRelease,
  assembleRelease,
  toReleaseSummary,
} from '../services/releaseStore.js';
import { getArchitecture, assembleArchitecture } from '../services/architectureStore.js';
import { getDesign, assembleDesign } from '../services/designStore.js';
import { getTest, assembleTest } from '../services/testStore.js';
import { getRequirement } from '../services/requirementStore.js';
import { assembleRequirement } from '../prompts/sections/assembler.js';
import { getProject } from '../services/projectStore.js';

const router = Router();

function getRequirementContent(projectId: string, requirementId: string): string | null {
  const project = getProject(projectId);
  if (!project) return null;
  const sessionId = project.sessionId;
  if (!sessionId) return null;
  const doc = getRequirement(sessionId, requirementId);
  if (!doc) return null;
  return assembleRequirement(doc);
}

function getArchitectureContent(projectId: string, archId: string): string | null {
  const doc = getArchitecture(projectId, archId);
  if (!doc) return null;
  return assembleArchitecture(doc);
}

function getDesignContent(projectId: string, designId: string): string | null {
  const doc = getDesign(projectId, designId);
  if (!doc) return null;
  return assembleDesign(doc);
}

function getTestContent(projectId: string, testId: string): string | null {
  const doc = getTest(projectId, testId);
  if (!doc) return null;
  return assembleTest(doc);
}

router.get('/:projectId/list', (req, res) => {
  try {
    const docs = getReleasesForProject(req.params.projectId);
    const summaries = docs.map(toReleaseSummary);
    res.json({ success: true, data: summaries });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:projectId/init', (req, res) => {
  try {
    const { projectId } = req.params;
    const { requirementId, architectureId, designId, testId } = req.body;

    if (!requirementId || !architectureId || !designId || !testId) {
      res.status(400).json({ success: false, error: 'requirementId, architectureId, designId, and testId are required' });
      return;
    }

    const project = getProject(projectId);
    if (!project) { res.status(404).json({ success: false, error: 'Project not found' }); return; }

    const reqContent = getRequirementContent(projectId, requirementId);
    if (!reqContent) { res.status(404).json({ success: false, error: 'Requirement not found' }); return; }

    const archContent = getArchitectureContent(projectId, architectureId);
    if (!archContent) { res.status(404).json({ success: false, error: 'Architecture not found' }); return; }

    const desContent = getDesignContent(projectId, designId);
    if (!desContent) { res.status(404).json({ success: false, error: 'Design not found' }); return; }

    const testContent = getTestContent(projectId, testId);
    if (!testContent) { res.status(404).json({ success: false, error: 'Test plan not found' }); return; }

    const existing = getReleasesForProject(projectId)
      .find((r) => r.requirementId === requirementId && r.testId === testId && r.status !== 'finalized');

    if (existing) { res.json({ success: true, data: existing }); return; }

    const doc = createRelease(projectId, requirementId, architectureId, designId, testId, project.name);
    res.json({ success: true, data: doc });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:projectId/:releaseId', (req, res) => {
  const doc = getRelease(req.params.projectId, req.params.releaseId);
  if (!doc) { res.status(404).json({ success: false, error: 'Release notes not found' }); return; }
  res.json({ success: true, data: doc });
});

router.post('/:projectId/:releaseId/generate', async (req, res) => {
  try {
    const { projectId, releaseId } = req.params;
    const { sectionNumber, feedback } = req.body;

    const doc = getRelease(projectId, releaseId);
    if (!doc) { res.status(404).json({ success: false, error: 'Release notes not found' }); return; }

    const reqContent = getRequirementContent(projectId, doc.requirementId);
    if (!reqContent) { res.status(404).json({ success: false, error: 'Source requirement not found' }); return; }

    const archContent = getArchitectureContent(projectId, doc.architectureId);
    if (!archContent) { res.status(404).json({ success: false, error: 'Source architecture not found' }); return; }

    const desContent = getDesignContent(projectId, doc.designId);
    if (!desContent) { res.status(404).json({ success: false, error: 'Source design not found' }); return; }

    const testContent = getTestContent(projectId, doc.testId);
    if (!testContent) { res.status(404).json({ success: false, error: 'Source test plan not found' }); return; }

    const llm = getLLM();
    if (!llm) { res.status(500).json({ success: false, error: 'No LLM configured' }); return; }

    const section = doc.sections.find((s) => s.number === sectionNumber);
    if (!section) { res.status(400).json({ success: false, error: 'Invalid section number' }); return; }

    section.status = 'generating';

    const previousSections: Record<string, string> = {};
    for (const s of doc.sections) {
      if (s.status === 'approved' && s.content) {
        previousSections[String(s.number)] = s.content;
      }
    }

    const project = getProject(projectId);

    const context: ReleaseSectionContext = {
      requirementContent: reqContent,
      architectureContent: archContent,
      designContent: desContent,
      testContent,
      previousSections,
      userFeedback: feedback || undefined,
      projectName: project?.name || doc.projectName,
      requirementId: doc.requirementId,
      architectureId: doc.architectureId,
      designId: doc.designId,
      testId: doc.testId,
      releaseId: doc.id,
    };

    const prompt = getReleaseSectionPrompt(sectionNumber, context);
    const content = await llm.analyze(prompt, '');

    const updated = updateReleaseSectionContent(doc, sectionNumber, content.trim(), feedback);
    const updatedSection = updated.sections.find((s) => s.number === sectionNumber)!;

    res.json({
      success: true,
      data: {
        sectionNumber,
        content: updatedSection.content,
        version: updatedSection.versions.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:projectId/:releaseId/approve', (req, res) => {
  try {
    const { projectId, releaseId } = req.params;
    const { sectionNumber, content } = req.body;
    const doc = getRelease(projectId, releaseId);
    if (!doc) { res.status(404).json({ success: false, error: 'Release notes not found' }); return; }
    const updated = approveReleaseSection(doc, sectionNumber, content);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:projectId/:releaseId/skip', (req, res) => {
  try {
    const { projectId, releaseId } = req.params;
    const { sectionNumber } = req.body;
    const doc = getRelease(projectId, releaseId);
    if (!doc) { res.status(404).json({ success: false, error: 'Release notes not found' }); return; }
    const updated = skipReleaseSection(doc, sectionNumber);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:projectId/:releaseId/revert', (req, res) => {
  try {
    const { projectId, releaseId } = req.params;
    const { sectionNumber, version } = req.body;
    const doc = getRelease(projectId, releaseId);
    if (!doc) { res.status(404).json({ success: false, error: 'Release notes not found' }); return; }
    const updated = revertReleaseSection(doc, sectionNumber, version);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:projectId/:releaseId/assemble', (req, res) => {
  try {
    const doc = getRelease(req.params.projectId, req.params.releaseId);
    if (!doc) { res.status(404).json({ success: false, error: 'Release notes not found' }); return; }
    const markdown = assembleRelease(doc);
    res.json({ success: true, data: { markdown, doc } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:projectId/:releaseId/download', (req, res) => {
  try {
    const doc = getRelease(req.params.projectId, req.params.releaseId);
    if (!doc) { res.status(404).json({ success: false, error: 'Release notes not found' }); return; }
    const markdown = assembleRelease(doc);
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.id}-release-notes-${date}.md"`);
    res.send(markdown);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:projectId/:releaseId/finalize', (req, res) => {
  try {
    const doc = getRelease(req.params.projectId, req.params.releaseId);
    if (!doc) { res.status(404).json({ success: false, error: 'Release notes not found' }); return; }
    const { markdown, savedPath } = finalizeRelease(doc);
    res.json({ success: true, data: { savedPath, releaseId: doc.id, markdown } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
