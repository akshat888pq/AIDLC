import express, { Router } from 'express';
import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';
import '../phases/index.js';
import { getAllPhases, getPhase, getNextPhase } from '../phases/registry.js';
import { toDescriptor } from '../phases/phaseConfig.js';
import * as engine from '../phases/engine/index.js';
import { PhaseError } from '../phases/engine/index.js';
import { deliverableFilePath, generateDeliverable, listDeliverables } from '../phases/deliverables.js';
import { getLLM } from '../state.js';
import { getAllProjects, getProjectBySessionId } from '../services/projectStore.js';
import { devStatus } from '../dev/workspace.js';
import { readProgress } from '../services/phaseProgressStore.js';
import * as brain from '../services/secondBrain.js';
import {
  approveSetDiagram,
  buildDiagramSet,
  getDiagramSet,
  regenerateSetDiagram,
  saveSetDiagram,
  skipSetDiagram,
  storeSetDiagramImage,
} from '../phases/diagramSets.js';
import { diagramImagePath, isValidDiagramKey } from '../services/diagramStore.js';
import { commitPhasePackage, listPackageFiles, resolvePackagePath } from '../phases/packageFiles.js';
import { readRenderedIndex } from '../services/designRender.js';
import {
  approveMockup,
  generateMockup,
  getMockup,
  getMockupSet,
  mockupArchive,
  mockupDownload,
  MockupError,
  revertMockup,
  saveMockupEdit,
} from '../services/mockupGenerator.js';

/**
 * One set of routes that works for ANY phase.
 *
 *   /api/phase/:phaseId/:sessionId/...   the workflow, driven by the phase's config
 *   /api/phases/...                      the Agent Hub: which phases exist, and
 *                                        which projects sit in each of them
 *
 * The phase id is resolved against the registry on every call, so the same handler
 * serves requirement, architecture and every phase added later. The existing
 * requirement routes (/api/analyze, /api/questions, /api/projects/:id/approval,
 * /api/requirements) are untouched and keep working: for the requirement phase the
 * engine drives the very same services and files those routes do, so a project can
 * be moved between the two entry points mid-flight without losing anything.
 */

export const phaseEngineRouter = Router({ mergeParams: true });
export const phaseHubRouter = Router();

function fail(res: Response, err: any, label: string) {
  const status = err instanceof PhaseError || err instanceof MockupError ? err.statusCode : 500;
  if (status >= 500) console.error(`[${label}] failed:`, err);
  res.status(status).json({ success: false, error: err.message || 'Unknown error' });
}

/** Resolve :phaseId or answer 404. */
function config(req: Request) {
  return engine.requirePhase(req.params.phaseId);
}

function requireLLM() {
  const llm = getLLM();
  if (!llm) {
    throw new PhaseError(
      'No LLM configured. Set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY in your .env file.',
      500
    );
  }
  return llm;
}

// ── Agent Hub ──────────────────────────────────────────────────────────────────

/** Every phase agent, with how many projects sit in each. */
phaseHubRouter.get('/', (_req, res) => {
  try {
    const projects = getAllProjects();

    const agents = getAllPhases().map((phase) => {
      let inProgress = 0;
      let completed = 0;

      for (const project of projects) {
        if (!project.sessionId) continue;
        if (phase.workspace === 'ide') {
          if (devStatus(project.sessionId).exists) inProgress++;
          continue;
        }
        const status = engine.phaseStatus(project.sessionId, phase.id);
        if (!status.exists) continue;
        if (status.completed) completed++;
        else inProgress++;
      }

      return {
        ...toDescriptor(phase),
        totalProjects: inProgress + completed,
        inProgress,
        completed,
        available: !phase.comingSoon,
      };
    });

    res.json({ success: true, data: agents });
  } catch (err: any) {
    fail(res, err, 'phases');
  }
});

