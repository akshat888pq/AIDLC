import fs from 'fs';
import path from 'path';
import { TEST_SECTION_TEMPLATES } from '../prompts/testSections/templates.js';
import { ownedFiles, projectOutputDirName } from './artifactFiles.js';

export interface TestSectionVersion {
  version: number;
  content: string;
  generatedAt: string;
  feedback?: string;
  status: 'superseded' | 'current' | 'approved';
  approvedAt?: string;
}

export type TestSectionStatus = 'pending' | 'generating' | 'draft' | 'approved' | 'skipped';

export interface TestSection {
  number: number;
  title: string;
  key: string;
  status: TestSectionStatus;
  content: string;
  versions: TestSectionVersion[];
}

export interface TestDoc {
  id: string;
  projectId: string;
  requirementId: string;
  architectureId: string;
  designId: string;
  projectName: string;
  generatedDate: string;
  status: 'draft' | 'in-progress' | 'finalized';
  sections: TestSection[];
  createdAt: string;
  updatedAt: string;
}

export interface TestSummary {
  id: string;
  requirementId: string;
  architectureId: string;
  designId: string;
  title: string;
  status: string;
  sectionProgress: string;
  createdAt: string;
}

const TEST_DIR = path.resolve('tests');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function testFilePath(projectId: string, testId: string): string {
  return path.join(TEST_DIR, `${projectId}-${testId}.json`);
}

function generateTestId(projectId: string): string {
  ensureDir(TEST_DIR);
  const existing = ownedFiles(TEST_DIR, projectId);

  let maxNum = 0;
  for (const f of existing) {
    const match = f.match(/TEST-(\d+)\.json$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return `TEST-${String(maxNum + 1).padStart(3, '0')}`;
}

export function createTest(
  projectId: string,
  requirementId: string,
  architectureId: string,
  designId: string,
  projectName: string,
): TestDoc {
  ensureDir(TEST_DIR);
  const id = generateTestId(projectId);
  const now = new Date().toISOString();

  const sections: TestSection[] = TEST_SECTION_TEMPLATES.map((t) => ({
    number: t.number,
    title: t.title,
    key: t.key,
    status: 'pending',
    content: '',
    versions: [],
  }));

  const doc: TestDoc = {
    id,
    projectId,
    requirementId,
    architectureId,
    designId,
    projectName,
    generatedDate: now.split('T')[0],
    status: 'draft',
    sections,
    createdAt: now,
    updatedAt: now,
  };

  fs.writeFileSync(testFilePath(projectId, id), JSON.stringify(doc, null, 2));
  return doc;
}

export function getTest(projectId: string, testId: string): TestDoc | null {
  const fp = testFilePath(projectId, testId);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

export function saveTest(doc: TestDoc): void {
  ensureDir(TEST_DIR);
  fs.writeFileSync(testFilePath(doc.projectId, doc.id), JSON.stringify(doc, null, 2));
}

export function getTestsForProject(projectId: string): TestDoc[] {
  ensureDir(TEST_DIR);
  const files = ownedFiles(TEST_DIR, projectId);

  return files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(TEST_DIR, f), 'utf-8'));
    } catch { return null; }
  }).filter(Boolean) as TestDoc[];
}

export function updateTestSectionContent(
  doc: TestDoc,
  sectionNumber: number,
  content: string,
  feedback?: string,
): TestDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);

  for (const v of section.versions) {
    if (v.status === 'current') v.status = 'superseded';
  }

  const newVersion: TestSectionVersion = {
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

  saveTest(doc);
  return doc;
}

export function approveTestSection(doc: TestDoc, sectionNumber: number, content?: string): TestDoc {
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
  saveTest(doc);
  return doc;
}

export function skipTestSection(doc: TestDoc, sectionNumber: number): TestDoc {
  const section = doc.sections.find((s) => s.number === sectionNumber);
  if (!section) throw new Error(`Section ${sectionNumber} not found`);
  section.status = 'skipped';
  doc.updatedAt = new Date().toISOString();
  saveTest(doc);
  return doc;
}

export function revertTestSection(doc: TestDoc, sectionNumber: number, version: number): TestDoc {
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

  saveTest(doc);
  return doc;
}

export function assembleTest(doc: TestDoc): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`test_plan_id: ${doc.id}`);
  lines.push(`generated_by: AIDLC v1.0`);
  lines.push(`generated_date: ${doc.generatedDate}`);
  lines.push(`status: ${doc.status}`);
  lines.push(`source_requirement: ${doc.requirementId}`);
  lines.push(`source_architecture: ${doc.architectureId}`);
  lines.push(`source_design: ${doc.designId}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${doc.projectName} — Test Plan`);
  lines.push('');

  for (const template of TEST_SECTION_TEMPLATES) {
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

export function finalizeTest(doc: TestDoc): { markdown: string; savedPath: string } {
  const markdown = assembleTest(doc);
  doc.status = 'finalized';
  doc.updatedAt = new Date().toISOString();
  saveTest(doc);

  const projectDir = path.join(path.resolve('projects'), projectOutputDirName(doc.projectName, doc.projectId), 'tests');
  ensureDir(projectDir);

  const filePath = path.join(projectDir, `${doc.id}.md`);
  fs.writeFileSync(filePath, markdown);

  return { markdown, savedPath: filePath };
}

export function toTestSummary(doc: TestDoc): TestSummary {
  const approved = doc.sections.filter((s) => s.status === 'approved').length;
  const total = doc.sections.length;
  return {
    id: doc.id,
    requirementId: doc.requirementId,
    architectureId: doc.architectureId,
    designId: doc.designId,
    title: `${doc.projectName} Test Plan`,
    status: doc.status,
    sectionProgress: `${approved}/${total} approved`,
    createdAt: doc.createdAt,
  };
}
