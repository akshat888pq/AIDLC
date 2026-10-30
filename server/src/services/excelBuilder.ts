import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx-js-style';
import type { Epic, UserStory } from '../types/index.js';
import { ensureDir, reportsDir } from './secondBrain.js';

/**
 * Excel writer for the approved Epic + User Stories backlog.
 *
 * Note on the package: the community build of `xlsx` silently discards cell styles
 * (fills/fonts/borders are a SheetJS Pro feature), which would make the required
 * navy header, banded rows and priority colour coding no-ops. `xlsx-js-style` is the
 * drop-in fork of the same library that writes those styles, so it is used here. The
 * API is identical to `xlsx`.
 */

const NAVY = '1A1A2E';
const WHITE = 'FFFFFF';
const LIGHT_BLUE = 'DCE9F7';
const LIGHT_GRAY = 'F4F5F7';
const BORDER_GRAY = 'D6D9DE';

const PRIORITY_FILL: Record<string, string> = {
  High: 'FBD5D5',
  Medium: 'FDEBC8',
  Low: 'D6F0D8',
};

type Style = Record<string, any>;

const thinBorder = {
  top: { style: 'thin', color: { rgb: BORDER_GRAY } },
  bottom: { style: 'thin', color: { rgb: BORDER_GRAY } },
  left: { style: 'thin', color: { rgb: BORDER_GRAY } },
  right: { style: 'thin', color: { rgb: BORDER_GRAY } },
};

function headerStyle(): Style {
  return {
    font: { bold: true, color: { rgb: WHITE }, sz: 11, name: 'Calibri' },
    fill: { patternType: 'solid', fgColor: { rgb: NAVY } },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
    border: thinBorder,
  };
}

function bodyStyle(fillRgb?: string, opts: { bold?: boolean; center?: boolean } = {}): Style {
  const style: Style = {
    font: { sz: 10, name: 'Calibri', bold: Boolean(opts.bold) },
    alignment: {
      horizontal: opts.center ? 'center' : 'left',
      vertical: 'top',
      wrapText: true,
    },
    border: thinBorder,
  };
  if (fillRgb) style.fill = { patternType: 'solid', fgColor: { rgb: fillRgb } };
  return style;
}

/** Auto-fit column widths from the widest line of content, within sane bounds. */
function autoFitColumns(rows: (string | number)[][], min = 10, max = 60) {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      const text = cell === null || cell === undefined ? '' : String(cell);
      const longestLine = text.split('\n').reduce((a, l) => Math.max(a, l.length), 0);
      widths[i] = Math.max(widths[i] ?? 0, longestLine);
    });
  }
  return widths.map((w) => ({ wch: Math.max(min, Math.min(max, w + 2)) }));
}

function cell(value: string | number, style: Style) {
  return { v: value, t: typeof value === 'number' ? 'n' : 's', s: style };
}

function sheetFromCells(cells: any[][], rows: (string | number)[][], rowHeights?: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet(cells.map((r) => r.map((c) => (c && c.v !== undefined ? c.v : c))));

  // aoa_to_sheet drops the style objects, so re-apply them cell by cell.
  cells.forEach((row, r) => {
    row.forEach((c, col) => {
      if (!c || c.s === undefined) return;
      const ref = XLSX.utils.encode_cell({ r, c: col });
      if (!sheet[ref]) sheet[ref] = { v: c.v, t: c.t };
      sheet[ref].s = c.s;
    });
  });

  sheet['!cols'] = autoFitColumns(rows);
  if (rowHeights) sheet['!rows'] = rowHeights.map((h) => ({ hpt: h }));
  return sheet;
}

