import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalysisResult, DiagramStatus, PhaseDoc, PhaseImportSummary } from '../types';
import * as phaseApi from '../services/phaseApi';
import type { PhaseProgressEntry, PhaseStatusResponse } from '../services/phaseApi';
import AgentUnderstanding from './AgentUnderstanding';
import QuestionPanel from './QuestionPanel';
import ApprovalStep from './ApprovalStep';
import SectionEditor from './SectionEditor';
import SectionNavigator from './SectionNavigator';
import PhaseImport from './PhaseImport';
import PhaseProgress from './PhaseProgress';
import PhaseDeliverables from './PhaseDeliverables';
import DiagramStep from './DiagramStep';
import type { DiagramApi } from './DiagramStep';
import DiagramSetStep from './DiagramSetStep';
import DesignGallery from './DesignGallery';
import MockupStudio from './MockupStudio';
import PhaseGitCommit from './PhaseGitCommit';
import { phaseTheme } from './phaseTheme';

interface Props {
  phaseId: string;
  sessionId: string;
  projectName?: string;
  onBack: () => void;
  /** Called after the user explicitly proceeds, so the shell can route to the next phase. */
  onProceed?: (nextPhaseId: string, nextSessionId: string) => void;
  onSelectPhase?: (phaseId: string) => void;
  /** Rendered inside the Command Center, which draws the header and stage rail itself. */
  embedded?: boolean;
}

type Step =
  | 'import'
  | 'analyzing'
  | 'understanding'
  | 'questions'
  | 'approval'
  | 'sections'
  | 'diagram'
  | 'mockups'
  | 'export';

const STEPS: { key: Step; label: string }[] = [
  { key: 'import', label: 'Import' },
  { key: 'analyzing', label: 'Analysis' },
  { key: 'questions', label: 'Q & A' },
  { key: 'approval', label: 'Approval' },
  { key: 'sections', label: 'Sections' },
  { key: 'diagram', label: 'Diagram' },
  // Only for phases whose config sets mockups: true (design).
  { key: 'mockups', label: 'Mockups' },
  { key: 'export', label: 'Export' },
];

/**
 * The workflow every phase runs, rendered with that phase's own content.
 *
 * It is deliberately the same set of components the requirement phase uses —
 * QuestionPanel, ApprovalStep, SectionNavigator, SectionEditor — with the phase id
 * passed through so their API calls land on the phase engine instead of the
 * requirement-specific routes.
 */
