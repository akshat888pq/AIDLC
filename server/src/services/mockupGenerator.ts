import fs from 'fs';
import path from 'path';
import type { LLMAdapter } from './llm/adapter.js';
import type { MockupScreen, MockupSet, MockupVersion } from '../types/index.js';
import * as brain from './secondBrain.js';
import { ensureDir, phaseDir } from './secondBrain.js';
import { screenBlock } from './designModel.js';
import { buildZip, type ZipEntry } from './zip.js';

/**
 * Live UI mockups: one complete, self-contained HTML file per screen of the design
 * package — Tailwind (CDN) + vanilla JavaScript, no framework and no build step —
 * generated from the screen's definition (Section 7) and the design system
 * (Section 6), and rendered in a sandboxed iframe in the browser.
 *
 * Unlike the JPG renderings, a mockup is working code: buttons respond, forms
 * validate, tabs switch, tables sort. A developer can lift the markup directly.
 *
 * Storage (projects/<sessionId>/phases/<phaseId>/):
 *   mockups.json            every screen's versions — a working file, not committed
 *   mockups/<SCR>-<slug>.html   the APPROVED version of each screen, cross-linked so
 *                               the folder opens as a clickable prototype
 *
 * Screens are read from the approved sections rather than the design model, so
 * mockups can be produced while the package is still under review — as soon as the
 * design system and the screen definitions are signed off.
 */

// Section numbers in the UX/UI design package (prompts/uxDesignSections/templates.ts).
const SECTION_IA = 3;
const SECTION_WIREFRAMES = 5;
const SECTION_DESIGN_SYSTEM = 6;
const SECTION_SCREEN_DEFINITIONS = 7;

/** Sections that must be approved before a mockup can be generated. */
export const MOCKUP_REQUIRED_SECTIONS = [SECTION_DESIGN_SYSTEM, SECTION_SCREEN_DEFINITIONS];

const SCREEN_ID = /^SCR-\d{3,}$/;

export class MockupError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

// ── The prompt ─────────────────────────────────────────────────────────────────

