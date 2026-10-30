import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { DesignModel, DesignScreen, DesignTokens, ScreenRegion } from './designModel.js';
import { ensureDir } from './secondBrain.js';

/**
 * Renders the approved design package as JPG images.
 *
 * Per screen: a lo-fi wireframe (greyscale, structure only — what the UX team shows
 * the client after IA), a hi-fi desktop mockup and a hi-fi mobile mockup with the
 * package's own design tokens applied. Plus one style-guide sheet for the design
 * system. Every image is drawn from the design model — the layout regions the
 * approved wireframes describe and the tokens the approved design system specifies —
 * so nothing is drawn that the reviewer did not sign off.
 *
 * Images are composed as SVG (flow layout, measured top to bottom — the same
 * relative-layout discipline the package asks of the developer) and rasterized by
 * sharp/librsvg. No browser is involved, so this runs anywhere the server runs.
 */

export type RenderVariant = 'wireframe' | 'desktop' | 'mobile';

export interface RenderedImage {
  /** Path relative to the images directory, with forward slashes. */
  file: string;
  screenId?: string;
  screenName?: string;
  variant: RenderVariant | 'style-guide';
  width: number;
  height: number;
}

// ── Theme ──────────────────────────────────────────────────────────────────────

interface Theme {
  wire: boolean;
  page: string;
  surface: string;
  border: string;
  text: string;
  textSub: string;
  muted: string;
  primary: string;
  onPrimary: string;
  primaryTint: string;
  input: string;
  placeholder: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  radius: number;
  font: string;
  headingFont: string;
}

const FALLBACK_FONTS = "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";

function themeFor(variant: RenderVariant, t: DesignTokens): Theme {
  if (variant === 'wireframe') {
    return {
      wire: true,
      page: '#ffffff',
      surface: '#ffffff',
      border: '#8c8c8c',
      text: '#262626',
      textSub: '#595959',
      muted: '#8c8c8c',
      primary: '#595959',
      onPrimary: '#ffffff',
      primaryTint: '#ececec',
      input: '#ffffff',
      placeholder: '#d9d9d9',
      success: '#8c8c8c',
      warning: '#8c8c8c',
      error: '#8c8c8c',
      info: '#8c8c8c',
      radius: 2,
      font: FALLBACK_FONTS,
      headingFont: FALLBACK_FONTS,
    };
  }
  return {
    wire: false,
    page: t.pageBg,
    surface: t.cardBg,
    border: t.border,
    text: t.textPrimary,
    textSub: t.textSecondary,
    muted: t.textMuted,
    primary: t.primary,
    onPrimary: readableOn(t.primary),
    primaryTint: mix(t.primary, '#ffffff', 0.88),
    input: t.inputBg,
    placeholder: mix(t.textMuted, '#ffffff', 0.6),
    success: t.success,
    warning: t.warning,
    error: t.error,
    info: t.info,
    radius: t.radius,
    font: `'${t.bodyFont}', ${FALLBACK_FONTS}`,
    headingFont: `'${t.headingFont}', ${FALLBACK_FONTS}`,
  };
}

// ── Colour helpers ─────────────────────────────────────────────────────────────

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** `amount` of `other` mixed into `hex` (0 = hex, 1 = other). */
export function mix(hex: string, other: string, amount: number): string {
  const a = rgb(hex);
  const b = rgb(other);
  return toHex(a.map((v, i) => v + (b[i] - v) * amount));
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever reads better on `bg`. */
function readableOn(bg: string): string {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#0f172a') ? '#ffffff' : '#0f172a';
}

// ── SVG primitives ─────────────────────────────────────────────────────────────

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Average glyph advance as a share of font size — good enough to truncate by. */
function textWidth(text: string, size: number, weight = 400): number {
  return text.length * size * (weight >= 600 ? 0.58 : 0.53);
}

function fit(text: string, maxWidth: number, size: number, weight = 400): string {
  if (textWidth(text, size, weight) <= maxWidth) return text;
  const chars = Math.max(1, Math.floor(maxWidth / (size * (weight >= 600 ? 0.58 : 0.53))) - 1);
  return `${text.slice(0, chars).trimEnd()}…`;
}

/** A deterministic 0..1 value per string, so the same screen always renders the same. */
function seeded(seed: string, n: number): number {
  let h = 2166136261;
  const s = `${seed}:${n}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

class Svg {
  parts: string[] = [];

  constructor(readonly theme: Theme) {}

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    o: { fill?: string; stroke?: string; rx?: number; dash?: boolean; sw?: number; shadow?: boolean } = {}
  ) {
    const attrs = [
      `x="${r(x)}" y="${r(y)}" width="${r(Math.max(0, w))}" height="${r(Math.max(0, h))}"`,
      `rx="${o.rx ?? 0}"`,
      `fill="${o.fill ?? 'none'}"`,
      o.stroke ? `stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : '',
      o.dash ? 'stroke-dasharray="6 4"' : '',
      o.shadow && !this.theme.wire ? 'filter="url(#shadow)"' : '',
    ];
    this.parts.push(`<rect ${attrs.filter(Boolean).join(' ')}/>`);
  }

  text(
    x: number,
    y: number,
    content: string,
    o: { size?: number; weight?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; heading?: boolean; maxWidth?: number } = {}
  ) {
    const size = o.size ?? 14;
    const weight = o.weight ?? 400;
    const value = o.maxWidth ? fit(content, o.maxWidth, size, weight) : content;
    const family = o.heading ? this.theme.headingFont : this.theme.font;
    this.parts.push(
      `<text x="${r(x)}" y="${r(y)}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${
        o.fill ?? this.theme.text
      }" text-anchor="${o.anchor ?? 'start'}">${esc(value)}</text>`
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: string, sw = 1, dash = false) {
    this.parts.push(
      `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${stroke}" stroke-width="${sw}"${
        dash ? ' stroke-dasharray="4 4"' : ''
      }/>`
    );
  }

  circle(cx: number, cy: number, radius: number, fill: string, stroke?: string) {
    this.parts.push(
      `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(radius)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="1.5"` : ''}/>`
    );
  }

  raw(markup: string) {
    this.parts.push(markup);
  }

  /** A grey text placeholder bar — the wireframe's stand-in for copy. */
  bar(x: number, y: number, w: number, h = 8) {
    this.rect(x, y, w, h, { fill: this.theme.placeholder, rx: h / 2 });
  }

  /** The wireframe convention for an image: a box with a cross through it. */
  imagePlaceholder(x: number, y: number, w: number, h: number) {
    const t = this.theme;
    if (t.wire) {
      this.rect(x, y, w, h, { fill: '#f5f5f5', stroke: t.border });
      this.line(x, y, x + w, y + h, t.placeholder);
      this.line(x + w, y, x, y + h, t.placeholder);
    } else {
      this.rect(x, y, w, h, { fill: t.primaryTint, rx: t.radius });
      // A simple landscape glyph, so it reads as "image" rather than "empty box".
      const cx = x + w / 2;
      const cy = y + h / 2;
      this.raw(
        `<path d="M${r(cx - 28)} ${r(cy + 16)} L${r(cx - 8)} ${r(cy - 8)} L${r(cx + 6)} ${r(cy + 6)} L${r(cx + 14)} ${r(cy - 2)} L${r(cx + 28)} ${r(cy + 16)} Z" fill="${mix(t.primary, '#ffffff', 0.55)}"/>`
      );
      this.circle(cx + 14, cy - 14, 5, mix(t.primary, '#ffffff', 0.55));
    }
  }

  /** Draw a button; returns its width. */
  button(x: number, y: number, label: string, kind: 'primary' | 'secondary' | 'outline' = 'primary', h = 40): number {
    const t = this.theme;
    const size = h <= 32 ? 13 : 14;
    const w = Math.max(80, textWidth(label, size, 600) + 32);
    if (kind === 'primary') {
      this.rect(x, y, w, h, { fill: t.primary, rx: t.radius });
      this.text(x + w / 2, y + h / 2 + size * 0.36, label, { size, weight: 600, fill: t.onPrimary, anchor: 'middle' });
    } else {
      const fill = kind === 'secondary' ? (t.wire ? '#f0f0f0' : mix(t.muted, '#ffffff', 0.85)) : t.surface;
      this.rect(x, y, w, h, { fill, stroke: t.border, rx: t.radius });
      this.text(x + w / 2, y + h / 2 + size * 0.36, label, { size, weight: 600, fill: t.text, anchor: 'middle' });
    }
    return w;
  }

  badge(x: number, y: number, label: string, color: string): number {
    const t = this.theme;
    const w = textWidth(label, 12, 600) + 20;
    if (t.wire) {
      this.rect(x, y, w, 22, { fill: '#ffffff', stroke: t.border, rx: 11 });
      this.text(x + w / 2, y + 15, label, { size: 12, weight: 600, fill: t.textSub, anchor: 'middle' });
    } else {
      this.rect(x, y, w, 22, { fill: mix(color, '#ffffff', 0.85), rx: 11 });
      this.text(x + w / 2, y + 15, label, { size: 12, weight: 600, fill: mix(color, '#000000', 0.35), anchor: 'middle' });
    }
    return w;
  }

  input(x: number, y: number, w: number, placeholder: string, h = 40) {
    const t = this.theme;
    this.rect(x, y, w, h, { fill: t.input, stroke: t.border, rx: t.radius });
    if (t.wire) this.bar(x + 12, y + h / 2 - 4, Math.min(w * 0.4, 140));
    else this.text(x + 12, y + h / 2 + 5, placeholder, { size: 14, fill: t.muted, maxWidth: w - 24 });
  }

  toString(width: number, height: number): string {
    const defs = this.theme.wire
      ? ''
      : '<defs><filter id="shadow" x="-5%" y="-5%" width="110%" height="120%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#0f172a" flood-opacity="0.08"/></filter></defs>';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs}<rect width="${width}" height="${height}" fill="${this.theme.page}"/>${this.parts.join('')}</svg>`;
  }
}

