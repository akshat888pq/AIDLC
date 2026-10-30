import type {
  UploadedFile,
  AnalysisResult,
  ClarifyingQuestion,
  ApiResponse,
  TicketProviderConnection,
  TicketProject,
  Ticket,
  TicketHierarchyNode,
  TicketCreationSummary,
  DuplicateCandidate,
  RequirementDoc,
  GenerateSectionResponse,
  GitProviderConnection,
  GitProvider,
  Repo,
  Branch,
  CommitResult,
  PullRequest,
  GitRepoConfig,
  Project,
  ProjectStats,
  ArchitectureDoc,
  ArchitectureSummary,
  PhaseDiagram,
  DesignDoc,
  DesignSummary,
  TestDoc,
  TestSummary,
  ReleaseDoc,
  ReleaseSummary,
  SecondBrainStatus,
  UnderstandingSummary,
  HumanInput,
  EpicStoriesResult,
} from '../types';

const BASE = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  const body: ApiResponse<T> = await res.json();
  if (!body.success) throw new Error(body.error || 'Unknown error');
  return body.data as T;
}

export async function uploadFiles(sessionId: string, files: File[]): Promise<UploadedFile[]> {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  const res = await fetch(`${BASE}/upload/${sessionId}`, { method: 'POST', body: formData });
  return handleResponse<UploadedFile[]>(res);
}

export async function getFiles(sessionId: string): Promise<UploadedFile[]> {
  const res = await fetch(`${BASE}/upload/${sessionId}/files`);
  return handleResponse<UploadedFile[]>(res);
}

/** Cycle + approval metadata returned alongside analysis and answer calls. */
export interface CycleState {
  cycleCount: number;
  maxCycles: number;
  questionsExhausted: boolean;
  readyForApproval: boolean;
  approvalStatus: 'pending' | 'approved';
  roundComplete?: boolean;
  questionCycle?: number | null;
  questionsWithheldReason?: string;
}

export type AnalysisWithCycle = AnalysisResult & CycleState;

export async function analyzeDocuments(sessionId: string): Promise<AnalysisWithCycle> {
  const res = await fetch(`${BASE}/analyze/${sessionId}`, { method: 'POST' });
  return handleResponse<AnalysisWithCycle>(res);
}

export async function getAnalysis(sessionId: string): Promise<AnalysisWithCycle> {
  const res = await fetch(`${BASE}/analyze/${sessionId}`);
  return handleResponse<AnalysisWithCycle>(res);
}

export async function getAnalysisStatus(sessionId: string): Promise<SecondBrainStatus> {
  const res = await fetch(`${BASE}/analyze/${sessionId}/status`);
  return handleResponse<SecondBrainStatus>(res);
}

export async function answerQuestion(
  sessionId: string,
  questionId: string,
  answer: string | string[]
): Promise<{ question: ClarifyingQuestion } & CycleState> {
  const res = await fetch(`${BASE}/questions/${sessionId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId, answer }),
  });
  return handleResponse<{ question: ClarifyingQuestion } & CycleState>(res);
}

export async function answerQuestionsBulk(
  sessionId: string,
  answers: { questionId: string; answer: string | string[] }[]
): Promise<{ questions: ClarifyingQuestion[] } & CycleState> {
  const res = await fetch(`${BASE}/questions/${sessionId}/answer-bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  return handleResponse<{ questions: ClarifyingQuestion[] } & CycleState>(res);
}

export async function skipQuestion(
  sessionId: string,
  questionId: string
): Promise<{ question: ClarifyingQuestion } & CycleState> {
  const res = await fetch(`${BASE}/questions/${sessionId}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId }),
  });
  return handleResponse<{ question: ClarifyingQuestion } & CycleState>(res);
}

export async function importAnswers(
  sessionId: string,
  markdown: string
): Promise<{ importedCount: number; questions: ClarifyingQuestion[] } & Partial<CycleState>> {
  const res = await fetch(`${BASE}/questions/${sessionId}/import-answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  });
  return handleResponse<
    { importedCount: number; questions: ClarifyingQuestion[] } & Partial<CycleState>
  >(res);
}