function bulletList(items: string[]): string {
  if (!items || items.length === 0) return '—';
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

export interface BuiltExcel {
  filePath: string;
  fileName: string;
  totalStoryPoints: number;
}

export function buildEpicStoriesWorkbook(
  sessionId: string,
  epic: Epic,
  stories: UserStory[]
): BuiltExcel {
  const totalStoryPoints = stories.reduce((sum, s) => sum + s.storyPoints, 0);

  // ── Sheet 1: Epic ──
  const epicHeaders = [
    'Title',
    'Description',
    'Business Value',
    'Acceptance Criteria',
    'Total Stories',
    'Total Story Points',
  ];
  const epicRow: (string | number)[] = [
    epic.title,
    epic.description,
    epic.businessValue,
    bulletList(epic.acceptanceCriteria),
    stories.length,
    totalStoryPoints,
  ];

  const epicCells = [
    epicHeaders.map((h) => cell(h, headerStyle())),
    epicRow.map((v, i) =>
      cell(v, bodyStyle(LIGHT_BLUE, { bold: i === 0, center: i >= 4 }))
    ),
  ];
  const epicSheet = sheetFromCells(epicCells, [epicHeaders, epicRow], [24, 120]);

  // ── Sheet 2: User Stories ──
  const storyHeaders = [
    'Story ID',
    'Epic',
    'Title',
    'User Story',
    'Acceptance Criteria',
    'Story Points',
    'Priority',
    'Component',
    'Labels',
    'Status',
  ];

  const storyRows: (string | number)[][] = stories.map((s) => [
    s.id,
    s.epic,
    s.title,
    s.userStory,
    bulletList(s.acceptanceCriteria),
    s.storyPoints,
    s.priority,
    s.component,
    s.labels.join(', '),
    s.status,
  ]);

  const storyCells: any[][] = [storyHeaders.map((h) => cell(h, headerStyle()))];

  storyRows.forEach((row, index) => {
    // Alternate white / light gray banding for readability.
    const band = index % 2 === 0 ? undefined : LIGHT_GRAY;
    const priority = String(row[6]);
    storyCells.push(
      row.map((value, col) => {
        // Priority column carries its own colour coding regardless of banding.
        if (col === 6) {
          return cell(value, bodyStyle(PRIORITY_FILL[priority] ?? band, { bold: true, center: true }));
        }
        const centered = col === 0 || col === 5 || col === 9;
        return cell(value, bodyStyle(band, { bold: col === 0, center: centered }));
      })
    );
  });

  const storyHeights = [24, ...storyRows.map((row) => {
    const acLines = String(row[4]).split('\n').length;
    return Math.max(44, Math.min(180, acLines * 26));
  })];

  const storySheet = sheetFromCells(storyCells, [storyHeaders, ...storyRows], storyHeights);
  storySheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: storyRows.length, c: storyHeaders.length - 1 },
    }),
  };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, epicSheet, 'Epic');
  XLSX.utils.book_append_sheet(workbook, storySheet, 'User Stories');

  const dir = reportsDir(sessionId);
  ensureDir(dir);
  const fileName = 'epic-stories.xlsx';
  const filePath = path.join(dir, fileName);

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(filePath, buffer);

  return { filePath, fileName, totalStoryPoints };
}

// ── Generic workbook writer (used by the phase engine's Excel deliverables) ──

export interface WorkbookSheet {
  name: string;
  headers: string[];
  rows: (string | number)[][];
  /** Columns rendered centred rather than left-aligned. */
  centerColumns?: number[];
  /** Column whose value drives the priority colour coding, if any. */
  priorityColumn?: number;
}

/**
 * Write any set of tabular sheets with the same house style the backlog workbook
 * uses: navy header row, banded rows, auto-fitted columns, autofilter, wrapped
 * cells sized to their content.
 *
 * A phase declares an Excel deliverable; this turns whatever rows that deliverable
 * produced into the file. Sheet names are truncated to Excel's 31-character limit.
 */
export function buildStyledWorkbook(
  sheets: WorkbookSheet[],
  targetDir: string,
  fileName: string
): { filePath: string; fileName: string } {
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const centered = new Set(sheet.centerColumns ?? []);
    const cells: any[][] = [sheet.headers.map((h) => cell(h, headerStyle()))];

    sheet.rows.forEach((row, index) => {
      const band = index % 2 === 0 ? undefined : LIGHT_GRAY;
      cells.push(
        row.map((value, col) => {
          if (sheet.priorityColumn !== undefined && col === sheet.priorityColumn) {
            const fill = PRIORITY_FILL[String(value)] ?? band;
            return cell(value, bodyStyle(fill, { bold: true, center: true }));
          }
          return cell(value, bodyStyle(band, { bold: col === 0, center: centered.has(col) }));
        })
      );
    });

    // Row height follows the tallest wrapped cell in the row.
    const heights = [
      24,
      ...sheet.rows.map((row) => {
        const lines = row.reduce<number>(
          (max, value) => Math.max(max, String(value ?? '').split('\n').length),
          1
        );
        return Math.max(40, Math.min(200, lines * 24));
      }),
    ];

    const built = sheetFromCells(cells, [sheet.headers, ...sheet.rows], heights);
    if (sheet.rows.length > 0) {
      built['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: sheet.rows.length, c: sheet.headers.length - 1 },
        }),
      };
    }
    XLSX.utils.book_append_sheet(workbook, built, sheet.name.slice(0, 31));
  }

  ensureDir(targetDir);
  const filePath = path.join(targetDir, fileName);
  fs.writeFileSync(filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  return { filePath, fileName };
}

/** Render a list as a numbered block for a wrapped Excel cell. */
export function excelList(items: string[] | undefined): string {
  return bulletList(items ?? []);
}