/** The projects sitting in one phase — started, or eligible to start. */
phaseHubRouter.get('/:phaseId/projects', (req, res) => {
  try {
    const phase = engine.requirePhase(req.params.phaseId);
    const previous = phase.requiresPhase ? getPhase(phase.requiresPhase) : undefined;

    const entries = getAllProjects()
      .filter((p) => Boolean(p.sessionId))
      .map((project) => {
        const sessionId = project.sessionId!;
        if (phase.workspace === 'ide') {
          const dev = devStatus(sessionId);
          return {
            projectId: project.id,
            projectName: project.name,
            client: project.client,
            sessionId,
            phaseId: phase.id,
            status: (dev.exists ? 'in-progress' : 'not-started') as 'in-progress' | 'not-started',
            statusLabel: dev.label,
            sourceLabel: undefined as string | undefined,
            documentId: undefined as string | undefined,
            confidenceScore: undefined as number | undefined,
            lastActivity: project.lastActivity,
          };
        }
        const status = engine.phaseStatus(sessionId, phase.id);
        const record = readProgress(sessionId, project.id).phases[phase.id];

        const previousStatus = previous ? brain.getStatus(sessionId, previous.id) : null;
        const previousReady = previous ? previousStatus?.approvalStatus === 'approved' : true;

        let value: 'not-started' | 'in-progress' | 'completed' | 'locked';
        if (status.completed || record?.status === 'completed') value = 'completed';
        else if (status.exists) value = 'in-progress';
        else if (phase.comingSoon || !previousReady) value = 'locked';
        else value = 'not-started';

        const previousDocId = previous
          ? engine.phaseStatus(sessionId, previous.id).doc?.id
          : undefined;

        return {
          projectId: project.id,
          projectName: project.name,
          client: project.client,
          sessionId,
          phaseId: phase.id,
          status: value,
          statusLabel:
            value === 'locked'
              ? phase.comingSoon
                ? 'Coming soon'
                : `Complete ${previous?.name ?? 'the previous phase'} first`
              : engine.phaseStatusLabel(status, phase),
          sourceLabel:
            previous && previousDocId ? `${previousDocId} (from ${previous.shortName})` : undefined,
          documentId: status.doc?.id ?? record?.documentId,
          confidenceScore: status.confidenceScore || record?.confidenceScore,
          lastActivity: project.lastActivity,
        };
      })
      // A phase's list leads with the work that is actually in it.
      .sort((a, b) => {
        const rank = { 'in-progress': 0, completed: 1, 'not-started': 2, locked: 3 } as const;
        const diff = rank[a.status] - rank[b.status];
        if (diff !== 0) return diff;
        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      });

    res.json({ success: true, data: entries });
  } catch (err: any) {
    fail(res, err, 'phases:projects');
  }
});

/** Progress across every phase for one project. */
phaseHubRouter.get('/progress/:sessionId', (req, res) => {
  try {
    res.json({ success: true, data: engine.projectPhaseProgress(req.params.sessionId) });
  } catch (err: any) {
    fail(res, err, 'phases:progress');
  }
});

// ── Phase workflow ─────────────────────────────────────────────────────────────

/** The phase's own definition — sections, deliverables, limits. */
phaseEngineRouter.get('/:phaseId/:sessionId/config', (req, res) => {
  try {
    res.json({ success: true, data: toDescriptor(config(req)) });
  } catch (err: any) {
    fail(res, err, 'phase:config');
  }
});

/** Start the phase: import from the previous phase and create this phase's brain. */
phaseEngineRouter.post('/:phaseId/:sessionId/start', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const imported = engine.startPhase(sessionId, phaseId);
    res.json({
      success: true,
      data: { imported, status: engine.phaseStatus(sessionId, phaseId) },
    });
  } catch (err: any) {
    fail(res, err, 'phase:start');
  }
});