export const MOCKUP_SYSTEM_PROMPT = `You are a Senior UI Engineer turning an APPROVED screen specification into a
live, interactive HTML mockup. The mockup is not a picture: developers will lift its
markup directly, and reviewers will click through it as if it were the real product.

You receive: the design system (Section 6 — colours, typography, spacing, radii,
components), the screen definition (Section 7 — components, data, states, responsive
behaviour, accessibility), the screen's lo-fi wireframe (Section 5), the navigation
from the information architecture (Section 3), the list of every screen in the
application, and the project's Second Brain.

OUTPUT FORMAT — NON-NEGOTIABLE
- Output ONE complete HTML document and nothing else: it starts with <!DOCTYPE html>
  and ends with </html>. No markdown fences, no commentary before or after.
- Self-contained. The ONLY external resources allowed are:
    <script src="https://cdn.tailwindcss.com"></script>
    Google Fonts <link> tags for the fonts the design system names.
  No React, Vue, Alpine, jQuery or any other library. No images from the web — use
  inline SVG for icons and illustrations, and initials for avatars.
- All JavaScript is vanilla, in ONE <script> block before </body>, wrapped in an IIFE.
- Keep the file under ~35 KB so it is never truncated. Prefer generating repeated rows
  from a small JS data array over hand-writing them.

DESIGN SYSTEM FIDELITY
- Configure Tailwind right after the CDN script:
    <script>tailwind.config = { theme: { extend: { colors: { primary: '#…', … },
      fontFamily: { sans: ['…'], heading: ['…'] }, borderRadius: { DEFAULT: '…' } } } }</script>
  using the EXACT hex values, font families and radii from Section 6. Then use those
  token names (bg-primary, text-primary, font-heading…) — never a hex value the
  design system does not define, and never Tailwind's default palette for brand colours.
- Use the component vocabulary the design system names (ShadCN/ui-style Button, Card,
  Table, Dialog, Tabs, Badge, DropdownMenu…) and reproduce their look with Tailwind.
- Match the wireframe's layout: same regions, same order, same hierarchy.

INTERACTIVITY — EVERY CONTROL MUST DO SOMETHING
- Buttons: perform the action in-page (open a dialog, add a row, show a toast).
  Never use alert(), confirm() or prompt() — build an in-page toast / dialog instead.
- Forms: validate on submit and on blur with inline error text under the field,
  aria-invalid="true" and aria-describedby on the invalid input; required fields are
  marked; call event.preventDefault() on submit and show a success state.
- Tabs switch panels (role="tablist"/"tab"/"tabpanel", arrow-key support).
- Dropdowns and menus open/close on click, close on Escape and on outside click.
- Tables sort when a column header is clicked (aria-sort updated), filter from the
  search box, and paginate when there are more than 10 rows.
- Dialogs/sheets open and close (Escape, close button, backdrop), and return focus
  to the control that opened them.
- On mobile the navigation collapses to a hamburger button that opens a drawer.
- STATES: if the screen definition lists loading / empty / error states, implement
  each one, and add a small floating "Preview state" switcher fixed to the bottom-right
  corner (a <select> with Default / Loading / Empty / Error) that toggles between them.
  Give that switcher the attribute data-mockup-tool so developers can strip it.

NAVIGATION BETWEEN SCREENS
- Links and buttons that lead to another screen of this application use
  href="#SCR-00x" and data-screen="SCR-00x", with the target's real id from the
  screen list. The host application turns these into a clickable prototype.
- Navigation items for screens that are not in the list use href="#" and do nothing.
- Never navigate away from the document, never open windows, never call fetch/XHR,
  and never use localStorage, sessionStorage or cookies — the mockup runs in a
  sandboxed frame where they are unavailable.

CONTENT
- Use realistic sample data for THIS project's domain — real-looking names, dates,
  amounts, statuses — drawn from the requirements in the Second Brain. No lorem ipsum,
  no "Item 1 / Item 2".
- Every label, heading and column the screen definition names must appear, verbatim.

RESPONSIVE
- Mobile-first Tailwind. Use the breakpoints in the screen definition (default: mobile
  < 768px, tablet md: 768–1279px, desktop xl: 1280px+). The layout must work at 375px,
  768px and 1440px wide with no horizontal scrolling of the page body (a wide table
  may scroll inside its own overflow-x-auto container).
- Flex and grid only — no absolute positioning for layout, no fixed pixel page widths.

ACCESSIBILITY (WCAG 2.2 AA unless the package says otherwise)
- Semantic landmarks: <header>, <nav aria-label>, <main id="main">, <footer>; a
  "Skip to main content" link as the first focusable element.
- One <h1>; headings in order. Every input has a <label>. Icon-only buttons have
  aria-label. Visible focus rings (focus-visible:ring-2). Status changes announced
  through an aria-live="polite" region. Colour is never the only signal.
- Apply every accessibility note the screen definition gives for this screen.

At the top of <body>, add one HTML comment:
<!-- AIDLC mockup: <SCREEN ID> <Screen name> — generated from Section 7 + Section 6 -->`;

// ── Types / persistence ────────────────────────────────────────────────────────

function mockupsPath(sessionId: string, phaseId: string): string {
  return path.join(phaseDir(sessionId, phaseId), 'mockups.json');
}

function mockupsDir(sessionId: string, phaseId: string): string {
  return path.join(phaseDir(sessionId, phaseId), 'mockups');
}

interface StoredMockups {
  screens: Record<string, MockupScreen>;
}

function readStore(sessionId: string, phaseId: string): StoredMockups {
  const fp = mockupsPath(sessionId, phaseId);
  if (!fs.existsSync(fp)) return { screens: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    return { screens: parsed?.screens ?? {} };
  } catch (err: any) {
    console.error(`[mockups] corrupt store for session=${sessionId}: ${err.message}`);
    return { screens: {} };
  }
}

