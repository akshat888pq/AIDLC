/**
 * The contract every phase agent is described by.
 *
 * A phase is one agent in the delivery lifecycle. The phase engine (routes +
 * services under src/phases/engine) contains all the *behaviour* — Q&A with the
 * Second Brain, the two-cycle question budget, the human approval gate,
 * section-by-section generation, deliverables. A PhaseConfig contains everything
 * that differs between phases: its prompts, its sections, its deliverables.
 *
 * Adding a phase is therefore: write a config, register it, done.
 */

export interface PhaseConfig {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  /** Tailwind colour family used for the agent card and progress bar, e.g. 'indigo'. */
  color: string;
  roleOwner: string;

  /** What this phase needs from previous phases. */
  requiresPhase?: string;

  // ── Questions ──
  questionSystemPrompt: string;
  maxQuestionsRound1: number;
  maxQuestionsRound2: number;

  // ── Sections ──
  sections: PhaseSection[];
  sectionSystemPrompt: string;

  // ── Approval ──
  approvalSystemPrompt: string;

  // ── Deliverables ──
  deliverables: PhaseDeliverable[];

  /** Output document name, e.g. 'requirement.md' | 'architecture.md'. */
  outputFileName: string;

  /**
   * Prefix for the documents this phase mints: REQ-001, ARCH-001, DES-001…
   * Needed so every phase can label its output the way the requirement phase does.
   */
  docIdPrefix: string;

  /**
   * A registered-but-not-yet-buildable phase. The Agent Hub shows it as
   * "Coming Soon" and the engine refuses to start it.
   */
  comingSoon?: boolean;

  /**
   * Phases whose intake is a document upload rather than a hand-off from the
   * previous phase. Only the requirement phase does this today.
   */
  intake?: 'upload' | 'import';

  /**
   * How the phase draws its diagrams. 'single' (the default) is one system diagram
   * embedded as the section after the last one — the architecture phase. 'set' is a
   * named collection (navigation map, one diagram per user flow, component
   * hierarchy) built by a builder registered in phases/diagramSets.ts.
   */
  diagramMode?: 'single' | 'set';

  /**
   * Generate a live, interactive HTML mockup for every screen in the package's
   * screen definitions (services/mockupGenerator.ts). Design phase only today.
   */
  mockups?: boolean;

  /**
   * 'ide' phases run in the development workspace (editor, terminal, coding agent)
   * instead of the Q&A/sections engine. They are never locked behind the previous phase.
   */
  workspace?: 'ide';
}

export interface PhaseSection {
  number: number;
  key: string;
  title: string;
  description: string;
  /** Expected markdown format for this section. */
  format: string;
  /**
   * When set, finalizing the phase also writes this section on its own to
   * phases/<phaseId>/<fileName>, alongside the assembled document.
   */
  fileName?: string;
}

export interface PhaseDeliverable {
  id: string;
  name: string;
  type: 'excel' | 'tickets' | 'document' | 'images';
  description: string;
}

/** The subset of a config the browser needs; prompts never leave the server. */
export function toDescriptor(config: PhaseConfig) {
  return {
    id: config.id,
    name: config.name,
    shortName: config.shortName,
    icon: config.icon,
    color: config.color,
    roleOwner: config.roleOwner,
    requiresPhase: config.requiresPhase,
    outputFileName: config.outputFileName,
    docIdPrefix: config.docIdPrefix,
    maxQuestionsRound1: config.maxQuestionsRound1,
    maxQuestionsRound2: config.maxQuestionsRound2,
    comingSoon: Boolean(config.comingSoon),
    diagramMode: config.diagramMode ?? 'single',
    mockups: Boolean(config.mockups),
    workspace: config.workspace,
    sections: config.sections.map((s) => ({
      number: s.number,
      key: s.key,
      title: s.title,
      description: s.description,
      fileName: s.fileName,
    })),
    deliverables: config.deliverables.map((d) => ({ ...d })),
  };
}