// ── Human Approval (Second Brain) ──

export interface ApprovalState extends SecondBrainStatus {
  summary: UnderstandingSummary | null;
  humanInputs: HumanInput[];
  projectName: string;
  sourceDocuments: string[];
  canGenerateRequirements: boolean;
  canGenerateExcel: boolean;
}

export async function getApproval(sessionId: string): Promise<ApprovalState> {
  const res = await fetch(`${BASE}/projects/${sessionId}/approval`);
  return handleResponse<ApprovalState>(res);
}

export async function generateApprovalSummary(
  sessionId: string,
  force = false
): Promise<ApprovalState> {
  const res = await fetch(`${BASE}/projects/${sessionId}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
  return handleResponse<ApprovalState>(res);
}

export async function addApprovalInfo(sessionId: string, text: string): Promise<ApprovalState> {
  const res = await fetch(`${BASE}/projects/${sessionId}/approval/add-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return handleResponse<ApprovalState>(res);
}

export async function approveUnderstanding(
  sessionId: string,
  additionalInput?: string
): Promise<ApprovalState> {
  const res = await fetch(`${BASE}/projects/${sessionId}/approval/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ additionalInput }),
  });
  return handleResponse<ApprovalState>(res);
}

export async function getSecondBrain(
  sessionId: string
): Promise<{ markdown: string; path: string }> {
  const res = await fetch(`${BASE}/projects/${sessionId}/second-brain`);
  return handleResponse<{ markdown: string; path: string }>(res);
}

// ── Epic & User Stories Excel Report ──

export interface ExcelReportState {
  exists: boolean;
  fileAvailable: boolean;
  approvalStatus: 'pending' | 'approved';
  result: EpicStoriesResult | null;
  downloadUrl: string | null;
}

export async function getExcelReport(sessionId: string): Promise<ExcelReportState> {
  const res = await fetch(`${BASE}/projects/${sessionId}/excel-report`);
  return handleResponse<ExcelReportState>(res);
}

export async function generateExcelReport(
  sessionId: string,
  regenerate = false
): Promise<EpicStoriesResult & { reused?: boolean }> {
  const res = await fetch(`${BASE}/projects/${sessionId}/excel-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regenerate }),
  });
  return handleResponse<EpicStoriesResult & { reused?: boolean }>(res);
}

export function getExcelReportDownloadUrl(sessionId: string): string {
  return `${BASE}/projects/${sessionId}/excel-report/download`;
}

export function getExportQuestionsUrl(sessionId: string): string {
  return `${BASE}/export/${sessionId}/questions`;
}

export function getExportUnderstandingUrl(sessionId: string): string {
  return `${BASE}/export/${sessionId}/understanding`;
}

