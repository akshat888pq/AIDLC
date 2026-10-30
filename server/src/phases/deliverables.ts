import fs from 'fs';
import path from 'path';
import type { LLMAdapter } from '../services/llm/adapter.js';
import type { PhaseDeliverableState, EpicStoriesResult } from '../types/index.js';
import type { PhaseConfig, PhaseDeliverable } from './phaseConfig.js';
import * as brain from '../services/secondBrain.js';
import { ensureDir, phaseDir, reportsDir } from '../services/secondBrain.js';
import { getOrCreateSession } from '../state.js';
import { generateEpicAndStories } from '../services/storyGenerator.js';
import { buildEpicStoriesWorkbook, buildStyledWorkbook, excelList } from '../services/excelBuilder.js';
import {
  extractArchitectureInventory,
  generateStoryArchitectureUpdates,
} from '../services/architectureInventory.js';
import { phaseContextBlock, PhaseError } from './engine/index.js';
import { getPhaseDoc, readPhaseOutput } from './engine/phaseDocStore.js';
import {
  designKnowledgeBlocks,
  getOrBuildDesignModel,
  type DesignModel,
  type DesignScreen,
} from '../services/designModel.js';
import { renderDesignImages } from '../services/designRender.js';
import { diagramImagePath, listDiagramSet } from '../services/diagramStore.js';
import { writeZip, type ZipEntry } from '../services/zip.js';

/**
 * Phase deliverables: the artifacts a phase produces beyond its own document.
 *
 * A PhaseConfig declares *what* its deliverables are; the handlers below say *how*
 * each one is produced. Adding a deliverable to a phase means declaring it in the
 * config and registering a handler here under the same id.
 *
 * Every deliverable is gated on human approval, for the same reason section
 * generation is: nothing downstream is produced from an unreviewed understanding.
 */

export interface DeliverableContext {
  sessionId: string;
  config: PhaseConfig;
  deliverable: PhaseDeliverable;
  llm: LLMAdapter;
}

export interface DeliverableResult {
  /** Absolute path of the produced file, when the deliverable produces one. */
  filePath?: string;
  summary: string;
  payload?: any;
}

type DeliverableHandler = (ctx: DeliverableContext) => Promise<DeliverableResult>;

// ── Persistence ────────────────────────────────────────────────────────────────

interface StoredDeliverable {
  id: string;
  generatedAt: string;
  filePath?: string;
  summary: string;
  payload?: any;
}

function recordPath(sessionId: string, phaseId: string): string {
  return path.join(phaseDir(sessionId, phaseId), 'deliverables.json');
}

function readRecords(sessionId: string, phaseId: string): Record<string, StoredDeliverable> {
  const fp = recordPath(sessionId, phaseId);
  if (!fs.existsSync(fp)) return {};
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, StoredDeliverable>;
  } catch {
    return {};
  }
}

function writeRecord(sessionId: string, phaseId: string, record: StoredDeliverable): void {
  const records = readRecords(sessionId, phaseId);
  records[record.id] = record;
  ensureDir(phaseDir(sessionId, phaseId));
  fs.writeFileSync(recordPath(sessionId, phaseId), JSON.stringify(records, null, 2), 'utf-8');
}

// ── Handlers ───────────────────────────────────────────────────────────────────

