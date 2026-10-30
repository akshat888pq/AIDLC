import type {
  ApiResponse,
  ClarifyingQuestion,
  CommitResult,
  PhaseAgentSummary,
  PhaseDeliverableState,
  PhaseDescriptor,
  PhaseDiagram,
  PhaseDoc,
  PhaseImportSummary,
  PhaseProjectEntry,
  PhaseRuntimeStatus,
  PhaseTransitionResult,
  PullRequest,
  UnderstandingSummary,
  AnalysisResult,
  MockupScreen,
  MockupSet,
} from '../types';

/**
 * Client for the generic phase engine.
 *
 * Every call is phase-agnostic: pass the phase id and the project's session id.
 * The requirement phase can be driven through here too, but the existing screens
 * keep using services/api.ts — both hit the same server-side state.
 */

const BASE = '/api';

async function handle<T>(res: Response): Promise<T> {
  const body: ApiResponse<T> = await res.json();
  if (!body.success) throw new Error(body.error || 'Unknown error');
  return body.data as T;
}

function phaseUrl(phaseId: string, sessionId: string, suffix = ''): string {
  return `${BASE}/phase/${phaseId}/${sessionId}${suffix}`;
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return handle<T>(res);
}

async function get<T>(url: string): Promise<T> {
  return handle<T>(await fetch(url));
}

// ── Agent Hub ──────────────────────────────────────────────────────────────────

export async function getAgents(): Promise<PhaseAgentSummary[]> {
  return get<PhaseAgentSummary[]>(`${BASE}/phases`);
}

export async function getPhaseProjects(phaseId: string): Promise<PhaseProjectEntry[]> {
  return get<PhaseProjectEntry[]>(`${BASE}/phases/${phaseId}/projects`);
}

export interface PhaseProgressEntry {
  phaseId: string;
  name: string;
  shortName: string;
  icon: string;
  color: string;
  comingSoon: boolean;
  status: 'not-started' | 'in-progress' | 'completed' | 'locked';
  statusLabel: string;
  documentId?: string;
  confidenceScore?: number;
  startedAt?: string;
  completedAt?: string;
  lockedReason?: string;
}

export async function getPhaseProgress(sessionId: string): Promise<PhaseProgressEntry[]> {
  return get<PhaseProgressEntry[]>(`${BASE}/phases/progress/${sessionId}`);
}

// ── Phase workflow ─────────────────────────────────────────────────────────────

export async function getPhaseConfig(phaseId: string, sessionId: string): Promise<PhaseDescriptor> {
  return get<PhaseDescriptor>(phaseUrl(phaseId, sessionId, '/config'));
}

export interface PhaseStatusResponse extends PhaseRuntimeStatus {
  phase: PhaseDescriptor;
  projectId?: string;
  projectName?: string;
  nextPhase: { id: string; name: string; comingSoon: boolean } | null;
  progress: PhaseProgressEntry[];
}

export async function getPhaseStatus(
  phaseId: string,
  sessionId: string
): Promise<PhaseStatusResponse> {
  return get<PhaseStatusResponse>(phaseUrl(phaseId, sessionId, '/status'));
}

export async function startPhase(
  phaseId: string,
  sessionId: string
): Promise<{ imported: PhaseImportSummary | null; status: PhaseRuntimeStatus }> {
  return post(phaseUrl(phaseId, sessionId, '/start'));
}

export async function getPhaseImport(
  phaseId: string,
  sessionId: string
): Promise<PhaseImportSummary | null> {
  return get<PhaseImportSummary | null>(phaseUrl(phaseId, sessionId, '/import'));
}

export interface PhaseAnalysis extends AnalysisResult {
  cycleCount: number;
  maxCycles: number;
  questionCycle: number | null;
  questionsExhausted: boolean;
  questionsWithheldReason?: string;
  readyForApproval: boolean;
  approvalStatus: 'pending' | 'approved';
}

export async function analyzePhase(phaseId: string, sessionId: string): Promise<PhaseAnalysis> {
  return post<PhaseAnalysis>(phaseUrl(phaseId, sessionId, '/analyze'));
}

export async function getPhaseQuestions(
  phaseId: string,
  sessionId: string
): Promise<ClarifyingQuestion[]> {
  return get<ClarifyingQuestion[]>(phaseUrl(phaseId, sessionId, '/questions'));
}

