import fs from 'fs';
import path from 'path';
import { RELEASE_SECTION_TEMPLATES } from '../prompts/releaseSections/templates.js';
import { ownedFiles, projectOutputDirName } from './artifactFiles.js';

export interface ReleaseSectionVersion {
  version: number;
  content: string;
  generatedAt: string;
  feedback?: string;
  status: 'superseded' | 'current' | 'approved';
  approvedAt?: string;
}

export type ReleaseSectionStatus = 'pending' | 'generating' | 'draft' | 'approved' | 'skipped';

export interface ReleaseSection {
  number: number;
  title: string;
  key: string;
  status: ReleaseSectionStatus;
  content: string;
  versions: ReleaseSectionVersion[];
}

export interface ReleaseDoc {
  id: string;
  projectId: string;
  requirementId: string;
  architectureId: string;
  designId: string;
  testId: string;
  projectName: string;
  generatedDate: string;
  status: 'draft' | 'in-progress' | 'finalized';
  sections: ReleaseSection[];
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseSummary {
  id: string;
  requirementId: string;
  architectureId: string;
  designId: string;
  testId: string;
  title: string;
  status: string;
  sectionProgress: string;
  createdAt: string;
}

const RELEASE_DIR = path.resolve('release');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function releaseFilePath(projectId: string, releaseId: string): string {
  return path.join(RELEASE_DIR, `${projectId}-${releaseId}.json`);
}

function generateReleaseId(projectId: string): string {
  ensureDir(RELEASE_DIR);
  const existing = ownedFiles(RELEASE_DIR, projectId);

  let maxNum = 0;
  for (const f of existing) {
    const match = f.match(/REL-(\d+)\.json$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return `REL-${String(maxNum + 1).padStart(3, '0')}`;
}

export function createRelease(
  projectId: string,
  requirementId: string,
  architectureId: string,
  designId: string,
  testId: string,
  projectName: string,
): ReleaseDoc {
  ensureDir(RELEASE_DIR);
  const id = generateReleaseId(projectId);
  const now = new Date().toISOString();

  const sections: ReleaseSection[] = RELEASE_SECTION_TEMPLATES.map((t) => ({
    number: t.number,
    title: t.title,
    key: t.key,
    status: 'pending',
    content: '',
    versions: [],
  }));

  const doc: ReleaseDoc = {
    id,
    projectId,
    requirementId,
    architectureId,
    designId,
    testId,
    projectName,
    generatedDate: now.split('T')[0],
    status: 'draft',
    sections,
    createdAt: now,
    updatedAt: now,
  };

  fs.writeFileSync(releaseFilePath(projectId, id), JSON.stringify(doc, null, 2));
  return doc;
}

export function getRelease(projectId: string, releaseId: string): ReleaseDoc | null {
  const fp = releaseFilePath(projectId, releaseId);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

export function saveRelease(doc: ReleaseDoc): void {
  ensureDir(RELEASE_DIR);
  fs.writeFileSync(releaseFilePath(doc.projectId, doc.id), JSON.stringify(doc, null, 2));
}

export function getReleasesForProject(projectId: string): ReleaseDoc[] {
  ensureDir(RELEASE_DIR);
  const files = ownedFiles(RELEASE_DIR, projectId);

  return files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(RELEASE_DIR, f), 'utf-8'));
    } catch { return null; }
  }).filter(Boolean) as ReleaseDoc[];
}

export function updateReleaseSectionContent(
  doc: ReleaseDoc,
  sectionNumber: number,
  content: string,
  feedback?: string,
): ReleaseDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);

  for (const v of section.versions) {
    if (v.status === 'current') v.status = 'superseded';
  }

  const newVersion: ReleaseSectionVersion = {
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

  saveRelease(doc);
  return doc;
}

export function approveReleaseSection(doc: ReleaseDoc, sectionNumber: number, content?: string): ReleaseDoc {
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
  saveRelease(doc);
  return doc;
}

export function skipReleaseSection(doc: ReleaseDoc, sectionNumber: number): ReleaseDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);
  section.status = 'skipped';
  doc.updatedAt = new Date().toISOString();
  saveRelease(doc);
  return doc;
}

export function revertReleaseSection(doc: ReleaseDoc, sectionNumber: number, version: number): ReleaseDoc {
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

  saveRelease(doc);
  return doc;
}

export function assembleRelease(doc: ReleaseDoc): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`release_notes_id: ${doc.id}`);
  lines.push(`generated_by: AIDLC v1.0`);
  lines.push(`generated_date: ${doc.generatedDate}`);
  lines.push(`status: ${doc.status}`);
  lines.push(`source_requirement: ${doc.requirementId}`);
  lines.push(`source_architecture: ${doc.architectureId}`);
  lines.push(`source_design: ${doc.designId}`);
  lines.push(`source_test_plan: ${doc.testId}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${doc.projectName} — Release Notes`);
  lines.push('');

  for (const template of RELEASE_SECTION_TEMPLATES) {
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

export function finalizeRelease(doc: ReleaseDoc): { markdown: string; savedPath: string } {
  const markdown = assembleRelease(doc);
  doc.status = 'finalized';
  doc.updatedAt = new Date().toISOString();
  saveRelease(doc);

  const projectDir = path.join(path.resolve('projects'), projectOutputDirName(doc.projectName, doc.projectId), 'release');
  ensureDir(projectDir);

  const filePath = path.join(projectDir, `${doc.id}.md`);
  fs.writeFileSync(filePath, markdown);

  return { markdown, savedPath: filePath };
}

export function toReleaseSummary(doc: ReleaseDoc): ReleaseSummary {
  const approved = doc.sections.filter((s) => s.status === 'approved').length;
  const total = doc.sections.length;
  return {
    id: doc.id,
    requirementId: doc.requirementId,
    architectureId: doc.architectureId,
    designId: doc.designId,
    testId: doc.testId,
    title: `${doc.projectName} Release Notes`,
    status: doc.status,
    sectionProgress: `${approved}/${total} approved`,
    createdAt: doc.createdAt,
  };
}