export async function sendChatMessage(
  sessionId: string,
  message: string
): Promise<{ reply: string }> {
  const res = await fetch(`${BASE}/chat/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return handleResponse<{ reply: string }>(res);
}

// ── Connections ──

export async function getConnections(sessionId: string): Promise<Partial<TicketProviderConnection>[]> {
  const res = await fetch(`${BASE}/connections/${sessionId}`);
  return handleResponse<Partial<TicketProviderConnection>[]>(res);
}

export async function getOAuthUrl(sessionId: string, provider: string): Promise<{ url: string }> {
  const res = await fetch(`${BASE}/oauth/${provider}/authorize?sessionId=${sessionId}`);
  return handleResponse<{ url: string }>(res);
}

export async function testConnection(sessionId: string, provider: string): Promise<{ ok: boolean; user?: string; org?: string }> {
  const res = await fetch(`${BASE}/connections/${sessionId}/test/${provider}`, { method: 'POST' });
  return handleResponse<{ ok: boolean; user?: string; org?: string }>(res);
}

export async function setAzureOrg(sessionId: string, organizationUrl: string): Promise<void> {
  const res = await fetch(`${BASE}/connections/${sessionId}/azure-org`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationUrl }),
  });
  await handleResponse<any>(res);
}

export async function disconnectProvider(sessionId: string, provider: string): Promise<void> {
  const res = await fetch(`${BASE}/connections/${sessionId}/${provider}`, { method: 'DELETE' });
  await handleResponse<any>(res);
}

// ── Tickets ──

export async function getProjects(sessionId: string, provider: string): Promise<TicketProject[]> {
  const res = await fetch(`${BASE}/tickets/${sessionId}/projects?provider=${provider}`);
  return handleResponse<TicketProject[]>(res);
}

export async function getTickets(
  sessionId: string,
  provider: string,
  projectId: string,
  filters?: Record<string, string>
): Promise<Ticket[]> {
  const params = new URLSearchParams({ provider, ...filters });
  const res = await fetch(`${BASE}/tickets/${sessionId}/projects/${projectId}/tickets?${params}`);
  return handleResponse<Ticket[]>(res);
}

export async function searchTickets(sessionId: string, provider: string, projectId: string, query: string): Promise<Ticket[]> {
  const res = await fetch(`${BASE}/tickets/${sessionId}/projects/${projectId}/search?provider=${provider}&q=${encodeURIComponent(query)}`);
  return handleResponse<Ticket[]>(res);
}

export async function getTicket(sessionId: string, provider: string, ticketId: string): Promise<Ticket> {
  const res = await fetch(`${BASE}/tickets/${sessionId}/ticket/${ticketId}?provider=${provider}`);
  return handleResponse<Ticket>(res);
}

/**
 * `sessionId` addresses the provider connection (workspace-scoped); `targetSessionId`
 * is the project session the ticket gets filed into.
 */
export async function workOnTicket(
  sessionId: string,
  provider: string,
  ticketId: string,
  targetSessionId: string,
): Promise<{ ticket: Ticket; injected: boolean }> {
  const params = new URLSearchParams({ provider, targetSessionId });
  const res = await fetch(`${BASE}/tickets/${sessionId}/work-on/${ticketId}?${params}`, { method: 'POST' });
  return handleResponse<{ ticket: Ticket; injected: boolean }>(res);
}

export async function generateHierarchy(sessionId: string, projectId: string): Promise<{ reasoning: string; hierarchy: TicketHierarchyNode[] }> {
  const res = await fetch(`${BASE}/tickets/${sessionId}/generate-hierarchy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });
  return handleResponse<{ reasoning: string; hierarchy: TicketHierarchyNode[] }>(res);
}

export async function checkDuplicates(
  sessionId: string,
  provider: string,
  projectId: string,
  titles: string[]
): Promise<{ duplicates: DuplicateCandidate[] }> {
  const res = await fetch(`${BASE}/tickets/${sessionId}/check-duplicates?provider=${provider}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, titles }),
  });
  return handleResponse<{ duplicates: DuplicateCandidate[] }>(res);
}

export async function createTickets(
  sessionId: string,
  provider: string,
  hierarchy: TicketHierarchyNode[]
): Promise<TicketCreationSummary> {
  const res = await fetch(`${BASE}/tickets/${sessionId}/create-tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hierarchy, provider }),
  });
  return handleResponse<TicketCreationSummary>(res);
}

// ── Requirements ──

export async function initRequirement(sessionId: string): Promise<RequirementDoc> {
  const res = await fetch(`${BASE}/requirements/${sessionId}/init`, { method: 'POST' });
  return handleResponse<RequirementDoc>(res);
}

export async function getRequirement(sessionId: string, reqId: string): Promise<RequirementDoc> {
  const res = await fetch(`${BASE}/requirements/${sessionId}/${reqId}`);
  return handleResponse<RequirementDoc>(res);
}

export async function getLatestRequirement(sessionId: string): Promise<RequirementDoc> {
  const res = await fetch(`${BASE}/requirements/${sessionId}`);
  return handleResponse<RequirementDoc>(res);
}

