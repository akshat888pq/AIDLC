import fs from 'fs';
import path from 'path';
import type { PhaseDoc, PhaseSectionState, RequirementDoc } from '../../types/index.js';
import type { PhaseConfig } from '../phaseConfig.js';
import { ensureDir, phaseDir, DEFAULT_PHASE_ID } from '../../services/secondBrain.js';
import {
  listDiagramSet,
  readDiagram,
  renderDiagramSection,
  renderDiagramSetSection,
} from '../../services/diagramStore.js';
import {
  createRequirement,
  getRequirement,
  getLatestRequirement,
  saveRequirement,
  updateSectionContent as updateRequirementSection,
  approveSection as approveRequirementSection,
  skipSection as skipRequirementSection,
  revertSection as revertRequirementSection,
  finalizeRequirement,
} from '../../services/requirementStore.js';
import { assembleRequirement } from '../../prompts/sections/assembler.js';

/**
 * The section-by-section document a phase builds.
 *
 * Non-requirement phases store one document per phase at
 * projects/<sessionId>/phases/<phaseId>/doc.json, with the finalized markdown
 * written next to it under the config's outputFileName.
 *
 * The requirement phase keeps using requirementStore — the same REQ-00n files the
 * existing requirement routes, Excel report, git commit and ticket flows all read.
 * Everything below simply projects a RequirementDoc into the shared PhaseDoc shape,
 * so one set of engine code (and one set of UI components) drives both.
 */

function docPath(sessionId: string, phaseId: string): string {
  return path.join(phaseDir(sessionId, phaseId), 'doc.json');
}

function isLegacyPhase(phaseId: string): boolean {
  return phaseId === DEFAULT_PHASE_ID;
}

function fromRequirementDoc(doc: RequirementDoc): PhaseDoc {
  return {
    id: doc.id,
    sessionId: doc.sessionId,
    phaseId: DEFAULT_PHASE_ID,
    projectName: doc.projectName,
    generatedDate: doc.generatedDate,
    status: doc.status === 'approved' ? 'finalized' : (doc.status as PhaseDoc['status']),
    sourceDocuments: doc.sourceDocuments,
    linkedTickets: doc.linkedTickets,
    confidenceScore: doc.confidenceScore,
    sections: doc.sections as unknown as PhaseSectionState[],
    createdAt: doc.generatedDate,
    updatedAt: doc.generatedDate,
  };
}

function readGenericDoc(sessionId: string, phaseId: string): PhaseDoc | null {
  const fp = docPath(sessionId, phaseId);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as PhaseDoc;
  } catch (err: any) {
    console.error(`[phaseDoc] corrupt doc for session=${sessionId} phase=${phaseId}: ${err.message}`);
    return null;
  }
}

function writeGenericDoc(doc: PhaseDoc): PhaseDoc {
  doc.updatedAt = new Date().toISOString();
  ensureDir(phaseDir(doc.sessionId, doc.phaseId));
  fs.writeFileSync(docPath(doc.sessionId, doc.phaseId), JSON.stringify(doc, null, 2), 'utf-8');
  return doc;
}

/** The phase's current document, or null if it has not been initialized. */
export function getPhaseDoc(sessionId: string, phaseId: string): PhaseDoc | null {
  if (isLegacyPhase(phaseId)) {
    const doc = getLatestRequirement(sessionId);
    return doc ? fromRequirementDoc(doc) : null;
  }
  return readGenericDoc(sessionId, phaseId);
}

export function getPhaseDocById(sessionId: string, phaseId: string, docId: string): PhaseDoc | null {
  if (isLegacyPhase(phaseId)) {
    const doc = getRequirement(sessionId, docId);
    return doc ? fromRequirementDoc(doc) : null;
  }
  const doc = readGenericDoc(sessionId, phaseId);
  return doc && doc.id === docId ? doc : null;
}

/**
 * Create the phase's document if it does not exist. An in-progress document is
 * returned as-is so re-entering the sections step never discards approved work.
 */
export function initPhaseDoc(
  sessionId: string,
  config: PhaseConfig,
  meta: { projectName: string; sourceDocuments: string[]; linkedTickets?: string[]; confidenceScore: number }
): PhaseDoc {
  if (isLegacyPhase(config.id)) {
    const existing = getLatestRequirement(sessionId);
    if (existing && existing.status === 'in-progress') return fromRequirementDoc(existing);
    const created = createRequirement(
      sessionId,
      meta.projectName,
      meta.sourceDocuments,
      meta.linkedTickets ?? [],
      meta.confidenceScore
    );
    return fromRequirementDoc(created);
  }

  const existing = readGenericDoc(sessionId, config.id);
  if (existing && existing.status !== 'finalized') return existing;

  const now = new Date().toISOString();
  const doc: PhaseDoc = {
    id: nextDocId(existing, config.docIdPrefix),
    sessionId,
    phaseId: config.id,
    projectName: meta.projectName,
    generatedDate: now.split('T')[0],
    status: 'draft',
    sourceDocuments: meta.sourceDocuments,
    linkedTickets: meta.linkedTickets ?? [],
    confidenceScore: meta.confidenceScore,
    sections: config.sections.map((s) => ({
      number: s.number,
      title: s.title,
      key: s.key,
      status: 'pending',
      content: '',
      versions: [],
    })),
    createdAt: now,
    updatedAt: now,
  };
  return writeGenericDoc(doc);
}

