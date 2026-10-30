import type { NextFunction, Request, Response } from 'express';

/**
 * Prompt-injection defence for everything a user or a document can put into a
 * prompt: request bodies (answers, feedback, chat, review input) and the text
 * parsed out of uploaded documents.
 *
 * Pattern stripping is one layer, not the defence: the Anthropic adapter also keeps
 * all user-derived text out of Claude's `system` field and fences it in tags the
 * text itself can no longer forge (see promptLayout.ts).
 */

const REPLACEMENT = '[removed: possible prompt injection]';

const INJECTION_PATTERNS: RegExp[] = [
  // "ignore / disregard / forget (all) (the) previous instructions"
  /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|every\s+)?(?:of\s+)?(?:the\s+|your\s+|my\s+|these\s+|those\s+)?(?:previous|prior|above|earlier|preceding|original|initial|system|existing)\s+(?:instructions?|prompts?|rules?|messages?|context|directions?|guidelines?|constraints?)\b/gi,
  // Role reassignment: "you are now DAN", "you are now an unrestricted ..."
  /\byou\s+are\s+now\s+(?:a|an|the|my|in|acting|playing|dan|no\s+longer|free|unrestricted|jailbroken|developer\s+mode)\b[^.\n]*/gi,
  /\b(?:act|behave|respond)\s+as\s+(?:if\s+you\s+(?:are|were)\s+)?(?:an?\s+)?(?:unrestricted|unfiltered|jailbroken|dan)\b[^.\n]*/gi,
  /\b(?:enter|enable|activate)\s+(?:developer|god|jailbreak|dan)\s+mode\b/gi,
  // System prompt override / exfiltration
  /\b(?:new|updated|real|actual|override|replacement)\s+(?:system\s+)?(?:prompt|instructions)\s*:/gi,
  /\b(?:reveal|print|show|repeat|output|display|leak|dump)\s+(?:me\s+)?(?:your|the)\s+(?:entire\s+|full\s+|hidden\s+)?(?:system\s+prompt|initial\s+prompt|instructions|system\s+message)\b/gi,
  // Chat-template control tokens from various model families
  /<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>/gi,
  /\[\/?INST\]|<<\/?SYS>>/g,
  /(?:^|\n)\s*(?:Human|Assistant)\s*:\s*(?=\S)/g,
];

/**
 * Tags our prompt structure relies on. Anything resembling them in user text is
 * defanged (angle brackets swapped for square ones) so it cannot close or open a
 * block. Ordinary HTML/XML in documents is left alone.
 */
const STRUCTURAL_TAG = /<\s*(\/?)\s*(system|instructions?|user_content|untrusted_input|second_brain|documents?|assistant|human|tool_result|function_calls?|antml:[a-z_]+)\b([^>]*)>/gi;

export interface SanitizeResult {
  text: string;
  findings: number;
}

export function sanitizeText(input: string): SanitizeResult {
  let findings = 0;
  let text = input;
  for (const pattern of INJECTION_PATTERNS) {
    text = text.replace(pattern, (match) => {
      findings++;
      // Keep a leading newline a pattern consumed so document layout survives.
      return (match.startsWith('\n') ? '\n' : '') + REPLACEMENT;
    });
  }
  text = text.replace(STRUCTURAL_TAG, (_m, slash, name, rest) => {
    findings++;
    return `[${slash}${name}${rest}]`;
  });
  return { text, findings };
}

/** For text parsed from an uploaded document, before it is stored or prompted. */
export function sanitizeDocument(text: string, label: string): string {
  const { text: clean, findings } = sanitizeText(text);
  if (findings > 0) console.warn(`[sanitize] ${label}: neutralised ${findings} injection pattern(s)`);
  return clean;
}

function sanitizeValue(value: unknown, counter: { n: number }, depth = 0): unknown {
  if (depth > 20) return value;
  if (typeof value === 'string') {
    const { text, findings } = sanitizeText(value);
    counter.n += findings;
    return text;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, counter, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeValue(v, counter, depth + 1);
    return out;
  }
  return value;
}

/**
 * Bodies that are code, markup or diagrams written straight to disk or Git and not
 * user prose headed for a prompt. Rewriting them would corrupt the artifact.
 */
const EXEMPT: RegExp[] = [
  /^\/api\/dev\/[^/]+\/(?:files|terminal|processes)/,
  /^\/api\/git\//,
  /^\/api\/phase\/[^/]+\/[^/]+\/(?:git\/commit|mockups\/[^/]+$|diagram$|diagrams\/[^/]+(?:\/image)?$)/,
  /^\/api\/(?:architecture|design|tests|release)\/[^/]+\/[^/]+\/diagram$/,
];

/** Express middleware: sanitise every string in a JSON body. */
export function sanitizeBodyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.body || typeof req.body !== 'object' || EXEMPT.some((r) => r.test(req.path))) return next();
  const counter = { n: 0 };
  req.body = sanitizeValue(req.body, counter);
  if (counter.n > 0) {
    res.locals.injectionFindings = counter.n;
    console.warn(`[sanitize] ${req.method} ${req.path}: neutralised ${counter.n} injection pattern(s)`);
  }
  next();
}
