import fs from 'fs';
import path from 'path';
import '../phases/index.js';
import { getPhase } from '../phases/registry.js';
import * as engine from '../phases/engine/index.js';
import * as brain from '../services/secondBrain.js';
import { getProjectBySessionId } from '../services/projectStore.js';
import { projectOutputDirName } from '../services/artifactFiles.js';
import { getMockupSet } from '../services/mockupGenerator.js';
import { listDiagramSet, readDiagram } from '../services/diagramStore.js';
import {
  DOCS_DIR,
  PROJECTS_DIR,
  SECOND_BRAIN_FILE,
  registerContextSyncer,
  resolveInWorkspace,
  writeFile,
  writeManagedBlock,
} from './workspace.js';
import { projectPorts } from './processes.js';

/**
 * The hand-over into development: everything every earlier phase produced is copied
 * into the project's workspace under docs/aidlc/, and secondbrain.md gets an index of
 * it plus the essentials, so the coding agent starts with the whole project memory.
 */

export interface MockupEntry {
  screenId: string;
  screenName: string;
  route?: string;
  status: string;
  file: string;
  orphaned?: boolean;
}

export interface HandoverFile {
  path: string;
  title: string;
  note?: string;
}

export interface HandoverManifest {
  generatedAt: string;
  projectName: string;
  phases: { id: string; name: string; status: string; files: HandoverFile[] }[];
  mockups: MockupEntry[];
  storyCount: number;
  warnings: string[];
}

const ENGINE_PHASES = ['requirement', 'architecture', 'design'];
const MANIFEST = `${DOCS_DIR}/manifest.json`;

// ── Builder-flow documents (REQ/ARCH/DES/TEST/REL .md) ───────────────────────

const BUILDER_DOC_TYPES = [
  { folder: 'requirements', target: 'requirement', title: 'Requirement document' },
  { folder: 'architecture', target: 'architecture', title: 'Architecture document (builder)' },
  { folder: 'design', target: 'solution-design', title: 'Solution design: API, data, components' },
  { folder: 'tests', target: 'tests', title: 'Test plan' },
  { folder: 'release', target: 'release', title: 'Release notes' },
];

