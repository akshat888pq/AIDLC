export interface UploadedFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: 'uploading' | 'parsing' | 'ready' | 'error';
  error?: string;
  parsedTextPreview?: string;
}

export interface ProjectUnderstanding {
  projectOverview: string;
  businessObjective: string;
  scope: {
    inScope: string[];
    outOfScope: string[];
    unclear: string[];
  };
  stakeholders: string[];
  timeline: string;
  techStack: string;
  deliverables: string[];
  constraints: string[];
  assumptions: string[];
  risks: string[];
  dependencies: string[];
}

export interface ClarifyingQuestion {
  id: string;
  category: 'scope' | 'timeline' | 'technical' | 'stakeholder' | 'budget' | 'risk' | 'requirement' | 'other';
  question: string;
  context: string;
  priority: 'critical' | 'important' | 'nice-to-have';
  answerType: 'text' | 'single-select' | 'multi-select';
  options?: string[];
  answer?: string | string[];
  status: 'pending' | 'answered' | 'skipped';
}

export interface AnalysisResult {
  understanding: ProjectUnderstanding;
  confidenceScore: number;
  questions: ClarifyingQuestion[];
}

export interface Session {
  id: string;
  createdAt: string;
  files: UploadedFile[];
  analyses: AnalysisResult[];
  currentStep: 'upload' | 'analyzing' | 'understanding' | 'questions' | 'approval' | 'approved' | 'refined';
  /** Number of question cycles already issued to the user. Hard capped at MAX_QUESTION_CYCLES. */
  cycleCount: number;
  /** Human-in-the-loop gate. Requirements/Excel generation is blocked until 'approved'. */
  approvalStatus: 'pending' | 'approved';
  approvedAt?: string;
}

// ── Second Brain / Human Approval Types ──

export interface QnaRecord {
  cycle: number;
  questionId: string;
  question: string;
  category: string;
  priority: string;
  answer: string;
  answeredAt: string;
}

export interface HumanInput {
  text: string;
  at: string;
}

export interface UnderstandingSummary {
  projectOverview: string;
  confirmedFacts: string[];
  assumptions: string[];
  openItems: string[];
  readyToGenerate: boolean;
  confidenceScore: number;
  generatedAt?: string;
}

/** What a phase inherited from the phase that ran before it. */
export interface PhaseInputFromPreviousPhase {
  fromPhaseId: string | null;
  fromPhaseName: string | null;
  /** Output documents of the previous phase, by name. */
  documents: string[];
  /** The previous phase's document id, e.g. REQ-001. */
  documentId?: string;
  /** Full markdown of the previous phase's output document. */
  previousPhaseDocument?: string;
  /** The previous phase's second-brain.md, verbatim. */
  secondBrainMd?: string;
  confirmedFacts: string[];
  assumptions: string[];
  openItems: string[];
  /** Epic + user stories as JSON, when any upstream phase produced a backlog. */
  storiesJson?: string;
  /**
   * Output documents of the phases BEFORE the previous one, oldest first — e.g. the
   * design phase receives requirement.md here and architecture.md above. Without
   * them a later phase would only ever see its immediate predecessor's summary of
   * the requirement, never the FR ids themselves.
   */
  earlierPhaseDocuments?: EarlierPhaseDocument[];
  importedAt?: string;
}

export interface EarlierPhaseDocument {
  phaseId: string;
  phaseName: string;
  documentId?: string;
  markdown: string;
}

/** One reviewer action on a section, kept in the brain so later prompts see it. */
export interface SectionLogEntry {
  sectionNumber: number;
  title: string;
  action: 'approved' | 'regenerated' | 'skipped' | 'edited';
  version?: number;
  /** The reviewer's own words, when they asked for a change. */
  feedback?: string;
  at: string;
}

/** A block of structured knowledge a phase distilled from its approved output. */
export interface PhaseKnowledgeBlock {
  heading: string;
  lines: string[];
  updatedAt: string;
}

