import fs from 'fs';
import path from 'path';
import { DESIGN_SECTION_TEMPLATES } from '../prompts/designSections/templates.js';
import { ownedFiles, projectOutputDirName } from './artifactFiles.js';

export interface DesignSectionVersion {
  version: number;
  content: string;
  generatedAt: string;
  feedback?: string;
  status: 'superseded' | 'current' | 'approved';
  approvedAt?: string;
}

export type DesignSectionStatus = 'pending' | 'generating' | 'draft' | 'approved' | 'skipped';

export interface DesignSection {
  number: number;
  title: string;
  key: string;
  status: DesignSectionStatus;
  content: string;
  versions: DesignSectionVersion[];
}

export interface DesignDoc {
  id: string;
  projectId: string;
  requirementId: string;
  architectureId: string;
  projectName: string;
  generatedDate: string;
  status: 'draft' | 'in-progress' | 'finalized';
  sections: DesignSection[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignSummary {
  id: string;
  requirementId: string;
  architectureId: string;
  title: string;
  status: string;
  sectionProgress: string;
  createdAt: string;
}

const DESIGN_DIR = path.resolve('design');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function designFilePath(projectId: string, designId: string): string {
  return path.join(DESIGN_DIR, `${projectId}-${designId}.json`);
}

function generateDesignId(projectId: string): string {
  ensureDir(DESIGN_DIR);
  const existing = ownedFiles(DESIGN_DIR, projectId);

  let maxNum = 0;
  for (const f of existing) {
    const match = f.match(/DES-(\d+)\.json$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return `DES-${String(maxNum + 1).padStart(3, '0')}`;
}

export function createDesign(
  projectId: string,
  requirementId: string,
  architectureId: string,
  projectName: string,
): DesignDoc {
  ensureDir(DESIGN_DIR);
  const id = generateDesignId(projectId);
  const now = new Date().toISOString();

  const sections: DesignSection[] = DESIGN_SECTION_TEMPLATES.map((t) => ({
    number: t.number,
    title: t.title,
    key: t.key,
    status: 'pending',
    content: '',
    versions: [],
  }));

  const doc: DesignDoc = {
    id,
    projectId,
    requirementId,
    architectureId,
    projectName,
    generatedDate: now.split('T')[0],
    status: 'draft',
    sections,
    createdAt: now,
    updatedAt: now,
  };

  fs.writeFileSync(designFilePath(projectId, id), JSON.stringify(doc, null, 2));
  return doc;
}

export function getDesign(projectId: string, designId: string): DesignDoc | null {
  const fp = designFilePath(projectId, designId);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

export function saveDesign(doc: DesignDoc): void {
  ensureDir(DESIGN_DIR);
  fs.writeFileSync(designFilePath(doc.projectId, doc.id), JSON.stringify(doc, null, 2));
}

export function getDesignsForProject(projectId: string): DesignDoc[] {
  ensureDir(DESIGN_DIR);
  const files = ownedFiles(DESIGN_DIR, projectId);

  return files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf-8'));
    } catch { return null; }
  }).filter(Boolean) as DesignDoc[];
}

export function updateDesignSectionContent(
  doc: DesignDoc,
  sectionNumber: number,
  content: string,
  feedback?: string,
): DesignDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);

  for (const v of section.versions) {
    if (v.status === 'current') v.status = 'superseded';
  }

  const newVersion: DesignSectionVersion = {
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

  saveDesign(doc);
  return doc;
}

export function approveDesignSection(doc: DesignDoc, sectionNumber: number, content?: string): DesignDoc {
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
  saveDesign(doc);
  return doc;
}

export function skipDesignSection(doc: DesignDoc, sectionNumber: number): DesignDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);
  section.status = 'skipped';
  doc.updatedAt = new Date().toISOString();
  saveDesign(doc);
  return doc;
}

export function revertDesignSection(doc: DesignDoc, sectionNumber: number, version: number): DesignDoc {
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

  saveDesign(doc);
  return doc;
}

export function assembleDesign(doc: DesignDoc): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`design_id: ${doc.id}`);
  lines.push(`generated_by: AIDLC v1.0`);
  lines.push(`generated_date: ${doc.generatedDate}`);
  lines.push(`status: ${doc.status}`);
  lines.push(`source_requirement: ${doc.requirementId}`);
  lines.push(`source_architecture: ${doc.architectureId}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${doc.projectName} — Solution Design Document`);
  lines.push('');

  for (const template of DESIGN_SECTION_TEMPLATES) {
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

  return lines.join('\n');
}

export function finalizeDesign(doc: DesignDoc): { markdown: string; savedPath: string } {
  const markdown = assembleDesign(doc);
  doc.status = 'finalized';
  doc.updatedAt = new Date().toISOString();
  saveDesign(doc);

  const projectDir = path.join(path.resolve('projects'), projectOutputDirName(doc.projectName, doc.projectId), 'design');
  ensureDir(projectDir);

  const filePath = path.join(projectDir, `${doc.id}.md`);
  fs.writeFileSync(filePath, markdown);

  return { markdown, savedPath: filePath };
}

export function toDesignSummary(doc: DesignDoc): DesignSummary {
  const approved = doc.sections.filter((s) => s.status === 'approved').length;
  const total = doc.sections.length;
  return {
    id: doc.id,
    requirementId: doc.requirementId,
    architectureId: doc.architectureId,
    title: `${doc.projectName} Solution Design`,
    status: doc.status,
    sectionProgress: `${approved}/${total} approved`,
    createdAt: doc.createdAt,
  };
}