export default function PhaseWorkflow({
  phaseId,
  sessionId,
  projectName,
  onBack,
  onProceed,
  onSelectPhase,
  embedded = false,
}: Props) {
  const [status, setStatus] = useState<PhaseStatusResponse | null>(null);
  const [progress, setProgress] = useState<PhaseProgressEntry[]>([]);
  const [imported, setImported] = useState<PhaseImportSummary | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [doc, setDoc] = useState<PhaseDoc | null>(null);
  const [assembled, setAssembled] = useState<string>('');

  const [step, setStep] = useState<Step>('import');
  const [analysisRound, setAnalysisRound] = useState(0);
  const [cycleCount, setCycleCount] = useState(0);
  const [maxCycles, setMaxCycles] = useState(2);
  const [questionsExhausted, setQuestionsExhausted] = useState(false);
  const [withheldReason, setWithheldReason] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [generatingSection, setGeneratingSection] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proceeding, setProceeding] = useState(false);
  const [diagramStatus, setDiagramStatus] = useState<DiagramStatus>('none');

  const theme = phaseTheme(status?.phase.color ?? 'purple');
  const isApproved = status?.approvalStatus === 'approved';

  const refreshStatus = useCallback(async () => {
    const next = await phaseApi.getPhaseStatus(phaseId, sessionId);
    setStatus(next);
    setProgress(next.progress);
    setCycleCount(next.cycleCount);
    setMaxCycles(next.maxCycles);
    setQuestionsExhausted(next.questionsExhausted);
    setImported(next.imported);
    if (next.diagram) setDiagramStatus(next.diagram.status);
    return next;
  }, [phaseId, sessionId]);

  // Re-hydrate everything this phase already holds, so the workflow can be left and
  // re-entered at any point without losing its place.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await phaseApi.getPhaseStatus(phaseId, sessionId);
        if (cancelled) return;
        setStatus(next);
        setProgress(next.progress);
        setCycleCount(next.cycleCount);
        setMaxCycles(next.maxCycles);
        setQuestionsExhausted(next.questionsExhausted);
        setImported(next.imported);
        if (next.diagram) setDiagramStatus(next.diagram.status);

        if (next.exists) {
          try {
            const questions = await phaseApi.getPhaseQuestions(phaseId, sessionId);
            if (!cancelled && questions.length > 0) {
              setAnalysis({
                understanding: {
                  projectOverview: '',
                  businessObjective: '',
                  scope: { inScope: [], outOfScope: [], unclear: [] },
                  stakeholders: [],
                  timeline: '',
                  techStack: '',
                  deliverables: [],
                  constraints: [],
                  assumptions: [],
                  risks: [],
                  dependencies: [],
                },
                confidenceScore: next.confidenceScore,
                questions,
              });
              setAnalysisRound(1);
            }
          } catch {
            // No analysis round yet.
          }

          if (next.doc) {
            try {
              const existingDoc = await phaseApi.getPhaseDoc(phaseId, sessionId);
              if (!cancelled) {
                setDoc(existingDoc);
                const first = existingDoc.sections.find(
                  (s) => s.status !== 'approved' && s.status !== 'skipped'
                );
                if (first) setActiveSection(first.number);
              }
            } catch {
              // Document not initialized yet.
            }
          }
        }

        if (!cancelled) setStep(deriveStep(next));
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phaseId, sessionId]);

  const handleStart = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await phaseApi.startPhase(phaseId, sessionId);
      setImported(result.imported);
      await refreshStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [phaseId, sessionId, refreshStatus]);

  const handleAnalyze = useCallback(async () => {
    setBusy(true);
    setError(null);
    setWithheldReason(null);
    setStep('analyzing');
    try {
      // Starting is idempotent, and running it here means a phase can be analyzed
      // straight from the list without a separate "start" click.
      if (!status?.exists) await phaseApi.startPhase(phaseId, sessionId);

      const result = await phaseApi.analyzePhase(phaseId, sessionId);
      setAnalysis(result);
      setAnalysisRound((r) => r + 1);
      setCycleCount(result.cycleCount);
      setMaxCycles(result.maxCycles);
      setQuestionsExhausted(result.questionsExhausted);
      setWithheldReason(result.questionsWithheldReason ?? null);
      setStep(result.questions.length > 0 ? 'understanding' : 'approval');
      await refreshStatus();
    } catch (err: any) {
      setError(err.message);
      setStep('import');
    } finally {
      setBusy(false);
    }
  }, [phaseId, sessionId, status?.exists, refreshStatus]);

  const handleApproved = useCallback(async () => {
    setError(null);
    try {
      const initialized = await phaseApi.initPhaseSections(phaseId, sessionId);
      setDoc(initialized);
      const first = initialized.sections.find(
        (s) => s.status !== 'approved' && s.status !== 'skipped'
      );
      if (first) setActiveSection(first.number);
      setStep('sections');
      await refreshStatus();
    } catch (err: any) {
      setError(err.message);
    }
  }, [phaseId, sessionId, refreshStatus]);

  const handleGenerateSection = useCallback(
    async (sectionNumber: number, feedback?: string) => {
      setGeneratingSection(sectionNumber);
      setError(null);
      try {
        const result = await phaseApi.generatePhaseSection(
          phaseId,
          sessionId,
          sectionNumber,
          feedback
        );
        setDoc(result.doc);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setGeneratingSection(null);
      }
    },
    [phaseId, sessionId]
  );

  const advanceSection = useCallback((updated: PhaseDoc, from: number) => {
    setDoc(updated);
    const next = updated.sections.find(
      (s) => s.number > from && s.status !== 'approved' && s.status !== 'skipped'
    );
    if (next) setActiveSection(next.number);
  }, []);

  const handleApproveSection = useCallback(
    async (sectionNumber: number, content?: string) => {
      setError(null);
      try {
        advanceSection(
          await phaseApi.approvePhaseSection(phaseId, sessionId, sectionNumber, content),
          sectionNumber
        );
      } catch (err: any) {
        setError(err.message);
      }
    },
    [phaseId, sessionId, advanceSection]
  );

  const handleSkipSection = useCallback(
    async (sectionNumber: number) => {
      setError(null);
      try {
        advanceSection(
          await phaseApi.skipPhaseSection(phaseId, sessionId, sectionNumber),
          sectionNumber
        );
      } catch (err: any) {
        setError(err.message);
      }
    },
    [phaseId, sessionId, advanceSection]
  );

  const handleRevertSection = useCallback(
    async (sectionNumber: number, version: number) => {
      setError(null);
      try {
        setDoc(await phaseApi.revertPhaseSection(phaseId, sessionId, sectionNumber, version));
      } catch (err: any) {
        setError(err.message);
      }
    },
    [phaseId, sessionId]
  );

  const diagramApi: DiagramApi = useMemo(
    () => ({
      load: () => phaseApi.getPhaseDiagram(phaseId, sessionId),
      generate: (feedback) => phaseApi.generatePhaseDiagram(phaseId, sessionId, feedback),
      save: (mermaid) => phaseApi.savePhaseDiagram(phaseId, sessionId, mermaid),
      approve: (mermaid) => phaseApi.approvePhaseDiagram(phaseId, sessionId, mermaid),
      skip: () => phaseApi.skipPhaseDiagram(phaseId, sessionId),
    }),
    [phaseId, sessionId]
  );

  const handleOpenExport = useCallback(async () => {
    setError(null);
    try {
      const result = await phaseApi.assemblePhase(phaseId, sessionId);
      setAssembled(result.markdown);
      setDoc(result.doc);
      setStep('export');
    } catch (err: any) {
      setError(err.message);
    }
  }, [phaseId, sessionId]);

  const handleFinalize = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await phaseApi.finalizePhase(phaseId, sessionId);
      setAssembled(result.markdown);
      await refreshStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [phaseId, sessionId, refreshStatus]);

  const handleProceed = useCallback(async () => {
    setProceeding(true);
    setError(null);
    try {
      const result = await phaseApi.proceedToNextPhase(phaseId, sessionId);
      onProceed?.(result.nextPhaseId, result.nextSessionId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProceeding(false);
    }
  }, [phaseId, sessionId, onProceed]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-700 font-medium">Loading the phase...</p>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-center">
        <div>
          <p className="text-red-600 mb-4">{error || 'This phase could not be loaded.'}</p>
          <button onClick={onBack} className="text-accent hover:text-accent-hover text-sm font-medium">
            Go back
          </button>
        </div>
      </div>
    );
  }

  const phase = status.phase;
  const diagramSet = phase.diagramMode === 'set';
  const rendersImages = phase.deliverables.some((d) => d.type === 'images');
  const hasMockups = Boolean(phase.mockups);
  const steps = STEPS.filter((s) => s.key !== 'mockups' || hasMockups);
  const stepIndex = steps.findIndex((s) => s.key === (step === 'understanding' ? 'analyzing' : step));
  const afterDiagram: Step = hasMockups ? 'mockups' : 'export';
  const goAfterDiagram = () => (hasMockups ? setStep('mockups') : handleOpenExport());
  const allSectionsDone =
    doc?.sections.every((s) => s.status === 'approved' || s.status === 'skipped') ?? false;

  return (
    <div className={embedded ? 'min-h-full bg-slate-50' : 'min-h-screen bg-slate-50'}>
      {!embedded && (
      <header className="bg-navy text-white">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={onBack}
              aria-label="Back"
              className="text-slate-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight truncate">
                <span aria-hidden="true" className="mr-2">
                  {phase.icon}
                </span>
                {projectName ?? status.projectName ?? 'Project'} — {phase.shortName}
              </h1>
              <p className="text-sm text-slate-300 mt-0.5">
                {phase.name} · {phase.roleOwner}
              </p>
            </div>
          </div>
          <div className="text-xs text-slate-400 font-mono hidden sm:block">
            {status.doc?.id ?? phase.docIdPrefix} · {sessionId.slice(0, 8)}
          </div>
        </div>
      </header>
      )}

      <div className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 space-y-4">
          {!embedded && <PhaseProgress phases={progress} currentPhaseId={phaseId} onSelectPhase={onSelectPhase} />}

          <div className="flex items-center gap-2 flex-wrap">
            {steps.map((s, i) => {
              const isActive = s.key === step || (step === 'understanding' && s.key === 'analyzing');
              const isDone = i < stepIndex;
              return (
                <div key={s.key} className="flex items-center gap-2">
                  {i > 0 && <div className={`w-8 h-px ${isDone ? 'bg-accent' : 'bg-slate-200'}`} />}
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                      isActive
                        ? 'bg-accent text-white'
                        : isDone
                        ? 'bg-accent/10 text-accent'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {isDone ? '✓' : i + 1}
                  </div>
                  <span
                    className={`text-sm font-medium ${
                      isActive ? 'text-slate-900' : isDone ? 'text-accent' : 'text-slate-400'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            <strong>Error:</strong> {error}
            <button onClick={() => setError(null)} className="ml-3 text-red-500 hover:text-red-700 underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Step 1 — Import */}
        {(step === 'import' || step === 'analyzing') && (
          <PhaseImport
            imported={imported}
            phaseName={phase.name}
            busy={busy}
            onStart={handleStart}
            onAnalyze={handleAnalyze}
            analyzed={analysisRound > 0}
          />
        )}

        {step === 'analyzing' && busy && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
            <div className="inline-block w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-slate-700 font-medium">Analyzing…</p>
            <p className="text-sm text-slate-500 mt-1">
              Reading the previous phase's output and every Second Brain before it.
            </p>
          </div>
        )}

        {/* Step 2 — Understanding */}
        {analysis && !busy && (step === 'understanding' || step === 'questions') && (
          <AgentUnderstanding
            analysis={analysis}
            round={analysisRound}
            onProceedToQuestions={() =>
              setStep(analysis.questions.length > 0 ? 'questions' : 'approval')
            }
          />
        )}

        {/* Step 3 — Q&A */}
        {analysis && analysis.questions.length > 0 && step === 'questions' && !busy && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">
                {cycleCount > 1 ? 'Final follow-up questions' : `${phase.shortName} questions`}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {PHASE_COPY[phase.id]?.questions ?? 'The agent asks everything it needs in one batch.'}
              </p>
            </div>

            <div className="px-6 pt-4">
              <div
                className={`rounded-lg border px-4 py-2.5 text-sm ${
                  questionsExhausted
                    ? 'bg-slate-50 border-slate-200 text-slate-600'
                    : `${theme.tile} ${theme.border} ${theme.text}`
                }`}
              >
                <strong>
                  Question cycle {Math.max(1, cycleCount)} of {maxCycles}.
                </strong>{' '}
                {questionsExhausted
                  ? 'No further cycles remain — anything still unclear is recorded as an assumption for your review.'
                  : 'If the agent is still under 70% confident after these answers, it gets one final cycle.'}
              </div>
            </div>

            <div className="p-6">
              <QuestionPanel
                sessionId={sessionId}
                analysis={analysis}
                phaseId={phaseId}
                onUpdated={(updated) => setAnalysis({ ...updated })}
              />
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <button
                  onClick={() => setStep('approval')}
                  className="px-6 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-medium text-sm transition-colors"
                >
                  Proceed to Approval
                </button>
                <button
                  onClick={handleAnalyze}
                  className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium text-sm transition-colors"
                >
                  {questionsExhausted ? 'Finalize Understanding' : 'Re-analyze with Answers'}
                </button>
              </div>
            </div>
          </div>
        )}

        {analysis && analysis.questions.length === 0 && withheldReason && !busy && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-4">
            <p className="text-sm text-slate-700">
              <strong className="text-slate-900">No further questions.</strong> {withheldReason}
            </p>
          </div>
        )}

        {/* Step 4 — Human approval */}
        {(step === 'approval' ||
          step === 'sections' ||
          step === 'diagram' ||
          step === 'mockups' ||
          step === 'export') && (
          <ApprovalStep
            sessionId={sessionId}
            phaseId={phaseId}
            heading={`Human Approval — ${phase.shortName}`}
            subheading={`My complete understanding of what I am about to ${
              PHASE_COPY[phase.id]?.verb ?? 'produce'
            } — review it before anything is generated`}
            approveLabel={`✓ Approve & Generate ${phase.shortName}`}
            unlockedLabel={`${phase.name} generation and this phase's deliverables are now unlocked.`}
            nextActionLabel={`Generate ${phase.shortName} sections`}
            deliverables={
              <PhaseDeliverables phaseId={phaseId} sessionId={sessionId} approved={Boolean(isApproved)} />
            }
            onApproved={handleApproved}
            onOpenRequirements={handleApproved}
          />
        )}

        {/* Step 5 — Sections */}
        {step === 'sections' && doc && (
          <div className="flex gap-6 items-start">
            <div className="w-72 flex-shrink-0 hidden lg:block">
              <div className="sticky top-6">
                <SectionNavigator
                  sections={doc.sections}
                  activeSection={activeSection}
                  onSelect={setActiveSection}
                />
              </div>
            </div>

            <div className="flex-1 min-w-0 space-y-4">
              {doc.sections.map((section) => (
                <SectionEditor
                  key={section.number}
                  section={section}
                  isActive={section.number === activeSection}
                  isGenerating={generatingSection === section.number}
                  onGenerate={(feedback) => handleGenerateSection(section.number, feedback)}
                  onApprove={(content) => handleApproveSection(section.number, content)}
                  onSkip={() => handleSkipSection(section.number)}
                  onRevert={(version) => handleRevertSection(section.number, version)}
                />
              ))}

              {allSectionsDone && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-center">
                  <h3 className="text-lg font-semibold text-emerald-800 mb-2">
                    All {doc.sections.length} sections complete
                  </h3>
                  <p className="text-sm text-emerald-700 mb-4">
                    {diagramSet
                      ? 'Next, review the diagrams (navigation map, user flows, component hierarchy) — then review the assembled '
                      : 'Next, generate the system diagram — then review the assembled '}
                    {phase.outputFileName} and export it.
                  </p>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <button
                      onClick={() => setStep('diagram')}
                      className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      {diagramSet
                        ? diagramStatus === 'none'
                          ? 'Generate Diagrams'
                          : 'Review Diagrams'
                        : diagramStatus === 'approved'
                        ? 'Review Diagram'
                        : 'Generate Diagram'}
                    </button>
                    {hasMockups && (
                      <button
                        onClick={() => setStep('mockups')}
                        className="px-5 py-2 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        Live UI Mockups
                      </button>
                    )}
                    <button
                      onClick={handleOpenExport}
                      className="px-5 py-2 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-700 rounded-lg text-sm font-medium transition-colors"
                    >
                      Skip to Export
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 6 — System diagram (optional, recommended) */}
        {step === 'diagram' && diagramSet && (
          <DiagramSetStep
            phaseId={phaseId}
            sessionId={sessionId}
            filePrefix={status.doc?.id ?? phase.docIdPrefix}
            onChange={setDiagramStatus}
            footer={
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center justify-between gap-4 flex-wrap">
                <p className="text-sm text-slate-600">
                  {diagramStatus === 'approved'
                    ? `All diagrams decided — the approved ones are embedded in ${phase.outputFileName} as section ${
                        (doc?.sections.length ?? 0) + 1
                      }, with their .mmd source and JPG in diagrams/.`
                    : 'Approve or skip each diagram. Anything still in draft is left out of the package.'}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setStep('sections')}
                    className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 underline"
                  >
                    Back to sections
                  </button>
                  <button
                    onClick={goAfterDiagram}
                    className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {afterDiagram === 'mockups' ? 'Continue to Mockups →' : 'Continue to Export →'}
                  </button>
                </div>
              </div>
            }
          />
        )}

        {step === 'diagram' && !diagramSet && (
          <div className="space-y-4">
            <DiagramStep
              api={diagramApi}
              resetKey={`${phaseId}:${sessionId}`}
              title={`${phase.shortName} Diagram`}
              fileName={`${status.doc?.id ?? phase.docIdPrefix}-diagram`}
              onChange={(next) => setDiagramStatus(next.status)}
              footer={
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center justify-between gap-4 flex-wrap">
                  <p className="text-sm text-slate-600">
                    {diagramStatus === 'approved'
                      ? `Approved — it will be embedded in ${phase.outputFileName} as section ${
                          (doc?.sections.length ?? 0) + 1
                        }.`
                      : diagramStatus === 'skipped'
                      ? 'Skipped — the document will be finalized without a diagram.'
                      : 'Approve or skip the diagram to continue to export.'}
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setStep('sections')}
                      className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 underline"
                    >
                      Back to sections
                    </button>
                    <button
                      onClick={handleOpenExport}
                      className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Continue to Export →
                    </button>
                  </div>
                </div>
              }
            />
          </div>
        )}

        {/* Live UI mockups (design) — one interactive HTML page per screen */}
        {step === 'mockups' && hasMockups && (
          <MockupStudio
            phaseId={phaseId}
            sessionId={sessionId}
            footer={
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center justify-between gap-4 flex-wrap">
                <p className="text-sm text-slate-600">
                  Approved mockups are written to mockups/ in the package and committed with it. Drafts are left out.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setStep('diagram')}
                    className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 underline"
                  >
                    Back to diagrams
                  </button>
                  <button
                    onClick={handleOpenExport}
                    className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Continue to Export →
                  </button>
                </div>
              </div>
            }
          />
        )}

        {/* Export + hand-off */}
        {step === 'export' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">
                    {status.doc?.id ?? phase.docIdPrefix} — {phase.outputFileName}
                  </h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {status.completed
                      ? 'Finalized and written to the project folder.'
                      : 'Finalize to write it to the project folder and unlock the next phase.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={phaseApi.phaseDownloadUrl(phaseId, sessionId)}
                    className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Download .md
                  </a>
                  <button
                    onClick={handleFinalize}
                    disabled={busy}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {busy ? 'Finalizing...' : status.completed ? 'Re-finalize' : 'Finalize'}
                  </button>
                  <button
                    onClick={() => setStep('diagram')}
                    className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 underline"
                  >
                    {diagramSet ? 'Diagrams' : diagramStatus === 'approved' ? 'Edit diagram' : 'Add diagram'}
                  </button>
                  {hasMockups && (
                    <button
                      onClick={() => setStep('mockups')}
                      className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 underline"
                    >
                      Mockups
                    </button>
                  )}
                  <button
                    onClick={() => setStep('sections')}
                    className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 underline"
                  >
                    Back to sections
                  </button>
                </div>
              </div>
              <pre className="p-6 text-xs text-slate-700 whitespace-pre-wrap max-h-[60vh] overflow-y-auto font-mono leading-relaxed">
                {assembled || 'Nothing assembled yet.'}
              </pre>
            </div>

            {rendersImages && (
              <DesignGallery phaseId={phaseId} sessionId={sessionId} finalized={status.completed} />
            )}

            <PhaseDeliverables phaseId={phaseId} sessionId={sessionId} approved={Boolean(isApproved)} />

            <PhaseGitCommit
              phaseId={phaseId}
              sessionId={sessionId}
              projectId={status.projectId}
              finalized={status.completed}
              documentId={status.doc?.id}
              phaseName={phase.name}
            />

            {/* The hand-off is always an explicit human act. */}
            {status.nextPhase?.id === 'development' && onProceed && (
              <div className="bg-indigo-50 rounded-xl border border-indigo-200 shadow-sm p-6 text-center">
                <h3 className="text-base font-semibold text-indigo-900 mb-1">Next: 💻 Development</h3>
                <p className="text-sm text-indigo-700 mb-2 max-w-2xl mx-auto">
                  Opens this project's isolated development workspace. Every phase's documents, Second Brains, user
                  stories, diagrams and live mockups are carried into it and loaded into the coding agent's memory. You
                  then approve the build blueprint, the scaffold, each file and every command.
                </p>
                {!status.completed && (
                  <p className="text-xs text-amber-700 mb-3">
                    This phase is not finalized yet. Unapproved sections and draft mockups will be carried over marked as
                    drafts.
                  </p>
                )}
                <button
                  onClick={() => onProceed('development', sessionId)}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-sm transition-colors"
                >
                  Move to Development →
                </button>
              </div>
            )}

            {status.nextPhase && status.nextPhase.id !== 'development' && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 text-center">
                <h3 className="text-base font-semibold text-slate-800 mb-1">
                  Next: {status.nextPhase.name}
                </h3>
                <p className="text-sm text-slate-500 mb-4">
                  {status.nextPhase.comingSoon
                    ? 'This phase is not available yet.'
                    : `Hands this document, this phase's Second Brain, its confirmed facts and its open items — plus every earlier phase's document — to the ${status.nextPhase.name} agent. Nothing moves until you click.`}
                </p>
                <button
                  onClick={handleProceed}
                  disabled={status.nextPhase.comingSoon || !status.completed || proceeding}
                  title={
                    !status.completed ? 'Finalize this phase first' : undefined
                  }
                  className="px-6 py-3 bg-accent hover:bg-accent-hover disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg font-semibold text-sm transition-colors"
                >
                  {proceeding
                    ? 'Preparing...'
                    : status.nextPhase.comingSoon
                    ? '🔒 Coming soon'
                    : `Proceed to ${status.nextPhase.name} →`}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/** Wording that differs by phase. Anything not listed falls back to neutral copy. */
const PHASE_COPY: Record<string, { questions: string; verb: string }> = {
  architecture: {
    questions: 'Technical questions only — anything the requirement phase already answered is off the table.',
    verb: 'architect',
  },
  design: {
    questions:
      'UX/UI questions only — platform, design system, brand, accessibility, navigation. Screens the requirements already imply are listed in the understanding, not asked about.',
    verb: 'design',
  },
};

/** Where a re-entered phase should pick up. */
function deriveStep(status: PhaseStatusResponse): Step {
  if (!status.exists) return 'import';
  if (status.completed) return 'export';
  if (status.doc) return 'sections';
  if (status.approvalStatus === 'approved') return 'approval';
  if (status.hasSummary) return 'approval';
  if (status.cycleCount > 0) return 'questions';
  return 'import';
}