/** What this phase received from the phase before it. */
phaseEngineRouter.get('/:phaseId/:sessionId/import', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    config(req);
    res.json({ success: true, data: engine.getImportSummary(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:import');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/analyze', async (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    res.json({ success: true, data: await engine.analyzePhase(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:analyze');
  }
});

phaseEngineRouter.get('/:phaseId/:sessionId/questions', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    res.json({ success: true, data: engine.getPhaseQuestions(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:questions');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/questions/answer', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { questionId, answer } = req.body ?? {};
    if (!questionId || answer === undefined) {
      throw new PhaseError('questionId and answer are required', 400);
    }
    const result = engine.answerPhaseQuestions(sessionId, phaseId, [{ questionId, answer }]);
    const question = result.questions.find((q) => q.id === questionId);
    res.json({ success: true, data: { question, ...result } });
  } catch (err: any) {
    fail(res, err, 'phase:answer');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/questions/answer-bulk', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { answers } = req.body ?? {};
    if (!Array.isArray(answers)) throw new PhaseError('answers array is required', 400);
    res.json({ success: true, data: engine.answerPhaseQuestions(sessionId, phaseId, answers) });
  } catch (err: any) {
    fail(res, err, 'phase:answer-bulk');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/questions/skip', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { questionId } = req.body ?? {};
    if (!questionId) throw new PhaseError('questionId is required', 400);
    res.json({ success: true, data: engine.skipPhaseQuestion(sessionId, phaseId, questionId) });
  } catch (err: any) {
    fail(res, err, 'phase:skip');
  }
});

// ── Approval ──

phaseEngineRouter.get('/:phaseId/:sessionId/approval', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    config(req);
    res.json({ success: true, data: engine.phaseApprovalState(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:approval');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/approval', async (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { force } = req.body ?? {};
    res.json({
      success: true,
      data: await engine.generatePhaseApprovalSummary(sessionId, phaseId, { force }),
    });
  } catch (err: any) {
    fail(res, err, 'phase:approval');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/approval/add-info', async (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { text } = req.body ?? {};
    if (!text || !String(text).trim()) throw new PhaseError('text is required', 400);
    res.json({
      success: true,
      data: await engine.generatePhaseApprovalSummary(sessionId, phaseId, {
        humanInput: String(text),
        force: true,
      }),
    });
  } catch (err: any) {
    fail(res, err, 'phase:add-info');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/approval/approve', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { additionalInput } = req.body ?? {};
    res.json({
      success: true,
      data: engine.approvePhaseUnderstanding(sessionId, phaseId, additionalInput),
    });
  } catch (err: any) {
    fail(res, err, 'phase:approve');
  }
});

/** The phase's Second Brain as markdown. */
phaseEngineRouter.get('/:phaseId/:sessionId/second-brain', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    config(req);
    const markdown = brain.readMarkdown(sessionId, phaseId);
    if (!markdown) throw new PhaseError('This phase has no second brain yet', 404);
    res.json({
      success: true,
      data: { markdown, path: brain.secondBrainMdPath(sessionId, phaseId) },
    });
  } catch (err: any) {
    fail(res, err, 'phase:second-brain');
  }
});

// ── Sections ──

phaseEngineRouter.post('/:phaseId/:sessionId/sections/init', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    res.json({ success: true, data: engine.initPhaseSections(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:sections-init');
  }
});

phaseEngineRouter.get('/:phaseId/:sessionId/sections', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    config(req);
    res.json({ success: true, data: engine.assemblePhase(sessionId, phaseId).doc });
  } catch (err: any) {
    fail(res, err, 'phase:sections');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/sections/:sectionNum/generate', async (req, res) => {
  try {
    const { phaseId, sessionId, sectionNum } = req.params;
    const { feedback } = req.body ?? {};
    const result = await engine.generatePhaseSection(
      sessionId,
      phaseId,
      Number(sectionNum),
      feedback
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    fail(res, err, 'phase:generate-section');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/sections/:sectionNum/approve', (req, res) => {
  try {
    const { phaseId, sessionId, sectionNum } = req.params;
    const { content } = req.body ?? {};
    res.json({
      success: true,
      data: engine.approvePhaseSection(sessionId, phaseId, Number(sectionNum), content),
    });
  } catch (err: any) {
    fail(res, err, 'phase:approve-section');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/sections/:sectionNum/skip', (req, res) => {
  try {
    const { phaseId, sessionId, sectionNum } = req.params;
    res.json({
      success: true,
      data: engine.skipPhaseSection(sessionId, phaseId, Number(sectionNum)),
    });
  } catch (err: any) {
    fail(res, err, 'phase:skip-section');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/sections/:sectionNum/revert', (req, res) => {
  try {
    const { phaseId, sessionId, sectionNum } = req.params;
    const { version } = req.body ?? {};
    if (!version) throw new PhaseError('version is required', 400);
    res.json({
      success: true,
      data: engine.revertPhaseSection(sessionId, phaseId, Number(sectionNum), Number(version)),
    });
  } catch (err: any) {
    fail(res, err, 'phase:revert-section');
  }
});

// ── System diagram ──
//
// POST /api/phase/architecture/:sessionId/generate-diagram is the architecture
// phase's use of this; every phase gets the same set, so design and testing can
// have diagrams without another round of routes.

phaseEngineRouter.post('/:phaseId/:sessionId/generate-diagram', async (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { feedback } = req.body ?? {};
    const diagram = await engine.generatePhaseDiagram(sessionId, phaseId, feedback);
    res.json({ success: true, data: diagram });
  } catch (err: any) {
    fail(res, err, 'phase:generate-diagram');
  }
});

phaseEngineRouter.get('/:phaseId/:sessionId/diagram', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    res.json({ success: true, data: engine.getPhaseDiagram(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:diagram');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/diagram', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { mermaid } = req.body ?? {};
    if (typeof mermaid !== 'string') {
      res.status(400).json({ success: false, error: 'mermaid (string) is required' });
      return;
    }
    res.json({ success: true, data: engine.savePhaseDiagram(sessionId, phaseId, mermaid) });
  } catch (err: any) {
    fail(res, err, 'phase:diagram:save');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/diagram/approve', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { mermaid } = req.body ?? {};
    res.json({ success: true, data: engine.approvePhaseDiagram(sessionId, phaseId, mermaid) });
  } catch (err: any) {
    fail(res, err, 'phase:diagram:approve');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/diagram/skip', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    res.json({ success: true, data: engine.skipPhaseDiagram(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:diagram:skip');
  }
});

phaseEngineRouter.get('/:phaseId/:sessionId/diagram/download', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const diagram = engine.getPhaseDiagram(sessionId, phaseId);
    if (!diagram.mermaid.trim()) {
      res.status(404).json({ success: false, error: 'No diagram has been generated yet' });
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${phaseId}-diagram.mmd"`);
    res.send(diagram.mermaid);
  } catch (err: any) {
    fail(res, err, 'phase:diagram:download');
  }
});

// ── Diagram sets ──
//
// Phases with diagramMode: 'set' (design) keep several named diagrams — the
// navigation map, one per user flow, the component hierarchy. Each is reviewed on
// its own with the same actions as the single system diagram above.

function diagramKey(req: Request): string {
  const key = req.params.key;
  if (!isValidDiagramKey(key)) throw new PhaseError(`Invalid diagram key "${key}"`, 400);
  return key;
}

phaseEngineRouter.get('/:phaseId/:sessionId/diagrams', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    res.json({ success: true, data: getDiagramSet(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:diagrams');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/diagrams/build', async (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    res.json({ success: true, data: await buildDiagramSet(sessionId, phaseId, requireLLM()) });
  } catch (err: any) {
    fail(res, err, 'phase:diagrams:build');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/diagrams/:key', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { mermaid } = req.body ?? {};
    if (typeof mermaid !== 'string') throw new PhaseError('mermaid (string) is required', 400);
    res.json({ success: true, data: saveSetDiagram(sessionId, phaseId, diagramKey(req), mermaid) });
  } catch (err: any) {
    fail(res, err, 'phase:diagrams:save');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/diagrams/:key/approve', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { mermaid } = req.body ?? {};
    res.json({ success: true, data: approveSetDiagram(sessionId, phaseId, diagramKey(req), mermaid) });
  } catch (err: any) {
    fail(res, err, 'phase:diagrams:approve');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/diagrams/:key/skip', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    res.json({ success: true, data: skipSetDiagram(sessionId, phaseId, diagramKey(req)) });
  } catch (err: any) {
    fail(res, err, 'phase:diagrams:skip');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/diagrams/:key/regenerate', async (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const { feedback } = req.body ?? {};
    res.json({
      success: true,
      data: await regenerateSetDiagram(sessionId, phaseId, diagramKey(req), requireLLM(), feedback),
    });
  } catch (err: any) {
    fail(res, err, 'phase:diagrams:regenerate');
  }
});

/** The browser renders Mermaid, so it rasterizes the diagram and posts the JPG here. */
phaseEngineRouter.post(
  '/:phaseId/:sessionId/diagrams/:key/image',
  express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '20mb' }),
  (req, res) => {
    try {
      const { phaseId, sessionId } = req.params;
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new PhaseError('Send the JPG as the request body with Content-Type image/jpeg', 400);
      }
      res.json({ success: true, data: storeSetDiagramImage(sessionId, phaseId, diagramKey(req), req.body) });
    } catch (err: any) {
      fail(res, err, 'phase:diagrams:image');
    }
  }
);

phaseEngineRouter.get('/:phaseId/:sessionId/diagrams/:key/image', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    config(req);
    const key = diagramKey(req);
    const fp = diagramImagePath(sessionId, phaseId, key);
    if (!fs.existsSync(fp)) throw new PhaseError('No image has been saved for this diagram', 404);
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${key}.jpg"`);
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(path.resolve(fp));
  } catch (err: any) {
    fail(res, err, 'phase:diagrams:image-get');
  }
});

phaseEngineRouter.get('/:phaseId/:sessionId/diagrams/:key/download', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const key = diagramKey(req);
    const diagram = getDiagramSet(sessionId, phaseId).find((d) => d.key === key);
    if (!diagram) throw new PhaseError('Diagram not found', 404);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${key}.mmd"`);
    res.send(diagram.mermaid);
  } catch (err: any) {
    fail(res, err, 'phase:diagrams:download');
  }
});

// ── Package files (what the phase wrote to disk) ──

phaseEngineRouter.get('/:phaseId/:sessionId/package', (req, res) => {
  try {
    const { sessionId } = req.params;
    res.json({ success: true, data: listPackageFiles(sessionId, config(req)) });
  } catch (err: any) {
    fail(res, err, 'phase:package');
  }
});

/** Rendered screen images, with their screen and variant, for the gallery. */
phaseEngineRouter.get('/:phaseId/:sessionId/images', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    config(req);
    res.json({ success: true, data: readRenderedIndex(path.join(brain.phaseDir(sessionId, phaseId), 'images')) });
  } catch (err: any) {
    fail(res, err, 'phase:images');
  }
});

/** Serve one file of the package, e.g. ?path=images/hifi/SCR-001-login-desktop.jpg */
phaseEngineRouter.get('/:phaseId/:sessionId/package/file', (req, res) => {
  try {
    const { sessionId } = req.params;
    const relative = String(req.query.path ?? '');
    if (!relative) throw new PhaseError('path is required', 400);
    const abs = resolvePackagePath(sessionId, config(req), relative);
    // Mockups are model-written HTML: never let one run with the app's origin.
    if (abs.toLowerCase().endsWith('.html')) res.setHeader('Content-Security-Policy', MOCKUP_CSP);
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${path.basename(abs)}"`);
    res.sendFile(abs);
  } catch (err: any) {
    fail(res, err, 'phase:package-file');
  }
});

/** Commit the whole finalized phase package to the project's repository in one commit. */
phaseEngineRouter.post('/:phaseId/:sessionId/git/commit', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { workspaceSessionId, message, createPR, orgUrl } = req.body ?? {};
    if (!workspaceSessionId) throw new PhaseError('workspaceSessionId is required', 400);
    res.json({
      success: true,
      data: await commitPhasePackage(sessionId, config(req), { workspaceSessionId, message, createPR, orgUrl }),
    });
  } catch (err: any) {
    fail(res, err, 'phase:git-commit');
  }
});

