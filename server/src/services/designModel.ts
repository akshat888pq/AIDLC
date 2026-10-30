import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { LLMAdapter } from './llm/adapter.js';
import { parseLlmJson } from './sessionContext.js';
import { ensureDir, phaseDir } from './secondBrain.js';

/**
 * The approved UX/UI design package, as structured data.
 *
 * The package itself is markdown a human signed off on. The Excel inventory, the JPG
 * screen renderings and the design phase's Second Brain all need the same facts in a
 * shape a program can use — so they are extracted ONCE, validated, and cached next to
 * the package as design-model.json, keyed by a hash of the markdown they came from.
 *
 * Like the architecture inventory, this is extraction, not design: every value must
 * come from the approved document. Where a value is missing or malformed the
 * validators below substitute a clearly-labelled default rather than letting a bad
 * hex code or a missing layout break the renderer.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type RegionKind =
  | 'stats'
  | 'table'
  | 'form'
  | 'cards'
  | 'list'
  | 'chart'
  | 'detail'
  | 'tabs'
  | 'filters'
  | 'text'
  | 'hero'
  | 'empty'
  | 'actions'
  | 'steps'
  | 'media';

export const REGION_KINDS: RegionKind[] = [
  'stats',
  'table',
  'form',
  'cards',
  'list',
  'chart',
  'detail',
  'tabs',
  'filters',
  'text',
  'hero',
  'empty',
  'actions',
  'steps',
  'media',
];

export interface ScreenRegion {
  kind: RegionKind;
  /** Region heading as the wireframe names it, e.g. "Recent inspections". */
  label: string;
  /** Kind-specific content: stat labels, table columns, form fields, tab names… */
  items: string[];
  /** Buttons that belong to the region (form submit, card CTA…). */
  actions: string[];
  /** Grid columns on desktop, where the wireframe states it (stats, cards). */
  columns?: number;
}

export type ScreenShell = 'sidebar' | 'topnav' | 'bottomtabs' | 'centered' | 'none';

export interface DesignScreen {
  id: string;
  name: string;
  route: string;
  module: string;
  purpose: string;
  requirements: string[];
  components: string[];
  apiCalls: string[];
  personas: string[];
  authRequired: string;
  needsHiFi: boolean;
  needsClientReview: boolean;
  shell: ScreenShell;
  navItems: string[];
  /** Header actions — primary first — shown beside the page title. */
  primaryActions: string[];
  regions: ScreenRegion[];
}

export interface DesignTokens {
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  pageBg: string;
  cardBg: string;
  inputBg: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  headingFont: string;
  bodyFont: string;
  /** Default component radius in px (ShadCN --radius). */
  radius: number;
  /** Which tokens fell back to a default because the package did not give a usable value. */
  defaulted: string[];
}

export interface DesignComponentRow {
  component: string;
  variants: string;
  source: string;
  usageCount: number;
  screens: string[];
}

export interface DesignDecisionRow {
  decision: string;
  options: string;
  chosen: string;
  rationale: string;
  impact: string;
}

export interface DesignFlowRow {
  id: string;
  name: string;
  persona: string;
  startScreen: string;
  endScreen: string;
}

export interface DesignModel {
  packageId: string;
  projectName: string;
  sourceHash: string;
  generatedAt: string;
  designSystem: { name: string; rationale: string };
  platforms: string;
  accessibility: string;
  responsiveStrategy: string;
  darkMode: string;
  navigationStyle: string;
  tokens: DesignTokens;
  screens: DesignScreen[];
  components: DesignComponentRow[];
  decisions: DesignDecisionRow[];
  userFlows: DesignFlowRow[];
}

// ── Defaults ───────────────────────────────────────────────────────────────────

/** The palette in the design-system section's own format — used only when a token is unusable. */
export const DEFAULT_TOKENS: Omit<DesignTokens, 'defaulted'> = {
  primary: '#4361ee',
  secondary: '#64748b',
  accent: '#7c3aed',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
  pageBg: '#f8fafc',
  cardBg: '#ffffff',
  inputBg: '#f1f5f9',
  border: '#e2e8f0',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  textDisabled: '#cbd5e1',
  headingFont: 'Inter',
  bodyFont: 'Inter',
  radius: 8,
};

// ── Prompts ────────────────────────────────────────────────────────────────────