export interface PhaseAnswerState {
  cycleCount: number;
  maxCycles: number;
  questionsExhausted: boolean;
  roundComplete: boolean;
  readyForApproval: boolean;
  approvalStatus: 'pending' | 'approved';
  questions?: ClarifyingQuestion[];
  question?: ClarifyingQuestion;
}

export async function answerPhaseQuestion(
  phaseId: string,
  sessionId: string,
  questionId: string,
  answer: string | string[]
): Promise<PhaseAnswerState> {
  return post(phaseUrl(phaseId, sessionId, '/questions/answer'), { questionId, answer });
}

export async function answerPhaseQuestionsBulk(
  phaseId: string,
  sessionId: string,
  answers: { questionId: string; answer: string | string[] }[]
): Promise<PhaseAnswerState> {
  return post(phaseUrl(phaseId, sessionId, '/questions/answer-bulk'), { answers });
}

export async function skipPhaseQuestion(
  phaseId: string,
  sessionId: string,
  questionId: string
): Promise<PhaseAnswerState> {
  return post(phaseUrl(phaseId, sessionId, '/questions/skip'), { questionId });
}

// ── Approval ──

export interface PhaseApprovalState {
  exists: boolean;
  cycleCount: number;
  maxCycles: number;
  questionsExhausted: boolean;
  approvalStatus: 'pending' | 'approved';
  approvedAt?: string;
  hasSummary: boolean;
  confidenceScore: number;
  summary: UnderstandingSummary | null;
  humanInputs: { text: string; at: string }[];
  projectName: string;
  sourceDocuments: string[];
  canGenerateSections: boolean;
}

export async function getPhaseApproval(
  phaseId: string,
  sessionId: string
): Promise<PhaseApprovalState> {
  return get<PhaseApprovalState>(phaseUrl(phaseId, sessionId, '/approval'));
}

export async function generatePhaseApproval(
  phaseId: string,
  sessionId: string,
  force = false
): Promise<PhaseApprovalState> {
  return post(phaseUrl(phaseId, sessionId, '/approval'), { force });
}

export async function addPhaseApprovalInfo(
  phaseId: string,
  sessionId: string,
  text: string
): Promise<PhaseApprovalState> {
  return post(phaseUrl(phaseId, sessionId, '/approval/add-info'), { text });
}

export async function approvePhase(
  phaseId: string,
  sessionId: string,
  additionalInput?: string
): Promise<PhaseApprovalState> {
  return post(phaseUrl(phaseId, sessionId, '/approval/approve'), { additionalInput });
}

export async function getPhaseSecondBrain(
  phaseId: string,
  sessionId: string
): Promise<{ markdown: string; path: string }> {
  return get(phaseUrl(phaseId, sessionId, '/second-brain'));
}

// ── Sections ──

export async function initPhaseSections(phaseId: string, sessionId: string): Promise<PhaseDoc> {
  return post<PhaseDoc>(phaseUrl(phaseId, sessionId, '/sections/init'));
}

export async function getPhaseDoc(phaseId: string, sessionId: string): Promise<PhaseDoc> {
  return get<PhaseDoc>(phaseUrl(phaseId, sessionId, '/sections'));
}

export async function generatePhaseSection(
  phaseId: string,
  sessionId: string,
  sectionNumber: number,
  feedback?: string
): Promise<{ sectionNumber: number; content: string; version: number; doc: PhaseDoc }> {
  return post(phaseUrl(phaseId, sessionId, `/sections/${sectionNumber}/generate`), { feedback });
}

export async function approvePhaseSection(
  phaseId: string,
  sessionId: string,
  sectionNumber: number,
  content?: string
): Promise<PhaseDoc> {
  return post<PhaseDoc>(phaseUrl(phaseId, sessionId, `/sections/${sectionNumber}/approve`), {
    content,
  });
}

export async function skipPhaseSection(
  phaseId: string,
  sessionId: string,
  sectionNumber: number
): Promise<PhaseDoc> {
  return post<PhaseDoc>(phaseUrl(phaseId, sessionId, `/sections/${sectionNumber}/skip`));
}

export async function revertPhaseSection(
  phaseId: string,
  sessionId: string,
  sectionNumber: number,
  version: number
): Promise<PhaseDoc> {
  return post<PhaseDoc>(phaseUrl(phaseId, sessionId, `/sections/${sectionNumber}/revert`), {
    version,
  });
}

