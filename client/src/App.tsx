import { useState, useCallback } from 'react';
import type { PhaseProjectEntry, Project } from './types';
import { getWorkspaceSessionId } from './services/session';
import * as api from './services/api';
import AgentDashboard from './pages/AgentDashboard';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import Connections from './pages/Connections';
import RequirementBuilder from './pages/RequirementBuilder';
import ArchitectureBuilder from './pages/ArchitectureBuilder';
import DesignBuilder from './pages/DesignBuilder';
import TestBuilder from './pages/TestBuilder';
import ReleaseBuilder from './pages/ReleaseBuilder';
import CommandCenter from './pages/CommandCenter';

type Page =
  | { kind: 'agents' }
  | { kind: 'command'; project: Project; stage: string }
  | { kind: 'dashboard' }
  | { kind: 'connections' }
  | { kind: 'project-detail'; project: Project }
  | { kind: 'requirements'; project: Project; reqId?: string }
  | { kind: 'architecture'; project: Project; requirementId: string; archId?: string }
  | { kind: 'design'; project: Project; requirementId: string; architectureId: string; designId?: string }
  | { kind: 'test'; project: Project; requirementId: string; architectureId: string; designId: string; testId?: string }
  | { kind: 'release'; project: Project; requirementId: string; architectureId: string; designId: string; testId: string; releaseId?: string };

const STAGE_OF: Record<string, string> = {
  requirements: 'requirement',
  architecture: 'architecture',
  design: 'design',
  test: 'testing',
  release: 'release',
};

/** Every stage of a project opens in the unified command center. */
function pageForPhase(phaseId: string, project: Project): Page {
  return { kind: 'command', project, stage: phaseId };
}