const INVENTORY_PROMPT = `You are a UX/UI Designer extracting a structured inventory from a UX/UI design
package that a human reviewer has already approved.

You are EXTRACTING, not designing. Every value must come from the package. Where the
package genuinely does not say, write "Not specified" (or an empty array). Never invent
a screen, a component, a requirement id or a colour.

Output raw JSON only (no markdown fences, no commentary) with this exact structure:
{
  "designSystem": { "name": "e.g. ShadCN/ui + Tailwind CSS", "rationale": "why, as the package states it" },
  "platforms": "target platforms as stated",
  "accessibility": "e.g. WCAG 2.2 AA; ADA compliance required",
  "responsiveStrategy": "breakpoints and the general approach, one or two sentences",
  "darkMode": "required / optional toggle / system preference / not required",
  "navigationStyle": "sidebar / top nav / bottom tabs / hybrid, as stated",
  "tokens": {
    "primary": "#hex", "secondary": "#hex", "accent": "#hex",
    "success": "#hex", "warning": "#hex", "error": "#hex", "info": "#hex",
    "pageBg": "#hex", "cardBg": "#hex", "inputBg": "#hex", "border": "#hex",
    "textPrimary": "#hex", "textSecondary": "#hex", "textMuted": "#hex", "textDisabled": "#hex",
    "headingFont": "font family name only", "bodyFont": "font family name only",
    "radius": 8
  },
  "screens": [
    {
      "id": "SCR-001",
      "name": "Dashboard",
      "route": "/dashboard",
      "module": "Dashboard",
      "purpose": "one line",
      "requirements": ["FR-001"],
      "components": ["Card", "Table", "DropdownMenu"],
      "apiCalls": ["GET /api/projects"],
      "personas": ["P-01 Sarah"],
      "authRequired": "Yes — any authenticated user",
      "needsHiFi": true,
      "needsClientReview": false
    }
  ],
  "components": [
    { "component": "Button", "variants": "default, destructive, outline, secondary, ghost, link", "source": "ShadCN" }
  ],
  "decisions": [
    { "decision": "Design system", "options": "ShadCN, MUI, custom", "chosen": "ShadCN/ui", "rationale": "…", "impact": "what it means for the developer" }
  ],
  "userFlows": [
    { "id": "UF-001", "name": "Login", "persona": "All users", "startScreen": "SCR-001", "endScreen": "SCR-002" }
  ]
}

Rules:
- "screens" must contain EVERY screen in the package's screen inventory (Section 3), in SCR id order.
- "components" lists the design-system components the package specifies or the screens use; "source" is "ShadCN", "CDS" or "custom" as the package states.
- "decisions" covers the key design decisions in Section 1 and any decision recorded in Sections 6-8.
- needsHiFi / needsClientReview are true only when Section 8's open items list that screen.
- Colours must be 6-digit hex codes copied from the design system section.`;

const LAYOUT_PROMPT = `You are a UX/UI Designer converting approved text wireframes into a layout
specification a renderer can draw.

For each screen requested below, read its wireframe (Section 5) and its screen
definition (Section 7) and describe its layout as an ordered list of regions, top to
bottom, exactly as the wireframe arranges them. Do not add regions the wireframe does
not show and do not drop regions it does show.

Region kinds (use only these):
- "stats"   — a row of metric cards. items = "Label: example value" per card.
- "table"   — a data table. items = the column headers.
- "form"    — input fields. items = field labels (append " *" for required); actions = buttons.
- "cards"   — a grid of content cards. items = card titles.
- "list"    — a vertical list of rows (notifications, activity). items = example row texts.
- "chart"   — a chart. items = series or axis labels; label = chart title.
- "detail"  — read-only key/value details. items = "Field: example value".
- "tabs"    — a tab strip. items = tab names (first one active).
- "filters" — a search/filter bar. items = filter control labels.
- "text"    — a heading with body copy. items = short lines of copy.
- "hero"    — a large heading + subheading + call to action. items = [heading, subheading]; actions = CTA buttons.
- "empty"   — an empty state. items = [message]; actions = CTA.
- "actions" — a standalone button row. actions = button labels, primary first.
- "steps"   — a stepper / wizard progress. items = step names.
- "media"   — an image, map, file preview or video area. label = what it shows.

Screen shell (the chrome around the content):
- "sidebar"    — persistent left navigation
- "topnav"     — horizontal navigation in the header
- "bottomtabs" — mobile-first app with bottom tab bar
- "centered"   — a single centred card with no app navigation (login, register, reset password)
- "none"       — full-bleed page with only a header

Output raw JSON only (no markdown fences, no commentary):
{
  "screens": [
    {
      "id": "SCR-001",
      "shell": "sidebar",
      "navItems": ["Dashboard", "Projects", "Settings"],
      "primaryActions": ["New Project"],
      "regions": [
        { "kind": "stats", "label": "Key metrics", "items": ["Total projects: 12", "Active: 8"], "actions": [], "columns": 4 },
        { "kind": "table", "label": "Projects", "items": ["Name", "Status", "Owner", "Last updated"], "actions": [] }
      ]
    }
  ]
}

Rules:
- Every requested screen id must appear exactly once.
- navItems are the primary navigation items as the Information Architecture defines them (identical for every screen that shares the shell).
- Keep labels short (under 40 characters) — they are drawn on the image.
- Do not include the page header/title/breadcrumb as a region — the renderer draws those.`;