export async function assemblePhase(
  phaseId: string,
  sessionId: string
): Promise<{ markdown: string; doc: PhaseDoc }> {
  return get(phaseUrl(phaseId, sessionId, '/assemble'));
}

export function phaseDownloadUrl(phaseId: string, sessionId: string): string {
  return phaseUrl(phaseId, sessionId, '/download');
}

export async function finalizePhase(
  phaseId: string,
  sessionId: string
): Promise<{ markdown: string; savedPath: string; documentId: string }> {
  return post(phaseUrl(phaseId, sessionId, '/finalize'));
}

// ── System diagram ──

export async function generatePhaseDiagram(
  phaseId: string,
  sessionId: string,
  feedback?: string
): Promise<PhaseDiagram> {
  return post<PhaseDiagram>(phaseUrl(phaseId, sessionId, '/generate-diagram'), { feedback });
}

export async function getPhaseDiagram(phaseId: string, sessionId: string): Promise<PhaseDiagram> {
  return get<PhaseDiagram>(phaseUrl(phaseId, sessionId, '/diagram'));
}

export async function savePhaseDiagram(
  phaseId: string,
  sessionId: string,
  mermaid: string
): Promise<PhaseDiagram> {
  return post<PhaseDiagram>(phaseUrl(phaseId, sessionId, '/diagram'), { mermaid });
}

export async function approvePhaseDiagram(
  phaseId: string,
  sessionId: string,
  mermaid?: string
): Promise<PhaseDiagram> {
  return post<PhaseDiagram>(phaseUrl(phaseId, sessionId, '/diagram/approve'), { mermaid });
}

export async function skipPhaseDiagram(
  phaseId: string,
  sessionId: string
): Promise<PhaseDiagram> {
  return post<PhaseDiagram>(phaseUrl(phaseId, sessionId, '/diagram/skip'));
}

// ── Deliverables ──

export async function getPhaseDeliverables(
  phaseId: string,
  sessionId: string
): Promise<PhaseDeliverableState[]> {
  return get<PhaseDeliverableState[]>(phaseUrl(phaseId, sessionId, '/deliverables'));
}

export async function generatePhaseDeliverable(
  phaseId: string,
  sessionId: string,
  deliverableId: string,
  regenerate = false
): Promise<PhaseDeliverableState> {
  return post(phaseUrl(phaseId, sessionId, `/deliverables/${deliverableId}`), { regenerate });
}

export function deliverableDownloadUrl(
  phaseId: string,
  sessionId: string,
  deliverableId: string
): string {
  return phaseUrl(phaseId, sessionId, `/deliverables/${deliverableId}/download`);
}

// ── Transition ──

export async function proceedToNextPhase(
  phaseId: string,
  sessionId: string
): Promise<PhaseTransitionResult> {
  return post<PhaseTransitionResult>(phaseUrl(phaseId, sessionId, '/proceed'));
}

// ── Diagram sets (phases with diagramMode 'set', e.g. design) ──

export async function getDiagramSet(phaseId: string, sessionId: string): Promise<PhaseDiagram[]> {
  return get<PhaseDiagram[]>(phaseUrl(phaseId, sessionId, '/diagrams'));
}

export async function buildDiagramSet(phaseId: string, sessionId: string): Promise<PhaseDiagram[]> {
  return post<PhaseDiagram[]>(phaseUrl(phaseId, sessionId, '/diagrams/build'));
}

function diagramUrl(phaseId: string, sessionId: string, key: string, suffix = ''): string {
  return phaseUrl(phaseId, sessionId, `/diagrams/${encodeURIComponent(key)}${suffix}`);
}

export async function saveSetDiagram(phaseId: string, sessionId: string, key: string, mermaid: string): Promise<PhaseDiagram> {
  return post<PhaseDiagram>(diagramUrl(phaseId, sessionId, key), { mermaid });
}

export async function approveSetDiagram(phaseId: string, sessionId: string, key: string, mermaid?: string): Promise<PhaseDiagram> {
  return post<PhaseDiagram>(diagramUrl(phaseId, sessionId, key, '/approve'), { mermaid });
}

export async function skipSetDiagram(phaseId: string, sessionId: string, key: string): Promise<PhaseDiagram> {
  return post<PhaseDiagram>(diagramUrl(phaseId, sessionId, key, '/skip'));
}