/**
 * ARCH-001, then ARCH-002 if a finalized document is being superseded. One phase
 * holds one live document at a time, so the counter only has to move past the
 * document it is replacing.
 */
function nextDocId(existing: PhaseDoc | null, prefix: string): string {
  const previous = existing?.id?.match(new RegExp(`^${prefix}-(\\d+)$`));
  const next = previous ? parseInt(previous[1], 10) + 1 : 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

export function setSectionContent(
  sessionId: string,
  phaseId: string,
  sectionNumber: number,
  content: string,
  feedback?: string
): PhaseDoc {
  if (isLegacyPhase(phaseId)) {
    const doc = getLatestRequirement(sessionId);
    if (!doc) throw new Error('No requirement document exists for this session');
    return fromRequirementDoc(updateRequirementSection(doc, sectionNumber, content, feedback));
  }

  const doc = mustReadGeneric(sessionId, phaseId);
  const section = findSection(doc, sectionNumber);

  for (const v of section.versions) {
    if (v.status === 'current') v.status = 'superseded';
  }
  section.versions.push({
    version: section.versions.length + 1,
    content,
    generatedAt: new Date().toISOString(),
    feedback: feedback || undefined,
    status: 'current',
  });
  section.content = content;
  section.status = 'draft';
  doc.status = 'in-progress';
  return writeGenericDoc(doc);
}

export function approveSection(
  sessionId: string,
  phaseId: string,
  sectionNumber: number,
  content?: string
): PhaseDoc {
  if (isLegacyPhase(phaseId)) {
    const doc = getLatestRequirement(sessionId);
    if (!doc) throw new Error('No requirement document exists for this session');
    return fromRequirementDoc(approveRequirementSection(doc, sectionNumber, content));
  }

  const doc = mustReadGeneric(sessionId, phaseId);
  const section = findSection(doc, sectionNumber);

  if (content && content !== section.content) {
    // The reviewer edited before approving — that edit becomes its own version.
    for (const v of section.versions) {
      if (v.status === 'current') v.status = 'superseded';
    }
    section.versions.push({
      version: section.versions.length + 1,
      content,
      generatedAt: new Date().toISOString(),
      status: 'approved',
      approvedAt: new Date().toISOString(),
    });
    section.content = content;
  } else {
    const current = section.versions.find((v) => v.status === 'current');
    if (current) {
      current.status = 'approved';
      current.approvedAt = new Date().toISOString();
    }
  }

  section.status = 'approved';
  return writeGenericDoc(doc);
}

export function skipSection(sessionId: string, phaseId: string, sectionNumber: number): PhaseDoc {
  if (isLegacyPhase(phaseId)) {
    const doc = getLatestRequirement(sessionId);
    if (!doc) throw new Error('No requirement document exists for this session');
    return fromRequirementDoc(skipRequirementSection(doc, sectionNumber));
  }
  const doc = mustReadGeneric(sessionId, phaseId);
  findSection(doc, sectionNumber).status = 'skipped';
  return writeGenericDoc(doc);
}

export function revertSection(
  sessionId: string,
  phaseId: string,
  sectionNumber: number,
  version: number
): PhaseDoc {
  if (isLegacyPhase(phaseId)) {
    const doc = getLatestRequirement(sessionId);
    if (!doc) throw new Error('No requirement document exists for this session');
    return fromRequirementDoc(revertRequirementSection(doc, sectionNumber, version));
  }

  const doc = mustReadGeneric(sessionId, phaseId);
  const section = findSection(doc, sectionNumber);
  const target = section.versions.find((v) => v.version === version);
  if (!target) throw new Error(`Version ${version} not found`);

  for (const v of section.versions) {
    if (v.status === 'current' || v.status === 'approved') v.status = 'superseded';
  }
  target.status = 'current';
  section.content = target.content;
  section.status = 'draft';
  return writeGenericDoc(doc);
}

/** The full document as markdown, including a YAML front-matter header. */
export function assemblePhaseDoc(doc: PhaseDoc, config: PhaseConfig): string {
  if (isLegacyPhase(config.id)) {
    const req = getRequirement(doc.sessionId, doc.id);
    if (req) {
      const diagram = renderDiagramSection(
        readDiagram(doc.sessionId, config.id),
        config.sections.length + 1
      );
      return diagram ? `${assembleRequirement(req)}\n${diagram}` : assembleRequirement(req);
    }
  }

  const lines: string[] = [];
  lines.push('---');
  lines.push(`${config.id}_id: ${doc.id}`);
  lines.push('generated_by: AIDLC v1.0');
  lines.push(`generated_date: ${doc.generatedDate}`);
  lines.push(`phase: ${config.id}`);
  lines.push(`status: ${doc.status}`);
  lines.push(`source_documents: [${doc.sourceDocuments.map((d) => `"${d}"`).join(', ')}]`);
  lines.push(`linked_tickets: [${doc.linkedTickets.map((t) => `"${t}"`).join(', ')}]`);
  lines.push(`confidence_score: ${doc.confidenceScore}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${doc.projectName} — ${config.name}`);
  lines.push('');

  for (const template of config.sections) {
    const section = doc.sections.find((s) => s.number === template.number);
    if (section && section.content && section.status === 'approved') {
      lines.push(section.content);
    } else if (section && section.content) {
      lines.push(`<!-- Section ${template.number} status: ${section.status} -->`);
      lines.push(section.content);
    } else {
      lines.push(`## ${template.number}. ${template.title}`);
      lines.push('');
      lines.push('_Section not yet generated._');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // The approved diagram becomes the section after the last configured one — 14
  // for the 13-section architecture document. It is appended rather than declared
  // in the phase config because it is optional: a document finalized without a
  // diagram must not carry an empty section 14.
  const diagramSection =
    config.diagramMode === 'set'
      ? renderDiagramSetSection(listDiagramSet(doc.sessionId, config.id), config.sections.length + 1)
      : renderDiagramSection(readDiagram(doc.sessionId, config.id), config.sections.length + 1);
  if (diagramSection) {
    lines.push(diagramSection);
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/** Write the assembled markdown to disk and mark the document finalized. */
export function finalizePhaseDoc(
  doc: PhaseDoc,
  config: PhaseConfig
): { markdown: string; savedPath: string } {
  const markdown = assemblePhaseDoc(doc, config);

  if (isLegacyPhase(config.id)) {
    const req = getRequirement(doc.sessionId, doc.id);
    if (!req) throw new Error('No requirement document exists for this session');
    const savedPath = finalizeRequirement(req, markdown);
    // Also place a copy at the uniform phase path so downstream phases have one
    // place to look for "the output of the phase before me".
    writePhaseOutput(doc.sessionId, config, markdown);
    return { markdown, savedPath };
  }

  const stored = mustReadGeneric(doc.sessionId, config.id);
  stored.status = 'finalized';
  writeGenericDoc(stored);
  const savedPath = writePhaseOutput(doc.sessionId, config, markdown);
  writeSectionFiles(stored, config);
  return { markdown, savedPath };
}

/**
 * Sections that declare a fileName are also written on their own, so the package
 * reads as a folder of documents (wireframes.md, design-system.md, …) as well as
 * one assembled file. Only approved content is written; a section that was skipped
 * or never approved has its stale file removed rather than left behind.
 */
function writeSectionFiles(doc: PhaseDoc, config: PhaseConfig): void {
  const dir = phaseDir(doc.sessionId, config.id);
  for (const template of config.sections) {
    if (!template.fileName) continue;
    const filePath = path.join(dir, template.fileName);
    const section = doc.sections.find((s) => s.number === template.number);
    if (section?.status === 'approved' && section.content.trim()) {
      const header = [
        '---',
        `document_id: ${doc.id}`,
        `section: ${template.number}`,
        `title: ${template.title}`,
        `project: ${doc.projectName}`,
        `generated_date: ${doc.generatedDate}`,
        '---',
        '',
      ].join('\n');
      fs.writeFileSync(filePath, `${header}${section.content.trim()}\n`, 'utf-8');
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

/** projects/<sessionId>/phases/<phaseId>/<outputFileName> */
export function writePhaseOutput(sessionId: string, config: PhaseConfig, markdown: string): string {
  const dir = phaseDir(sessionId, config.id);
  ensureDir(dir);
  const filePath = path.join(dir, config.outputFileName);
  fs.writeFileSync(filePath, markdown, 'utf-8');
  return filePath;
}

/** The finalized output of a phase, if it has produced one. */
export function readPhaseOutput(sessionId: string, config: PhaseConfig): string | null {
  const filePath = path.join(phaseDir(sessionId, config.id), config.outputFileName);
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');

  // Not finalized yet — fall back to assembling whatever has been approved so far.
  const doc = getPhaseDoc(sessionId, config.id);
  return doc ? assemblePhaseDoc(doc, config) : null;
}

/** Keep the requirement store in step when the engine touches a requirement doc. */
export function persistLegacyDoc(doc: RequirementDoc): void {
  saveRequirement(doc);
}

function mustReadGeneric(sessionId: string, phaseId: string): PhaseDoc {
  const doc = readGenericDoc(sessionId, phaseId);
  if (!doc) throw new Error(`No ${phaseId} document exists for this session`);
  return doc;
}

function findSection(doc: PhaseDoc, sectionNumber: number): PhaseSectionState {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);
  return section;
}