export async function generateSection(
  sessionId: string,
  reqId: string,
  sectionNumber: number,
  feedback?: string,
): Promise<GenerateSectionResponse> {
  const res = await fetch(`${BASE}/requirements/${sessionId}/${reqId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, feedback }),
  });
  return handleResponse<GenerateSectionResponse>(res);
}

export async function approveSection(
  sessionId: string,
  reqId: string,
  sectionNumber: number,
  content?: string,
): Promise<RequirementDoc> {
  const res = await fetch(`${BASE}/requirements/${sessionId}/${reqId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, content }),
  });
  return handleResponse<RequirementDoc>(res);
}

export async function skipSectionApi(sessionId: string, reqId: string, sectionNumber: number): Promise<RequirementDoc> {
  const res = await fetch(`${BASE}/requirements/${sessionId}/${reqId}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber }),
  });
  return handleResponse<RequirementDoc>(res);
}

export async function revertSection(
  sessionId: string,
  reqId: string,
  sectionNumber: number,
  version: number,
): Promise<RequirementDoc> {
  const res = await fetch(`${BASE}/requirements/${sessionId}/${reqId}/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, version }),
  });
  return handleResponse<RequirementDoc>(res);
}

export async function assembleRequirement(sessionId: string, reqId: string): Promise<{ markdown: string; doc: RequirementDoc }> {
  const res = await fetch(`${BASE}/requirements/${sessionId}/${reqId}/assemble`);
  return handleResponse<{ markdown: string; doc: RequirementDoc }>(res);
}

export function getRequirementDownloadUrl(sessionId: string, reqId: string): string {
  return `${BASE}/requirements/${sessionId}/${reqId}/download`;
}

export async function finalizeRequirement(
  sessionId: string,
  reqId: string,
  projectId?: string,
): Promise<{ savedPath: string; requirementId: string; markdown?: string }> {
  const res = await fetch(`${BASE}/requirements/${sessionId}/${reqId}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });
  return handleResponse<{ savedPath: string; requirementId: string; markdown?: string }>(res);
}

export async function getProjectRequirements(sessionId: string): Promise<RequirementDoc[]> {
  const res = await fetch(`${BASE}/requirements/project/${sessionId}/list`);
  return handleResponse<RequirementDoc[]>(res);
}

// ── Git Integration ──

export async function getGitConnections(sessionId: string): Promise<Partial<GitProviderConnection>[]> {
  const res = await fetch(`${BASE}/git/connections/${sessionId}`);
  return handleResponse<Partial<GitProviderConnection>[]>(res);
}

export async function getGitOAuthUrl(sessionId: string, provider: string): Promise<{ url: string | null; autoConnected?: boolean }> {
  const res = await fetch(`${BASE}/git/oauth/${provider}/authorize?sessionId=${sessionId}`);
  return handleResponse<{ url: string | null; autoConnected?: boolean }>(res);
}

export async function testGitConnection(sessionId: string, provider: string, orgUrl?: string): Promise<{ ok: boolean; user?: string; org?: string }> {
  const params = orgUrl ? `?orgUrl=${encodeURIComponent(orgUrl)}` : '';
  const res = await fetch(`${BASE}/git/connections/${sessionId}/test/${provider}${params}`, { method: 'POST' });
  return handleResponse<{ ok: boolean; user?: string; org?: string }>(res);
}

export async function disconnectGitProvider(sessionId: string, provider: string): Promise<void> {
  const res = await fetch(`${BASE}/git/connections/${sessionId}/${provider}`, { method: 'DELETE' });
  await handleResponse<any>(res);
}

export async function getGitRepos(sessionId: string, provider: GitProvider, orgUrl?: string): Promise<Repo[]> {
  const params = new URLSearchParams({ provider });
  if (orgUrl) params.set('orgUrl', orgUrl);
  const res = await fetch(`${BASE}/git/${sessionId}/repos?${params}`);
  return handleResponse<Repo[]>(res);
}

export async function getGitBranches(sessionId: string, provider: GitProvider, repoId: string, orgUrl?: string): Promise<Branch[]> {
  const params = new URLSearchParams({ provider });
  if (orgUrl) params.set('orgUrl', orgUrl);
  const res = await fetch(`${BASE}/git/${sessionId}/repos/${encodeURIComponent(repoId)}/branches?${params}`);
  return handleResponse<Branch[]>(res);
}

export async function getGitConfig(projectId: string): Promise<GitRepoConfig | null> {
  const res = await fetch(`${BASE}/git/config/${projectId}`);
  return handleResponse<GitRepoConfig | null>(res);
}

export async function saveGitConfig(projectId: string, config: GitRepoConfig): Promise<GitRepoConfig> {
  const res = await fetch(`${BASE}/git/config/${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return handleResponse<GitRepoConfig>(res);
}

export async function gitCommitFile(
  sessionId: string,
  provider: GitProvider,
  repoId: string,
  branch: string,
  path: string,
  content: string,
  message: string,
  orgUrl?: string,
): Promise<CommitResult> {
  const res = await fetch(`${BASE}/git/${sessionId}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, repoId, branch, path, content, message, orgUrl }),
  });
  return handleResponse<CommitResult>(res);
}

export async function gitCreateBranch(
  sessionId: string,
  provider: GitProvider,
  repoId: string,
  sourceBranch: string,
  newBranch: string,
  orgUrl?: string,
): Promise<Branch> {
  const res = await fetch(`${BASE}/git/${sessionId}/branch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, repoId, sourceBranch, newBranch, orgUrl }),
  });
  return handleResponse<Branch>(res);
}