const handlers: Record<string, DeliverableHandler> = {
  /** Requirement phase — the Epic + User Stories workbook. */
  'epic-stories': async ({ sessionId, llm }) => {
    const session = getOrCreateSession(sessionId);
    const { epic, stories } = await generateEpicAndStories(llm, session);
    const built = buildEpicStoriesWorkbook(sessionId, epic, stories);

    const result: EpicStoriesResult = {
      epic,
      stories,
      generatedAt: new Date().toISOString(),
      totalStoryPoints: built.totalStoryPoints,
      filePath: built.filePath,
      downloadUrl: `/api/projects/${sessionId}/excel-report/download`,
    };
    // The backlog is part of the project's permanent context, and the existing
    // Excel report route reads it from exactly here.
    brain.recordGeneratedStories(sessionId, result);

    return {
      filePath: built.filePath,
      summary: `${stories.length} user stories (${built.totalStoryPoints} points) under the epic "${epic.title}".`,
      payload: result,
    };
  },

  /** Requirement phase — the work-item hierarchy, ready for the ticket workflow. */
  tickets: async ({ sessionId }) => {
    const data = brain.readBrain(sessionId);
    const stories = data?.generatedStories;
    if (!stories) {
      throw new PhaseError(
        'Generate the Epic & User Stories deliverable first — the ticket hierarchy is built from it.',
        400
      );
    }

    const lines: string[] = [`# Work item hierarchy — ${data?.projectName ?? 'Project'}`, ''];
    lines.push(`## Epic: ${stories.epic.title}`, '', stories.epic.description, '');
    for (const story of stories.stories) {
      lines.push(`### ${story.id} — ${story.title}`);
      lines.push(`${story.userStory}`);
      lines.push(`Points: ${story.storyPoints} | Priority: ${story.priority} | Component: ${story.component}`);
      lines.push('Acceptance criteria:');
      for (const ac of story.acceptanceCriteria) lines.push(`- ${ac}`);
      lines.push('');
    }

    const dir = reportsDir(sessionId);
    ensureDir(dir);
    const filePath = path.join(dir, 'work-item-hierarchy.md');
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');

    return {
      filePath,
      summary: `1 epic and ${stories.stories.length} stories prepared. Push them to Jira or Azure DevOps from the ticket workflow on the project's intake screen.`,
      payload: { epic: stories.epic, stories: stories.stories },
    };
  },

  /** Architecture phase — the component inventory workbook. */
  'component-inventory': async ({ sessionId, config, llm }) => {
    const markdown = requireApprovedDocument(sessionId, config);
    const inventory = await extractArchitectureInventory(
      llm,
      markdown,
      phaseContextBlock(sessionId, config.id)
    );

    const built = buildStyledWorkbook(
      [
        {
          name: 'Components',
          headers: [
            'Component ID',
            'Name',
            'Type',
            'Responsibility',
            'Technology',
            'Data Stores',
            'Dependencies',
            'Interfaces',
            'NFRs',
            'Traces To',
            'Risks',
          ],
          rows: inventory.components.map((c) => [
            c.id,
            c.name,
            c.type,
            c.responsibility,
            c.technology,
            c.dataStores,
            c.dependencies,
            c.interfaces,
            c.nfrs,
            c.tracesTo,
            c.risks,
          ]),
          centerColumns: [2],
        },
        {
          name: 'Decisions (ADRs)',
          headers: ['ADR ID', 'Title', 'Status', 'Decision', 'Rationale', 'Alternatives', 'Consequences', 'Driven By'],
          rows: inventory.decisions.map((d) => [
            d.id,
            d.title,
            d.status,
            d.decision,
            d.rationale,
            d.alternatives,
            d.consequences,
            d.drivenBy,
          ]),
          centerColumns: [2],
        },
        {
          name: 'Traceability',
          headers: ['Requirement ID', 'Requirement', 'Components', 'Decisions', 'Architecture Section'],
          rows: inventory.traceability.map((t) => [
            t.requirementId,
            t.requirement,
            t.components,
            t.decisions,
            t.section,
          ]),
          centerColumns: [4],
        },
      ],
      reportsDir(sessionId, config.id),
      'architecture-inventory.xlsx'
    );

    return {
      filePath: built.filePath,
      summary: `${inventory.components.length} components, ${inventory.decisions.length} decisions and ${inventory.traceability.length} traceability rows.`,
      payload: inventory,
    };
  },

  /** Architecture phase — architecture notes mapped onto the requirement phase's stories. */
  'ticket-updates': async ({ sessionId, config, llm }) => {
    const markdown = requireApprovedDocument(sessionId, config);
    const input = brain.readBrain(sessionId, config.id)?.inputFromPreviousPhase;

    if (!input?.storiesJson) {
      throw new PhaseError(
        'No user stories were imported from the requirement phase. Generate the Epic & User Stories deliverable there first, then restart this phase to re-import.',
        400
      );
    }

    const updates = await generateStoryArchitectureUpdates(
      llm,
      markdown,
      input.storiesJson,
      phaseContextBlock(sessionId, config.id)
    );

    const built = buildStyledWorkbook(
      [
        {
          name: 'Ticket Updates',
          headers: [
            'Story ID',
            'Story',
            'Components',
            'Architecture Notes',
            'Decisions',
            'Technical Tasks',
            'Risks',
          ],
          rows: updates.map((u) => [
            u.storyId,
            u.storyTitle,
            u.components,
            u.technicalNotes,
            u.decisions,
            excelList(u.technicalTasks),
            u.risks,
          ]),
        },
      ],
      reportsDir(sessionId, config.id),
      'ticket-architecture-updates.xlsx'
    );

    // A markdown copy is what a human actually pastes into a ticket.
    const lines: string[] = ['# Architecture updates for existing tickets', ''];
    for (const u of updates) {
      lines.push(`## ${u.storyId} — ${u.storyTitle}`, '');
      lines.push(`**Components:** ${u.components}`);
      lines.push(`**Decisions:** ${u.decisions}`);
      lines.push('', u.technicalNotes, '');
      if (u.technicalTasks.length > 0) {
        lines.push('**Technical tasks:**');
        for (const task of u.technicalTasks) lines.push(`- ${task}`);
        lines.push('');
      }
      lines.push(`**Risks:** ${u.risks}`, '');
    }
    fs.writeFileSync(
      path.join(reportsDir(sessionId, config.id), 'ticket-architecture-updates.md'),
      lines.join('\n'),
      'utf-8'
    );

    return {
      filePath: built.filePath,
      summary: `Architecture context prepared for ${updates.length} stories. Apply them from the ticket workflow, or hand the markdown copy to whoever owns the board.`,
      payload: { updates },
    };
  },

  /** Design phase — Screen Inventory, Component Library and Design Decisions workbook. */
  'design-inventory': async ({ sessionId, config, llm }) => {
    const model = await designModelFor(sessionId, config, llm);

    const built = buildStyledWorkbook(
      [
        {
          name: 'Screen Inventory',
          headers: ['Screen ID', 'Name', 'Route', 'Module', 'Linked FR', 'Components Used', 'API Calls', 'Status'],
          rows: model.screens.map((s) => [
            s.id,
            s.name,
            s.route,
            s.module,
            s.requirements.join(', ') || '⚠ No FR linked',
            excelList(s.components),
            excelList(s.apiCalls),
            screenStatus(s, model.packageId),
          ]),
          centerColumns: [0],
        },
        {
          name: 'Component Library',
          headers: ['Component', 'Variant', 'Usage Count', 'Screens Used In', 'Design System Source (ShadCN/custom)'],
          rows: model.components.map((c) => [
            c.component,
            c.variants,
            c.usageCount,
            c.screens.join(', ') || '—',
            c.source,
          ]),
          centerColumns: [2],
        },
        {
          name: 'Design Decisions',
          headers: ['Decision', 'Options Considered', 'Chosen', 'Rationale', 'Impact on Development'],
          rows: model.decisions.map((d) => [d.decision, d.options, d.chosen, d.rationale, d.impact]),
        },
      ],
      reportsDir(sessionId, config.id),
      'design-inventory.xlsx'
    );

    const unlinked = model.screens.filter((s) => s.requirements.length === 0).length;
    return {
      filePath: built.filePath,
      summary: `${model.screens.length} screens, ${model.components.length} components and ${model.decisions.length} design decisions${
        unlinked > 0 ? ` — ⚠ ${unlinked} screen(s) have no linked FR` : ''
      }.`,
      payload: {
        screens: model.screens.length,
        components: model.components.length,
        decisions: model.decisions.length,
      },
    };
  },

  /** Design phase — every screen as a JPG (lo-fi, hi-fi desktop, hi-fi mobile) + style guide, zipped. */
  'design-images': async ({ sessionId, config, llm }) => {
    const model = await designModelFor(sessionId, config, llm);
    const imagesDir = path.join(phaseDir(sessionId, config.id), 'images');
    const images = await renderDesignImages(model, imagesDir);

    // Approved diagrams ride along: their source always, their JPG when one was saved.
    const entries: ZipEntry[] = images.map((img) => ({
      name: `images/${img.file}`,
      data: fs.readFileSync(path.join(imagesDir, img.file)),
    }));
    for (const d of listDiagramSet(sessionId, config.id)) {
      if (d.status !== 'approved' || !d.key) continue;
      entries.push({ name: `diagrams/${d.key}.mmd`, data: Buffer.from(d.mermaid, 'utf-8') });
      if (d.hasImage) entries.push({ name: `diagrams/${d.key}.jpg`, data: fs.readFileSync(diagramImagePath(sessionId, config.id, d.key)) });
    }

    const zipPath = path.join(imagesDir, `${model.packageId}-screen-designs.zip`);
    for (const stale of fs.readdirSync(imagesDir).filter((f) => f.endsWith('.zip'))) {
      fs.unlinkSync(path.join(imagesDir, stale));
    }
    writeZip(zipPath, entries);

    const screens = images.filter((i) => i.screenId).length / 3;
    return {
      filePath: zipPath,
      summary: `${images.length} JPGs — ${screens} screens × (lo-fi wireframe, hi-fi desktop, hi-fi mobile) + style guide${
        entries.length > images.length ? `, plus ${entries.length - images.length} diagram files` : ''
      }.`,
      payload: { images },
    };
  },
};