export async function regenerateSetDiagram(
  phaseId: string,
  sessionId: string,
  key: string,
  feedback?: string
): Promise<PhaseDiagram> {
  return post<PhaseDiagram>(diagramUrl(phaseId, sessionId, key, '/regenerate'), { feedback });
}

/** Store the browser-rendered JPG of a diagram in the phase package. */
export async function uploadSetDiagramImage(
  phaseId: string,
  sessionId: string,
  key: string,
  jpg: Blob
): Promise<PhaseDiagram> {
  const res = await fetch(diagramUrl(phaseId, sessionId, key, '/image'), {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: jpg,
  });
  return handle<PhaseDiagram>(res);
}

export function setDiagramImageUrl(phaseId: string, sessionId: string, key: string, download = false): string {
  return diagramUrl(phaseId, sessionId, key, `/image${download ? '?download=1' : ''}`);
}

// ── Package (files the phase wrote) ──

export interface PackageFile {
  path: string;
  size: number;
  binary: boolean;
}

export interface RenderedImage {
  file: string;
  screenId?: string;
  screenName?: string;
  variant: 'wireframe' | 'desktop' | 'mobile' | 'style-guide';
  width: number;
  height: number;
}

export async function getPackageFiles(phaseId: string, sessionId: string): Promise<PackageFile[]> {
  return get<PackageFile[]>(phaseUrl(phaseId, sessionId, '/package'));
}

export async function getRenderedImages(phaseId: string, sessionId: string): Promise<RenderedImage[]> {
  return get<RenderedImage[]>(phaseUrl(phaseId, sessionId, '/images'));
}

export function packageFileUrl(phaseId: string, sessionId: string, relativePath: string, download = false): string {
  return phaseUrl(
    phaseId,
    sessionId,
    `/package/file?path=${encodeURIComponent(relativePath)}${download ? '&download=1' : ''}`
  );
}

export interface PackageCommitResult {
  commit: CommitResult;
  pullRequest?: PullRequest;
  branch: string;
  repoName: string;
  files: string[];
}

export async function commitPhasePackage(
  phaseId: string,
  sessionId: string,
  body: { workspaceSessionId: string; message?: string; createPR?: boolean }
): Promise<PackageCommitResult> {
  return post<PackageCommitResult>(phaseUrl(phaseId, sessionId, '/git/commit'), body);
}

// ── Live UI mockups (phases with mockups: true, e.g. design) ──

function mockupUrl(phaseId: string, sessionId: string, suffix = ''): string {
  return phaseUrl(phaseId, sessionId, `/mockups${suffix}`);
}

export async function getMockupSet(phaseId: string, sessionId: string): Promise<MockupSet> {
  return get<MockupSet>(mockupUrl(phaseId, sessionId));
}

/** One screen, with the HTML of every version. */
export async function getMockup(phaseId: string, sessionId: string, screenId: string): Promise<MockupScreen> {
  return get<MockupScreen>(mockupUrl(phaseId, sessionId, `/${screenId}`));
}

export async function generateMockup(
  phaseId: string,
  sessionId: string,
  screenId: string,
  feedback?: string
): Promise<MockupScreen> {
  return post<MockupScreen>(mockupUrl(phaseId, sessionId, `/${screenId}/generate`), { feedback });
}

export async function saveMockup(phaseId: string, sessionId: string, screenId: string, html: string): Promise<MockupScreen> {
  const res = await fetch(mockupUrl(phaseId, sessionId, `/${screenId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html }),
  });
  return handle<MockupScreen>(res);
}

export async function approveMockup(
  phaseId: string,
  sessionId: string,
  screenId: string,
  html?: string
): Promise<MockupScreen> {
  return post<MockupScreen>(mockupUrl(phaseId, sessionId, `/${screenId}/approve`), { html });
}

export async function revertMockup(
  phaseId: string,
  sessionId: string,
  screenId: string,
  version: number
): Promise<MockupScreen> {
  return post<MockupScreen>(mockupUrl(phaseId, sessionId, `/${screenId}/revert`), { version });
}

/** The approved (else current) mockup as a standalone page, or as a download. */
export function mockupFileUrl(phaseId: string, sessionId: string, screenId: string, download = false): string {
  return mockupUrl(phaseId, sessionId, `/${screenId}/file${download ? '?download=1' : ''}`);
}

export function mockupArchiveUrl(phaseId: string, sessionId: string): string {
  return mockupUrl(phaseId, sessionId, '/archive');
}