export async function gitCreatePullRequest(
  sessionId: string,
  provider: GitProvider,
  repoId: string,
  sourceBranch: string,
  targetBranch: string,
  title: string,
  description: string,
  orgUrl?: string,
): Promise<PullRequest> {
  const res = await fetch(`${BASE}/git/${sessionId}/pull-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, repoId, sourceBranch, targetBranch, title, description, orgUrl }),
  });
  return handleResponse<PullRequest>(res);
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  url: string;
  files?: string[];
}

export async function getGitHistory(projectId: string): Promise<GitCommit[]> {
  const res = await fetch(`${BASE}/git/history/${projectId}`);
  return handleResponse<GitCommit[]>(res);
}

// ── Projects ──

export async function getProjects_all(): Promise<Project[]> {
  const res = await fetch(`${BASE}/projects`);
  return handleResponse<Project[]>(res);
}

export async function getProjectStats(): Promise<ProjectStats> {
  const res = await fetch(`${BASE}/projects/stats`);
  return handleResponse<ProjectStats>(res);
}

export async function getProject(projectId: string): Promise<Project> {
  const res = await fetch(`${BASE}/projects/${projectId}`);
  return handleResponse<Project>(res);
}

export async function createProject(data: {
  name: string;
  description?: string;
  client?: string;
  ticketProvider?: string;
  ticketProjectId?: string;
  gitProvider?: string;
  gitRepoId?: string;
  gitBranch?: string;
}): Promise<Project> {
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<Project>(res);
}

export async function updateProject(projectId: string, updates: Partial<Project>): Promise<Project> {
  const res = await fetch(`${BASE}/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return handleResponse<Project>(res);
}

/** Hide a project from the dashboard without destroying its work. */
export async function archiveProject(projectId: string): Promise<void> {
  const res = await fetch(`${BASE}/projects/${projectId}/archive`, { method: 'POST' });
  await handleResponse<any>(res);
}

/**
 * Permanently delete a project along with its Second Brain, requirements and every
 * downstream artifact. Not reversible.
 */
export async function deleteProject(projectId: string): Promise<{ id: string; name: string }> {
  const res = await fetch(`${BASE}/projects/${projectId}`, { method: 'DELETE' });
  return handleResponse<{ id: string; name: string }>(res);
}

// ── Architecture ──

export async function initArchitecture(
  projectId: string,
  requirementId: string,
): Promise<ArchitectureDoc> {
  const res = await fetch(`${BASE}/architecture/${projectId}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requirementId }),
  });
  return handleResponse<ArchitectureDoc>(res);
}

export async function getArchitecture(
  projectId: string,
  archId: string,
): Promise<ArchitectureDoc> {
  const res = await fetch(`${BASE}/architecture/${projectId}/${archId}`);
  return handleResponse<ArchitectureDoc>(res);
}

export async function getProjectArchitectures(
  projectId: string,
): Promise<ArchitectureSummary[]> {
  const res = await fetch(`${BASE}/architecture/${projectId}/list`);
  return handleResponse<ArchitectureSummary[]>(res);
}

export async function generateArchSection(
  projectId: string,
  archId: string,
  sectionNumber: number,
  feedback?: string,
): Promise<{ sectionNumber: number; content: string; version: number }> {
  const res = await fetch(`${BASE}/architecture/${projectId}/${archId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, feedback }),
  });
  return handleResponse<{ sectionNumber: number; content: string; version: number }>(res);
}