export interface SecondBrainData {
  sessionId: string;
  /** Which phase owns this brain. Absent on brains written before phases existed. */
  phaseId?: string;
  /** Set on every phase after the first. */
  inputFromPreviousPhase?: PhaseInputFromPreviousPhase;
  projectName: string;
  createdAt: string;
  lastUpdated: string;
  sourceDocuments: string[];
  documentUnderstanding: string;
  confidenceScore: number;
  cycleCount: number;
  qna: QnaRecord[];
  confirmedFacts: string[];
  assumptions: string[];
  openItems: string[];
  humanInputs: HumanInput[];
  approval: {
    status: 'pending' | 'approved';
    approvedAt?: string;
  };
  understandingSummary?: UnderstandingSummary;
  generatedStories?: EpicStoriesResult;
  /** The system diagram generated for this phase, once the AI has produced one. */
  diagram?: PhaseDiagram;
  /** Every approval, regeneration request and skip, in order — the reviewer's trail. */
  sectionLog?: SectionLogEntry[];
  /** Structured decisions the phase distilled from its approved document. */
  knowledge?: PhaseKnowledgeBlock[];
}

/**
 * A Mermaid diagram belonging to one phase.
 *
 * `none` means nothing has been generated. `skipped` means the human chose to
 * finalize without one — a deliberate decision, kept so the UI does not keep
 * nagging, and distinct from "not attempted yet".
 */
export type DiagramStatus = 'none' | 'draft' | 'approved' | 'skipped';

export interface PhaseDiagram {
  sessionId: string;
  phaseId: string;
  status: DiagramStatus;
  /** Raw Mermaid source — no code fences. */
  mermaid: string;
  /** How many times the AI has produced a version of this diagram. */
  revision: number;
  generatedAt?: string;
  updatedAt?: string;
  approvedAt?: string;
  /** Set when the human edited the generated code by hand. */
  editedByHuman?: boolean;
  /** Set for diagrams that belong to a phase's diagram set, e.g. 'navigation-map'. */
  key?: string;
  title?: string;
  /** What the diagram depicts, e.g. 'navigation' | 'user-flow' | 'component-hierarchy'. */
  kind?: string;
  /** How it was produced: pulled from an approved section, or drawn by the model. */
  origin?: 'extracted' | 'generated' | 'manual';
  /** True once a JPG rendering of it has been saved to the package. */
  hasImage?: boolean;
}

export interface SecondBrainStatus {
  exists: boolean;
  cycleCount: number;
  maxCycles: number;
  questionsExhausted: boolean;
  approvalStatus: 'pending' | 'approved';
  approvedAt?: string;
  hasSummary: boolean;
  hasStories: boolean;
  confidenceScore: number;
}

// ── Epic & User Stories (Excel Report) ──

export interface Epic {
  title: string;
  description: string;
  businessValue: string;
  acceptanceCriteria: string[];
}

export interface UserStory {
  id: string;
  title: string;
  userStory: string;
  acceptanceCriteria: string[];
  storyPoints: number;
  priority: 'High' | 'Medium' | 'Low';
  epic: string;
  labels: string[];
  component: string;
  status: string;
}