function writeStore(sessionId: string, phaseId: string, store: StoredMockups): void {
  ensureDir(phaseDir(sessionId, phaseId));
  fs.writeFileSync(mockupsPath(sessionId, phaseId), JSON.stringify(store, null, 2), 'utf-8');
}

// ── Source material ────────────────────────────────────────────────────────────

/** Approved section content by number, from the phase's doc.json. */
interface SectionSource {
  status: string;
  content: string;
}

function readSections(sessionId: string, phaseId: string): Map<number, SectionSource> {
  const fp = path.join(phaseDir(sessionId, phaseId), 'doc.json');
  const sections = new Map<number, SectionSource>();
  if (!fs.existsSync(fp)) return sections;
  try {
    const doc = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    for (const s of doc?.sections ?? []) sections.set(s.number, { status: s.status, content: s.content ?? '' });
  } catch {
    // Treated as "no sections".
  }
  return sections;
}

function approvedContent(sections: Map<number, SectionSource>, n: number): string {
  const s = sections.get(n);
  return s?.status === 'approved' ? s.content : '';
}

/** Why mockups cannot be generated yet, or null when they can. */
function blockedReason(sections: Map<number, SectionSource>): string | null {
  if (sections.size === 0) return 'Generate the design package sections first.';
  const missing = MOCKUP_REQUIRED_SECTIONS.filter((n) => sections.get(n)?.status !== 'approved');
  if (missing.length === 0) return null;
  const names: Record<number, string> = { 6: 'Section 6 (Design System)', 7: 'Section 7 (Screen Definitions)' };
  return `Approve ${missing.map((n) => names[n]).join(' and ')} before generating mockups.`;
}

/**
 * Every SCR id the package defines, in id order, with its name — from the headings of
 * the screen definitions, falling back to the screen inventory table in Section 3.
 */
