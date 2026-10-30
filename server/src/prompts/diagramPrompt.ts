/**
 * The prompt that turns an approved phase document into a Mermaid diagram.
 *
 * It is deliberately phase-agnostic: the architecture phase is the first caller,
 * but design and testing want the same thing later, so the only phase-specific
 * input is the label and the document itself.
 */

export interface DiagramPromptContext {
  /** The full assembled document the diagram must visualize. */
  documentMarkdown: string;
  /** Second Brain context block for this phase and every phase before it. */
  contextBlock?: string;
  projectName: string;
  documentId: string;
  phaseName: string;
  /** What the reviewer asked to be changed, when regenerating. */
  feedback?: string;
  /** The Mermaid the reviewer is asking to be changed, when regenerating. */
  previousDiagram?: string;
}

export const DIAGRAM_SYSTEM_PROMPT = `You are a Solution Architect. Based on the approved
architecture document below, generate a Mermaid diagram
that visualizes the complete system architecture.

The diagram should show:

All major system components and their relationships
External systems and integrations
Data flow direction (arrows)
User/actor entry points
Database and storage components
Infrastructure boundaries (cloud, on-prem, etc.)

Use Mermaid flowchart syntax (graph TD or graph LR).
Group related components using subgraph blocks.
Label all connections with the protocol or data type
(e.g., "REST API", "gRPC", "Event Bus", "SQL").

Output ONLY the Mermaid code block — no explanation,
no markdown fences around it, just the raw Mermaid syntax
starting with "graph" or "flowchart".`;

/**
 * Syntax rules appended to the prompt. Mermaid fails hard on a handful of
 * characters inside node labels, and an invalid diagram is worthless to the user,
 * so the model is told the constraints rather than left to rediscover them.
 */
export const MERMAID_SYNTAX_RULES = `MERMAID SYNTAX RULES (a diagram that does not parse is useless):
- Start with "graph TD" or "graph LR" on the first line. Nothing before it.
- Give every node a short alphanumeric id (no spaces, no dots, no hyphens): apiGw, orderSvc, postgresDb.
- Put the display text in brackets and ALWAYS quote it: apiGw["API Gateway"].
- Use ("...") for external systems/actors, [("...")] for databases, {"..."} for decisions.
- Never put unquoted parentheses, braces, commas, colons or angle brackets inside a label.
- Label edges as: a -->|"REST API"| b — the pipe text must be quoted too.
- Every subgraph needs an id and a quoted title, and its own "end": subgraph aws["AWS Cloud"] ... end
- Do not use "end" as a node id. Do not use click, style URLs, or HTML tags.
- Keep it to roughly 30 nodes — readable beats exhaustive.`;

export function buildDiagramPrompt(ctx: DiagramPromptContext): string {
  const parts: string[] = [DIAGRAM_SYSTEM_PROMPT, '', MERMAID_SYNTAX_RULES];

  if (ctx.contextBlock) {
    parts.push('', ctx.contextBlock);
  }

  parts.push(
    '',
    `PROJECT: ${ctx.projectName}`,
    `DOCUMENT: ${ctx.documentId} (${ctx.phaseName})`,
    '',
    `--- APPROVED ${ctx.phaseName.toUpperCase()} DOCUMENT (source of truth for the diagram) ---`,
    ctx.documentMarkdown,
    `--- END DOCUMENT ---`
  );

  if (ctx.previousDiagram) {
    parts.push(
      '',
      '--- THE DIAGRAM YOU PRODUCED LAST TIME ---',
      ctx.previousDiagram,
      '--- END PREVIOUS DIAGRAM ---'
    );
  }

  if (ctx.feedback) {
    parts.push(
      '',
      '--- REVIEWER FEEDBACK ---',
      `The reviewer has asked for the following changes: "${ctx.feedback}"`,
      'Produce a new diagram that addresses every point, keeping everything else the reviewer did not object to.'
    );
  }

  parts.push(
    '',
    'Output ONLY the raw Mermaid syntax. No prose before it, no prose after it, no ``` fences.'
  );

  return parts.join('\n');
}

/**
 * Pull the Mermaid source out of whatever the model returned.
 *
 * Models fence the block, prefix it with "Here is the diagram:", or both, however
 * firmly the prompt says not to. Rather than fail the request, take the first
 * thing that looks like a diagram.
 */
export function extractMermaid(raw: string): string {
  let text = (raw ?? '').trim();

  const fenced = text.match(/```(?:mermaid)?\s*\n([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  else text = text.replace(/^```(?:mermaid)?\s*/i, '').replace(/```\s*$/, '').trim();

  // Drop any preamble before the first diagram declaration.
  const start = text.search(
    /^(graph|flowchart|C4Context|C4Container|C4Component|sequenceDiagram|erDiagram)\b/im
  );
  if (start > 0) text = text.slice(start).trim();

  return text;
}

/**
 * A cheap structural check — enough to catch "the model returned an apology"
 * without shipping a Mermaid parser to the server. Real validation happens in the
 * browser, where mermaid.parse() actually runs.
 */
export function looksLikeMermaid(code: string): boolean {
  return /^(graph|flowchart|C4Context|C4Container|C4Component|sequenceDiagram|erDiagram)\b/im.test(
    code.trim()
  );
}