export interface EpicStoriesResult {
  epic: Epic;
  stories: UserStory[];
  generatedAt: string;
  totalStoryPoints: number;
  downloadUrl?: string;
  filePath?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ── Ticket Integration Types ──

export interface TicketProviderConnection {
  provider: 'azure-devops' | 'jira';
  connected: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  organizationUrl?: string;
  cloudId?: string;
  userName?: string;
  orgName?: string;
}

export interface TicketProject {
  id: string;
  name: string;
  key?: string;
  url?: string;
}

export interface Ticket {
  id: string;
  key: string;
  title: string;
  description: string;
  type: 'epic' | 'feature' | 'story' | 'task' | 'subtask' | 'bug';
  status: string;
  priority: string;
  assignee?: string;
  sprint?: string;
  storyPoints?: number;
  acceptanceCriteria?: string;
  labels: string[];
  parentId?: string;
  url: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTicketInput {
  title: string;
  description: string;
  type: 'epic' | 'feature' | 'story' | 'task' | 'subtask';
  priority: string;
  labels?: string[];
  storyPoints?: number;
  acceptanceCriteria?: string;
  parentId?: string;
  projectId: string;
}

export interface CreatedTicket {
  id: string;
  key: string;
  title: string;
  type: string;
  url: string;
}

export interface TicketFilter {
  type?: string;
  status?: string;
  sprint?: string;
  assignee?: string;
}

export interface TicketHierarchyNode {
  tempId: string;
  ticket: CreateTicketInput;
  children: TicketHierarchyNode[];
  createdTicket?: CreatedTicket;
  status: 'pending' | 'creating' | 'created' | 'failed';
  error?: string;
}

export interface DuplicateCandidate {
  ticket: Ticket;
  similarity: number;
  reason: string;
}

export interface TicketCreationSummary {
  epics: number;
  features: number;
  stories: number;
  tasks: number;
  total: number;
  created: CreatedTicket[];
  failed: { title: string; error: string }[];
}

// ── Requirements Generator Types ──

export type SectionStatus = 'pending' | 'generating' | 'draft' | 'approved' | 'skipped';

export interface SectionVersion {
  version: number;
  content: string;
  generatedAt: string;
  feedback?: string;
  status: 'superseded' | 'current' | 'approved';
  approvedAt?: string;
}

export interface RequirementSection {
  number: number;
  title: string;
  key: string;
  status: SectionStatus;
  content: string;
  versions: SectionVersion[];
}

export interface RequirementDoc {
  id: string;
  sessionId: string;
  projectName: string;
  generatedDate: string;
  status: 'in-progress' | 'approved' | 'finalized';
  sourceDocuments: string[];
  linkedTickets: string[];
  confidenceScore: number;
  sections: RequirementSection[];
}

export interface GenerateSectionRequest {
  sectionNumber: number;
  feedback?: string;
}

export interface GenerateSectionResponse {
  sectionNumber: number;
  content: string;
  version: number;
}

// ── Git Integration Types (Phase 4) ──

export type GitProvider = 'github' | 'gitlab' | 'azure-repos';

export interface GitProviderConnection {
  provider: GitProvider;
  connected: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  userName?: string;
  orgName?: string;
  avatarUrl?: string;
}

export interface Repo {
  id: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  url: string;
  private: boolean;
}

export interface Branch {
  name: string;
  sha: string;
  isDefault: boolean;
}

export interface FileCommit {
  path: string;
  content: string;
  /** 'base64' for binary files (images); text files omit it. */
  encoding?: 'utf-8' | 'base64';
}

export interface CommitResult {
  sha: string;
  url: string;
  message: string;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  status: 'open' | 'merged' | 'closed';
}

export interface GitRepoConfig {
  provider: GitProvider;
  repoId: string;
  repoName: string;
  branch: string;
  createAidlcBranch: boolean;
  autoCreatePR: boolean;
  basePath: string;
}

export interface GitCommitHistoryEntry {
  version: string;
  sha: string;
  date: string;
  message: string;
}

// ── Project Dashboard Types (Phase 5) ──

export type ProjectStatus = 'active' | 'completed' | 'on-hold' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string;
  client?: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;

  sessionId?: string;

  ticketProvider?: 'azure-devops' | 'jira';
  ticketProjectId?: string;
  gitProvider?: GitProvider;
  gitRepoId?: string;
  gitBranch?: string;
  gitConfig?: GitRepoConfig;