/**
 * The structured design model behind both design deliverables. It is extracted from
 * the FINALIZED package only — images and inventories of an unapproved draft would
 * be handed to a developer as if they had been signed off.
 */
async function designModelFor(sessionId: string, config: PhaseConfig, llm: LLMAdapter): Promise<DesignModel> {
  const doc = getPhaseDoc(sessionId, config.id);
  if (!doc || doc.status !== 'finalized') {
    throw new PhaseError(`Finalize the ${config.name} before generating its deliverables.`, 409);
  }
  const markdown = requireApprovedDocument(sessionId, config);

  const model = await getOrBuildDesignModel(llm, {
    sessionId,
    phaseId: config.id,
    markdown,
    contextBlock: phaseContextBlock(sessionId, config.id),
    packageId: doc.id,
    projectName: doc.projectName,
  });

  // The next phase inherits these decisions from this phase's Second Brain.
  brain.recordKnowledge(sessionId, config.id, designKnowledgeBlocks(model));
  return model;
}

function screenStatus(screen: DesignScreen, packageId: string): string {
  const flags = [
    screen.needsHiFi ? 'Needs Hi-Fi (Figma)' : '',
    screen.needsClientReview ? 'Needs client review' : '',
  ].filter(Boolean);
  return flags.length > 0 ? `Approved in ${packageId} — ${flags.join(', ')}` : `Approved in ${packageId}`;
}

