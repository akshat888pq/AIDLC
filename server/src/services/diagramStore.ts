import fs from 'fs';
import path from 'path';
import type { PhaseDiagram } from '../types/index.js';
import { ensureDir, phaseDir, updateBrain, readBrain } from './secondBrain.js';

/**
 * A phase's system diagram, stored two ways on purpose:
 *
 *   projects/<sessionId>/phases/<phaseId>/diagram.mmd   the raw Mermaid source,
 *       so it can be re-rendered, diffed, committed to git or opened in any
 *       Mermaid tool without going through this server.
 *   projects/<sessionId>/phases/<phaseId>/diagram.json  the state around it —
 *       status, revision count, who last touched it.
 *
 * The diagram is also written into the phase's Second Brain, which is what makes
 * it visible to every later prompt: the design agent should see the architecture
 * it is designing against, not just read about it.
 *
 * The .mmd file is authoritative for the source text. If the two ever disagree
 * (someone edited the file by hand, which is a reasonable thing to do), the file
 * wins.
 */

/*
 * Keyed diagrams — for a phase whose config says diagramMode: 'set' — live one
 * level down, each with its own source, metadata and (optionally) a JPG rendering:
 *
 *   projects/<sessionId>/phases/<phaseId>/diagrams/<key>.mmd | .json | .jpg
 *
 * Every function below takes the key as an optional last argument; without it the
 * phase's single system diagram is addressed exactly as before.
 */

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid diagram key "${key}"`);
}

export function isValidDiagramKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function diagramSetDir(sessionId: string, phaseId: string): string {
  return path.join(phaseDir(sessionId, phaseId), 'diagrams');
}

function mmdPath(sessionId: string, phaseId: string, key?: string): string {
  if (!key) return path.join(phaseDir(sessionId, phaseId), 'diagram.mmd');
  assertKey(key);
  return path.join(diagramSetDir(sessionId, phaseId), `${key}.mmd`);
}

function metaPath(sessionId: string, phaseId: string, key?: string): string {
  if (!key) return path.join(phaseDir(sessionId, phaseId), 'diagram.json');
  assertKey(key);
  return path.join(diagramSetDir(sessionId, phaseId), `${key}.json`);
}

export function diagramImagePath(sessionId: string, phaseId: string, key: string): string {
  assertKey(key);
  return path.join(diagramSetDir(sessionId, phaseId), `${key}.jpg`);
}

export function diagramFilePath(sessionId: string, phaseId: string, key?: string): string {
  return mmdPath(sessionId, phaseId, key);
}

function emptyDiagram(sessionId: string, phaseId: string, key?: string): PhaseDiagram {
  return { sessionId, phaseId, status: 'none', mermaid: '', revision: 0, ...(key ? { key } : {}) };
}

export function readDiagram(sessionId: string, phaseId: string, key?: string): PhaseDiagram {
  const meta = metaPath(sessionId, phaseId, key);
  let diagram = emptyDiagram(sessionId, phaseId, key);

  if (fs.existsSync(meta)) {
    try {
      diagram = { ...diagram, ...(JSON.parse(fs.readFileSync(meta, 'utf-8')) as PhaseDiagram) };
    } catch (err: any) {
      console.error(`[diagram] corrupt metadata for session=${sessionId} phase=${phaseId}: ${err.message}`);
    }
  }

  const mmd = mmdPath(sessionId, phaseId, key);
  if (fs.existsSync(mmd)) {
    const source = fs.readFileSync(mmd, 'utf-8').trim();
    if (source) diagram.mermaid = source;
    // A .mmd with no metadata beside it means the file was written by hand.
    if (diagram.status === 'none' && source) diagram.status = 'draft';
  }

  if (key) diagram.hasImage = fs.existsSync(diagramImagePath(sessionId, phaseId, key));
  return diagram;
}

function write(diagram: PhaseDiagram): PhaseDiagram {
  const key = diagram.key;
  const dir = key
    ? diagramSetDir(diagram.sessionId, diagram.phaseId)
    : phaseDir(diagram.sessionId, diagram.phaseId);
  ensureDir(dir);
  diagram.updatedAt = new Date().toISOString();
  const { hasImage: _derived, ...stored } = diagram;
  fs.writeFileSync(mmdPath(diagram.sessionId, diagram.phaseId, key), diagram.mermaid, 'utf-8');
  fs.writeFileSync(metaPath(diagram.sessionId, diagram.phaseId, key), JSON.stringify(stored, null, 2), 'utf-8');
  if (key) diagram.hasImage = fs.existsSync(diagramImagePath(diagram.sessionId, diagram.phaseId, key));

  // Mirror into the Second Brain so downstream phases inherit the picture, not
  // just the prose. Only do it for a brain that exists — generating a diagram must
  // never be the thing that creates a phase's brain. Diagram sets are carried by
  // the assembled document instead, which embeds every approved one.
  if (!key && readBrain(diagram.sessionId, diagram.phaseId)) {
    updateBrain(diagram.sessionId, (brain) => { brain.diagram = diagram; }, diagram.phaseId);
  }

  return diagram;
}

/** Record a freshly generated diagram. Always lands as a draft awaiting review. */
export function saveGeneratedDiagram(
  sessionId: string,
  phaseId: string,
  mermaid: string,
  key?: string,
  meta: Pick<PhaseDiagram, 'title' | 'kind' | 'origin'> = {}
): PhaseDiagram {
  const existing = readDiagram(sessionId, phaseId, key);
  // New source means a saved JPG no longer depicts it.
  if (key && existing.mermaid.trim() !== mermaid.trim()) removeDiagramImage(sessionId, phaseId, key);
  return write({
    ...existing,
    sessionId,
    phaseId,
    ...meta,
    mermaid: mermaid.trim(),
    status: 'draft',
    revision: existing.revision + 1,
    generatedAt: new Date().toISOString(),
    approvedAt: undefined,
    editedByHuman: false,
  });
}

/** Record a hand edit. Editing an approved diagram sends it back to draft. */
export function saveEditedDiagram(
  sessionId: string,
  phaseId: string,
  mermaid: string,
  key?: string
): PhaseDiagram {
  const existing = readDiagram(sessionId, phaseId, key);
  const trimmed = mermaid.trim();
  if (!trimmed) throw new Error('The diagram cannot be empty.');
  if (key && trimmed !== existing.mermaid.trim()) removeDiagramImage(sessionId, phaseId, key);

  return write({
    ...existing,
    sessionId,
    phaseId,
    mermaid: trimmed,
    status: 'draft',
    approvedAt: undefined,
    editedByHuman: true,
  });
}

/**
 * Sign the diagram off. The code is taken as given, so an edit the user never
 * explicitly saved is not silently lost when they click Approve.
 */
export function approveDiagram(
  sessionId: string,
  phaseId: string,
  mermaid?: string,
  key?: string
): PhaseDiagram {
  const existing = readDiagram(sessionId, phaseId, key);
  const source = (mermaid ?? existing.mermaid).trim();
  if (!source) throw new Error('There is no diagram to approve. Generate one first.');
  if (key && source !== existing.mermaid.trim()) removeDiagramImage(sessionId, phaseId, key);

  return write({
    ...existing,
    sessionId,
    phaseId,
    mermaid: source,
    status: 'approved',
    approvedAt: new Date().toISOString(),
    editedByHuman: existing.editedByHuman || (mermaid !== undefined && mermaid.trim() !== existing.mermaid),
  });
}

/**
 * Finalize without a diagram. The generated source is kept rather than deleted —
 * skipping is a decision about the document, not a reason to throw work away.
 */
export function skipDiagram(sessionId: string, phaseId: string, key?: string): PhaseDiagram {
  const existing = readDiagram(sessionId, phaseId, key);
  return write({ ...existing, sessionId, phaseId, status: 'skipped', approvedAt: undefined });
}

/** The diagram as a markdown section, or '' when there is nothing to embed. */
export function renderDiagramSection(
  diagram: PhaseDiagram | null,
  sectionNumber: number,
  title = 'System Architecture Diagram'
): string {
  if (!diagram || diagram.status !== 'approved' || !diagram.mermaid.trim()) return '';

  return [
    `## ${sectionNumber}. ${title}`,
    '',
    '```mermaid',
    diagram.mermaid.trim(),
    '```',
    '',
  ].join('\n');
}

