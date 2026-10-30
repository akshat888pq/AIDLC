import fs from 'fs';
import path from 'path';
import { ARCH_SECTION_TEMPLATES } from '../prompts/architectureSections/templates.js';
import { ownedFiles, projectOutputDirName } from './artifactFiles.js';
import { getProject } from './projectStore.js';
import { readDiagram, renderDiagramSection } from './diagramStore.js';

/** The phase whose diagram this document carries. */
export const ARCHITECTURE_PHASE_ID = 'architecture';

export interface ArchSectionVersion {
  version: number;
  content: string;
  generatedAt: string;
  feedback?: string;
  status: 'superseded' | 'current' | 'approved';
  approvedAt?: string;
}

export type ArchSectionStatus = 'pending' | 'generating' | 'draft' | 'approved' | 'skipped';

export interface ArchitectureSection {
  number: number;
  title: string;
  key: string;
  status: ArchSectionStatus;
  content: string;
  versions: ArchSectionVersion[];
}

export interface ArchitectureDoc {
  id: string;
  projectId: string;
  requirementId: string;
  projectName: string;
  generatedDate: string;
  status: 'draft' | 'in-progress' | 'finalized';
  sections: ArchitectureSection[];
  createdAt: string;
  updatedAt: string;
}

export interface ArchitectureSummary {
  id: string;
  requirementId: string;
  title: string;
  status: string;
  sectionProgress: string;
  createdAt: string;
}

const ARCHITECTURE_DIR = path.resolve('architecture');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function archFilePath(projectId: string, archId: string): string {
  return path.join(ARCHITECTURE_DIR, `${projectId}-${archId}.json`);
}

function generateArchId(projectId: string): string {
  ensureDir(ARCHITECTURE_DIR);
  const existing = ownedFiles(ARCHITECTURE_DIR, projectId);

  let maxNum = 0;
  for (const f of existing) {
    const match = f.match(/ARCH-(\d+)\.json$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return `ARCH-${String(maxNum + 1).padStart(3, '0')}`;
}

export function createArchitecture(
  projectId: string,
  requirementId: string,
  projectName: string,
): ArchitectureDoc {
  ensureDir(ARCHITECTURE_DIR);
  const id = generateArchId(projectId);
  const now = new Date().toISOString();

  const sections: ArchitectureSection[] = ARCH_SECTION_TEMPLATES.map((t) => ({
    number: t.number,
    title: t.title,
    key: t.key,
    status: 'pending',
    content: '',
    versions: [],
  }));

  const doc: ArchitectureDoc = {
    id,
    projectId,
    requirementId,
    projectName,
    generatedDate: now.split('T')[0],
    status: 'draft',
    sections,
    createdAt: now,
    updatedAt: now,
  };

  fs.writeFileSync(archFilePath(projectId, id), JSON.stringify(doc, null, 2));
  return doc;
}

export function getArchitecture(projectId: string, archId: string): ArchitectureDoc | null {
  const fp = archFilePath(projectId, archId);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

export function saveArchitecture(doc: ArchitectureDoc): void {
  ensureDir(ARCHITECTURE_DIR);
  fs.writeFileSync(archFilePath(doc.projectId, doc.id), JSON.stringify(doc, null, 2));
}

export function getArchitecturesForProject(projectId: string): ArchitectureDoc[] {
  ensureDir(ARCHITECTURE_DIR);
  const files = ownedFiles(ARCHITECTURE_DIR, projectId);

  return files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ARCHITECTURE_DIR, f), 'utf-8'));
    } catch { return null; }
  }).filter(Boolean) as ArchitectureDoc[];
}

export function updateArchSectionContent(
  doc: ArchitectureDoc,
  sectionNumber: number,
  content: string,
  feedback?: string,
): ArchitectureDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);

  for (const v of section.versions) {
    if (v.status === 'current') v.status = 'superseded';
  }

  const newVersion: ArchSectionVersion = {
    version: section.versions.length + 1,
    content,
    generatedAt: new Date().toISOString(),
    feedback: feedback || undefined,
    status: 'current',
  };

  section.versions.push(newVersion);
  section.content = content;
  section.status = 'draft';
  doc.status = 'in-progress';
  doc.updatedAt = new Date().toISOString();

  saveArchitecture(doc);
  return doc;
}