// ── Public API ─────────────────────────────────────────────────────────────────

function modelPath(sessionId: string, phaseId: string): string {
  return path.join(phaseDir(sessionId, phaseId), 'design-model.json');
}

export function readDesignModel(sessionId: string, phaseId: string): DesignModel | null {
  const fp = modelPath(sessionId, phaseId);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as DesignModel;
  } catch (err: any) {
    console.error(`[designModel] corrupt model for session=${sessionId}: ${err.message}`);
    return null;
  }
}

export function hashMarkdown(markdown: string): string {
  return crypto.createHash('sha256').update(markdown).digest('hex').slice(0, 16);
}

const LAYOUT_BATCH_SIZE = 6;

/**
 * The design model for this exact package text — from cache when the package has not
 * changed since the last extraction, otherwise extracted afresh.
 */
export async function getOrBuildDesignModel(
  llm: LLMAdapter,
  opts: {
    sessionId: string;
    phaseId: string;
    markdown: string;
    contextBlock: string;
    packageId: string;
    projectName: string;
    regenerate?: boolean;
  }
): Promise<DesignModel> {
  const sourceHash = hashMarkdown(opts.markdown);
  const cached = readDesignModel(opts.sessionId, opts.phaseId);
  if (cached && cached.sourceHash === sourceHash && !opts.regenerate) return cached;

  console.log(`[designModel] session=${opts.sessionId} extracting inventory (${llm.name})`);
  const inventoryRaw = await llm.analyze(
    `${INVENTORY_PROMPT}\n\n---\n\n${opts.contextBlock}`,
    `=== APPROVED UX/UI DESIGN PACKAGE (${opts.packageId}) ===\n${opts.markdown}`
  );
  const inventory = parseLlmJson<any>(inventoryRaw, 'design inventory');

  const screens = normalizeScreens(inventory.screens);
  if (screens.length === 0) {
    throw new Error(
      'No screens could be extracted from the design package. Check that Section 3 has a screen inventory with SCR ids.'
    );
  }

  const layouts = await extractLayouts(llm, opts.markdown, screens);
  for (const screen of screens) {
    const layout = layouts.get(screen.id);
    if (layout) Object.assign(screen, layout);
    if (screen.regions.length === 0) {
      // A screen whose layout could not be read is still drawn — as an honest
      // placeholder, not a guess.
      screen.regions = [
        { kind: 'text', label: screen.name, items: [screen.purpose || 'Layout not specified in the wireframe.'], actions: [] },
      ];
    }
  }
  harmonizeNavigation(screens);

  const model: DesignModel = {
    packageId: opts.packageId,
    projectName: opts.projectName,
    sourceHash,
    generatedAt: new Date().toISOString(),
    designSystem: {
      name: str(inventory.designSystem?.name, 'Not specified'),
      rationale: str(inventory.designSystem?.rationale, 'Not specified'),
    },
    platforms: str(inventory.platforms, 'Not specified'),
    accessibility: str(inventory.accessibility, 'Not specified'),
    responsiveStrategy: str(inventory.responsiveStrategy, 'Not specified'),
    darkMode: str(inventory.darkMode, 'Not specified'),
    navigationStyle: str(inventory.navigationStyle, 'Not specified'),
    tokens: normalizeTokens(inventory.tokens),
    screens,
    components: buildComponentRows(inventory.components, screens),
    decisions: (Array.isArray(inventory.decisions) ? inventory.decisions : [])
      .map((d: any) => ({
        decision: str(d?.decision),
        options: str(d?.options, 'Not specified'),
        chosen: str(d?.chosen, 'Not specified'),
        rationale: str(d?.rationale, 'Not specified'),
        impact: str(d?.impact, 'Not specified'),
      }))
      .filter((d: DesignDecisionRow) => d.decision),
    userFlows: (Array.isArray(inventory.userFlows) ? inventory.userFlows : [])
      .map((f: any) => ({
        id: str(f?.id),
        name: str(f?.name),
        persona: str(f?.persona, 'Not specified'),
        startScreen: str(f?.startScreen, 'Not specified'),
        endScreen: str(f?.endScreen, 'Not specified'),
      }))
      .filter((f: DesignFlowRow) => f.id || f.name),
  };

  ensureDir(phaseDir(opts.sessionId, opts.phaseId));
  fs.writeFileSync(modelPath(opts.sessionId, opts.phaseId), JSON.stringify(model, null, 2), 'utf-8');
  console.log(
    `[designModel] session=${opts.sessionId} ${model.screens.length} screens, ${model.components.length} components, ${model.decisions.length} decisions`
  );
  return model;
}