// ── Diagram sets ───────────────────────────────────────────────────────────────

const KIND_RANK: Record<string, number> = { navigation: 0, 'user-flow': 1, 'component-hierarchy': 2 };

/** Every keyed diagram of a phase: navigation first, then flows, then the rest. */
export function listDiagramSet(sessionId: string, phaseId: string): PhaseDiagram[] {
  const dir = diagramSetDir(sessionId, phaseId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.mmd'))
    .map((f) => f.slice(0, -4))
    .filter((key) => KEY_PATTERN.test(key))
    .map((key) => readDiagram(sessionId, phaseId, key))
    .sort(
      (a, b) =>
        (KIND_RANK[a.kind ?? ''] ?? 9) - (KIND_RANK[b.kind ?? ''] ?? 9) ||
        (a.key ?? '').localeCompare(b.key ?? '')
    );
}

/** Remove a keyed diagram entirely — used when a rebuild no longer produces it. */
export function deleteDiagram(sessionId: string, phaseId: string, key: string): void {
  for (const fp of [mmdPath(sessionId, phaseId, key), metaPath(sessionId, phaseId, key)]) {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  removeDiagramImage(sessionId, phaseId, key);
}

/** Store the JPG a browser rendered from the diagram's current source. */
export function saveDiagramImage(
  sessionId: string,
  phaseId: string,
  key: string,
  jpg: Buffer
): PhaseDiagram {
  const existing = readDiagram(sessionId, phaseId, key);
  if (!existing.mermaid.trim()) throw new Error(`Diagram "${key}" does not exist.`);
  // JPEG files start with FF D8 FF — refuse anything else rather than store it as .jpg.
  if (jpg.length < 4 || jpg[0] !== 0xff || jpg[1] !== 0xd8 || jpg[2] !== 0xff) {
    throw new Error('The uploaded image is not a JPEG.');
  }
  ensureDir(diagramSetDir(sessionId, phaseId));
  fs.writeFileSync(diagramImagePath(sessionId, phaseId, key), jpg);
  return readDiagram(sessionId, phaseId, key);
}

function removeDiagramImage(sessionId: string, phaseId: string, key: string): void {
  const fp = diagramImagePath(sessionId, phaseId, key);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

/** Every approved diagram of a set as one markdown section, or '' when none is approved. */
export function renderDiagramSetSection(
  diagrams: PhaseDiagram[],
  sectionNumber: number,
  title = 'Design Diagrams'
): string {
  const approved = diagrams.filter((d) => d.status === 'approved' && d.mermaid.trim());
  if (approved.length === 0) return '';

  const lines = [`## ${sectionNumber}. ${title}`, ''];
  approved.forEach((d, i) => {
    lines.push(`### ${sectionNumber}.${i + 1} ${d.title ?? d.key}`, '');
    const image = d.hasImage ? ` · Image: \`diagrams/${d.key}.jpg\`` : '';
    lines.push(`Source: \`diagrams/${d.key}.mmd\`${image}`, '');
    lines.push('```mermaid', d.mermaid.trim(), '```', '');
  });
  return lines.join('\n');
}

/** One status for the whole set, in the shape the single-diagram UI already understands. */
export function summarizeDiagramSet(diagrams: PhaseDiagram[]): { status: PhaseDiagram['status']; revision: number; hasCode: boolean } {
  if (diagrams.length === 0) return { status: 'none', revision: 0, hasCode: false };
  const live = diagrams.filter((d) => d.status !== 'skipped');
  const status: PhaseDiagram['status'] =
    live.length === 0 ? 'skipped' : live.every((d) => d.status === 'approved') ? 'approved' : 'draft';
  return {
    status,
    revision: diagrams.reduce((n, d) => n + d.revision, 0),
    hasCode: diagrams.some((d) => d.mermaid.trim()),
  };
}