export async function approveArchSection(
  projectId: string,
  archId: string,
  sectionNumber: number,
  content?: string,
): Promise<ArchitectureDoc> {
  const res = await fetch(`${BASE}/architecture/${projectId}/${archId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, content }),
  });
  return handleResponse<ArchitectureDoc>(res);
}

export async function skipArchSectionApi(
  projectId: string,
  archId: string,
  sectionNumber: number,
): Promise<ArchitectureDoc> {
  const res = await fetch(`${BASE}/architecture/${projectId}/${archId}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber }),
  });
  return handleResponse<ArchitectureDoc>(res);
}

export async function revertArchSection(
  projectId: string,
  archId: string,
  sectionNumber: number,
  version: number,
): Promise<ArchitectureDoc> {
  const res = await fetch(`${BASE}/architecture/${projectId}/${archId}/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, version }),
  });
  return handleResponse<ArchitectureDoc>(res);
}

export async function assembleArchitecture(
  projectId: string,
  archId: string,
): Promise<{ markdown: string; doc: ArchitectureDoc }> {
  const res = await fetch(`${BASE}/architecture/${projectId}/${archId}/assemble`);
  return handleResponse<{ markdown: string; doc: ArchitectureDoc }>(res);
}

export function getArchitectureDownloadUrl(projectId: string, archId: string): string {
  return `${BASE}/architecture/${projectId}/${archId}/download`;
}

export async function finalizeArchitecture(
  projectId: string,
  archId: string,
): Promise<{ savedPath: string; architectureId: string; markdown: string }> {
  const res = await fetch(`${BASE}/architecture/${projectId}/${archId}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<{ savedPath: string; architectureId: string; markdown: string }>(res);
}

// ── Architecture diagram ──

function diagramUrl(projectId: string, archId: string, suffix = ''): string {
  return `${BASE}/architecture/${projectId}/${archId}/diagram${suffix}`;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return handleResponse<T>(res);
}

export async function generateArchitectureDiagram(
  projectId: string,
  archId: string,
  feedback?: string,
): Promise<PhaseDiagram> {
  return postJson<PhaseDiagram>(
    `${BASE}/architecture/${projectId}/${archId}/generate-diagram`,
    { feedback },
  );
}

export async function getArchitectureDiagram(
  projectId: string,
  archId: string,
): Promise<PhaseDiagram> {
  return handleResponse<PhaseDiagram>(await fetch(diagramUrl(projectId, archId)));
}

export async function saveArchitectureDiagram(
  projectId: string,
  archId: string,
  mermaid: string,
): Promise<PhaseDiagram> {
  return postJson<PhaseDiagram>(diagramUrl(projectId, archId), { mermaid });
}

export async function approveArchitectureDiagram(
  projectId: string,
  archId: string,
  mermaid?: string,
): Promise<PhaseDiagram> {
  return postJson<PhaseDiagram>(diagramUrl(projectId, archId, '/approve'), { mermaid });
}

export async function skipArchitectureDiagram(
  projectId: string,
  archId: string,
): Promise<PhaseDiagram> {
  return postJson<PhaseDiagram>(diagramUrl(projectId, archId, '/skip'));
}

// ── Design ──

export async function initDesign(
  projectId: string,
  requirementId: string,
  architectureId: string,
): Promise<DesignDoc> {
  const res = await fetch(`${BASE}/design/${projectId}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requirementId, architectureId }),
  });
  return handleResponse<DesignDoc>(res);
}

export async function getDesign(projectId: string, designId: string): Promise<DesignDoc> {
  const res = await fetch(`${BASE}/design/${projectId}/${designId}`);
  return handleResponse<DesignDoc>(res);
}

export async function getProjectDesigns(projectId: string): Promise<DesignSummary[]> {
  const res = await fetch(`${BASE}/design/${projectId}/list`);
  return handleResponse<DesignSummary[]>(res);
}

export async function generateDesignSection(
  projectId: string,
  designId: string,
  sectionNumber: number,
  feedback?: string,
): Promise<{ sectionNumber: number; content: string; version: number }> {
  const res = await fetch(`${BASE}/design/${projectId}/${designId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, feedback }),
  });
  return handleResponse<{ sectionNumber: number; content: string; version: number }>(res);
}