// ── Live UI mockups (phases with mockups: true, e.g. design) ──
//
// One interactive HTML file per screen of the package, generated from the approved
// screen definition + design system. The browser renders them in a sandboxed iframe;
// anything served from here as a page carries the same sandbox as a CSP header.

const MOCKUP_CSP = 'sandbox allow-scripts allow-forms allow-modals';

function mockupPhase(req: Request) {
  const phase = config(req);
  if (!phase.mockups) throw new PhaseError(`The ${phase.name} does not generate mockups`, 404);
  return phase;
}

phaseEngineRouter.get('/:phaseId/:sessionId/mockups', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    mockupPhase(req);
    res.json({ success: true, data: getMockupSet(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:mockups');
  }
});

/** Every mockup that exists, cross-linked, with an index page. Declared before /:screenId. */
phaseEngineRouter.get('/:phaseId/:sessionId/mockups/archive', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    mockupPhase(req);
    const project = getProjectBySessionId(sessionId);
    const { fileName, zip } = mockupArchive(sessionId, phaseId, project?.name ?? 'Project');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(zip);
  } catch (err: any) {
    fail(res, err, 'phase:mockups:archive');
  }
});

phaseEngineRouter.get('/:phaseId/:sessionId/mockups/:screenId', (req, res) => {
  try {
    const { phaseId, sessionId, screenId } = req.params;
    mockupPhase(req);
    res.json({ success: true, data: getMockup(sessionId, phaseId, screenId) });
  } catch (err: any) {
    fail(res, err, 'phase:mockup');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/mockups/:screenId/generate', async (req, res) => {
  try {
    const { phaseId, sessionId, screenId } = req.params;
    mockupPhase(req);
    const { feedback } = req.body ?? {};
    res.json({
      success: true,
      data: await generateMockup(sessionId, phaseId, screenId, requireLLM(), {
        feedback: typeof feedback === 'string' ? feedback : undefined,
        contextBlock: engine.phaseContextBlock(sessionId, phaseId),
      }),
    });
  } catch (err: any) {
    fail(res, err, 'phase:mockup:generate');
  }
});

/** Save a hand edit from the code editor as a new version. */
phaseEngineRouter.put('/:phaseId/:sessionId/mockups/:screenId', (req, res) => {
  try {
    const { phaseId, sessionId, screenId } = req.params;
    mockupPhase(req);
    const { html } = req.body ?? {};
    if (typeof html !== 'string') throw new PhaseError('html (string) is required', 400);
    res.json({ success: true, data: saveMockupEdit(sessionId, phaseId, screenId, html) });
  } catch (err: any) {
    fail(res, err, 'phase:mockup:save');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/mockups/:screenId/approve', (req, res) => {
  try {
    const { phaseId, sessionId, screenId } = req.params;
    mockupPhase(req);
    const { html } = req.body ?? {};
    res.json({
      success: true,
      data: approveMockup(sessionId, phaseId, screenId, typeof html === 'string' ? html : undefined),
    });
  } catch (err: any) {
    fail(res, err, 'phase:mockup:approve');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/mockups/:screenId/revert', (req, res) => {
  try {
    const { phaseId, sessionId, screenId } = req.params;
    mockupPhase(req);
    const version = Number(req.body?.version);
    if (!Number.isInteger(version)) throw new PhaseError('version (integer) is required', 400);
    res.json({ success: true, data: revertMockup(sessionId, phaseId, screenId, version) });
  } catch (err: any) {
    fail(res, err, 'phase:mockup:revert');
  }
});

/** The mockup as a standalone file — opened in a tab (sandboxed), or downloaded with ?download=1. */
phaseEngineRouter.get('/:phaseId/:sessionId/mockups/:screenId/file', (req, res) => {
  try {
    const { phaseId, sessionId, screenId } = req.params;
    mockupPhase(req);
    const { fileName, html } = mockupDownload(sessionId, phaseId, screenId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', MOCKUP_CSP);
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(html);
  } catch (err: any) {
    fail(res, err, 'phase:mockup:file');
  }
});

// ── Assemble / finalize / status ──

phaseEngineRouter.get('/:phaseId/:sessionId/assemble', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    res.json({ success: true, data: engine.assemblePhase(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:assemble');
  }
});

phaseEngineRouter.get('/:phaseId/:sessionId/download', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const phase = config(req);
    const { markdown, doc } = engine.assemblePhase(sessionId, phaseId);
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${doc.id}-${phase.id}-${date}.md"`
    );
    res.send(markdown);
  } catch (err: any) {
    fail(res, err, 'phase:download');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/finalize', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    res.json({ success: true, data: engine.finalizePhase(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:finalize');
  }
});

phaseEngineRouter.get('/:phaseId/:sessionId/status', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    const phase = config(req);
    const next = getNextPhase(phaseId);
    const project = getProjectBySessionId(sessionId);

    res.json({
      success: true,
      data: {
        ...engine.phaseStatus(sessionId, phaseId),
        phase: toDescriptor(phase),
        projectId: project?.id,
        projectName: project?.name,
        nextPhase: next ? { id: next.id, name: next.name, comingSoon: Boolean(next.comingSoon) } : null,
        progress: engine.projectPhaseProgress(sessionId),
      },
    });
  } catch (err: any) {
    fail(res, err, 'phase:status');
  }
});