// ── Layout extraction ──────────────────────────────────────────────────────────

async function extractLayouts(
  llm: LLMAdapter,
  markdown: string,
  screens: DesignScreen[]
): Promise<Map<string, Partial<DesignScreen>>> {
  const wireframes = sectionBody(markdown, 5);
  const definitions = sectionBody(markdown, 7);
  const ia = sectionBody(markdown, 3);
  const result = new Map<string, Partial<DesignScreen>>();

  for (let i = 0; i < screens.length; i += LAYOUT_BATCH_SIZE) {
    const batch = screens.slice(i, i + LAYOUT_BATCH_SIZE);
    const ids = batch.map((s) => s.id);

    const material = [
      '=== INFORMATION ARCHITECTURE (navigation) ===',
      truncate(ia, 12_000),
      ...batch.map((s) =>
        [
          `=== ${s.id}: ${s.name} (${s.route}) ===`,
          '--- Wireframe ---',
          screenBlock(wireframes, s.id) || '(no wireframe found for this screen)',
          '--- Screen definition ---',
          screenBlock(definitions, s.id) || '(no screen definition found for this screen)',
        ].join('\n')
      ),
    ].join('\n\n');

    console.log(`[designModel] layouts for ${ids.join(', ')}`);
    try {
      const raw = await llm.analyze(
        `${LAYOUT_PROMPT}\n\nSCREENS REQUESTED: ${ids.join(', ')}`,
        material
      );
      const parsed = parseLlmJson<any>(raw, 'design layouts');
      for (const entry of Array.isArray(parsed.screens) ? parsed.screens : []) {
        const id = str(entry?.id).toUpperCase();
        if (!ids.includes(id)) continue;
        result.set(id, {
          shell: normalizeShell(entry.shell),
          navItems: strList(entry.navItems).slice(0, 8),
          primaryActions: strList(entry.primaryActions).slice(0, 3),
          regions: normalizeRegions(entry.regions),
        });
      }
    } catch (err: any) {
      // One bad batch must not lose every other screen's layout.
      console.error(`[designModel] layout batch ${ids.join(', ')} failed: ${err.message}`);
    }
  }
  return result;
}