export async function approveDesignSection(
  projectId: string,
  designId: string,
  sectionNumber: number,
  content?: string,
): Promise<DesignDoc> {
  const res = await fetch(`${BASE}/design/${projectId}/${designId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, content }),
  });
  return handleResponse<DesignDoc>(res);
}

export async function skipDesignSectionApi(
  projectId: string,
  designId: string,
  sectionNumber: number,
): Promise<DesignDoc> {
  const res = await fetch(`${BASE}/design/${projectId}/${designId}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber }),
  });
  return handleResponse<DesignDoc>(res);
}

export async function revertDesignSection(
  projectId: string,
  designId: string,
  sectionNumber: number,
  version: number,
): Promise<DesignDoc> {
  const res = await fetch(`${BASE}/design/${projectId}/${designId}/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, version }),
  });
  return handleResponse<DesignDoc>(res);
}

export async function assembleDesign(
  projectId: string,
  designId: string,
): Promise<{ markdown: string; doc: DesignDoc }> {
  const res = await fetch(`${BASE}/design/${projectId}/${designId}/assemble`);
  return handleResponse<{ markdown: string; doc: DesignDoc }>(res);
}

export function getDesignDownloadUrl(projectId: string, designId: string): string {
  return `${BASE}/design/${projectId}/${designId}/download`;
}

export async function finalizeDesign(
  projectId: string,
  designId: string,
): Promise<{ savedPath: string; designId: string; markdown: string }> {
  const res = await fetch(`${BASE}/design/${projectId}/${designId}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<{ savedPath: string; designId: string; markdown: string }>(res);
}

// ── Test Cases ──

export async function initTest(
  projectId: string,
  requirementId: string,
  architectureId: string,
  designId: string,
): Promise<TestDoc> {
  const res = await fetch(`${BASE}/tests/${projectId}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requirementId, architectureId, designId }),
  });
  return handleResponse<TestDoc>(res);
}

export async function getTestPlan(projectId: string, testId: string): Promise<TestDoc> {
  const res = await fetch(`${BASE}/tests/${projectId}/${testId}`);
  return handleResponse<TestDoc>(res);
}

export async function getProjectTests(projectId: string): Promise<TestSummary[]> {
  const res = await fetch(`${BASE}/tests/${projectId}/list`);
  return handleResponse<TestSummary[]>(res);
}

export async function generateTestSection(
  projectId: string,
  testId: string,
  sectionNumber: number,
  feedback?: string,
): Promise<{ sectionNumber: number; content: string; version: number }> {
  const res = await fetch(`${BASE}/tests/${projectId}/${testId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, feedback }),
  });
  return handleResponse<{ sectionNumber: number; content: string; version: number }>(res);
}

export async function approveTestSection(
  projectId: string,
  testId: string,
  sectionNumber: number,
  content?: string,
): Promise<TestDoc> {
  const res = await fetch(`${BASE}/tests/${projectId}/${testId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, content }),
  });
  return handleResponse<TestDoc>(res);
}

export async function skipTestSectionApi(
  projectId: string,
  testId: string,
  sectionNumber: number,
): Promise<TestDoc> {
  const res = await fetch(`${BASE}/tests/${projectId}/${testId}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber }),
  });
  return handleResponse<TestDoc>(res);
}