// ── Deliverables ──

phaseEngineRouter.get('/:phaseId/:sessionId/deliverables', (req, res) => {
  try {
    const { sessionId } = req.params;
    res.json({ success: true, data: listDeliverables(sessionId, config(req)) });
  } catch (err: any) {
    fail(res, err, 'phase:deliverables');
  }
});

phaseEngineRouter.post('/:phaseId/:sessionId/deliverables/:deliverableId', async (req, res) => {
  try {
    const { sessionId, deliverableId } = req.params;
    const { regenerate } = req.body ?? {};
    const data = await generateDeliverable(sessionId, config(req), deliverableId, requireLLM(), {
      regenerate,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    fail(res, err, 'phase:deliverable');
  }
});

phaseEngineRouter.get('/:phaseId/:sessionId/deliverables/:deliverableId/download', (req, res) => {
  try {
    const { sessionId, deliverableId } = req.params;
    const { filePath, fileName } = deliverableFilePath(sessionId, config(req), deliverableId);
    if (!fs.existsSync(filePath)) throw new PhaseError('The generated file is no longer on disk', 404);

    const contentType = fileName.endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : fileName.endsWith('.zip')
      ? 'application/zip'
      : fileName.endsWith('.md')
      ? 'text/markdown; charset=utf-8'
      : 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.sendFile(filePath);
  } catch (err: any) {
    fail(res, err, 'phase:deliverable-download');
  }
});

// ── Transition ──

/** Explicit hand-off to the next phase. Never automatic — a human clicks this. */
phaseEngineRouter.post('/:phaseId/:sessionId/proceed', (req, res) => {
  try {
    const { phaseId, sessionId } = req.params;
    res.json({ success: true, data: engine.proceedToNextPhase(sessionId, phaseId) });
  } catch (err: any) {
    fail(res, err, 'phase:proceed');
  }
});

export default phaseEngineRouter;