export default function App() {
  // The Agent Hub is the home screen; the classic project dashboard is still one
  // click away from inside any agent, and from the Projects tab.
  const [page, setPage] = useState<Page>({ kind: 'dashboard' });
  // Identifies the browser for provider connections only — never used as a project's
  // context. Each project carries its own server-minted sessionId.
  const [workspaceSessionId] = useState(getWorkspaceSessionId);

  const navTab =
    page.kind === 'connections' ? 'connections' : 'projects';

  // Projects is the single entry point; every stage hangs off a project.
  const goToAgents = useCallback(() => setPage({ kind: 'dashboard' }), []);
  const goToDashboard = useCallback(() => setPage({ kind: 'dashboard' }), []);
  const goToConnections = useCallback(() => setPage({ kind: 'connections' }), []);

  /**
   * Open a project inside a phase. The requirement phase keeps its own intake
   * screen (uploads, the ticket entry point); every other phase runs the generic
   * phase workflow.
   */
  const openPhaseProject = useCallback(async (phaseId: string, entry: PhaseProjectEntry) => {
    const project = await api.getProject(entry.projectId);
    setPage(pageForPhase(phaseId, project));
  }, []);

  const openProject = useCallback((project: Project) => {
    setPage(pageForPhase('requirement', project));
  }, []);

  const startIntake = useCallback((project: Project) => {
    setPage(pageForPhase('requirement', project));
  }, []);

  const openRequirements = useCallback((project: Project, reqId?: string) => {
    setPage({ kind: 'requirements', project, reqId });
  }, []);

  const openArchitecture = useCallback((project: Project, requirementId: string, archId?: string) => {
    setPage({ kind: 'architecture', project, requirementId, archId });
  }, []);

  const openDesign = useCallback((project: Project, requirementId: string, architectureId: string, designId?: string) => {
    setPage({ kind: 'design', project, requirementId, architectureId, designId });
  }, []);

  const openTest = useCallback((project: Project, requirementId: string, architectureId: string, designId: string, testId?: string) => {
    setPage({ kind: 'test', project, requirementId, architectureId, designId, testId });
  }, []);

  const openRelease = useCallback((project: Project, requirementId: string, architectureId: string, designId: string, testId: string, releaseId?: string) => {
    setPage({ kind: 'release', project, requirementId, architectureId, designId, testId, releaseId });
  }, []);

  // A project's context is addressed by its own session id and nothing else. The
  // server backfills one for any project created before per-project sessions existed,
  // so this is always set; falling back to the workspace id would hand the project
  // whatever context the browser last touched.
  const projectSessionId = (project: Project) => project.sessionId!;

  if (page.kind === 'command') {
    return (
      <CommandCenter
        key={page.project.id}
        project={page.project}
        workspaceSessionId={workspaceSessionId}
        initialStage={page.stage}
        onExit={goToAgents}
        onOpenRequirementBuilder={() => setPage({ kind: 'requirements', project: page.project })}
      />
    );
  }

  if (page.kind === 'release') {
    return (
      <ReleaseBuilder
        projectId={page.project.id}
        sessionId={projectSessionId(page.project)}
        requirementId={page.requirementId}
        architectureId={page.architectureId}
        designId={page.designId}
        testId={page.testId}
        releaseId={page.releaseId}
        onBack={() => setPage(pageForPhase(STAGE_OF[page.kind], page.project))}
        onStartDevelopment={() => setPage(pageForPhase('development', page.project))}
      />
    );
  }

  if (page.kind === 'test') {
    return (
      <TestBuilder
        projectId={page.project.id}
        sessionId={projectSessionId(page.project)}
        requirementId={page.requirementId}
        architectureId={page.architectureId}
        designId={page.designId}
        testId={page.testId}
        onBack={() => setPage(pageForPhase(STAGE_OF[page.kind], page.project))}
        onGenerateReleaseNotes={(reqId, archId, desId, testId) =>
          openRelease(page.project, reqId, archId, desId, testId)
        }
      />
    );
  }

  if (page.kind === 'design') {
    return (
      <DesignBuilder
        projectId={page.project.id}
        sessionId={projectSessionId(page.project)}
        requirementId={page.requirementId}
        architectureId={page.architectureId}
        designId={page.designId}
        onBack={() => setPage(pageForPhase(STAGE_OF[page.kind], page.project))}
        onGenerateTestCases={(reqId, archId, desId) =>
          openTest(page.project, reqId, archId, desId)
        }
      />
    );
  }

  if (page.kind === 'architecture') {
    return (
      <ArchitectureBuilder
        projectId={page.project.id}
        sessionId={projectSessionId(page.project)}
        requirementId={page.requirementId}
        architectureId={page.archId}
        onBack={() => setPage(pageForPhase(STAGE_OF[page.kind], page.project))}
        onGenerateDesign={(reqId, archId) =>
          openDesign(page.project, reqId, archId)
        }
      />
    );
  }

  if (page.kind === 'requirements') {
    return (
      <RequirementBuilder
        sessionId={projectSessionId(page.project)}
        projectId={page.project.id}
        requirementId={page.reqId}
        onBack={() => setPage(pageForPhase(STAGE_OF[page.kind], page.project))}
        onGenerateArchitecture={(reqId) =>
          setPage({ kind: 'architecture', project: page.project, requirementId: reqId })
        }
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Nav */}
      <nav className="bg-[#f3f1ec] text-slate-800 border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div
              className="flex items-center gap-2.5 cursor-pointer py-3"
              onClick={goToAgents}
            >
              <span className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center font-bold text-sm shrink-0">A</span>
              <h1 className="text-base font-bold tracking-wide">AIDLC STUDIO</h1>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={goToDashboard}
                className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                  navTab === 'projects' ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Projects
                {navTab === 'projects' && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-700" />
                )}
              </button>
              <button
                onClick={goToConnections}
                className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                  navTab === 'connections' ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Connections
                {navTab === 'connections' && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-700" />
                )}
              </button>
            </div>
          </div>
          <div className="text-xs text-slate-400 font-mono hidden sm:block">
            {workspaceSessionId.slice(0, 8)}
          </div>
        </div>
      </nav>

      {/* Page Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {page.kind === 'agents' && (
          <AgentDashboard
            onOpenPhaseProject={openPhaseProject}
            onOpenAllProjects={goToDashboard}
          />
        )}

        {page.kind === 'dashboard' && (
          <Dashboard
            onOpenProject={openProject}
            onNewRequirement={startIntake}
          />
        )}

        {page.kind === 'connections' && <Connections />}

        {page.kind === 'project-detail' && (
          <ProjectDetail
            project={page.project}
            sessionId={projectSessionId(page.project)}
            onBack={goToDashboard}
            onOpenRequirement={(reqId) => openRequirements(page.project, reqId)}
            onNewRequirement={() => startIntake(page.project)}
            onOpenArchitecture={(reqId, archId) => openArchitecture(page.project, reqId, archId)}
            onOpenDesign={(reqId, archId, desId) => openDesign(page.project, reqId, archId, desId)}
            onOpenTest={(reqId, archId, desId, testId) => openTest(page.project, reqId, archId, desId, testId)}
            onOpenRelease={(reqId, archId, desId, testId, relId) => openRelease(page.project, reqId, archId, desId, testId, relId)}
          />
        )}
      </main>
    </div>
  );
}
