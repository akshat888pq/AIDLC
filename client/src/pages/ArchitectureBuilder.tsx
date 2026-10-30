import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ArchitectureDoc, DiagramStatus } from '../types';
import SectionEditor from '../components/SectionEditor';
import SectionNavigator from '../components/SectionNavigator';
import ArchitecturePreview from '../components/ArchitecturePreview';
import ArchitectureExport from '../components/ArchitectureExport';
import DiagramStep from '../components/DiagramStep';
import type { DiagramApi } from '../components/DiagramStep';
import * as api from '../services/api';

interface Props {
  projectId: string;
  sessionId: string;
  requirementId: string;
  architectureId?: string;
  onBack: () => void;
  onGenerateDesign?: (reqId: string, archId: string) => void;
}

type View = 'editor' | 'diagram' | 'preview' | 'export';

const VIEWS: { key: View; label: string }[] = [
  { key: 'editor', label: 'Editor' },
  { key: 'diagram', label: 'Diagram' },
  { key: 'preview', label: 'Preview' },
  { key: 'export', label: 'Export' },
];

export default function ArchitectureBuilder({ projectId, sessionId, requirementId, architectureId, onBack, onGenerateDesign }: Props) {
  const [doc, setDoc] = useState<ArchitectureDoc | null>(null);
  const [activeSection, setActiveSection] = useState(1);
  const [generatingSection, setGeneratingSection] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('editor');
  const [loading, setLoading] = useState(true);
  const [reqExpanded, setReqExpanded] = useState(false);
  const [reqMarkdown, setReqMarkdown] = useState<string | null>(null);
  const [diagramStatus, setDiagramStatus] = useState<DiagramStatus>('none');

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        let result: ArchitectureDoc;
        if (architectureId) {
          result = await api.getArchitecture(projectId, architectureId);
        } else {
          result = await api.initArchitecture(projectId, requirementId);
        }
        if (!cancelled) {
          setDoc(result);
          const first = result.sections.find((s) => s.status !== 'approved' && s.status !== 'skipped');
          if (first) setActiveSection(first.number);
        }

        // Read where the diagram stands up front, so the Export tab's nudge is
        // right even if the user never opens the Diagram tab.
        try {
          const diagram = await api.getArchitectureDiagram(projectId, result.id);
          if (!cancelled) setDiagramStatus(diagram.status);
        } catch {
          // A project with no session has no diagram — not an error worth showing.
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [projectId, requirementId, architectureId]);

  const handleGenerate = useCallback(
    async (sectionNumber: number, feedback?: string) => {
      if (!doc) return;
      setGeneratingSection(sectionNumber);
      setError(null);
      try {
        await api.generateArchSection(projectId, doc.id, sectionNumber, feedback);
        const updated = await api.getArchitecture(projectId, doc.id);
        setDoc(updated);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setGeneratingSection(null);
      }
    },
    [projectId, doc],
  );

  const handleApprove = useCallback(
    async (sectionNumber: number, content?: string) => {
      if (!doc) return;
      setError(null);
      try {
        const updated = await api.approveArchSection(projectId, doc.id, sectionNumber, content);
        setDoc(updated);
        const next = updated.sections.find(
          (s) => s.number > sectionNumber && s.status !== 'approved' && s.status !== 'skipped',
        );
        if (next) setActiveSection(next.number);
      } catch (err: any) {
        setError(err.message);
      }
    },
    [projectId, doc],
  );

  const handleSkip = useCallback(
    async (sectionNumber: number) => {
      if (!doc) return;
      setError(null);
      try {
        const updated = await api.skipArchSectionApi(projectId, doc.id, sectionNumber);
        setDoc(updated);
        const next = updated.sections.find(
          (s) => s.number > sectionNumber && s.status !== 'approved' && s.status !== 'skipped',
        );
        if (next) setActiveSection(next.number);
      } catch (err: any) {
        setError(err.message);
      }
    },
    [projectId, doc],
  );

  const handleRevert = useCallback(
    async (sectionNumber: number, version: number) => {
      if (!doc) return;
      setError(null);
      try {
        const updated = await api.revertArchSection(projectId, doc.id, sectionNumber, version);
        setDoc(updated);
      } catch (err: any) {
        setError(err.message);
      }
    },
    [projectId, doc],
  );

  const handleAutoGenerate = useCallback(async () => {
    if (!doc) return;
    for (const section of doc.sections) {
      if (section.status === 'pending') {
        setActiveSection(section.number);
        await handleGenerate(section.number);
      }
    }
  }, [doc, handleGenerate]);

  const loadReqMarkdown = useCallback(async () => {
    if (reqMarkdown) { setReqExpanded(!reqExpanded); return; }
    try {
      const req = await api.getRequirement(sessionId, requirementId);
      const result = await api.assembleRequirement(sessionId, req.id);
      setReqMarkdown(result.markdown);
      setReqExpanded(true);
    } catch {
      setReqMarkdown('Could not load requirement document.');
      setReqExpanded(true);
    }
  }, [sessionId, requirementId, reqMarkdown, reqExpanded]);

  const diagramApi: DiagramApi | null = useMemo(() => {
    if (!doc) return null;
    return {
      load: () => api.getArchitectureDiagram(projectId, doc.id),
      generate: (feedback) => api.generateArchitectureDiagram(projectId, doc.id, feedback),
      save: (mermaid) => api.saveArchitectureDiagram(projectId, doc.id, mermaid),
      approve: (mermaid) => api.approveArchitectureDiagram(projectId, doc.id, mermaid),
      skip: () => api.skipArchitectureDiagram(projectId, doc.id),
    };
  }, [projectId, doc]);

  const allDone = doc?.sections.every((s) => s.status === 'approved' || s.status === 'skipped');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-700 font-medium">Initializing architecture document...</p>
          <p className="text-xs text-slate-400 mt-1">Reading requirement {requirementId}</p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || 'Failed to initialize architecture document.'}</p>
          <button onClick={onBack} className="text-accent hover:text-accent-hover text-sm font-medium">
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
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
              <h1 className="text-lg font-bold text-slate-800">{doc.id}: Architecture</h1>
              <p className="text-xs text-slate-500">
                {doc.projectName} &middot; Source: {doc.requirementId}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    view === v.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {v.label}
                  {v.key === 'diagram' && diagramStatus === 'approved' && (
                    <span className="ml-1 text-emerald-500" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>

            {!allDone && (
              <button
                onClick={handleAutoGenerate}
                disabled={generatingSection !== null}
                className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              >
                Auto-generate All
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            <strong>Error:</strong> {error}
            <button onClick={() => setError(null)} className="ml-3 text-red-500 hover:text-red-700">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Requirement Reference Card */}
      {view === 'editor' && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg overflow-hidden">
            <button
              onClick={loadReqMarkdown}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                  Source Requirement
                </span>
                <span className="font-mono text-sm font-bold text-indigo-600">{requirementId}</span>
              </div>
              <span className="text-xs text-indigo-500">
                {reqExpanded ? 'Collapse' : 'Expand to reference'}
              </span>
            </button>
            {reqExpanded && reqMarkdown && (
              <div className="border-t border-indigo-200 px-4 py-3 max-h-64 overflow-y-auto">
                <pre className="whitespace-pre-wrap font-mono text-xs text-slate-700 leading-relaxed">
                  {reqMarkdown}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Editor View */}
      {view === 'editor' && (
        <div className="max-w-7xl mx-auto px-6 py-6 flex gap-6">
          <div className="w-72 flex-shrink-0">
            <div className="sticky top-20">
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
                onGenerate={(feedback) => handleGenerate(section.number, feedback)}
                onApprove={(content) => handleApprove(section.number, content)}
                onSkip={() => handleSkip(section.number)}
                onRevert={(version) => handleRevert(section.number, version)}
              />
            ))}

            {allDone && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-center">
                <h3 className="text-lg font-semibold text-emerald-800 mb-2">
                  All Sections Complete
                </h3>
                <p className="text-sm text-emerald-600 mb-4">
                  Recommended next: generate the architecture diagram. Then review the full
                  document in Preview and export.
                </p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <button
                    onClick={() => setView('diagram')}
                    className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {diagramStatus === 'approved'
                      ? 'Review Architecture Diagram'
                      : 'Generate Architecture Diagram'}
                  </button>
                  <button
                    onClick={() => setView('preview')}
                    className="px-5 py-2 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    View Full Document
                  </button>
                  <button
                    onClick={() => setView('export')}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Export
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Diagram View */}
      {view === 'diagram' && diagramApi && (
        <div className="max-w-6xl mx-auto px-6 py-6">
          <DiagramStep
            api={diagramApi}
            resetKey={`${projectId}:${doc.id}`}
            title="Architecture Diagram"
            fileName={`${doc.id}-architecture-diagram`}
            onChange={(next) => setDiagramStatus(next.status)}
            footer={
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center justify-between gap-4 flex-wrap">
                <p className="text-sm text-slate-600">
                  {diagramStatus === 'approved'
                    ? 'Approved — embedded in the document as Section 14.'
                    : diagramStatus === 'skipped'
                    ? 'Skipped — the document will be finalized without a diagram.'
                    : 'Approve or skip the diagram before finalizing.'}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setView('preview')}
                    className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 underline"
                  >
                    View full document
                  </button>
                  <button
                    onClick={() => setView('export')}
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

      {/* Preview View */}
      {view === 'preview' && (
        <div className="max-w-4xl mx-auto px-6 py-6">
          <ArchitecturePreview projectId={projectId} archId={doc.id} />
        </div>
      )}

      {/* Export View */}
      {view === 'export' && (
        <div className="max-w-2xl mx-auto px-6 py-6">
          <ArchitectureExport
            projectId={projectId}
            archId={doc.id}
            diagramStatus={diagramStatus}
            onOpenDiagram={() => setView('diagram')}
            onFinalized={() => {
              setDoc((prev) => prev ? { ...prev, status: 'finalized' } : prev);
            }}
            onGenerateDesign={onGenerateDesign ? () => onGenerateDesign(requirementId, doc.id) : undefined}
          />
        </div>
      )}
    </div>
  );
}