/** The body of "## N. Title" up to the next level-2 heading. */
export function sectionBody(markdown: string, sectionNumber: number): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${sectionNumber}\\.\\s`).test(l));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+\d+\.\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** One screen's block inside a section, found by its "SCR-00n" heading. */
export function screenBlock(sectionText: string, screenId: string): string {
  const lines = sectionText.split(/\r?\n/);
  const idPattern = new RegExp(`\\b${screenId.replace('-', '[-‐–]?')}\\b`, 'i');
  const start = lines.findIndex((l) => /^#{2,5}\s/.test(l) && idPattern.test(l));
  if (start < 0) return '';
  const level = (lines[start].match(/^#+/) ?? ['####'])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return truncate(lines.slice(start, end).join('\n'), 8_000);
}

// ── Normalization ──────────────────────────────────────────────────────────────

function str(value: any, fallback = ''): string {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function strList(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => str(v)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,;]\s*/).map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;
}

function normalizeScreens(raw: any): DesignScreen[] {
  const seen = new Set<string>();
  const screens: DesignScreen[] = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    const id = str(s?.id).toUpperCase().replace(/^SCR(\d)/, 'SCR-$1');
    if (!/^SCR-\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    screens.push({
      id,
      name: str(s.name, id),
      route: str(s.route, 'Not specified'),
      module: str(s.module, 'General'),
      purpose: str(s.purpose),
      requirements: strList(s.requirements),
      components: strList(s.components),
      apiCalls: strList(s.apiCalls),
      personas: strList(s.personas),
      authRequired: str(s.authRequired, 'Not specified'),
      needsHiFi: s.needsHiFi === true,
      needsClientReview: s.needsClientReview === true,
      shell: 'sidebar',
      navItems: [],
      primaryActions: [],
      regions: [],
    });
  }
  return screens.sort((a, b) => screenNumber(a.id) - screenNumber(b.id));
}

function screenNumber(id: string): number {
  return Number(id.replace(/\D/g, '')) || 0;
}

function normalizeShell(value: any): ScreenShell {
  const v = str(value).toLowerCase();
  if (v.includes('bottom')) return 'bottomtabs';
  if (v.includes('center') || v.includes('centre')) return 'centered';
  if (v.includes('top')) return 'topnav';
  if (v === 'none') return 'none';
  return 'sidebar';
}

function normalizeRegions(raw: any): ScreenRegion[] {
  const regions: ScreenRegion[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const kind = str(r?.kind).toLowerCase() as RegionKind;
    if (!REGION_KINDS.includes(kind)) continue;
    const columns = Number(r.columns);
    regions.push({
      kind,
      label: str(r.label).slice(0, 60),
      items: strList(r.items).slice(0, 12).map((i) => i.slice(0, 60)),
      actions: strList(r.actions).slice(0, 4).map((a) => a.slice(0, 30)),
      ...(Number.isFinite(columns) && columns >= 1 && columns <= 6 ? { columns: Math.round(columns) } : {}),
    });
  }
  return regions.slice(0, 10);
}

/**
 * Screens that share a shell share a navigation. The model occasionally lists
 * different nav items per screen; the most common list wins so the rendered set
 * reads as one application.
 */
function harmonizeNavigation(screens: DesignScreen[]): void {
  const byShell = new Map<ScreenShell, Map<string, { items: string[]; count: number }>>();
  for (const s of screens) {
    if (s.navItems.length === 0 || s.shell === 'centered') continue;
    const key = s.navItems.join('|');
    const bucket = byShell.get(s.shell) ?? new Map();
    const entry = bucket.get(key) ?? { items: s.navItems, count: 0 };
    entry.count++;
    bucket.set(key, entry);
    byShell.set(s.shell, bucket);
  }
  const all = [...byShell.values()].flatMap((b) => [...b.values()]);
  const global = all.sort((a, b) => b.count - a.count)[0]?.items ?? [];
  for (const s of screens) {
    if (s.shell === 'centered') continue;
    const bucket = byShell.get(s.shell);
    const best = bucket ? [...bucket.values()].sort((a, b) => b.count - a.count)[0]?.items : undefined;
    s.navItems = best ?? global;
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

function normalizeHex(value: any): string | null {
  const v = str(value);
  if (HEX.test(v)) return v.toLowerCase();
  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return null;
}

function normalizeFont(value: any, fallback: string): string {
  // Only a family name survives — it is written into an SVG attribute.
  const v = str(value).split(',')[0].replace(/["']/g, '').trim();
  return /^[A-Za-z0-9 \-]{2,40}$/.test(v) ? v : fallback;
}

function normalizeTokens(raw: any): DesignTokens {
  const defaulted: string[] = [];
  const tokens: any = {};
  for (const [key, fallback] of Object.entries(DEFAULT_TOKENS)) {
    if (key === 'headingFont' || key === 'bodyFont') {
      tokens[key] = normalizeFont(raw?.[key], fallback as string);
      if (tokens[key] !== normalizeFont(raw?.[key], '')) defaulted.push(key);
    } else if (key === 'radius') {
      const text = String(raw?.radius ?? '').replace(/px$/, '').trim();
      const n = text ? Number(text) : NaN;
      const usable = Number.isFinite(n) && n >= 0 && n <= 32;
      tokens.radius = usable ? n : fallback;
      if (!usable) defaulted.push(key);
    } else {
      const hex = normalizeHex(raw?.[key]);
      tokens[key] = hex ?? fallback;
      if (!hex) defaulted.push(key);
    }
  }
  return { ...(tokens as Omit<DesignTokens, 'defaulted'>), defaulted };
}

/** Usage counts come from the screens, not from the model — they must add up. */
function buildComponentRows(raw: any, screens: DesignScreen[]): DesignComponentRow[] {
  const rows = new Map<string, DesignComponentRow>();
  const key = (name: string) => name.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');

  for (const c of Array.isArray(raw) ? raw : []) {
    const name = str(c?.component);
    if (!name || rows.has(key(name))) continue;
    rows.set(key(name), {
      component: name,
      variants: str(c.variants, '—'),
      source: str(c.source, 'Not specified'),
      usageCount: 0,
      screens: [],
    });
  }

  for (const screen of screens) {
    for (const used of screen.components) {
      // "StatsCard x4 (ShadCN Card)" should count against Card when Card is in the library.
      const candidates = [used, ...(used.match(/\(([^)]+)\)/)?.[1]?.split(/\s+/) ?? [])];
      let row: DesignComponentRow | undefined;
      for (const candidate of candidates) {
        row = rows.get(key(candidate));
        if (row) break;
      }
      if (!row) {
        const name = used.replace(/\s*[x×]\s*\d+\s*$/i, '').trim();
        if (!name) continue;
        row = rows.get(key(name));
        if (!row) {
          row = { component: name, variants: '—', source: 'Not specified', usageCount: 0, screens: [] };
          rows.set(key(name), row);
        }
      }
      row.usageCount++;
      if (!row.screens.includes(screen.id)) row.screens.push(screen.id);
    }
  }

  return [...rows.values()].sort((a, b) => b.usageCount - a.usageCount || a.component.localeCompare(b.component));
}

// ── Second Brain knowledge ─────────────────────────────────────────────────────

/** The design decisions the next phase must inherit, as Second Brain knowledge blocks. */
export function designKnowledgeBlocks(model: DesignModel): { heading: string; lines: string[] }[] {
  const t = model.tokens;
  const defaulted = t.defaulted.length > 0 ? ` (defaults used for: ${t.defaulted.join(', ')})` : '';
  return [
    {
      heading: 'Design System',
      lines: [
        `System: ${model.designSystem.name} — ${model.designSystem.rationale}`,
        `Colours: primary ${t.primary}, secondary ${t.secondary}, accent ${t.accent}, success ${t.success}, warning ${t.warning}, error ${t.error}, info ${t.info}${defaulted}`,
        `Surfaces: page ${t.pageBg}, card ${t.cardBg}, input ${t.inputBg}, border ${t.border}`,
        `Text: primary ${t.textPrimary}, secondary ${t.textSecondary}, muted ${t.textMuted}, disabled ${t.textDisabled}`,
        `Typography: headings ${t.headingFont}, body ${t.bodyFont}; radius ${t.radius}px`,
        `Dark mode: ${model.darkMode}`,
        `Navigation: ${model.navigationStyle}`,
      ],
    },
    {
      heading: 'Screen Inventory',
      lines: model.screens.map((s) => {
        const flags = [s.needsHiFi ? 'needs Hi-Fi' : '', s.needsClientReview ? 'needs client review' : '']
          .filter(Boolean)
          .join(', ');
        return `${s.id} ${s.name} — ${s.route} — ${s.requirements.join(', ') || 'no FR linked'} — approved in ${model.packageId}${flags ? ` (${flags})` : ''}`;
      }),
    },
    {
      heading: 'User Flows',
      lines: model.userFlows.map((f) => `${f.id} ${f.name} — ${f.persona} — ${f.startScreen} → ${f.endScreen}`),
    },
    { heading: 'Responsive Strategy', lines: [model.responsiveStrategy, `Platforms: ${model.platforms}`] },
    { heading: 'Accessibility Approach', lines: [model.accessibility] },
    {
      heading: 'Design Decisions',
      lines: model.decisions.map((d) => `${d.decision}: ${d.chosen} — ${d.rationale}`),
    },
  ];
}