  requirementCount: number;
  approvedCount: number;
  ticketCount: number;
  lastActivity: string;
}

export interface ProjectStats {
  totalProjects: number;
  activeRequirements: number;
  connectedTickets: number;
  pendingApprovals: number;
}

// ── Architecture Types ──

export type ArchSectionStatus = 'pending' | 'generating' | 'draft' | 'approved' | 'skipped';

export interface ArchSectionVersion {
  version: number;
  content: string;
  generatedAt: string;
  feedback?: string;
  status: 'superseded' | 'current' | 'approved';
  approvedAt?: string;
}

export interface ArchitectureSection {
  number: number;
  title: string;
  key: string;
  status: ArchSectionStatus;
  content: string;
  versions: ArchSectionVersion[];
}

export interface ArchitectureDoc {
  id: string;
  projectId: string;
  requirementId: string;
  projectName: string;
  generatedDate: string;
  status: 'draft' | 'in-progress' | 'finalized';
  sections: ArchitectureSection[];
  createdAt: string;
  updatedAt: string;
}

export interface ArchitectureSummary {
  id: string;
  requirementId: string;
  title: string;
  status: string;
  sectionProgress: string;
  createdAt: string;
}

// ── Design Types ──

export type DesignSectionStatus = 'pending' | 'generating' | 'draft' | 'approved' | 'skipped';

export interface DesignSectionVersion {
  version: number;
  content: string;
  generatedAt: string;
  feedback?: string;
  status: 'superseded' | 'current' | 'approved';
  approvedAt?: string;
}

export interface DesignSection {
  number: number;
  title: string;
  key: string;
  status: DesignSectionStatus;
  content: string;
  versions: DesignSectionVersion[];
}

export interface DesignDoc {
  id: string;
  projectId: string;
  requirementId: string;
  architectureId: string;
  projectName: string;
  generatedDate: string;
  status: 'draft' | 'in-progress' | 'finalized';
  sections: DesignSection[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignSummary {
  id: string;
  requirementId: string;
  architectureId: string;
  title: string;
  status: string;
  sectionProgress: string;
  createdAt: string;
}

// ── Test Types ──

export type TestSectionStatus = 'pending' | 'generating' | 'draft' | 'approved' | 'skipped';

export interface TestSectionVersion {
  version: number;
  content: string;
  generatedAt: string;
  feedback?: string;
  status: 'superseded' | 'current' | 'approved';
  approvedAt?: string;
}

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

// ── Release Types ──

export type ReleaseSectionStatus = 'pending' | 'generating' | 'draft' | 'approved' | 'skipped';

export interface ReleaseSectionVersion {
  version: number;
  content: string;
  generatedAt: string;
  feedback?: string;
  status: 'superseded' | 'current' | 'approved';
  approvedAt?: string;
}

export interface ReleaseSection {
  number: number;
  title: string;
  key: string;
  status: ReleaseSectionStatus;
  content: string;
  versions: ReleaseSectionVersion[];
}

export interface ReleaseDoc {
  id: string;
  projectId: string;
  requirementId: string;
  architectureId: string;
  designId: string;
  testId: string;
  projectName: string;
  generatedDate: string;
  status: 'draft' | 'in-progress' | 'finalized';
  sections: ReleaseSection[];
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseSummary {
  id: string;
  requirementId: string;
  architectureId: string;
  designId: string;
  testId: string;
  title: string;
  status: string;
  sectionProgress: string;
  createdAt: string;
}

// ── Phase Engine Types ──
//
// A phase is one agent in the delivery lifecycle (requirement → architecture →
// design → testing → release). Every phase runs the same workflow — import/upload,
// Q&A against its Second Brain, human approval, section-by-section generation,
// deliverables — driven by a PhaseConfig on the server.

export type PhaseStatusValue = 'not-started' | 'in-progress' | 'completed' | 'locked';

export type PhaseStepKey =
  | 'import'
  | 'upload'
  | 'analyzing'
  | 'understanding'
  | 'questions'
  | 'approval'
  | 'sections'
  | 'export';

/** The phase definition as the client needs to render it. */
export interface PhaseDescriptor {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  color: string;
  roleOwner: string;
  requiresPhase?: string;
  outputFileName: string;
  docIdPrefix: string;
  maxQuestionsRound1: number;
  maxQuestionsRound2: number;
  comingSoon: boolean;
  /** 'set' phases draw several named diagrams instead of one system diagram. */
  diagramMode?: 'single' | 'set';
  /** Phases that generate live HTML mockups per screen (design). */
  mockups?: boolean;
  sections: { number: number; key: string; title: string; description: string; fileName?: string }[];
  deliverables: { id: string; name: string; type: 'excel' | 'tickets' | 'document' | 'images'; description: string }[];
}

export interface PhaseSectionState {
  number: number;
  title: string;
  key: string;
  status: 'pending' | 'generating' | 'draft' | 'approved' | 'skipped';
  content: string;
  versions: {
    version: number;
    content: string;
    generatedAt: string;
    feedback?: string;
    status: 'superseded' | 'current' | 'approved';
    approvedAt?: string;
  }[];
}

/** The section document a phase builds. Shaped like RequirementDoc so the same UI renders both. */
export interface PhaseDoc {
  id: string;
  sessionId: string;
  phaseId: string;
  projectName: string;
  generatedDate: string;
  status: 'draft' | 'in-progress' | 'finalized';
  sourceDocuments: string[];
  linkedTickets: string[];
  confidenceScore: number;
  sections: PhaseSectionState[];
  createdAt: string;
  updatedAt: string;
}

/** What a phase inherited from the phase before it. */
export interface PhaseImportSummary {
  fromPhaseId: string | null;
  fromPhaseName: string | null;
  documents: string[];
  documentId?: string;
  confirmedFacts: string[];
  assumptions: string[];
  openItems: string[];
  storyCount?: number;
  importedAt?: string;
}

export interface PhaseRuntimeStatus {
  phaseId: string;
  sessionId: string;
  exists: boolean;
  started: boolean;
  currentStep: PhaseStepKey;
  cycleCount: number;
  maxCycles: number;
  questionsExhausted: boolean;
  approvalStatus: 'pending' | 'approved';
  approvedAt?: string;
  confidenceScore: number;
  hasSummary: boolean;
  doc: { id: string; status: string; approvedSections: number; totalSections: number } | null;
  imported: PhaseImportSummary | null;
  completed: boolean;
  /** Where this phase's system diagram stands. Never null — 'none' means untried. */
  diagram: { status: DiagramStatus; revision: number; hasCode: boolean };
}

export interface PhaseStatusRecord {
  status: PhaseStatusValue;
  sessionId?: string;
  startedAt?: string;
  completedAt?: string;
  documentId?: string;
  confidenceScore?: number;
}

export interface ProjectPhaseProgress {
  projectId: string;
  sessionId: string;
  phases: Record<string, PhaseStatusRecord>;
}

/** One project as it appears in a phase's project list. */
export interface PhaseProjectEntry {
  projectId: string;
  projectName: string;
  client?: string;
  sessionId: string;
  phaseId: string;
  status: PhaseStatusValue;
  statusLabel: string;
  sourceLabel?: string;
  documentId?: string;
  confidenceScore?: number;
  lastActivity: string;
}

export interface PhaseAgentSummary extends PhaseDescriptor {
  totalProjects: number;
  inProgress: number;
  completed: number;
  available: boolean;
}

export interface PhaseTransitionResult {
  nextPhaseId: string;
  nextSessionId: string;
  nextPhaseUrl: string;
}

export interface PhaseDeliverableState {
  id: string;
  name: string;
  type: 'excel' | 'tickets' | 'document' | 'images';
  description: string;
  generated: boolean;
  generatedAt?: string;
  fileAvailable: boolean;
  downloadUrl?: string;
  summary?: string;
  payload?: any;
}

// ── Live UI mockups (design phase) ──

export interface MockupVersion {
  version: number;
  /** The full HTML document. Empty in list responses — fetch the screen for it. */
  html: string;
  /** 'generated' by the model, or 'edited' by hand in the code editor. */
  source: 'generated' | 'edited';
  feedback?: string;
  createdAt: string;
}

export interface MockupScreen {
  screenId: string;
  screenName: string;
  route?: string;
  status: 'pending' | 'draft' | 'approved';
  versions: MockupVersion[];
  /** 0 until the first version exists. */
  currentVersion: number;
  approvedVersion?: number;
  approvedAt?: string;
  updatedAt?: string;
  /** File name in mockups/ and in the ZIP, e.g. SCR-001-dashboard.html. */
  fileName: string;
  /** The screen no longer appears in Section 7 — kept so its work is not lost. */
  orphaned?: boolean;
}

export interface MockupSet {
  /** Sections 6 and 7 are approved, so mockups can be generated. */
  ready: boolean;
  blockedReason?: string;
  screens: MockupScreen[];
}
