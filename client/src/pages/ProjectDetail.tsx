import { useState, useEffect, useCallback } from 'react';
import type { Project, RequirementDoc, ArchitectureSummary, DesignSummary, TestSummary, ReleaseSummary, UploadedFile } from '../types';
import type { GitCommit } from '../services/api';
import EmptyState from '../components/EmptyState';
import ExcelDownload from '../components/ExcelDownload';
import FileUpload from '../components/FileUpload';
import DocumentList from '../components/DocumentList';
import * as api from '../services/api';

interface Props {
  project: Project;
  sessionId: string;
  onBack: () => void;
  onOpenRequirement: (reqId: string) => void;
  onNewRequirement: () => void;
  onOpenArchitecture: (requirementId: string, archId?: string) => void;
  onOpenDesign: (requirementId: string, architectureId: string, designId?: string) => void;
  onOpenTest: (requirementId: string, architectureId: string, designId: string, testId?: string) => void;
  onOpenRelease: (requirementId: string, architectureId: string, designId: string, testId: string, releaseId?: string) => void;
}

type Tab = 'requirements' | 'documents' | 'backlog' | 'tickets' | 'git' | 'artifacts';

export default function ProjectDetail({ project, sessionId, onBack, onOpenRequirement, onNewRequirement, onOpenArchitecture, onOpenDesign, onOpenTest, onOpenRelease }: Props) {
  const [tab, setTab] = useState<Tab>('requirements');
  const [requirements, setRequirements] = useState<RequirementDoc[]>([]);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [gitHistory, setGitHistory] = useState<GitCommit[]>([]);
  const [loadingGit, setLoadingGit] = useState(false);
  const [gitLoaded, setGitLoaded] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [architectures, setArchitectures] = useState<ArchitectureSummary[]>([]);
  const [loadingArch, setLoadingArch] = useState(false);
  const [archLoaded, setArchLoaded] = useState(false);
  const [designs, setDesigns] = useState<DesignSummary[]>([]);
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [artifactsLoaded, setArtifactsLoaded] = useState(false);
  // The Epic & Stories backlog may only be built from an approved understanding.
  const [approved, setApproved] = useState(false);
  const [brainExists, setBrainExists] = useState(false);
  const [documents, setDocuments] = useState<UploadedFile[]>([]);
  const [reopened, setReopened] = useState(false);

  const loadRequirements = useCallback(async () => {
    setLoadingReqs(true);
    try {
      // `sessionId` is this project's own session — never fall back to another id,
      // which would list a different project's requirements here.
      const docs = await api.getProjectRequirements(sessionId);
      setRequirements(docs);
    } catch {
      try {
        const doc = await api.getLatestRequirement(sessionId);
        setRequirements(doc ? [doc] : []);
      } catch {
        setRequirements([]);
      }
    } finally {
      setLoadingReqs(false);
    }
  }, [sessionId]);

  const loadGitHistory = useCallback(async () => {
    if (gitLoaded) return;
    setLoadingGit(true);
    setGitError(null);
    try {
      const commits = await api.getGitHistory(project.id);
      setGitHistory(commits);
      setGitLoaded(true);
    } catch (err: any) {
      setGitError(err.message);
    } finally {
      setLoadingGit(false);
    }
  }, [project.id, gitLoaded]);

  const loadAllArtifacts = useCallback(async () => {
    if (artifactsLoaded) return;
    setLoadingArch(true);
    try {
      const [archs, des, tst, rel] = await Promise.all([
        api.getProjectArchitectures(project.id).catch(() => [] as ArchitectureSummary[]),
        api.getProjectDesigns(project.id).catch(() => [] as DesignSummary[]),
        api.getProjectTests(project.id).catch(() => [] as TestSummary[]),
        api.getProjectReleases(project.id).catch(() => [] as ReleaseSummary[]),
      ]);
      setArchitectures(archs);
      setDesigns(des);
      setTests(tst);
      setReleases(rel);
      setArchLoaded(true);
      setArtifactsLoaded(true);
    } catch {
      setArchLoaded(true);
      setArtifactsLoaded(true);
    } finally {
      setLoadingArch(false);
    }
  }, [project.id, artifactsLoaded]);

  useEffect(() => { loadRequirements(); }, [loadRequirements]);

  useEffect(() => {
    let cancelled = false;
    api.getAnalysisStatus(sessionId)
      .then((status) => {
        if (cancelled) return;
        setBrainExists(status.exists);
        setApproved(status.approvalStatus === 'approved');
      })
      .catch(() => {});
    api.getFiles(sessionId)
      .then((files) => { if (!cancelled) setDocuments(files); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId]);

  const handleDocumentsUploaded = useCallback((uploaded: UploadedFile[]) => {
    setDocuments((prev) => [...prev, ...uploaded]);
    // Adding a document to an approved project reopens the loop server-side: the
    // agent gets its question cycles back and sign-off returns to pending.
    if (approved) {
      setApproved(false);
      setReopened(true);
    }
    setBrainExists(true);
  }, [approved]);

  useEffect(() => {
    if (tab === 'git' && project.gitProvider && !gitLoaded) {
      loadGitHistory();
    }
  }, [tab, project.gitProvider, gitLoaded, loadGitHistory]);

  useEffect(() => {
    if (tab === 'artifacts' && !artifactsLoaded) {
      loadAllArtifacts();
    }
  }, [tab, artifactsLoaded, loadAllArtifacts]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'requirements', label: 'Requirements', count: requirements.length },
    { key: 'documents', label: 'Documents', count: documents.length },
    { key: 'backlog', label: 'Epic & Stories' },
    { key: 'tickets', label: 'Tickets' },
    { key: 'git', label: 'Git History' },
    { key: 'artifacts', label: 'Artifacts', count: (architectures.length + designs.length + tests.length + releases.length) || undefined },
  ];

  const finalizedReqs = requirements.filter((r) => r.status === 'finalized');

  return (
    <div className="space-y-6">
      {/* Project Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">{project.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                {project.client && <span className="text-sm text-slate-500">{project.client}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  project.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                  project.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                  'bg-amber-100 text-amber-700'
                }`}>
                  {project.status}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${project.gitProvider ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              Git {project.gitProvider ? `(${project.gitProvider})` : ''}
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${project.ticketProvider ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              Tickets {project.ticketProvider ? `(${project.ticketProvider})` : ''}
            </div>
          </div>
        </div>
        {project.description && (
          <p className="text-sm text-slate-600 mt-3">{project.description}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-6">
          <div className="flex items-center gap-1 -mb-px">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                  tab === t.key ? 'text-accent' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className="ml-1.5 text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                    {t.count}
                  </span>
                )}
                {tab === t.key && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Requirements Tab */}
          {tab === 'requirements' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-700">Requirements</h3>
                <button
                  onClick={onNewRequirement}
                  className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-medium transition-colors"
                >
                  New Requirement
                </button>
              </div>

              {loadingReqs ? (
                <div className="text-center py-8">
                  <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              ) : requirements.length === 0 ? (
                <EmptyState
                  title="No requirements yet"
                  description="Create a new requirement to start building your requirements document."
                  actionLabel="New Requirement"
                  onAction={onNewRequirement}
                />
              ) : (
                <div className="space-y-2">
                  {requirements.map((req) => {
                    const approved = req.sections.filter((s) => s.status === 'approved').length;
                    const total = req.sections.length;
                    const isFinalized = req.status === 'finalized';
                    return (
                      <div
                        key={req.id}
                        className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm font-bold text-accent">{req.id}</span>
                            <span className="text-sm text-slate-700">{req.projectName}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              req.status === 'finalized' ? 'bg-emerald-100 text-emerald-700' :
                              req.status === 'in-progress' ? 'bg-blue-100 text-blue-700' :
                              'bg-amber-100 text-amber-700'
                            }`}>
                              {req.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">{approved}/{total} sections</span>
                            {isFinalized && (
                              <button
                                onClick={() => onOpenArchitecture(req.id)}
                                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium transition-colors"
                              >
                                Generate Architecture
                              </button>
                            )}
                            <button
                              onClick={() => onOpenRequirement(req.id)}
                              className="px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded text-xs font-medium transition-colors"
                            >
                              Open
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all"
                            style={{ width: `${total > 0 ? (approved / total) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Documents / Context Tab */}
          {tab === 'documents' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Project Documents</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Everything this project knows is built from these. Add a new document
                  whenever one arrives from the client — the agent keeps what it already
                  learned and reads the new material on top of it.
                </p>
              </div>

              {reopened && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <p className="text-sm font-medium text-amber-800">New document added</p>
                  <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                    This project was already approved, so the agent's question cycles have
                    been returned and sign-off is back to pending. Continue the intake to
                    re-analyse with the new document, answer any follow-up questions, and
                    approve the combined understanding — then the Epic &amp; Stories Excel
                    can be regenerated.
                  </p>
                  <button
                    onClick={onNewRequirement}
                    className="mt-3 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    Continue intake
                  </button>
                </div>
              )}

              <FileUpload sessionId={sessionId} onFilesUploaded={handleDocumentsUploaded} />

              {documents.length > 0 ? (
                <DocumentList files={documents} />
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">
                  No documents in this project yet.
                </p>
              )}

              {documents.length > 0 && !reopened && (
                <div className="border-t border-slate-200 pt-4 flex items-center justify-between gap-4">
                  <p className="text-xs text-slate-500">
                    {approved
                      ? 'Understanding approved. Adding another document will reopen it for review.'
                      : 'Continue the intake to analyse these documents, answer the agent\'s questions, and approve.'}
                  </p>
                  <button
                    onClick={onNewRequirement}
                    className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    Open intake
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Epic & Stories Backlog Tab */}
          {tab === 'backlog' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Epic &amp; User Stories</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  The delivery backlog for this project, built from its second brain and
                  exported as an Excel workbook.
                </p>
              </div>

              {!brainExists ? (
                <EmptyState
                  title="No project context yet"
                  description="Upload the client documents and complete the intake for this project first — the backlog is generated from its approved understanding."
                  actionLabel="Start intake"
                  onAction={onNewRequirement}
                />
              ) : (
                <ExcelDownload sessionId={sessionId} approved={approved} />
              )}
            </div>
          )}

          {/* Tickets Tab */}
          {tab === 'tickets' && (
            <div>
              {project.ticketProvider ? (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-600 mb-3">
                    Connected to <strong>{project.ticketProvider}</strong>
                  </p>
                  <p className="text-xs text-slate-400">
                    Ticket sync will show linked tickets here when requirements are created with ticket integration.
                  </p>
                </div>
              ) : (
                <EmptyState
                  title="No ticket provider connected"
                  description="Connect Azure DevOps or Jira on the Connections page to link tickets to this project."
                />
              )}
            </div>
          )}

          {/* Git History Tab */}
          {tab === 'git' && (
            <div>
              {!project.gitProvider ? (
                <EmptyState
                  title="No git provider connected"
                  description="Connect GitHub, GitLab, or Azure Repos on the Connections page to enable version control."
                />
              ) : loadingGit ? (
                <div className="text-center py-8">
                  <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-slate-500 mt-2">Loading commit history...</p>
                </div>
              ) : gitError ? (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-500 mb-3">
                    Could not load commit history. Make sure a repository is configured for this project.
                  </p>
                  <p className="text-xs text-red-500 mb-4">{gitError}</p>
                  <button
                    onClick={() => { setGitLoaded(false); loadGitHistory(); }}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : gitHistory.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-600 mb-3">
                    Connected to <strong>{project.gitProvider}</strong>
                  </p>
                  <p className="text-xs text-slate-400">
                    No commits found yet. Commits will appear here after requirements are committed to Git.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-slate-700">Recent Commits</h3>
                    <button
                      onClick={() => { setGitLoaded(false); loadGitHistory(); }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-medium transition-colors"
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="space-y-2">
                    {gitHistory.map((commit) => (
                      <div key={commit.sha} className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-800 truncate">{commit.message.split('\n')[0]}</p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{commit.shortSha}</span>
                              <span>{commit.author}</span>
                              <span>{new Date(commit.date).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <a
                            href={commit.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-accent hover:underline ml-3 whitespace-nowrap"
                          >
                            View
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Artifacts Tab */}
          {tab === 'artifacts' && (
            <div className="space-y-6">
              {/* Artifact Cards Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <button onClick={() => setTab('requirements')} className="border border-emerald-200 bg-emerald-50/30 rounded-lg p-4 text-center hover:bg-emerald-50 transition-colors">
                  <h4 className="text-sm font-semibold text-slate-700">Requirements</h4>
                  <p className="text-xs text-emerald-600 mt-1">{finalizedReqs.length} finalized / {requirements.length} total</p>
                </button>
                <div className={`border rounded-lg p-4 text-center ${architectures.length > 0 ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                  <h4 className="text-sm font-semibold text-slate-700">Architecture</h4>
                  <p className={`text-xs mt-1 ${architectures.length > 0 ? 'text-indigo-600' : 'text-slate-400'}`}>
                    {architectures.length > 0 ? `${architectures.length} generated` : finalizedReqs.length > 0 ? 'Ready to generate' : 'Finalize a requirement first'}
                  </p>
                </div>
                <div className={`border rounded-lg p-4 text-center ${designs.length > 0 ? 'border-violet-200 bg-violet-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                  <h4 className="text-sm font-semibold text-slate-700">Solution Design</h4>
                  <p className={`text-xs mt-1 ${designs.length > 0 ? 'text-violet-600' : 'text-slate-400'}`}>
                    {designs.length > 0 ? `${designs.length} generated` : 'Finalize architecture first'}
                  </p>
                </div>
                <div className={`border rounded-lg p-4 text-center ${tests.length > 0 ? 'border-teal-200 bg-teal-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                  <h4 className="text-sm font-semibold text-slate-700">Test Cases</h4>
                  <p className={`text-xs mt-1 ${tests.length > 0 ? 'text-teal-600' : 'text-slate-400'}`}>
                    {tests.length > 0 ? `${tests.length} generated` : 'Finalize design first'}
                  </p>
                </div>
                <div className={`border rounded-lg p-4 text-center ${releases.length > 0 ? 'border-orange-200 bg-orange-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                  <h4 className="text-sm font-semibold text-slate-700">Release Notes</h4>
                  <p className={`text-xs mt-1 ${releases.length > 0 ? 'text-orange-600' : 'text-slate-400'}`}>
                    {releases.length > 0 ? `${releases.length} generated` : 'Finalize test plan first'}
                  </p>
                </div>
              </div>

              {loadingArch ? (
                <div className="text-center py-4">
                  <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {/* Architecture List */}
                  {architectures.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700 mb-3">Architecture Documents</h3>
                      <div className="space-y-2">
                        {architectures.map((arch) => (
                          <div key={arch.id} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-sm font-bold text-indigo-600">{arch.id}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${arch.status === 'finalized' ? 'bg-emerald-100 text-emerald-700' : arch.status === 'in-progress' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{arch.status}</span>
                                <span className="text-xs text-slate-400">{arch.sectionProgress} &middot; from {arch.requirementId}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {arch.status === 'finalized' && (
                                  <button onClick={() => onOpenDesign(arch.requirementId, arch.id)} className="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded text-xs font-medium transition-colors">
                                    Generate Design
                                  </button>
                                )}
                                <button onClick={() => onOpenArchitecture(arch.requirementId, arch.id)} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium transition-colors">Open</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Design List */}
                  {designs.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700 mb-3">Solution Design Documents</h3>
                      <div className="space-y-2">
                        {designs.map((des) => (
                          <div key={des.id} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-sm font-bold text-violet-600">{des.id}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${des.status === 'finalized' ? 'bg-emerald-100 text-emerald-700' : des.status === 'in-progress' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{des.status}</span>
                                <span className="text-xs text-slate-400">{des.sectionProgress} &middot; from {des.architectureId}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {des.status === 'finalized' && (
                                  <button onClick={() => onOpenTest(des.requirementId, des.architectureId, des.id)} className="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs font-medium transition-colors">
                                    Generate Tests
                                  </button>
                                )}
                                <button onClick={() => onOpenDesign(des.requirementId, des.architectureId, des.id)} className="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded text-xs font-medium transition-colors">Open</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Test List */}
                  {tests.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700 mb-3">Test Plan Documents</h3>
                      <div className="space-y-2">
                        {tests.map((tst) => (
                          <div key={tst.id} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-sm font-bold text-teal-600">{tst.id}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tst.status === 'finalized' ? 'bg-emerald-100 text-emerald-700' : tst.status === 'in-progress' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{tst.status}</span>
                                <span className="text-xs text-slate-400">{tst.sectionProgress} &middot; from {tst.designId}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {tst.status === 'finalized' && (
                                  <button onClick={() => onOpenRelease(tst.requirementId, tst.architectureId, tst.designId, tst.id)} className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-medium transition-colors">
                                    Generate Release Notes
                                  </button>
                                )}
                                <button onClick={() => onOpenTest(tst.requirementId, tst.architectureId, tst.designId, tst.id)} className="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs font-medium transition-colors">Open</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Release List */}
                  {releases.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700 mb-3">Release Notes Documents</h3>
                      <div className="space-y-2">
                        {releases.map((rel) => (
                          <div key={rel.id} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-sm font-bold text-orange-600">{rel.id}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rel.status === 'finalized' ? 'bg-emerald-100 text-emerald-700' : rel.status === 'in-progress' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{rel.status}</span>
                                <span className="text-xs text-slate-400">{rel.sectionProgress} &middot; from {rel.testId}</span>
                              </div>
                              <button onClick={() => onOpenRelease(rel.requirementId, rel.architectureId, rel.designId, rel.testId, rel.id)} className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-medium transition-colors">Open</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Generate prompt for architecture if none exist */}
                  {architectures.length === 0 && finalizedReqs.length > 0 && (
                    <div className="text-center py-4">
                      <p className="text-sm text-slate-600 mb-3">
                        You have {finalizedReqs.length} finalized requirement{finalizedReqs.length > 1 ? 's' : ''} ready for architecture generation.
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {finalizedReqs.map((req) => (
                          <button key={req.id} onClick={() => onOpenArchitecture(req.id)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors">
                            Generate Architecture from {req.id}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