function r(n: number): string {
  return String(Math.round(n * 10) / 10);
}

// ── Sample content (hi-fi only) ────────────────────────────────────────────────

const SAMPLE_NAMES = ['Sarah Chen', 'Marcus Reid', 'Priya Nair', 'Tom Walsh', 'Aisha Khan'];
const SAMPLE_STATUS: [string, keyof Theme][] = [
  ['Active', 'success'],
  ['Pending', 'warning'],
  ['Completed', 'info'],
  ['Overdue', 'error'],
  ['Active', 'success'],
];

type Cell = { text: string } | { badge: string; color: keyof Theme };

function sampleCell(column: string, row: number): Cell {
  const c = column.toLowerCase();
  if (/status|state|stage/.test(c)) {
    const [label, color] = SAMPLE_STATUS[row % SAMPLE_STATUS.length];
    return { badge: label, color };
  }
  if (/date|updated|created|time|due|when/.test(c)) return { text: `${12 + row} Mar 2026` };
  if (/e-?mail/.test(c)) return { text: `${SAMPLE_NAMES[row % 5].split(' ')[0].toLowerCase()}@example.com` };
  if (/owner|user|assignee|inspector|author|by\b|person|customer|client|contact|manager|member/.test(c)) {
    return { text: SAMPLE_NAMES[row % SAMPLE_NAMES.length] };
  }
  if (/amount|price|total|cost|value|budget|balance/.test(c)) return { text: `$${(1240 + row * 385).toLocaleString('en-US')}.00` };
  if (/^id$|\bid\b|#|number|\bno\b|ref/.test(c)) return { text: `#${1042 + row}` };
  if (/count|qty|quantity|score|progress|%/.test(c)) return { text: String(12 + row * 7) };
  if (/action/.test(c)) return { text: 'View' };
  const base = column.replace(/[^A-Za-z ]/g, '').trim() || 'Item';
  return { text: `${base} ${row + 1}` };
}

// ── Screen layout ──────────────────────────────────────────────────────────────

interface Ctx {
  svg: Svg;
  t: Theme;
  mobile: boolean;
  seed: string;
}

const PANEL_PAD = 20;

/** A titled surface. Draws the chrome and returns the y where content starts. */
function panelStart(ctx: Ctx, x: number, y: number, w: number, label: string): number {
  if (!label) return y + PANEL_PAD;
  ctx.svg.text(x + PANEL_PAD, y + PANEL_PAD + 14, label, {
    size: 16,
    weight: 600,
    heading: true,
    maxWidth: w - PANEL_PAD * 2,
  });
  return y + PANEL_PAD + 30;
}

/** Panels are drawn after their content is measured, so the background goes underneath. */
function withPanel(ctx: Ctx, x: number, y: number, w: number, draw: (svg: Svg) => number): number {
  const content = new Svg(ctx.t);
  const h = draw(content);
  ctx.svg.rect(x, y, w, h, { fill: ctx.t.surface, stroke: ctx.t.border, rx: ctx.t.radius + 4, shadow: true });
  ctx.svg.parts.push(...content.parts);
  return h;
}

function drawRegion(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  switch (region.kind) {
    case 'stats':
      return drawStats(ctx, region, x, y, w);
    case 'table':
      return ctx.mobile ? drawTableAsCards(ctx, region, x, y, w) : drawTable(ctx, region, x, y, w);
    case 'form':
      return drawForm(ctx, region, x, y, w);
    case 'cards':
      return drawCards(ctx, region, x, y, w);
    case 'list':
      return drawList(ctx, region, x, y, w);
    case 'chart':
      return drawChart(ctx, region, x, y, w);
    case 'detail':
      return drawDetail(ctx, region, x, y, w);
    case 'tabs':
      return drawTabs(ctx, region, x, y, w);
    case 'filters':
      return drawFilters(ctx, region, x, y, w);
    case 'hero':
      return drawHero(ctx, region, x, y, w);
    case 'empty':
      return drawEmpty(ctx, region, x, y, w);
    case 'actions':
      return drawActions(ctx, region.actions.length > 0 ? region.actions : region.items, x, y, w);
    case 'steps':
      return drawSteps(ctx, region, x, y, w);
    case 'media':
      return drawMedia(ctx, region, x, y, w);
    case 'text':
    default:
      return drawText(ctx, region, x, y, w);
  }
}

function splitItem(item: string): [string, string | null] {
  const idx = item.indexOf(':');
  if (idx < 0) return [item.trim(), null];
  return [item.slice(0, idx).trim(), item.slice(idx + 1).trim() || null];
}

function drawStats(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { svg, t } = ctx;
  const items = region.items.length > 0 ? region.items : ['Metric: —'];
  const cols = ctx.mobile ? 1 : Math.min(region.columns ?? Math.min(items.length, 4), items.length);
  const gap = 16;
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = ctx.mobile ? 84 : 104;
  items.forEach((item, i) => {
    const cx = x + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (ch + gap);
    svg.rect(cx, cy, cw, ch, { fill: t.surface, stroke: t.border, rx: t.radius + 4, shadow: true });
    const [label, value] = splitItem(item);
    svg.text(cx + 20, cy + 30, label, { size: 13, weight: 500, fill: t.textSub, maxWidth: cw - 72 });
    if (t.wire) svg.bar(cx + 20, cy + ch - 38, Math.min(90, cw * 0.4), 18);
    else svg.text(cx + 20, cy + ch - 22, value ?? String(10 + Math.round(seeded(ctx.seed + label, i) * 90)), {
      size: ctx.mobile ? 24 : 28,
      weight: 700,
      heading: true,
      maxWidth: cw - 40,
    });
    svg.circle(cx + cw - 32, cy + 30, 14, t.primaryTint, t.wire ? t.border : undefined);
  });
  const rows = Math.ceil(items.length / cols);
  return rows * ch + (rows - 1) * gap;
}

function drawTable(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { t } = ctx;
  const columns = (region.items.length > 0 ? region.items : ['Name', 'Status', 'Updated']).slice(0, 6);
  return withPanel(ctx, x, y, w, (svg) => {
    let cy = panelStart({ ...ctx, svg }, x, y, w, region.label);
    const tx = x + PANEL_PAD;
    const tw = w - PANEL_PAD * 2;
    const colW = tw / columns.length;
    svg.rect(tx, cy, tw, 44, { fill: t.wire ? '#f0f0f0' : mix(t.muted, '#ffffff', 0.88), rx: t.radius });
    columns.forEach((col, i) => {
      svg.text(tx + i * colW + 14, cy + 27, col.toUpperCase(), { size: 12, weight: 600, fill: t.textSub, maxWidth: colW - 24 });
    });
    cy += 44;
    const rows = 5;
    for (let row = 0; row < rows; row++) {
      const ry = cy + row * 52;
      columns.forEach((col, i) => {
        const cx = tx + i * colW + 14;
        if (t.wire) {
          svg.bar(cx, ry + 22, Math.max(24, (colW - 40) * (0.45 + seeded(ctx.seed + col, row) * 0.5)));
          return;
        }
        const cell = sampleCell(col, row);
        if ('badge' in cell) svg.badge(cx, ry + 15, cell.badge, t[cell.color] as string);
        else
          svg.text(cx, ry + 31, cell.text, {
            size: 14,
            weight: i === 0 ? 500 : 400,
            fill: /action/i.test(col) ? t.primary : i === 0 ? t.text : t.textSub,
            maxWidth: colW - 24,
          });
      });
      svg.line(tx, ry + 52, tx + tw, ry + 52, t.border);
    }
    cy += rows * 52 + 16;
    // Pagination
    svg.text(tx, cy + 20, 'Showing 1–5 of 48', { size: 13, fill: t.muted });
    let px = tx + tw;
    for (const label of ['›', '3', '2', '1', '‹']) {
      const bw = 34;
      px -= bw + 6;
      const active = label === '1';
      svg.rect(px, cy, bw, 32, { fill: active ? t.primary : t.surface, stroke: active ? undefined : t.border, rx: t.radius });
      svg.text(px + bw / 2, cy + 21, label, { size: 13, weight: 600, fill: active ? t.onPrimary : t.text, anchor: 'middle' });
    }
    return cy + 32 + PANEL_PAD - y;
  });
}

/** Below 768px a table becomes a list of cards — the package's standard responsive rule. */
function drawTableAsCards(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { svg, t } = ctx;
  const columns = region.items.length > 0 ? region.items : ['Name', 'Status', 'Updated'];
  let cy = y;
  if (region.label) {
    svg.text(x, cy + 16, region.label, { size: 16, weight: 600, heading: true, maxWidth: w });
    cy += 30;
  }
  const statusCol = columns.find((c) => /status|state|stage/i.test(c));
  const others = columns.filter((c) => c !== statusCol).slice(0, 3);
  for (let row = 0; row < 3; row++) {
    const h = 44 + Math.max(0, others.length - 1) * 24 + 12;
    svg.rect(x, cy, w, h, { fill: t.surface, stroke: t.border, rx: t.radius + 4, shadow: true });
    others.forEach((col, i) => {
      const ly = cy + 28 + i * 24;
      if (t.wire) {
        svg.bar(x + 16, ly - 8, i === 0 ? w * 0.45 : w * 0.3, i === 0 ? 10 : 8);
        return;
      }
      const cell = sampleCell(col, row);
      const text = 'text' in cell ? cell.text : cell.badge;
      if (i === 0) svg.text(x + 16, ly, text, { size: 15, weight: 600, maxWidth: w - 130 });
      else svg.text(x + 16, ly, `${col}: ${text}`, { size: 13, fill: t.textSub, maxWidth: w - 32 });
    });
    if (statusCol) {
      const cell = sampleCell(statusCol, row);
      if ('badge' in cell) svg.badge(x + w - 100, cy + 14, cell.badge, t[cell.color] as string);
    }
    cy += h + 12;
  }
  svg.button(x, cy, 'Load more', 'outline');
  return cy + 40 - y;
}

function drawForm(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { t } = ctx;
  const fields = region.items.length > 0 ? region.items : ['Field'];
  return withPanel(ctx, x, y, w, (svg) => {
    let cy = panelStart({ ...ctx, svg }, x, y, w, region.label);
    const inner = w - PANEL_PAD * 2;
    const cols = !ctx.mobile && fields.length > 4 && inner > 640 ? 2 : 1;
    const gap = 20;
    const fw = (inner - gap * (cols - 1)) / cols;
    fields.forEach((field, i) => {
      const fx = x + PANEL_PAD + (i % cols) * (fw + gap);
      const fy = cy + Math.floor(i / cols) * 76;
      const required = /\*\s*$/.test(field);
      const label = field.replace(/\s*\*\s*$/, '');
      svg.text(fx, fy + 14, label, { size: 13, weight: 600, fill: t.text, maxWidth: fw - 16 });
      if (required) svg.text(fx + textWidth(label, 13, 600) + 4, fy + 14, '*', { size: 13, weight: 700, fill: t.error });
      svg.input(fx, fy + 24, fw, /password/i.test(label) ? '••••••••' : `Enter ${label.toLowerCase()}`);
    });
    cy += Math.ceil(fields.length / cols) * 76 + 8;
    const actions = region.actions.length > 0 ? region.actions : ['Submit'];
    if (ctx.mobile) {
      actions.forEach((a, i) => {
        fullWidthButton(svg, t, x + PANEL_PAD, cy, inner, a, i === 0);
        cy += 48;
      });
      return cy - 8 + PANEL_PAD - y;
    }
    let bx = x + PANEL_PAD;
    actions.forEach((a, i) => {
      bx += svg.button(bx, cy, a, i === 0 ? 'primary' : 'outline') + 12;
    });
    return cy + 40 + PANEL_PAD - y;
  });
}

function fullWidthButton(svg: Svg, t: Theme, x: number, y: number, w: number, label: string, primary: boolean) {
  svg.rect(x, y, w, 40, { fill: primary ? t.primary : t.surface, stroke: primary ? undefined : t.border, rx: t.radius });
  svg.text(x + w / 2, y + 25, label, { size: 14, weight: 600, fill: primary ? t.onPrimary : t.text, anchor: 'middle' });
}

function drawCards(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { svg, t } = ctx;
  let cy = y;
  if (region.label) {
    svg.text(x, cy + 16, region.label, { size: 16, weight: 600, heading: true, maxWidth: w });
    cy += 30;
  }
  const items = region.items.length > 0 ? region.items : ['Card'];
  const cols = ctx.mobile ? 1 : Math.min(region.columns ?? Math.min(items.length, 3), items.length);
  const gap = 16;
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = 216;
  items.forEach((item, i) => {
    const cx = x + (i % cols) * (cw + gap);
    const top = cy + Math.floor(i / cols) * (ch + gap);
    svg.rect(cx, top, cw, ch, { fill: t.surface, stroke: t.border, rx: t.radius + 4, shadow: true });
    svg.imagePlaceholder(cx + 16, top + 16, cw - 32, 96);
    svg.text(cx + 16, top + 138, item, { size: 15, weight: 600, heading: true, maxWidth: cw - 32 });
    svg.bar(cx + 16, top + 154, (cw - 32) * 0.9);
    svg.bar(cx + 16, top + 170, (cw - 32) * 0.6);
    const action = region.actions[0];
    if (action) svg.text(cx + 16, top + 202, `${action} →`, { size: 13, weight: 600, fill: t.primary, maxWidth: cw - 32 });
  });
  const rows = Math.ceil(items.length / cols);
  return cy - y + rows * ch + (rows - 1) * gap;
}

function drawList(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { t } = ctx;
  const items = (region.items.length > 0 ? region.items : ['Item', 'Item', 'Item']).slice(0, 6);
  return withPanel(ctx, x, y, w, (svg) => {
    let cy = panelStart({ ...ctx, svg }, x, y, w, region.label);
    items.forEach((item, i) => {
      const ry = cy + i * 60;
      svg.circle(x + PANEL_PAD + 18, ry + 30, 18, t.primaryTint, t.wire ? t.border : undefined);
      if (!t.wire) {
        const initials = item.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
        svg.text(x + PANEL_PAD + 18, ry + 35, initials || '•', { size: 12, weight: 700, fill: t.primary, anchor: 'middle' });
      }
      svg.text(x + PANEL_PAD + 48, ry + 26, item, { size: 14, weight: 500, maxWidth: w - PANEL_PAD * 2 - 90 });
      if (t.wire) svg.bar(x + PANEL_PAD + 48, ry + 36, Math.min(160, w * 0.3));
      else svg.text(x + PANEL_PAD + 48, ry + 44, `${2 + i} hours ago`, { size: 12, fill: t.muted });
      svg.text(x + w - PANEL_PAD - 8, ry + 35, '›', { size: 20, fill: t.muted, anchor: 'end' });
      if (i < items.length - 1) svg.line(x + PANEL_PAD, ry + 60, x + w - PANEL_PAD, ry + 60, t.border);
    });
    cy += items.length * 60;
    return cy + PANEL_PAD - y;
  });
}

function drawChart(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { t } = ctx;
  return withPanel(ctx, x, y, w, (svg) => {
    const cy = panelStart({ ...ctx, svg }, x, y, w, region.label || 'Chart');
    const h = ctx.mobile ? 180 : 220;
    const left = x + PANEL_PAD + 32;
    const right = x + w - PANEL_PAD;
    const bottom = cy + h - 24;
    for (let g = 0; g <= 4; g++) {
      const gy = cy + 8 + ((h - 32) * g) / 4;
      svg.line(left, gy, right, gy, t.border, 1, g !== 4);
      if (!t.wire) svg.text(left - 8, gy + 4, String((4 - g) * 25), { size: 11, fill: t.muted, anchor: 'end' });
    }
    const bars = ctx.mobile ? 6 : 12;
    const slot = (right - left) / bars;
    for (let b = 0; b < bars; b++) {
      const bh = (h - 40) * (0.25 + seeded(ctx.seed + region.label, b) * 0.7);
      svg.rect(left + b * slot + slot * 0.2, bottom - bh, slot * 0.6, bh, {
        fill: t.wire ? t.placeholder : b === bars - 1 ? t.primary : mix(t.primary, '#ffffff', 0.35),
        rx: Math.min(4, t.radius),
      });
    }
    let lx = left;
    for (const series of region.items.slice(0, 3)) {
      svg.rect(lx, bottom + 12, 10, 10, { fill: t.wire ? t.placeholder : t.primary, rx: 2 });
      svg.text(lx + 16, bottom + 21, series, { size: 12, fill: t.textSub, maxWidth: 160 });
      lx += Math.min(176, textWidth(series, 12) + 36);
    }
    return cy + h + (region.items.length > 0 ? 12 : 0) + PANEL_PAD - y;
  });
}

function drawDetail(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { t } = ctx;
  const items = region.items.length > 0 ? region.items : ['Field: Value'];
  return withPanel(ctx, x, y, w, (svg) => {
    const cy = panelStart({ ...ctx, svg }, x, y, w, region.label);
    const cols = ctx.mobile ? 1 : 2;
    const cw = (w - PANEL_PAD * 2) / cols;
    items.forEach((item, i) => {
      const fx = x + PANEL_PAD + (i % cols) * cw;
      const fy = cy + Math.floor(i / cols) * 56;
      const [label, value] = splitItem(item);
      svg.text(fx, fy + 14, label, { size: 12, weight: 600, fill: t.muted, maxWidth: cw - 16 });
      if (t.wire) svg.bar(fx, fy + 26, Math.min(cw * 0.6, 200), 10);
      else svg.text(fx, fy + 36, value ?? '—', { size: 15, fill: t.text, maxWidth: cw - 16 });
    });
    return cy + Math.ceil(items.length / cols) * 56 + PANEL_PAD - 8 - y;
  });
}

function drawTabs(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { svg, t } = ctx;
  const tabs = region.items.length > 0 ? region.items : ['Tab 1', 'Tab 2'];
  let tx = x;
  tabs.forEach((tab, i) => {
    const tw = textWidth(tab, 14, 600) + 28;
    if (tx + tw > x + w) return;
    const active = i === 0;
    svg.text(tx + 14, y + 26, tab, { size: 14, weight: active ? 600 : 500, fill: active ? t.primary : t.textSub });
    if (active) svg.rect(tx, y + 40, tw, 3, { fill: t.primary, rx: 1.5 });
    tx += tw + 4;
  });
  svg.line(x, y + 43, x + w, y + 43, t.border);
  return 44;
}

function drawFilters(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { svg, t } = ctx;
  const controls = region.items.length > 0 ? region.items : ['Search'];
  if (ctx.mobile) {
    svg.input(x, y, w - 52, `Search ${controls[0].toLowerCase().replace(/^search\s*/, '')}`.trim());
    svg.rect(x + w - 44, y, 44, 40, { fill: t.surface, stroke: t.border, rx: t.radius });
    // Filter icon: three stacked lines, each shorter than the last.
    [16, 11, 6].forEach((lw, i) => svg.rect(x + w - 22 - lw / 2, y + 13 + i * 6, lw, 2, { fill: t.textSub, rx: 1 }));
    return 40;
  }
  const searchW = Math.min(320, w * 0.34);
  svg.input(x, y, searchW, `🔍 ${controls[0]}`);
  let fx = x + searchW + 12;
  for (const control of controls.slice(1, 5)) {
    const cw = Math.min(200, textWidth(control, 14) + 56);
    if (fx + cw > x + w) break;
    svg.rect(fx, y, cw, 40, { fill: t.surface, stroke: t.border, rx: t.radius });
    svg.text(fx + 12, y + 25, control, { size: 14, fill: t.textSub, maxWidth: cw - 36 });
    svg.text(fx + cw - 14, y + 25, '▾', { size: 12, fill: t.muted, anchor: 'end' });
    fx += cw + 12;
  }
  return 40;
}

function drawHero(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { svg, t } = ctx;
  const h = ctx.mobile ? 220 : 240;
  svg.rect(x, y, w, h, { fill: t.wire ? '#f5f5f5' : t.primaryTint, stroke: t.wire ? t.border : undefined, rx: t.radius + 4 });
  const heading = region.items[0] ?? region.label ?? 'Heading';
  const sub = region.items[1] ?? '';
  svg.text(x + 32, y + 64, heading, { size: ctx.mobile ? 24 : 34, weight: 700, heading: true, maxWidth: w - 64 });
  if (sub) svg.text(x + 32, y + 104, sub, { size: 16, fill: t.textSub, maxWidth: w - 64 });
  else svg.bar(x + 32, y + 96, (w - 64) * 0.5);
  let bx = x + 32;
  (region.actions.length > 0 ? region.actions : ['Get started']).forEach((a, i) => {
    bx += svg.button(bx, y + h - 72, a, i === 0 ? 'primary' : 'outline') + 12;
  });
  return h;
}

function drawEmpty(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { t } = ctx;
  return withPanel(ctx, x, y, w, (svg) => {
    const cx = x + w / 2;
    svg.circle(cx, y + 64, 32, t.primaryTint, t.wire ? t.border : undefined);
    svg.text(cx, y + 72, '∅', { size: 22, fill: t.wire ? t.muted : t.primary, anchor: 'middle' });
    svg.text(cx, y + 128, region.label || 'Nothing here yet', { size: 16, weight: 600, anchor: 'middle', maxWidth: w - 48 });
    svg.text(cx, y + 152, region.items[0] ?? 'Items you add will appear here.', {
      size: 14,
      fill: t.textSub,
      anchor: 'middle',
      maxWidth: w - 48,
    });
    const action = region.actions[0];
    if (action) {
      const bw = textWidth(action, 14, 600) + 32;
      svg.button(cx - Math.max(80, bw) / 2, y + 172, action);
      return 240;
    }
    return 184;
  });
}

function drawActions(ctx: Ctx, actions: string[], x: number, y: number, w: number): number {
  const { svg, t } = ctx;
  const list = actions.length > 0 ? actions : ['Continue'];
  if (ctx.mobile) {
    list.forEach((a, i) => fullWidthButton(svg, t, x, y + i * 48, w, a, i === 0));
    return list.length * 48 - 8;
  }
  let bx = x;
  list.forEach((a, i) => {
    bx += svg.button(bx, y, a, i === 0 ? 'primary' : 'outline') + 12;
  });
  return 40;
}

function drawSteps(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { svg, t } = ctx;
  const steps = (region.items.length > 0 ? region.items : ['Step 1', 'Step 2', 'Step 3']).slice(0, 6);
  const slot = w / steps.length;
  steps.forEach((step, i) => {
    const cx = x + slot * i + slot / 2;
    if (i > 0) svg.line(x + slot * (i - 1) + slot / 2 + 18, y + 18, cx - 18, y + 18, i === 1 ? t.primary : t.border, 2);
    const done = i === 0;
    svg.circle(cx, y + 18, 16, done ? t.primary : t.surface, done ? undefined : t.border);
    svg.text(cx, y + 23, String(i + 1), { size: 13, weight: 700, fill: done ? t.onPrimary : t.textSub, anchor: 'middle' });
    if (!ctx.mobile || steps.length <= 4) {
      svg.text(cx, y + 56, step, { size: 12, weight: done ? 600 : 400, fill: done ? t.text : t.textSub, anchor: 'middle', maxWidth: slot - 8 });
    }
  });
  return 68;
}

function drawMedia(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  return withPanel(ctx, x, y, w, (svg) => {
    const cy = panelStart({ ...ctx, svg }, x, y, w, region.label);
    const h = ctx.mobile ? 200 : 260;
    svg.imagePlaceholder(x + PANEL_PAD, cy, w - PANEL_PAD * 2, h);
    return cy + h + PANEL_PAD - y;
  });
}

function drawText(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { t } = ctx;
  return withPanel(ctx, x, y, w, (svg) => {
    let cy = panelStart({ ...ctx, svg }, x, y, w, region.label);
    const lines = region.items.length > 0 ? region.items : [''];
    for (const line of lines.slice(0, 6)) {
      if (t.wire || !line) svg.bar(x + PANEL_PAD, cy + 2, (w - PANEL_PAD * 2) * (0.6 + seeded(ctx.seed + line, cy) * 0.35));
      else svg.text(x + PANEL_PAD, cy + 12, line, { size: 14, fill: t.textSub, maxWidth: w - PANEL_PAD * 2 });
      cy += 24;
    }
    return cy + PANEL_PAD - 8 - y;
  });
}

// ── Screen chrome ──────────────────────────────────────────────────────────────

const DESKTOP_W = 1440;
const MOBILE_W = 390;
const STRIP_H = 36;
const SIDEBAR_W = 240;

function activeNav(screen: DesignScreen): string | undefined {
  const hay = `${screen.name} ${screen.module}`.toLowerCase();
  return (
    screen.navItems.find((n) => hay.includes(n.toLowerCase())) ??
    screen.navItems.find((n) => n.toLowerCase().includes(screen.module.toLowerCase()))
  );
}

function variantLabel(variant: RenderVariant): string {
  return variant === 'wireframe' ? 'Lo-fi wireframe · 1440px' : variant === 'desktop' ? 'Hi-fi · Desktop 1440px' : 'Hi-fi · Mobile 390px';
}

function drawStrip(svg: Svg, width: number, screen: DesignScreen, model: DesignModel, variant: RenderVariant) {
  svg.rect(0, 0, width, STRIP_H, { fill: '#0f172a' });
  const size = width < 600 ? 11 : 13;
  const right = width < 600 ? model.packageId : `${variantLabel(variant)} · ${model.packageId}`;
  svg.text(12, 23, `${screen.id} · ${screen.name} · ${screen.route}`, {
    size,
    weight: 600,
    fill: '#ffffff',
    maxWidth: width - textWidth(right, size) - 40,
  });
  svg.text(width - 12, 23, right, { size, fill: '#94a3b8', anchor: 'end' });
}

function drawLogo(svg: Svg, t: Theme, x: number, y: number, projectName: string, maxWidth: number): number {
  svg.rect(x, y, 32, 32, { fill: t.wire ? '#d9d9d9' : t.primary, rx: t.radius });
  if (!t.wire) svg.text(x + 16, y + 22, (projectName.trim()[0] ?? 'A').toUpperCase(), { size: 16, weight: 700, fill: t.onPrimary, anchor: 'middle' });
  svg.text(x + 44, y + 22, projectName, { size: 16, weight: 700, heading: true, maxWidth });
  return 44 + Math.min(maxWidth, textWidth(projectName, 16, 700));
}

export function renderScreenSvg(
  screen: DesignScreen,
  model: DesignModel,
  variant: RenderVariant
): { svg: string; width: number; height: number } {
  const t = themeFor(variant, model.tokens);
  const svg = new Svg(t);
  const mobile = variant === 'mobile';
  const width = mobile ? MOBILE_W : DESKTOP_W;
  const ctx: Ctx = { svg, t, mobile, seed: screen.id };
  const project = model.projectName || 'Application';

  // Centred shells (login, reset password…) have no application chrome.
  if (screen.shell === 'centered') {
    const cardW = mobile ? width - 32 : 440;
    const cardX = (width - cardW) / 2;
    const top = STRIP_H + (mobile ? 48 : 96);
    const content = new Svg(t);
    const inner: Ctx = { ...ctx, svg: content };
    let cy = top + 32;
    drawLogo(content, t, cardX + 24, cy, project, cardW - 90);
    cy += 60;
    content.text(cardX + 24, cy + 20, screen.name, { size: 22, weight: 700, heading: true, maxWidth: cardW - 48 });
    cy += 32;
    if (screen.purpose) {
      content.text(cardX + 24, cy + 16, screen.purpose, { size: 14, fill: t.textSub, maxWidth: cardW - 48 });
      cy += 28;
    }
    cy += 8;
    for (const region of screen.regions) {
      // Inside the card, regions render flat — no nested panels.
      cy += drawFlatRegion(inner, region, cardX + 24, cy, cardW - 48) + 20;
    }
    const cardH = cy - top + 12;
    svg.rect(cardX, top, cardW, cardH, { fill: t.surface, stroke: t.border, rx: t.radius + 6, shadow: true });
    svg.parts.push(...content.parts);
    const height = top + cardH + 64;
    drawStrip(svg, width, screen, model, variant);
    return { svg: svg.toString(width, height), width, height };
  }

  const headerH = mobile ? 56 : 64;
  const hasSidebar = !mobile && screen.shell === 'sidebar' && screen.navItems.length > 0;
  const hasBottomTabs = mobile && (screen.shell === 'sidebar' || screen.shell === 'bottomtabs') && screen.navItems.length > 0;
  const active = activeNav(screen);

  // Content first — its height decides how tall the sidebar and the canvas are.
  const contentX = hasSidebar ? SIDEBAR_W + 32 : mobile ? 16 : 32;
  const maxContent = hasSidebar ? width - contentX - 32 : Math.min(1200, width - contentX * 2);
  const cx = hasSidebar || mobile ? contentX : (width - maxContent) / 2;
  const cw = maxContent;
  let y = STRIP_H + headerH + (mobile ? 20 : 28);

  // Page heading: breadcrumb, title, purpose, header actions.
  if (!mobile) {
    svg.text(cx, y + 12, ['Home', screen.module, screen.name].filter((v, i, a) => v && a.indexOf(v) === i).join('  ›  '), {
      size: 12,
      fill: t.muted,
      maxWidth: cw * 0.6,
    });
    y += 24;
  }
  svg.text(cx, y + (mobile ? 22 : 28), screen.name, { size: mobile ? 22 : 28, weight: 700, heading: true, maxWidth: mobile ? cw : cw * 0.6 });
  if (!mobile && screen.primaryActions.length > 0) {
    let bx = cx + cw;
    [...screen.primaryActions].reverse().forEach((a, i, arr) => {
      const bw = Math.max(80, textWidth(a, 14, 600) + 32);
      bx -= bw;
      svg.button(bx, y, a, i === arr.length - 1 ? 'primary' : 'outline');
      bx -= 12;
    });
  }
  y += mobile ? 34 : 42;
  if (screen.purpose) {
    svg.text(cx, y + 14, screen.purpose, { size: 14, fill: t.textSub, maxWidth: cw });
    y += 28;
  }
  if (mobile && screen.primaryActions.length > 0) {
    y += 4;
    fullWidthButton(svg, t, cx, y, cw, screen.primaryActions[0], true);
    y += 48;
  }
  y += 12;

  for (const region of screen.regions) {
    y += drawRegion(ctx, region, cx, y, cw) + (mobile ? 16 : 24);
  }
  y += mobile ? 24 : 40;
  const tabsH = hasBottomTabs ? 64 : 0;
  const height = Math.max(y + tabsH, mobile ? 844 : 900);

  // Chrome goes underneath the content: draw it into its own layer and prepend.
  const chrome = new Svg(t);
  chrome.rect(0, STRIP_H, width, headerH, { fill: t.surface });
  chrome.line(0, STRIP_H + headerH, width, STRIP_H + headerH, t.border);
  if (mobile) {
    const showMenu = screen.shell !== 'none' && screen.navItems.length > 0;
    if (showMenu) for (let i = 0; i < 3; i++) chrome.rect(16, STRIP_H + 20 + i * 7, 20, 2.5, { fill: t.text, rx: 1 });
    drawLogo(chrome, t, showMenu ? 48 : 16, STRIP_H + 12, project, width - 150);
    chrome.circle(width - 32, STRIP_H + 28, 16, t.primaryTint, t.wire ? t.border : undefined);
  } else {
    const logoW = drawLogo(chrome, t, 24, STRIP_H + 16, project, 200);
    if (screen.shell !== 'sidebar' && screen.navItems.length > 0) {
      let nx = 24 + logoW + 40;
      for (const item of screen.navItems) {
        const iw = textWidth(item, 14, 500) + 24;
        if (nx + iw > width - 420) break;
        const on = item === active;
        chrome.text(nx + 12, STRIP_H + 38, item, { size: 14, weight: on ? 600 : 500, fill: on ? t.primary : t.textSub });
        if (on) chrome.rect(nx + 8, STRIP_H + headerH - 3, iw - 16, 3, { fill: t.primary, rx: 1.5 });
        nx += iw;
      }
    }
    chrome.input(width - 400, STRIP_H + 12, 260, 'Search…');
    chrome.circle(width - 104, STRIP_H + 32, 16, t.wire ? '#ffffff' : mix(t.muted, '#ffffff', 0.85), t.wire ? t.border : undefined);
    chrome.circle(width - 48, STRIP_H + 32, 18, t.primaryTint, t.wire ? t.border : undefined);
    if (!t.wire) chrome.text(width - 48, STRIP_H + 37, 'SC', { size: 12, weight: 700, fill: t.primary, anchor: 'middle' });
  }

  if (hasSidebar) {
    const top = STRIP_H + headerH;
    chrome.rect(0, top, SIDEBAR_W, height - top, { fill: t.surface });
    chrome.line(SIDEBAR_W, top, SIDEBAR_W, height, t.border);
    screen.navItems.forEach((item, i) => {
      const iy = top + 20 + i * 44;
      const on = item === active;
      if (on) chrome.rect(12, iy, SIDEBAR_W - 24, 38, { fill: t.primaryTint, rx: t.radius });
      chrome.rect(28, iy + 12, 14, 14, { fill: on ? t.primary : t.wire ? '#d9d9d9' : mix(t.muted, '#ffffff', 0.4), rx: 3 });
      chrome.text(52, iy + 24, item, { size: 14, weight: on ? 600 : 500, fill: on ? t.primary : t.textSub, maxWidth: SIDEBAR_W - 76 });
    });
  }

  if (hasBottomTabs) {
    const top = height - tabsH;
    chrome.rect(0, top, width, tabsH, { fill: t.surface });
    chrome.line(0, top, width, top, t.border);
    const tabs = screen.navItems.slice(0, screen.navItems.length > 5 ? 4 : 5);
    if (screen.navItems.length > 5) tabs.push('More');
    const slot = width / tabs.length;
    tabs.forEach((tab, i) => {
      const tx = slot * i + slot / 2;
      const on = tab === active;
      chrome.rect(tx - 9, top + 12, 18, 18, { fill: on ? t.primary : t.wire ? '#d9d9d9' : mix(t.muted, '#ffffff', 0.4), rx: 4 });
      chrome.text(tx, top + 48, tab, { size: 11, weight: on ? 600 : 500, fill: on ? t.primary : t.textSub, anchor: 'middle', maxWidth: slot - 6 });
    });
  }

  svg.parts.unshift(...chrome.parts);
  drawStrip(svg, width, screen, model, variant);
  return { svg: svg.toString(width, height), width, height };
}

/** A region drawn without its surrounding panel — for content already inside a card. */
function drawFlatRegion(ctx: Ctx, region: ScreenRegion, x: number, y: number, w: number): number {
  const { svg, t } = ctx;
  if (region.kind === 'form') {
    const fields = region.items.length > 0 ? region.items : ['Email'];
    let cy = y;
    for (const field of fields) {
      const label = field.replace(/\s*\*\s*$/, '');
      svg.text(x, cy + 14, label, { size: 13, weight: 600, maxWidth: w });
      svg.input(x, cy + 24, w, /password/i.test(label) ? '••••••••' : `Enter ${label.toLowerCase()}`);
      cy += 78;
    }
    (region.actions.length > 0 ? region.actions : ['Continue']).forEach((a, i) => {
      if (i === 0) fullWidthButton(svg, t, x, cy, w, a, true);
      else svg.text(x + w / 2, cy + 25, a, { size: 14, weight: 600, fill: t.primary, anchor: 'middle', maxWidth: w });
      cy += 48;
    });
    return cy - 8 - y;
  }
  if (region.kind === 'actions') return drawActions({ ...ctx, mobile: true }, region.actions.length > 0 ? region.actions : region.items, x, y, w);
  if (region.kind === 'text') {
    let cy = y;
    for (const line of region.items.slice(0, 4)) {
      svg.text(x, cy + 14, line, { size: 14, fill: t.textSub, maxWidth: w });
      cy += 22;
    }
    return cy - y;
  }
  return drawRegion({ ...ctx, mobile: true }, region, x, y, w);
}

// ── Style guide ────────────────────────────────────────────────────────────────

export function renderStyleGuideSvg(model: DesignModel): { svg: string; width: number; height: number } {
  const tokens = model.tokens;
  const t = themeFor('desktop', tokens);
  const svg = new Svg(t);
  const width = DESKTOP_W;
  const x = 64;
  let y = STRIP_H + 56;

  svg.rect(0, 0, width, STRIP_H, { fill: '#0f172a' });
  svg.text(12, 23, `Design System · ${model.designSystem.name}`, { size: 13, weight: 600, fill: '#ffffff', maxWidth: width - 300 });
  svg.text(width - 12, 23, `Style guide · ${model.packageId}`, { size: 13, fill: '#94a3b8', anchor: 'end' });

  svg.text(x, y, `${model.projectName} — Style Guide`, { size: 34, weight: 700, heading: true, maxWidth: width - 128 });
  y += 30;
  svg.text(x, y, `${model.accessibility} · Headings ${tokens.headingFont} · Body ${tokens.bodyFont} · Radius ${tokens.radius}px`, {
    size: 15,
    fill: t.textSub,
    maxWidth: width - 128,
  });
  y += 48;

  const heading = (label: string) => {
    svg.text(x, y, label.toUpperCase(), { size: 13, weight: 700, fill: t.muted });
    y += 20;
  };

  heading('Colour');
  const swatches: [string, string][] = [
    ['Primary', tokens.primary],
    ['Secondary', tokens.secondary],
    ['Accent', tokens.accent],
    ['Success', tokens.success],
    ['Warning', tokens.warning],
    ['Error', tokens.error],
    ['Info', tokens.info],
    ['Page', tokens.pageBg],
    ['Card', tokens.cardBg],
    ['Input', tokens.inputBg],
    ['Border', tokens.border],
    ['Text primary', tokens.textPrimary],
    ['Text secondary', tokens.textSecondary],
    ['Text muted', tokens.textMuted],
    ['Text disabled', tokens.textDisabled],
  ];
  const sw = 150;
  const perRow = 8;
  swatches.forEach(([name, hex], i) => {
    const sx = x + (i % perRow) * (sw + 14);
    const sy = y + Math.floor(i / perRow) * 132;
    svg.rect(sx, sy, sw, 72, { fill: hex, stroke: tokens.border, rx: tokens.radius });
    const ratio = contrastRatio(readableOn(hex), hex).toFixed(1);
    svg.text(sx + 10, sy + 44, `Aa ${ratio}:1`, { size: 13, weight: 600, fill: readableOn(hex) });
    svg.text(sx, sy + 92, name, { size: 13, weight: 600, maxWidth: sw });
    const note = tokens.defaulted.includes(swatchKey(name)) ? ' (default)' : '';
    svg.text(sx, sy + 110, `${hex}${note}`, { size: 12, fill: t.textSub, maxWidth: sw });
  });
  y += Math.ceil(swatches.length / perRow) * 132 + 28;

  heading('Typography');
  const type: [string, number, number][] = [
    ['H1 · 36px / 2.25rem · 700', 36, 700],
    ['H2 · 30px / 1.875rem · 600', 30, 600],
    ['H3 · 24px / 1.5rem · 600', 24, 600],
    ['H4 · 20px / 1.25rem · 600', 20, 600],
    ['Body · 16px / 1rem · 400', 16, 400],
    ['Small · 14px / 0.875rem · 400', 14, 400],
    ['Caption · 12px / 0.75rem · 500', 12, 500],
  ];
  for (const [label, size, weight] of type) {
    y += size + 12;
    svg.text(x, y, 'The quick brown fox jumps over the lazy dog', { size, weight, heading: size >= 20 });
    svg.text(width - 64, y, label, { size: 12, fill: t.muted, anchor: 'end' });
  }
  y += 44;

  heading('Buttons');
  y += 4;
  let bx = x;
  bx += svg.button(bx, y, 'Default') + 16;
  svg.rect(bx, y, 120, 40, { fill: tokens.error, rx: tokens.radius });
  svg.text(bx + 60, y + 25, 'Destructive', { size: 14, weight: 600, fill: readableOn(tokens.error), anchor: 'middle' });
  bx += 136;
  bx += svg.button(bx, y, 'Outline', 'outline') + 16;
  bx += svg.button(bx, y, 'Secondary', 'secondary') + 16;
  svg.text(bx + 16, y + 25, 'Ghost', { size: 14, weight: 600, fill: t.text });
  bx += 88;
  svg.text(bx, y + 25, 'Link', { size: 14, weight: 600, fill: t.primary });
  svg.line(bx, y + 29, bx + 30, y + 29, t.primary);
  bx += 72;
  svg.button(bx, y + 4, 'Small', 'primary', 32);
  svg.rect(bx + 100, y, 40, 40, { fill: t.primary, rx: tokens.radius });
  svg.text(bx + 120, y + 26, '+', { size: 18, weight: 700, fill: t.onPrimary, anchor: 'middle' });
  svg.rect(bx + 160, y, 110, 40, { fill: t.primary, rx: tokens.radius });
  svg.raw(`<rect x="${bx + 160}" y="${y}" width="110" height="40" rx="${tokens.radius}" fill="#ffffff" fill-opacity="0.5"/>`);
  svg.text(bx + 215, y + 25, 'Disabled', { size: 14, weight: 600, fill: t.onPrimary, anchor: 'middle' });
  y += 76;

  heading('Inputs');
  y += 4;
  const iw = 280;
  const states: [string, string, string][] = [
    ['Default', tokens.border, 'Placeholder'],
    ['Focus', tokens.primary, 'Typing…'],
    ['Error', tokens.error, 'invalid@'],
    ['Disabled', tokens.border, 'Disabled'],
  ];
  states.forEach(([label, stroke, value], i) => {
    const ix = x + i * (iw + 24);
    svg.text(ix, y + 12, label, { size: 13, weight: 600 });
    if (label === 'Focus') svg.rect(ix - 3, y + 21, iw + 6, 46, { fill: 'none', stroke: mix(tokens.primary, '#ffffff', 0.6), rx: tokens.radius + 3, sw: 3 });
    svg.rect(ix, y + 24, iw, 40, { fill: label === 'Disabled' ? mix(tokens.inputBg, tokens.border, 0.5) : tokens.inputBg, stroke, rx: tokens.radius, sw: label === 'Default' || label === 'Disabled' ? 1 : 2 });
    svg.text(ix + 12, y + 49, value, { size: 14, fill: label === 'Disabled' ? tokens.textDisabled : label === 'Default' ? tokens.textMuted : tokens.textPrimary });
    if (label === 'Error') svg.text(ix, y + 84, 'Enter a valid email', { size: 12, fill: tokens.error });
  });
  y += 116;

  heading('Badges · Avatars · Radius');
  y += 4;
  let gx = x;
  for (const [label, color] of [
    ['Default', tokens.primary],
    ['Success', tokens.success],
    ['Warning', tokens.warning],
    ['Error', tokens.error],
    ['Info', tokens.info],
  ] as [string, string][]) {
    gx += svg.badge(gx, y + 9, label, color) + 12;
  }
  gx += 24;
  for (const size of [32, 40, 48]) {
    svg.circle(gx + size / 2, y + 20, size / 2, t.primaryTint);
    svg.text(gx + size / 2, y + 20 + size * 0.14, 'SC', { size: size * 0.32, weight: 700, fill: t.primary, anchor: 'middle' });
    gx += size + 16;
  }
  gx += 24;
  for (const [label, radius] of [['sm', 4], ['md', 6], ['lg', 8], ['xl', 12], ['2xl', 16]] as [string, number][]) {
    svg.rect(gx, y, 56, 40, { fill: t.primaryTint, stroke: tokens.primary, rx: radius });
    svg.text(gx + 28, y + 58, `${label} ${radius}px`, { size: 11, fill: t.textSub, anchor: 'middle' });
    gx += 72;
  }
  y += 88;

  heading('Spacing (Tailwind scale)');
  y += 4;
  let px = x;
  for (const [step, value] of [[1, 4], [2, 8], [3, 12], [4, 16], [5, 20], [6, 24], [8, 32], [10, 40], [12, 48], [16, 64]]) {
    svg.rect(px, y + 64 - value, value, value, { fill: mix(tokens.primary, '#ffffff', 0.3), rx: 2 });
    svg.text(px + value / 2, y + 84, `${step}`, { size: 12, weight: 600, anchor: 'middle' });
    svg.text(px + value / 2, y + 100, `${value}px`, { size: 11, fill: t.muted, anchor: 'middle' });
    px += Math.max(value, 36) + 28;
  }
  y += 132;

  if (tokens.defaulted.length > 0) {
    svg.text(x, y, `Default values were used for: ${tokens.defaulted.join(', ')} — the package did not specify them.`, {
      size: 13,
      fill: tokens.warning,
      maxWidth: width - 128,
    });
    y += 28;
  }

  const height = y + 32;
  return { svg: svg.toString(width, height), width, height };
}

function swatchKey(name: string): string {
  const map: Record<string, string> = {
    Page: 'pageBg',
    Card: 'cardBg',
    Input: 'inputBg',
    'Text primary': 'textPrimary',
    'Text secondary': 'textSecondary',
    'Text muted': 'textMuted',
    'Text disabled': 'textDisabled',
  };
  return map[name] ?? name.toLowerCase();
}

// ── Rasterize ──────────────────────────────────────────────────────────────────

async function writeJpg(svg: string, filePath: string, scale: number): Promise<void> {
  ensureDir(path.dirname(filePath));
  await sharp(Buffer.from(svg), { density: 72 * scale, limitInputPixels: false })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(filePath);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'screen';
}

/**
 * Render every screen in all three variants, plus the style guide, into `imagesDir`.
 * The directory's previous renderings are removed first so a screen that left the
 * package does not linger as a stale image.
 */
export async function renderDesignImages(model: DesignModel, imagesDir: string): Promise<RenderedImage[]> {
  for (const sub of ['wireframes', 'hifi']) {
    fs.rmSync(path.join(imagesDir, sub), { recursive: true, force: true });
  }
  ensureDir(imagesDir);

  const rendered: RenderedImage[] = [];

  const guide = renderStyleGuideSvg(model);
  await writeJpg(guide.svg, path.join(imagesDir, 'design-system.jpg'), 1);
  rendered.push({ file: 'design-system.jpg', variant: 'style-guide', width: guide.width, height: guide.height });

  for (const screen of model.screens) {
    const base = `${screen.id}-${slug(screen.name)}`;
    const jobs: [RenderVariant, string, number][] = [
      ['wireframe', `wireframes/${base}.jpg`, 1],
      ['desktop', `hifi/${base}-desktop.jpg`, 1],
      ['mobile', `hifi/${base}-mobile.jpg`, 2],
    ];
    for (const [variant, file, scale] of jobs) {
      const out = renderScreenSvg(screen, model, variant);
      await writeJpg(out.svg, path.join(imagesDir, file), scale);
      rendered.push({
        file,
        screenId: screen.id,
        screenName: screen.name,
        variant,
        width: Math.round(out.width * scale),
        height: Math.round(out.height * scale),
      });
    }
  }

  fs.writeFileSync(path.join(imagesDir, 'index.json'), JSON.stringify(rendered, null, 2), 'utf-8');
  return rendered;
}

export function readRenderedIndex(imagesDir: string): RenderedImage[] {
  const fp = path.join(imagesDir, 'index.json');
  if (!fs.existsSync(fp)) return [];
  try {
    return (JSON.parse(fs.readFileSync(fp, 'utf-8')) as RenderedImage[]).filter((img) =>
      fs.existsSync(path.join(imagesDir, img.file))
    );
  } catch {
    return [];
  }
}