function sectionStats(content: string) {
  const total = (content.match(/^## /gm) ?? []).length;
  const missing = (content.match(/_Section not yet generated\._/g) ?? []).length;
  return { total, generated: Math.max(0, total - missing) };
}

function docNumber(file: string): number {
  return Number(/-(\d+)\.md$/i.exec(file)?.[1] ?? 0);
}

/** For each document type, the version with the most generated sections (newest wins a tie). */
export function findBuilderDocs(sessionId: string) {
  const project = getProjectBySessionId(sessionId);
  if (!project) return [];
  // Folders are "<doc's project name>-<owner id prefix>" and the name can differ from
  // the project's, so match on the id suffix.
  const owners = [project.id, sessionId].filter(Boolean);
  const suffixes = owners.map((o) => `-${o.slice(0, 8)}`);
  const dirs = new Set(owners.map((o) => path.join(PROJECTS_DIR, projectOutputDirName(project.name, o))));
  for (const entry of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && suffixes.some((s) => entry.name.endsWith(s))) dirs.add(path.join(PROJECTS_DIR, entry.name));
  }

  const result: { type: (typeof BUILDER_DOC_TYPES)[number]; file: string; abs: string; generated: number; total: number; skipped: string[] }[] = [];
  for (const type of BUILDER_DOC_TYPES) {
    const candidates: { file: string; abs: string; generated: number; total: number }[] = [];
    for (const dir of dirs) {
      const folder = path.join(dir, type.folder);
      if (!fs.existsSync(folder)) continue;
      for (const file of fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.md'))) {
        const abs = path.join(folder, file);
        candidates.push({ file, abs, ...sectionStats(fs.readFileSync(abs, 'utf-8')) });
      }
    }
    const usable = candidates.filter((c) => c.generated > 0).sort((a, b) => b.generated - a.generated || docNumber(b.file) - docNumber(a.file));
    if (!usable.length) continue;
    const best = usable[0];
    result.push({
      type,
      ...best,
      skipped: candidates
        .filter((c) => c.file !== best.file && docNumber(c.file) > docNumber(best.file))
        .map((c) => `${c.file} (${c.generated}/${c.total} sections generated)`),
    });
  }
  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function excerpt(content: string, maxChars = 2500): string {
  const body = content.replace(/^---[\s\S]*?\n---\s*/, '').replace(/<!--[\s\S]*?-->/g, '');
  const outline = (body.match(/^#{2,3} .*$/gm) ?? []).slice(0, 40).join('\n');
  const opening = body.replace(/^#.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars);
  return `Outline:\n${outline}\n\nOpening:\n${opening}${body.length > maxChars ? ' …' : ''}`;
}

function renderValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => `\n  - ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function storiesMarkdown(storiesJson: string): { markdown: string; count: number } | null {
  let parsed: any;
  try {
    parsed = JSON.parse(storiesJson);
  } catch {
    return null;
  }
  const stories: any[] = Array.isArray(parsed?.stories) ? parsed.stories : [];
  const epics: any[] = Array.isArray(parsed?.epics) ? parsed.epics : parsed?.epic ? [parsed.epic] : [];
  const lines = ['# Epics & User Stories', ''];
  for (const epic of epics) {
    lines.push(`## Epic: ${epic.title ?? epic.name ?? epic.id ?? ''}`, '');
    for (const [k, v] of Object.entries(epic)) if (!['title', 'name'].includes(k)) lines.push(`- **${k}:** ${renderValue(v)}`);
    lines.push('');
  }
  lines.push('## Stories', '');
  for (const s of stories) {
    lines.push(`### ${s.id ?? ''} ${s.title ?? ''}`.trim(), '');
    if (s.userStory) lines.push(`> ${s.userStory}`, '');
    for (const [k, v] of Object.entries(s)) {
      if (['id', 'title', 'userStory'].includes(k)) continue;
      lines.push(`- **${k}:** ${renderValue(v)}`);
    }
    lines.push('');
  }
  return { markdown: lines.join('\n'), count: stories.length };
}

function findStories(sessionId: string): string | null {
  for (const phaseId of ['design', 'architecture']) {
    const json = brain.readBrain(sessionId, phaseId)?.inputFromPreviousPhase?.storiesJson;
    if (json) return json;
  }
  return null;
}

/** The requirement document, when it only exists inside a later phase's imported input. */
function importedRequirementDoc(sessionId: string): { id: string; markdown: string } | null {
  for (const phaseId of ['design', 'architecture']) {
    const docs = brain.readBrain(sessionId, phaseId)?.inputFromPreviousPhase?.earlierPhaseDocuments ?? [];
    const req = docs.find((d: any) => d.phaseId === 'requirement' && d.markdown);
    if (req) return { id: req.documentId ?? 'requirement', markdown: req.markdown };
  }
  return null;
}

function clearDir(sessionId: string, relative: string) {
  const abs = resolveInWorkspace(sessionId, relative);
  if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
}

// ── Build the hand-over ──────────────────────────────────────────────────────

export function buildHandover(sessionId: string): HandoverManifest {
  const project = getProjectBySessionId(sessionId);
  const manifest: HandoverManifest = {
    generatedAt: new Date().toISOString(),
    projectName: project?.name ?? 'Project',
    phases: [],
    mockups: [],
    storyCount: 0,
    warnings: [],
  };

  // Rebuilt from scratch on every sync; the blueprint at the top level is kept.
  for (const dir of ['requirement', 'architecture', 'design', 'solution-design', 'tests', 'release']) clearDir(sessionId, `${DOCS_DIR}/${dir}`);

  // 1. Phase-engine phases: their document, Second Brain and diagrams.
  for (const phaseId of ENGINE_PHASES) {
    const config = getPhase(phaseId);
    if (!config) continue;
    const files: HandoverFile[] = [];
    let status = 'not started';

    let assembled: { markdown: string } | null = null;
    try {
      assembled = engine.assemblePhase(sessionId, phaseId);
    } catch {
      /* no document in this phase */
    }
    try {
      const st = engine.phaseStatus(sessionId, phaseId);
      if (st.completed) status = `finalized (${st.doc?.id ?? ''})`;
      else if (st.doc) status = `draft: ${st.doc.approvedSections}/${st.doc.totalSections} sections approved`;
      else if (st.exists) status = st.approvalStatus === 'approved' ? 'understanding approved' : 'in progress';
      if (st.doc && !st.completed) {
        const open = st.doc.totalSections - st.doc.approvedSections;
        manifest.warnings.push(
          `${config.name} is not finalized (${st.doc.approvedSections}/${st.doc.totalSections} sections approved)${open ? `; ${open} section(s) are still drafts` : ''}.`
        );
      }
    } catch {
      /* phase not started */
    }

    if (assembled?.markdown.trim()) {
      const rel = `${DOCS_DIR}/${phaseId}/${config.outputFileName}`;
      writeFile(sessionId, rel, assembled.markdown);
      files.push({ path: rel, title: `${config.name} document`, note: status });
    }

    const brainMd = brain.readMarkdown(sessionId, phaseId);
    if (brainMd?.trim()) {
      const rel = `${DOCS_DIR}/${phaseId}/second-brain.md`;
      writeFile(sessionId, rel, brainMd);
      files.push({ path: rel, title: `${config.shortName} Second Brain (understanding, Q&A, confirmed facts)` });
    }

    const diagrams =
      config.diagramMode === 'set'
        ? listDiagramSet(sessionId, phaseId)
        : [readDiagram(sessionId, phaseId)].filter((d) => d.mermaid?.trim());
    for (const d of diagrams) {
      if (!d.mermaid?.trim()) continue;
      const rel = `${DOCS_DIR}/${phaseId}/diagrams/${d.key ?? 'system'}.mmd`;
      writeFile(sessionId, rel, d.mermaid);
      files.push({ path: rel, title: `Diagram: ${d.title ?? d.key ?? 'system'}`, note: d.status });
    }

    if (files.length) manifest.phases.push({ id: phaseId, name: config.name, status, files });
  }

  // 2. Live mockups from the design phase.
  try {
    const set = getMockupSet(sessionId, 'design');
    const sourceDir = path.join(brain.phaseDir(sessionId, 'design'), 'mockups');
    for (const screen of set.screens) {
      const src = path.join(sourceDir, screen.fileName);
      if (!fs.existsSync(src)) continue;
      const rel = `${DOCS_DIR}/design/mockups/${screen.fileName}`;
      writeFile(sessionId, rel, fs.readFileSync(src, 'utf-8'));
      manifest.mockups.push({
        screenId: screen.screenId,
        screenName: screen.screenName,
        route: screen.route,
        status: screen.status,
        file: rel,
        orphaned: screen.orphaned,
      });
    }
    const drafts = manifest.mockups.filter((m) => m.status !== 'approved').length;
    if (drafts) manifest.warnings.push(`${drafts} of ${manifest.mockups.length} mockups are not approved yet.`);
  } catch {
    /* design phase not started */
  }

  // 3. Epics & user stories.
  const stories = findStories(sessionId);
  const rendered = stories ? storiesMarkdown(stories) : null;
  if (rendered) {
    const rel = `${DOCS_DIR}/requirement/user-stories.md`;
    writeFile(sessionId, rel, rendered.markdown);
    manifest.storyCount = rendered.count;
    const req = manifest.phases.find((p) => p.id === 'requirement');
    const entry = { path: rel, title: `Epics & user stories (${rendered.count})` };
    if (req) req.files.push(entry);
    else manifest.phases.unshift({ id: 'requirement', name: 'Requirements Analysis', status: 'approved', files: [entry] });
  }

  // 4. Builder-flow documents (requirement, solution design, tests, release).
  for (const doc of findBuilderDocs(sessionId)) {
    // The phase engine already carries the requirement document itself.
    if (doc.type.target === 'requirement' && manifest.phases.some((p) => p.id === 'requirement' && p.files.some((f) => f.path.endsWith('/requirement.md')))) continue;
    const rel = `${DOCS_DIR}/${doc.type.target}/${doc.file}`;
    writeFile(sessionId, rel, fs.readFileSync(doc.abs, 'utf-8'));
    const note = `${doc.generated}/${doc.total} sections generated${doc.skipped.length ? `; ignored less complete: ${doc.skipped.join(', ')}` : ''}`;
    let phase = manifest.phases.find((p) => p.id === doc.type.target);
    if (!phase) {
      phase = { id: doc.type.target, name: doc.type.title, status: 'builder document', files: [] };
      manifest.phases.push(phase);
    }
    phase.files.push({ path: rel, title: doc.type.title, note });
  }

  // 5. Requirement document held only inside a later phase's import.
  const reqPhase = manifest.phases.find((p) => p.id === 'requirement');
  if (!reqPhase?.files.some((f) => /REQ-|requirement\.md/i.test(f.path))) {
    const req = importedRequirementDoc(sessionId);
    if (req) {
      const rel = `${DOCS_DIR}/requirement/${req.id}.md`;
      writeFile(sessionId, rel, req.markdown);
      const entry = { path: rel, title: 'Requirement document' };
      if (reqPhase) reqPhase.files.unshift(entry);
      else manifest.phases.unshift({ id: 'requirement', name: 'Requirements Analysis', status: 'approved', files: [entry] });
    }
  }

  writeFile(sessionId, MANIFEST, JSON.stringify(manifest, null, 2));
  writeFile(sessionId, `${DOCS_DIR}/README.md`, manifestMarkdown(manifest));
  return manifest;
}

function manifestMarkdown(m: HandoverManifest): string {
  const phases = m.phases
    .map((p) => `## ${p.name} — ${p.status}\n${p.files.map((f) => `- \`${f.path}\` — ${f.title}${f.note ? ` _(${f.note})_` : ''}`).join('\n')}`)
    .join('\n\n');
  const mockups = m.mockups.length
    ? `| Screen | Name | Route | Status | File |\n|---|---|---|---|---|\n${m.mockups
        .map((s) => `| ${s.screenId} | ${s.screenName} | ${s.route ?? '—'} | ${s.status}${s.orphaned ? ' (orphaned)' : ''} | \`${s.file}\` |`)
        .join('\n')}`
    : '_No mockups were generated in the design phase._';
  return `# AIDLC hand-over — ${m.projectName}

Generated ${m.generatedAt}. Everything the earlier phases produced, carried into development.
Phase-engine documents (requirement / architecture / design) are the current, authoritative versions;
builder documents (solution design, tests, release) supplement them.

${m.warnings.length ? `**Warnings**\n${m.warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}
${phases}

## Live UI mockups (design phase)
Each file is a self-contained HTML/CSS/JS screen. Rebuild the UI to match them: layout, components, copy, states.

${mockups}
`;
}

export function readManifest(sessionId: string): HandoverManifest | null {
  try {
    return JSON.parse(fs.readFileSync(resolveInWorkspace(sessionId, MANIFEST), 'utf-8'));
  } catch {
    return null;
  }
}

// ── secondbrain.md ───────────────────────────────────────────────────────────

function readWs(sessionId: string, rel: string): string {
  try {
    return fs.readFileSync(resolveInWorkspace(sessionId, rel), 'utf-8');
  } catch {
    return '';
  }
}

function importedBlock(sessionId: string, m: HandoverManifest): string {
  if (!m.phases.length && !m.mockups.length) {
    return '_No earlier phase has produced documents for this project yet. Describe what to build in the chat, or fill in the sections above._';
  }
  const ports = projectPorts(sessionId);
  const parts: string[] = [
    `Full hand-over index: \`${DOCS_DIR}/README.md\`. Read the full documents with read_file / search before building anything they cover; this block only carries the essentials.`,
    `Reserved ports for this project: backend ${ports.backend}, frontend ${ports.frontend}.`,
  ];
  if (m.warnings.length) parts.push(`**Warnings**\n${m.warnings.map((w) => `- ${w}`).join('\n')}`);

  parts.push(
    `### Documents\n${m.phases
      .map((p) => `- **${p.name}** (${p.status}): ${p.files.map((f) => `\`${f.path}\``).join(', ')}`)
      .join('\n')}`
  );

  if (m.mockups.length) {
    parts.push(
      `### Live UI mockups — the visual spec for the frontend\n| Screen | Name | Route | Status | File |\n|---|---|---|---|---|\n${m.mockups
        .map((s) => `| ${s.screenId} | ${s.screenName} | ${s.route ?? '—'} | ${s.status} | \`${s.file}\` |`)
        .join('\n')}\nWhen building a screen, read its mockup HTML and reproduce its layout, components, copy and states.`
    );
  }
  if (m.storyCount) parts.push(`### User stories\n${m.storyCount} stories with acceptance criteria in \`${DOCS_DIR}/requirement/user-stories.md\`.`);

  const reqBrain = readWs(sessionId, `${DOCS_DIR}/requirement/second-brain.md`);
  if (reqBrain) parts.push(`### Project understanding (requirement phase)\n${reqBrain.replace(/^# .*$/m, '').trim().slice(0, 9000)}`);

  for (const phaseId of ['architecture', 'design']) {
    const phase = m.phases.find((p) => p.id === phaseId);
    const doc = phase?.files.find((f) => !f.path.endsWith('second-brain.md') && f.path.endsWith('.md'));
    if (doc) parts.push(`### ${phase!.name} — ${doc.path}\n${excerpt(readWs(sessionId, doc.path), 3500)}`);
  }
  return parts.join('\n\n');
}

function freshSecondBrain(sessionId: string, block: string): string {
  const project = getProjectBySessionId(sessionId);
  return `# ${project?.name ?? 'Project'} — Second Brain

This file is the project's memory for the development agent and is loaded into its context window on every turn.
Edit it to steer the agent: conventions, decisions, things it must never do.

## Goals
- Build a runnable first version that satisfies the approved requirements and matches the approved mockups.

## Tech stack & conventions
- See the approved blueprint below once it exists.

## Rules for the agent
- Ask before adding new dependencies beyond the blueprint.
- Keep changes small and explain them.
- Stay inside this workspace; use only the reserved ports.

## Development log
<!-- The agent appends decisions here. -->

## Imported from earlier phases
<!-- AIDLC:IMPORTED-CONTEXT:START -->
${block}
<!-- AIDLC:IMPORTED-CONTEXT:END -->
`;
}

/** Carry every phase into the workspace; human edits outside the managed blocks survive. */
export function syncProjectContext(sessionId: string): HandoverManifest {
  const manifest = buildHandover(sessionId);
  const block = importedBlock(sessionId, manifest);
  const abs = resolveInWorkspace(sessionId, SECOND_BRAIN_FILE);
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, freshSecondBrain(sessionId, block), 'utf-8');
  else writeManagedBlock(sessionId, 'IMPORTED-CONTEXT', 'Imported from earlier phases', block);
  return manifest;
}

registerContextSyncer((sessionId) => {
  syncProjectContext(sessionId);
});