export function discoverScreens(
  definitions: string,
  inventory: string
): { id: string; name: string; route?: string }[] {
  const found = new Map<string, { id: string; name: string; route?: string }>();

  for (const line of definitions.split(/\r?\n/)) {
    const heading = line.match(/^#{2,5}\s+(.*)$/);
    if (!heading) continue;
    const id = heading[1].match(/\bSCR[-‐–]?(\d{3,})\b/i);
    if (!id) continue;
    const screenId = `SCR-${id[1]}`;
    if (found.has(screenId)) continue;
    const name = heading[1]
      .replace(id[0], '')
      .replace(/[`*_]/g, '')
      .replace(/^[\s:—–\-|.()[\]]+|[\s:—–\-|.()[\]]+$/g, '')
      .trim();
    found.set(screenId, { id: screenId, name: name || screenId });
  }

  // Inventory rows: | SCR-001 | Dashboard | /dashboard | … — fills names and routes,
  // and supplies screens the definitions section forgot a heading for.
  for (const line of inventory.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.replace(/[`*]/g, '').trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    const idIdx = cells.findIndex((c) => /^SCR[-‐–]?\d{3,}$/i.test(c));
    if (idIdx < 0) continue;
    const screenId = `SCR-${cells[idIdx].replace(/\D/g, '')}`;
    const name = cells[idIdx + 1] || screenId;
    const route = cells.find((c) => c.startsWith('/'));
    const existing = found.get(screenId);
    if (existing) {
      if (existing.name === screenId) existing.name = name;
      if (route && !existing.route) existing.route = route;
    } else {
      found.set(screenId, { id: screenId, name, route });
    }
  }

  return [...found.values()].sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Every screen of the package with its mockup state (HTML omitted — fetch one screen for that). */
export function getMockupSet(sessionId: string, phaseId: string): MockupSet {
  const sections = readSections(sessionId, phaseId);
  const blocked = blockedReason(sections);
  const store = readStore(sessionId, phaseId);

  const discovered = discoverScreens(
    approvedContent(sections, SECTION_SCREEN_DEFINITIONS),
    approvedContent(sections, SECTION_IA) || sections.get(SECTION_IA)?.content || ''
  );

  const screens: MockupScreen[] = discovered.map((d) => {
    const stored = store.screens[d.id];
    return {
      ...(stored ?? { screenId: d.id, status: 'pending', versions: [], currentVersion: 0 }),
      screenId: d.id,
      screenName: d.name,
      route: d.route ?? stored?.route,
      fileName: mockupFileName(d.id, d.name),
    };
  });

  // Screens that have since dropped out of Section 7 keep their mockups, flagged.
  for (const stored of Object.values(store.screens)) {
    if (!screens.some((s) => s.screenId === stored.screenId)) {
      screens.push({ ...stored, orphaned: true, fileName: mockupFileName(stored.screenId, stored.screenName) });
    }
  }

  return {
    ready: blocked === null,
    blockedReason: blocked ?? undefined,
    screens: screens.map(withoutHtml),
  };
}

/** One screen with the HTML of every version. */
export function getMockup(sessionId: string, phaseId: string, screenId: string): MockupScreen {
  assertScreenId(screenId);
  const set = getMockupSet(sessionId, phaseId);
  const listed = set.screens.find((s) => s.screenId === screenId);
  if (!listed) throw new MockupError(`${screenId} is not a screen of this design package`, 404);
  const stored = readStore(sessionId, phaseId).screens[screenId];
  return { ...listed, versions: stored?.versions ?? [] };
}

/** Generate (or regenerate with feedback) one screen's mockup. */
export async function generateMockup(
  sessionId: string,
  phaseId: string,
  screenId: string,
  llm: LLMAdapter,
  opts: { feedback?: string; contextBlock: string }
): Promise<MockupScreen> {
  assertScreenId(screenId);
  const sections = readSections(sessionId, phaseId);
  const blocked = blockedReason(sections);
  if (blocked) throw new MockupError(blocked, 409);

  const set = getMockupSet(sessionId, phaseId);
  const screen = set.screens.find((s) => s.screenId === screenId && !s.orphaned);
  if (!screen) throw new MockupError(`${screenId} is not defined in Section 7`, 404);

  const definitions = approvedContent(sections, SECTION_SCREEN_DEFINITIONS);
  const definition = screenBlock(definitions, screenId);
  if (!definition) throw new MockupError(`No screen definition for ${screenId} was found in Section 7`, 404);

  const store = readStore(sessionId, phaseId);
  const existing = store.screens[screenId];
  const current = existing?.versions.find((v) => v.version === existing.currentVersion);
  const feedback = opts.feedback?.trim();

  const material = [
    `=== SCREEN TO BUILD: ${screenId} — ${screen.screenName}${screen.route ? ` (${screen.route})` : ''} ===`,
    '',
    '=== ALL SCREENS IN THE APPLICATION (for data-screen links) ===',
    set.screens
      .filter((s) => !s.orphaned)
      .map((s) => `${s.screenId} ${s.screenName}${s.route ? ` — ${s.route}` : ''}`)
      .join('\n'),
    '',
    '=== SECTION 6: DESIGN SYSTEM (approved) ===',
    truncate(approvedContent(sections, SECTION_DESIGN_SYSTEM), 20_000),
    '',
    `=== SECTION 7: SCREEN DEFINITION FOR ${screenId} (approved) ===`,
    definition,
    '',
    `=== SECTION 5: WIREFRAME FOR ${screenId} ===`,
    screenBlock(sections.get(SECTION_WIREFRAMES)?.content ?? '', screenId) || '(no wireframe found — follow the screen definition)',
    '',
    '=== SECTION 3: INFORMATION ARCHITECTURE (navigation) ===',
    truncate(sections.get(SECTION_IA)?.content ?? '(not available)', 8_000),
    ...(feedback && current
      ? [
          '',
          '=== CURRENT MOCKUP (revise THIS — keep everything the reviewer did not ask to change) ===',
          current.html,
          '',
          '=== REVIEWER FEEDBACK (apply all of it) ===',
          feedback,
        ]
      : feedback
      ? ['', '=== REVIEWER FEEDBACK (apply all of it) ===', feedback]
      : []),
  ].join('\n');

  console.log(`[mockups] session=${sessionId} generating ${screenId} (${llm.name})${feedback ? ' with feedback' : ''}`);
  const raw = await llm.analyze(
    `${MOCKUP_SYSTEM_PROMPT}\n\n---\n\nPROJECT CONTEXT (Second Brain):\n${truncate(opts.contextBlock, 15_000)}`,
    material
  );
  const html = extractHtml(raw);

  const entry = addVersion(store, screen, { html, source: 'generated', feedback });
  writeStore(sessionId, phaseId, store);
  syncPackageFiles(sessionId, phaseId);

  // The reviewer's words about a mockup are design feedback like any other — later
  // prompts read them from the Reviewer Trail. Logged against the screen definitions.
  if (feedback) {
    brain.recordSectionEvent(sessionId, phaseId, {
      sectionNumber: SECTION_SCREEN_DEFINITIONS,
      title: `Mockup ${screenId} ${screen.screenName}`,
      action: 'regenerated',
      version: entry.currentVersion,
      feedback,
    });
  }

  return { ...entry, fileName: screen.fileName };
}

/** Store a hand edit as a new version. */
export function saveMockupEdit(sessionId: string, phaseId: string, screenId: string, html: string): MockupScreen {
  assertScreenId(screenId);
  const screen = getMockup(sessionId, phaseId, screenId);
  const cleaned = requireHtml(html);
  const store = readStore(sessionId, phaseId);
  const current = store.screens[screenId]?.versions.find((v) => v.version === store.screens[screenId].currentVersion);
  if (current && current.html === cleaned) return screen;

  const entry = addVersion(store, screen, { html: cleaned, source: 'edited' });
  writeStore(sessionId, phaseId, store);
  syncPackageFiles(sessionId, phaseId);
  return { ...entry, fileName: screen.fileName };
}

/** Approve the current version — or, when html is passed, that edit as a new approved version. */
export function approveMockup(sessionId: string, phaseId: string, screenId: string, html?: string): MockupScreen {
  if (typeof html === 'string') saveMockupEdit(sessionId, phaseId, screenId, html);
  const store = readStore(sessionId, phaseId);
  const entry = store.screens[screenId];
  if (!entry || entry.currentVersion === 0) throw new MockupError(`Generate ${screenId} before approving it`, 409);

  entry.status = 'approved';
  entry.approvedVersion = entry.currentVersion;
  entry.approvedAt = new Date().toISOString();
  entry.updatedAt = entry.approvedAt;
  writeStore(sessionId, phaseId, store);
  syncPackageFiles(sessionId, phaseId);
  recordMockupKnowledge(sessionId, phaseId);
  return getMockup(sessionId, phaseId, screenId);
}

/** Make an earlier version current again (as a draft). */
export function revertMockup(sessionId: string, phaseId: string, screenId: string, version: number): MockupScreen {
  assertScreenId(screenId);
  const store = readStore(sessionId, phaseId);
  const entry = store.screens[screenId];
  if (!entry?.versions.some((v) => v.version === version)) throw new MockupError(`Version ${version} not found`, 404);

  entry.currentVersion = version;
  entry.status = entry.approvedVersion === version ? 'approved' : 'draft';
  entry.updatedAt = new Date().toISOString();
  writeStore(sessionId, phaseId, store);
  syncPackageFiles(sessionId, phaseId);
  recordMockupKnowledge(sessionId, phaseId);
  return getMockup(sessionId, phaseId, screenId);
}

/** The HTML to hand out for one screen (see deliverableHtml). */
export function mockupDownload(sessionId: string, phaseId: string, screenId: string): { fileName: string; html: string } {
  const screen = getMockup(sessionId, phaseId, screenId);
  const html = deliverableHtml(screen);
  if (!html) throw new MockupError(`${screenId} has no mockup yet`, 404);
  const links = linkMap(getMockupSet(sessionId, phaseId).screens);
  return { fileName: screen.fileName, html: crossLink(html, links) };
}

/** Every screen that has a mockup, cross-linked, plus an index page — as a ZIP. */
export function mockupArchive(sessionId: string, phaseId: string, projectName: string): { fileName: string; zip: Buffer } {
  const set = getMockupSet(sessionId, phaseId);
  const store = readStore(sessionId, phaseId);
  const links = linkMap(set.screens);

  const entries: ZipEntry[] = [];
  const listed: { screen: MockupScreen; approved: boolean }[] = [];
  for (const screen of set.screens) {
    const html = deliverableHtml({ ...screen, versions: store.screens[screen.screenId]?.versions ?? [] });
    if (!html) continue;
    entries.push({ name: `mockups/${screen.fileName}`, data: Buffer.from(crossLink(html, links), 'utf-8') });
    listed.push({ screen, approved: screen.status === 'approved' });
  }
  if (entries.length === 0) throw new MockupError('No mockups have been generated yet', 404);

  entries.unshift({ name: 'mockups/index.html', data: Buffer.from(indexPage(projectName, listed), 'utf-8') });
  const slug = slugify(projectName) || 'project';
  return { fileName: `${slug}-ui-mockups.zip`, zip: buildZip(entries) };
}

// ── Internals ──────────────────────────────────────────────────────────────────

function assertScreenId(screenId: string): void {
  if (!SCREEN_ID.test(screenId)) throw new MockupError(`Invalid screen id "${screenId}"`, 400);
}

function withoutHtml(screen: MockupScreen): MockupScreen {
  return { ...screen, versions: screen.versions.map((v) => ({ ...v, html: '' })) };
}

function addVersion(
  store: StoredMockups,
  screen: MockupScreen,
  v: { html: string; source: MockupVersion['source']; feedback?: string }
): MockupScreen {
  const now = new Date().toISOString();
  const entry: MockupScreen = store.screens[screen.screenId] ?? {
    screenId: screen.screenId,
    screenName: screen.screenName,
    route: screen.route,
    status: 'pending',
    versions: [],
    currentVersion: 0,
  };
  const version = entry.versions.reduce((max, x) => Math.max(max, x.version), 0) + 1;
  entry.versions.push({ version, html: v.html, source: v.source, feedback: v.feedback || undefined, createdAt: now });
  entry.currentVersion = version;
  entry.screenName = screen.screenName;
  entry.route = screen.route;
  entry.status = 'draft';
  entry.updatedAt = now;
  store.screens[screen.screenId] = entry;
  return entry;
}

/** Pull the HTML document out of whatever the model wrapped around it. */
export function extractHtml(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  if (fenced && /<html[\s>]/i.test(fenced[1])) text = fenced[1].trim();

  const start = text.search(/<!DOCTYPE html|<html[\s>]/i);
  const end = text.toLowerCase().lastIndexOf('</html>');
  if (start < 0) throw new MockupError('The model did not return an HTML document. Try regenerating.', 502);
  if (end < start) {
    throw new MockupError(
      'The model stopped before finishing the HTML document (no closing </html>). Regenerate, or ask for a simpler screen in the feedback.',
      502
    );
  }
  return requireHtml(text.slice(start, end + '</html>'.length));
}

/** Normalize a document: doctype present, Tailwind CDN present. */
function requireHtml(html: string): string {
  let out = html.trim();
  if (!/<html[\s>]/i.test(out) || !/<\/html>/i.test(out)) throw new MockupError('Not a complete HTML document', 400);
  if (!/^<!DOCTYPE html/i.test(out)) out = `<!DOCTYPE html>\n${out}`;
  if (!/cdn\.tailwindcss\.com/i.test(out)) {
    const tag = '<script src="https://cdn.tailwindcss.com"></script>';
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => `${m}\n  ${tag}`) : out.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${tag}</head>`);
  }
  return out;
}

/** What a download carries: the approved version while the screen is approved, else the current draft. */
function deliverableHtml(screen: MockupScreen): string | null {
  const pick = screen.status === 'approved' && screen.approvedVersion ? screen.approvedVersion : screen.currentVersion;
  return screen.versions.find((v) => v.version === pick)?.html || null;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function mockupFileName(screenId: string, name: string): string {
  const slug = slugify(name);
  return slug && slug !== screenId.toLowerCase() ? `${screenId}-${slug}.html` : `${screenId}.html`;
}

function linkMap(screens: MockupScreen[]): Map<string, string> {
  return new Map(screens.map((s) => [s.screenId, s.fileName]));
}

/** href="#SCR-002" → href="SCR-002-orders.html", so the exported files link to each other. */
function crossLink(html: string, links: Map<string, string>): string {
  return html.replace(/href=(["'])#(SCR-\d{3,})\1/g, (match, quote, id) => {
    const file = links.get(id);
    return file ? `href=${quote}${file}${quote}` : match;
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function indexPage(projectName: string, screens: { screen: MockupScreen; approved: boolean }[]): string {
  const rows = screens
    .map(
      ({ screen, approved }) => `      <li class="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <a class="font-medium text-indigo-700 hover:underline" href="${escapeHtml(screen.fileName)}">${escapeHtml(screen.screenId)} — ${escapeHtml(screen.screenName)}</a>
        <span class="text-xs ${approved ? 'text-emerald-700' : 'text-amber-700'}">${approved ? 'Approved' : 'Draft'}</span>
      </li>`
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(projectName)} — UI Mockups</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50 text-slate-900">
  <main class="mx-auto max-w-2xl px-4 py-10">
    <h1 class="text-2xl font-bold">${escapeHtml(projectName)} — UI Mockups</h1>
    <p class="mt-1 text-sm text-slate-600">Generated by AIDLC from the approved design package. Each file is standalone HTML + Tailwind + vanilla JS; links between screens work.</p>
    <ul class="mt-6 space-y-2">
${rows}
    </ul>
  </main>
</body>
</html>
`;
}

/**
 * mockups/ holds exactly the approved mockups — the committed package never carries
 * a draft, and a mockup that lost its approval loses its file.
 */
function syncPackageFiles(sessionId: string, phaseId: string): void {
  const dir = mockupsDir(sessionId, phaseId);
  const set = getMockupSet(sessionId, phaseId);
  const store = readStore(sessionId, phaseId);
  const links = linkMap(set.screens);
  const keep = new Set<string>();

  for (const screen of set.screens) {
    if (screen.status !== 'approved' || !screen.approvedVersion) continue;
    const html = store.screens[screen.screenId]?.versions.find((v) => v.version === screen.approvedVersion)?.html;
    if (!html) continue;
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, screen.fileName), crossLink(html, links), 'utf-8');
    keep.add(screen.fileName);
  }

  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.html') && !keep.has(f)) fs.unlinkSync(path.join(dir, f));
  }
}

/** The next phase inherits which screens have an approved, runnable mockup. */
function recordMockupKnowledge(sessionId: string, phaseId: string): void {
  const approved = getMockupSet(sessionId, phaseId).screens.filter((s) => s.status === 'approved');
  brain.recordKnowledge(sessionId, phaseId, [
    {
      heading: 'UI Mockups',
      lines:
        approved.length > 0
          ? approved.map(
              (s) =>
                `${s.screenId} ${s.screenName} — approved interactive HTML mockup (Tailwind + vanilla JS) at phases/${phaseId}/mockups/${s.fileName}; use as the reference implementation for layout, states and interactions`
            )
          : ['No mockup has been approved yet.'],
    },
  ]);
}