export async function revertTestSection(
  projectId: string,
  testId: string,
  sectionNumber: number,
  version: number,
): Promise<TestDoc> {
  const res = await fetch(`${BASE}/tests/${projectId}/${testId}/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, version }),
  });
  return handleResponse<TestDoc>(res);
}

export async function assembleTest(
  projectId: string,
  testId: string,
): Promise<{ markdown: string; doc: TestDoc }> {
  const res = await fetch(`${BASE}/tests/${projectId}/${testId}/assemble`);
  return handleResponse<{ markdown: string; doc: TestDoc }>(res);
}

export function getTestDownloadUrl(projectId: string, testId: string): string {
  return `${BASE}/tests/${projectId}/${testId}/download`;
}

export async function finalizeTest(
  projectId: string,
  testId: string,
): Promise<{ savedPath: string; testId: string; markdown: string }> {
  const res = await fetch(`${BASE}/tests/${projectId}/${testId}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<{ savedPath: string; testId: string; markdown: string }>(res);
}

// ── Release Notes ──

export async function initRelease(
  projectId: string,
  requirementId: string,
  architectureId: string,
  designId: string,
  testId: string,
): Promise<ReleaseDoc> {
  const res = await fetch(`${BASE}/release/${projectId}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requirementId, architectureId, designId, testId }),
  });
  return handleResponse<ReleaseDoc>(res);
}

export async function getRelease(projectId: string, releaseId: string): Promise<ReleaseDoc> {
  const res = await fetch(`${BASE}/release/${projectId}/${releaseId}`);
  return handleResponse<ReleaseDoc>(res);
}

export async function getProjectReleases(projectId: string): Promise<ReleaseSummary[]> {
  const res = await fetch(`${BASE}/release/${projectId}/list`);
  return handleResponse<ReleaseSummary[]>(res);
}

export async function generateReleaseSection(
  projectId: string,
  releaseId: string,
  sectionNumber: number,
  feedback?: string,
): Promise<{ sectionNumber: number; content: string; version: number }> {
  const res = await fetch(`${BASE}/release/${projectId}/${releaseId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, feedback }),
  });
  return handleResponse<{ sectionNumber: number; content: string; version: number }>(res);
}

export async function approveReleaseSection(
  projectId: string,
  releaseId: string,
  sectionNumber: number,
  content?: string,
): Promise<ReleaseDoc> {
  const res = await fetch(`${BASE}/release/${projectId}/${releaseId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, content }),
  });
  return handleResponse<ReleaseDoc>(res);
}

export async function skipReleaseSectionApi(
  projectId: string,
  releaseId: string,
  sectionNumber: number,
): Promise<ReleaseDoc> {
  const res = await fetch(`${BASE}/release/${projectId}/${releaseId}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber }),
  });
  return handleResponse<ReleaseDoc>(res);
}

export async function revertReleaseSection(
  projectId: string,
  releaseId: string,
  sectionNumber: number,
  version: number,
): Promise<ReleaseDoc> {
  const res = await fetch(`${BASE}/release/${projectId}/${releaseId}/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionNumber, version }),
  });
  return handleResponse<ReleaseDoc>(res);
}

export async function assembleRelease(
  projectId: string,
  releaseId: string,
): Promise<{ markdown: string; doc: ReleaseDoc }> {
  const res = await fetch(`${BASE}/release/${projectId}/${releaseId}/assemble`);
  return handleResponse<{ markdown: string; doc: ReleaseDoc }>(res);
}

export function getReleaseDownloadUrl(projectId: string, releaseId: string): string {
  return `${BASE}/release/${projectId}/${releaseId}/download`;
}

export async function finalizeRelease(
  projectId: string,
  releaseId: string,
): Promise<{ savedPath: string; releaseId: string; markdown: string }> {
  const res = await fetch(`${BASE}/release/${projectId}/${releaseId}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<{ savedPath: string; releaseId: string; markdown: string }>(res);
}