function requireApprovedDocument(sessionId: string, config: PhaseConfig): string {
  const markdown = readPhaseOutput(sessionId, config);
  if (!markdown || !markdown.trim()) {
    throw new PhaseError(`Generate the ${config.name} document before producing deliverables.`, 400);
  }
  return markdown;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function listDeliverables(sessionId: string, config: PhaseConfig): PhaseDeliverableState[] {
  const records = readRecords(sessionId, config.id);

  return config.deliverables.map((d) => {
    const record = records[d.id];
    const fileAvailable = Boolean(record?.filePath && fs.existsSync(record.filePath));
    return {
      id: d.id,
      name: d.name,
      type: d.type,
      description: d.description,
      generated: Boolean(record),
      generatedAt: record?.generatedAt,
      fileAvailable,
      downloadUrl: fileAvailable
        ? `/api/phase/${config.id}/${sessionId}/deliverables/${d.id}/download`
        : undefined,
      summary: record?.summary,
      payload: record?.payload,
    };
  });
}

export async function generateDeliverable(
  sessionId: string,
  config: PhaseConfig,
  deliverableId: string,
  llm: LLMAdapter,
  opts: { regenerate?: boolean } = {}
): Promise<PhaseDeliverableState> {
  const deliverable = config.deliverables.find((d) => d.id === deliverableId);
  if (!deliverable) {
    throw new PhaseError(`"${deliverableId}" is not a deliverable of the ${config.name} phase.`, 404);
  }

  const status = brain.getStatus(sessionId, config.id);
  if (status.approvalStatus !== 'approved') {
    throw new PhaseError(
      `The ${config.name} understanding must be approved by a human before its deliverables can be generated.`,
      403
    );
  }

  const existing = readRecords(sessionId, config.id)[deliverableId];
  if (existing && !opts.regenerate && existing.filePath && fs.existsSync(existing.filePath)) {
    return findState(sessionId, config, deliverableId);
  }

  const handler = handlers[deliverableId];
  if (!handler) {
    throw new PhaseError(
      `No handler is registered for deliverable "${deliverableId}". Register one in phases/deliverables.ts.`,
      501
    );
  }

  console.log(`[phase:${config.id}] session=${sessionId} generating deliverable ${deliverableId} (${llm.name})`);
  const result = await handler({ sessionId, config, deliverable, llm });

  writeRecord(sessionId, config.id, {
    id: deliverableId,
    generatedAt: new Date().toISOString(),
    filePath: result.filePath,
    summary: result.summary,
    payload: result.payload,
  });

  return findState(sessionId, config, deliverableId);
}

export function deliverableFilePath(
  sessionId: string,
  config: PhaseConfig,
  deliverableId: string
): { filePath: string; fileName: string } {
  const record = readRecords(sessionId, config.id)[deliverableId];
  if (!record?.filePath || !fs.existsSync(record.filePath)) {
    throw new PhaseError('This deliverable has not been generated yet', 404);
  }
  return { filePath: record.filePath, fileName: path.basename(record.filePath) };
}

function findState(sessionId: string, config: PhaseConfig, deliverableId: string): PhaseDeliverableState {
  const state = listDeliverables(sessionId, config).find((d) => d.id === deliverableId);
  if (!state) throw new PhaseError('Deliverable not found', 404);
  return state;
}
