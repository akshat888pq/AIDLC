import fs from 'fs/promises';
import path from 'path';
import type { Session } from '../types/index.js';

/** Concatenated text of every successfully parsed file in a session. */
export async function readParsedDocuments(session: Session, maxCharsPerFile?: number): Promise<string> {
  const parsedDir = path.resolve('parsed');
  const parts: string[] = [];

  for (const file of session.files.filter((f) => f.status === 'ready')) {
    try {
      const text = await fs.readFile(path.join(parsedDir, `${file.id}.txt`), 'utf-8');
      const body = maxCharsPerFile ? text.slice(0, maxCharsPerFile) : text;
      parts.push(`=== FILE: ${file.originalName} ===\n${body}`);
    } catch {
      // Virtual/ticket files may not have parsed text on disk — skip silently.
    }
  }

  return parts.join('\n\n');
}

/**
 * Pull a JSON object out of an LLM response, tolerating markdown fences and
 * surrounding prose.
 */
export function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }
  return raw;
}

/**
 * Close off a JSON object the model stopped emitting mid-way — the usual shape of a
 * response that hit the output token ceiling. Walks the text to find the bracket and
 * string state, then backtracks to the last structurally safe boundary and seals it,
 * so a long answer yields a short-but-valid object instead of an outright failure.
 */
export function repairTruncatedJson(text: string): string | null {
  let inString = false;
  let escaped = false;
  const closers: string[] = [];

  for (const ch of text) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { if (inString) escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if (ch === '}' || ch === ']') closers.pop();
  }

  if (!inString && closers.length === 0) return null; // Not truncated — a real syntax error.

  // Cut back to the last completed value, then seal every still-open container.
  let body = inString ? text.slice(0, text.lastIndexOf('"')) : text;
  for (let attempt = 0; attempt < 200 && body.length > 0; attempt++) {
    const trimmed = body.replace(/[\s,]*$/, '');
    const candidate = trimmed + closers.slice().reverse().join('');
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Drop the trailing partial element and try the next boundary back.
      const cut = Math.max(
        trimmed.lastIndexOf(','),
        trimmed.lastIndexOf('}'),
        trimmed.lastIndexOf(']')
      );
      if (cut <= 0) break;
      body = trimmed.slice(0, cut);
      // A closed container we just stepped past no longer needs a closer.
      const stepped = trimmed[cut];
      if (stepped === '}' || stepped === ']') body = trimmed.slice(0, cut + 1);
    }
  }
  return null;
}

export function parseLlmJson<T>(raw: string, label: string): T {
  const candidate = extractJson(raw);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const repaired = repairTruncatedJson(candidate);
    if (repaired) {
      console.warn(`[llm] ${label} response was truncated — recovered by sealing the JSON`);
      return JSON.parse(repaired) as T;
    }
    throw new Error(
      `Failed to parse ${label} as JSON. Raw response starts with: ${raw.slice(0, 200)}`
    );
  }
}