export function approveArchSection(doc: ArchitectureDoc, sectionNumber: number, content?: string): ArchitectureDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);

  if (content && content !== section.content) {
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
  doc.updatedAt = new Date().toISOString();
  saveArchitecture(doc);
  return doc;
}

export function skipArchSection(doc: ArchitectureDoc, sectionNumber: number): ArchitectureDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);
  section.status = 'skipped';
  doc.updatedAt = new Date().toISOString();
  saveArchitecture(doc);
  return doc;
}

export function revertArchSection(doc: ArchitectureDoc, sectionNumber: number, version: number): ArchitectureDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);

  const target = section.versions.find((v) => v.version === version);
  if (!target) throw new Error(`Version ${version} not found`);

  for (const v of section.versions) {
    if (v.status === 'current' || v.status === 'approved') v.status = 'superseded';
  }

  target.status = 'current';
  section.content = target.content;
  section.status = 'draft';
  doc.updatedAt = new Date().toISOString();

  saveArchitecture(doc);
  return doc;
}

export function assembleArchitecture(doc: ArchitectureDoc): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`architecture_id: ${doc.id}`);
  lines.push(`generated_by: AIDLC v1.0`);
  lines.push(`generated_date: ${doc.generatedDate}`);
  lines.push(`status: ${doc.status}`);
  lines.push(`source_requirement: ${doc.requirementId}`);
  lines.push(`linked_tickets: []`);
  lines.push(`confidence_score: 85`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${doc.projectName} — Architecture Document`);
  lines.push('');

  for (const template of ARCH_SECTION_TEMPLATES) {
    const section = doc.sections.find((s) => s.number === template.number);
    if (section && section.content && section.status === 'approved') {
      lines.push(section.content);
    } else if (section && section.content) {
      lines.push(`<!-- Section ${template.number} status: ${section?.status || 'pending'} -->`);
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

  // Section 14 — only present when a human has approved a diagram.
  const sessionId = architectureSessionId(doc);
  const diagramSection = sessionId
    ? renderDiagramSection(
        readDiagram(sessionId, ARCHITECTURE_PHASE_ID),
        ARCH_SECTION_TEMPLATES.length + 1
      )
    : '';
  if (diagramSection) {
    lines.push(diagramSection);
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * The session a legacy architecture document belongs to.
 *
 * The document is keyed by project, but the diagram — like every other phase
 * artifact — lives under the session, so the two screens that build an
 * architecture share one diagram rather than each keeping its own.
 */
export function architectureSessionId(doc: ArchitectureDoc): string | null {
  return getProject(doc.projectId)?.sessionId ?? null;
}

export function finalizeArchitecture(doc: ArchitectureDoc): { markdown: string; savedPath: string } {
  const markdown = assembleArchitecture(doc);
  doc.status = 'finalized';
  doc.updatedAt = new Date().toISOString();
  saveArchitecture(doc);

  const projectDir = path.join(path.resolve('projects'), projectOutputDirName(doc.projectName, doc.projectId), 'architecture');
  ensureDir(projectDir);

  const filePath = path.join(projectDir, `${doc.id}.md`);
  fs.writeFileSync(filePath, markdown);

  return { markdown, savedPath: filePath };
}

export function toSummary(doc: ArchitectureDoc): ArchitectureSummary {
  const approved = doc.sections.filter((s) => s.status === 'approved').length;
  const total = doc.sections.length;
  return {
    id: doc.id,
    requirementId: doc.requirementId,
    title: `${doc.projectName} Architecture`,
    status: doc.status,
    sectionProgress: `${approved}/${total} approved`,
    createdAt: doc.createdAt,
  };
}
