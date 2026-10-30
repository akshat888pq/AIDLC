import fs from 'fs';
import path from 'path';
import type { RequirementDoc, RequirementSection, SectionVersion } from '../types/index.js';
import { SECTION_TEMPLATES } from '../prompts/sections/templates.js';
import { ownedFiles, projectOutputDirName } from './artifactFiles.js';

const REQUIREMENTS_DIR = path.resolve('requirements');
const PROJECTS_DIR = path.resolve('projects');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function reqFilePath(sessionId: string, reqId: string): string {
  return path.join(REQUIREMENTS_DIR, `${sessionId}-${reqId}.json`);
}

function generateReqId(sessionId: string): string {
  ensureDir(REQUIREMENTS_DIR);
  const existing = ownedFiles(REQUIREMENTS_DIR, sessionId);

  let maxNum = 0;
  for (const f of existing) {
    const match = f.match(/REQ-(\d+)\.json$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return `REQ-${String(maxNum + 1).padStart(3, '0')}`;
}

export function createRequirement(
  sessionId: string,
  projectName: string,
  sourceDocuments: string[],
  linkedTickets: string[],
  confidenceScore: number,
): RequirementDoc {
  ensureDir(REQUIREMENTS_DIR);
  const id = generateReqId(sessionId);

  const sections: RequirementSection[] = SECTION_TEMPLATES.map((t) => ({
    number: t.number,
    title: t.title,
    key: t.key,
    status: 'pending',
    content: '',
    versions: [],
  }));

  const doc: RequirementDoc = {
    id,
    sessionId,
    projectName,
    generatedDate: new Date().toISOString().split('T')[0],
    status: 'in-progress',
    sourceDocuments,
    linkedTickets,
    confidenceScore,
    sections,
  };

  fs.writeFileSync(reqFilePath(sessionId, id), JSON.stringify(doc, null, 2));
  return doc;
}

export function getRequirement(sessionId: string, reqId: string): RequirementDoc | null {
  const fp = reqFilePath(sessionId, reqId);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

export function saveRequirement(doc: RequirementDoc): void {
  ensureDir(REQUIREMENTS_DIR);
  fs.writeFileSync(reqFilePath(doc.sessionId, doc.id), JSON.stringify(doc, null, 2));
}

export function getLatestRequirement(sessionId: string): RequirementDoc | null {
  ensureDir(REQUIREMENTS_DIR);
  const files = ownedFiles(REQUIREMENTS_DIR, sessionId).reverse();

  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(REQUIREMENTS_DIR, files[0]), 'utf-8'));
}

export function getRequirementsForProject(sessionId: string): RequirementDoc[] {
  ensureDir(REQUIREMENTS_DIR);
  const files = ownedFiles(REQUIREMENTS_DIR, sessionId);

  return files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(REQUIREMENTS_DIR, f), 'utf-8'));
    } catch { return null; }
  }).filter(Boolean) as RequirementDoc[];
}

export function updateSectionContent(
  doc: RequirementDoc,
  sectionNumber: number,
  content: string,
  feedback?: string,
): RequirementDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);

  // Mark previous current version as superseded
  for (const v of section.versions) {
    if (v.status === 'current') v.status = 'superseded';
  }

  const newVersion: SectionVersion = {
    version: section.versions.length + 1,
    content,
    generatedAt: new Date().toISOString(),
    feedback: feedback || undefined,
    status: 'current',
  };

  section.versions.push(newVersion);
  section.content = content;
  section.status = 'draft';

  saveRequirement(doc);
  return doc;
}

export function approveSection(doc: RequirementDoc, sectionNumber: number, content?: string): RequirementDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);

  if (content && content !== section.content) {
    // User edited before approving
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
    // Approve current version
    const current = section.versions.find((v) => v.status === 'current');
    if (current) {
      current.status = 'approved';
      current.approvedAt = new Date().toISOString();
    }
  }

  section.status = 'approved';
  saveRequirement(doc);
  return doc;
}

export function skipSection(doc: RequirementDoc, sectionNumber: number): RequirementDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);
  section.status = 'skipped';
  saveRequirement(doc);
  return doc;
}

export function revertSection(doc: RequirementDoc, sectionNumber: number, version: number): RequirementDoc {
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

  saveRequirement(doc);
  return doc;
}

export function finalizeRequirement(doc: RequirementDoc, assembledMarkdown: string): string {
  doc.status = 'finalized';
  saveRequirement(doc);

  const projectDir = path.join(PROJECTS_DIR, projectOutputDirName(doc.projectName, doc.sessionId), 'requirements');
  ensureDir(projectDir);

  const filePath = path.join(projectDir, `${doc.id}.md`);
  fs.writeFileSync(filePath, assembledMarkdown);
  return filePath;
}
