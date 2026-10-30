import { Router } from 'express';
import { getLLM } from '../state.js';
import { getDesignSectionPrompt, type DesignSectionContext } from '../prompts/designSections/index.js';
import {
  createDesign,
  getDesign,
  getDesignsForProject,
  updateDesignSectionContent,
  approveDesignSection,
  skipDesignSection,
  revertDesignSection,
  finalizeDesign,
  assembleDesign,
  toDesignSummary,
} from '../services/designStore.js';
import { getArchitecture, assembleArchitecture } from '../services/architectureStore.js';
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

router.get('/:projectId/list', (req, res) => {
  try {
    const docs = getDesignsForProject(req.params.projectId);
    const summaries = docs.map(toDesignSummary);
    res.json({ success: true, data: summaries });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:projectId/init', (req, res) => {
  try {
    const { projectId } = req.params;
    const { requirementId, architectureId } = req.body;

    if (!requirementId || !architectureId) {
      res.status(400).json({ success: false, error: 'requirementId and architectureId are required' });
      return;
    }

    const project = getProject(projectId);
    if (!project) { res.status(404).json({ success: false, error: 'Project not found' }); return; }

    const reqContent = getRequirementContent(projectId, requirementId);
    if (!reqContent) { res.status(404).json({ success: false, error: 'Requirement not found' }); return; }

    const archContent = getArchitectureContent(projectId, architectureId);
    if (!archContent) { res.status(404).json({ success: false, error: 'Architecture not found' }); return; }

    const existing = getDesignsForProject(projectId)
      .find((d) => d.requirementId === requirementId && d.architectureId === architectureId && d.status !== 'finalized');

    if (existing) { res.json({ success: true, data: existing }); return; }

    const doc = createDesign(projectId, requirementId, architectureId, project.name);
    res.json({ success: true, data: doc });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:projectId/:designId', (req, res) => {
  const doc = getDesign(req.params.projectId, req.params.designId);
  if (!doc) { res.status(404).json({ success: false, error: 'Design not found' }); return; }
  res.json({ success: true, data: doc });
});

router.post('/:projectId/:designId/generate', async (req, res) => {
  try {
    const { projectId, designId } = req.params;
    const { sectionNumber, feedback } = req.body;

    const doc = getDesign(projectId, designId);
    if (!doc) { res.status(404).json({ success: false, error: 'Design not found' }); return; }

    const reqContent = getRequirementContent(projectId, doc.requirementId);
    if (!reqContent) { res.status(404).json({ success: false, error: 'Source requirement not found' }); return; }

    const archContent = getArchitectureContent(projectId, doc.architectureId);
    if (!archContent) { res.status(404).json({ success: false, error: 'Source architecture not found' }); return; }

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

    const context: DesignSectionContext = {
      requirementContent: reqContent,
      architectureContent: archContent,
      previousSections,
      userFeedback: feedback || undefined,
      projectName: project?.name || doc.projectName,
      requirementId: doc.requirementId,
      architectureId: doc.architectureId,
      designId: doc.id,
    };

    const prompt = getDesignSectionPrompt(sectionNumber, context);
    const content = await llm.analyze(prompt, '');

    const updated = updateDesignSectionContent(doc, sectionNumber, content.trim(), feedback);
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

router.post('/:projectId/:designId/approve', (req, res) => {
  try {
    const { projectId, designId } = req.params;
    const { sectionNumber, content } = req.body;
    const doc = getDesign(projectId, designId);
    if (!doc) { res.status(404).json({ success: false, error: 'Design not found' }); return; }
    const updated = approveDesignSection(doc, sectionNumber, content);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:projectId/:designId/skip', (req, res) => {
  try {
    const { projectId, designId } = req.params;
    const { sectionNumber } = req.body;
    const doc = getDesign(projectId, designId);
    if (!doc) { res.status(404).json({ success: false, error: 'Design not found' }); return; }
    const updated = skipDesignSection(doc, sectionNumber);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:projectId/:designId/revert', (req, res) => {
  try {
    const { projectId, designId } = req.params;
    const { sectionNumber, version } = req.body;
    const doc = getDesign(projectId, designId);
    if (!doc) { res.status(404).json({ success: false, error: 'Design not found' }); return; }
    const updated = revertDesignSection(doc, sectionNumber, version);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:projectId/:designId/assemble', (req, res) => {
  try {
    const doc = getDesign(req.params.projectId, req.params.designId);
    if (!doc) { res.status(404).json({ success: false, error: 'Design not found' }); return; }
    const markdown = assembleDesign(doc);
    res.json({ success: true, data: { markdown, doc } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:projectId/:designId/download', (req, res) => {
  try {
    const doc = getDesign(req.params.projectId, req.params.designId);
    if (!doc) { res.status(404).json({ success: false, error: 'Design not found' }); return; }
    const markdown = assembleDesign(doc);
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.id}-solution-design-${date}.md"`);
    res.send(markdown);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:projectId/:designId/finalize', (req, res) => {
  try {
    const doc = getDesign(req.params.projectId, req.params.designId);
    if (!doc) { res.status(404).json({ success: false, error: 'Design not found' }); return; }
    const { markdown, savedPath } = finalizeDesign(doc);
    res.json({ success: true, data: { savedPath, designId: doc.id, markdown } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
