import { useState, useCallback, useEffect } from 'react';
import type { RequirementDoc } from '../types';
import SectionEditor from '../components/SectionEditor';
import SectionNavigator from '../components/SectionNavigator';
import RequirementPreview from '../components/RequirementPreview';
import RequirementExport from '../components/RequirementExport';
import * as api from '../services/api';

interface Props {
  sessionId: string;
  projectId?: string;
  requirementId?: string;
  onBack: () => void;
  onGenerateArchitecture?: (reqId: string) => void;
}

type View = 'editor' | 'preview' | 'export';

export default function RequirementBuilder({ sessionId, projectId, requirementId, onBack, onGenerateArchitecture }: Props) {
  const [doc, setDoc] = useState<RequirementDoc | null>(null);
  const [activeSection, setActiveSection] = useState(1);
  const [generatingSection, setGeneratingSection] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('editor');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        let result: RequirementDoc;
        if (requirementId) {
          result = await api.getRequirement(sessionId, requirementId);
        } else {
          result = await api.initRequirement(sessionId);
        }
        if (!cancelled) {
          setDoc(result);
          const first = result.sections.find((s) => s.status !== 'approved' && s.status !== 'skipped');
          if (first) setActiveSection(first.number);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [sessionId, requirementId]);

  const handleGenerate = useCallback(
    async (sectionNumber: number, feedback?: string) => {
      if (!doc) return;
      setGeneratingSection(sectionNumber);
      setError(null);
      try {
        const result = await api.generateSection(sessionId, doc.id, sectionNumber, feedback);
        const updated = await api.getRequirement(sessionId, doc.id);
        setDoc(updated);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setGeneratingSection(null);
      }
    },
    [sessionId, doc],
  );

  const handleApprove = useCallback(
    async (sectionNumber: number, content?: string) => {
      if (!doc) return;
      setError(null);
      try {
        const updated = await api.approveSection(sessionId, doc.id, sectionNumber, content);
        setDoc(updated);
        const next = updated.sections.find(
          (s) => s.number > sectionNumber && s.status !== 'approved' && s.status !== 'skipped',
        );
        if (next) setActiveSection(next.number);
      } catch (err: any) {
        setError(err.message);
      }
    },
    [sessionId, doc],
  );

  const handleSkip = useCallback(
    async (sectionNumber: number) => {
      if (!doc) return;
      setError(null);
      try {
        const updated = await api.skipSectionApi(sessionId, doc.id, sectionNumber);
        setDoc(updated);
        const next = updated.sections.find(
          (s) => s.number > sectionNumber && s.status !== 'approved' && s.status !== 'skipped',
        );
        if (next) setActiveSection(next.number);
      } catch (err: any) {
        setError(err.message);
      }
    },
    [sessionId, doc],
  );

  const handleRevert = useCallback(
    async (sectionNumber: number, version: number) => {
      if (!doc) return;
      setError(null);
      try {
        const updated = await api.revertSection(sessionId, doc.id, sectionNumber, version);
        setDoc(updated);
      } catch (err: any) {
        setError(err.message);
      }
    },
    [sessionId, doc],
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

  const allDone = doc?.sections.every((s) => s.status === 'approved' || s.status === 'skipped');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-700 font-medium">Initializing requirement document...</p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || 'Failed to initialize requirement document.'}</p>
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
              <h1 className="text-lg font-bold text-slate-800">{doc.id}: Requirements</h1>
              <p className="text-xs text-slate-500">{doc.projectName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View switcher */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setView('editor')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  view === 'editor' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Editor
              </button>
              <button
                onClick={() => setView('preview')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  view === 'preview' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Preview
              </button>
              <button
                onClick={() => setView('export')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  view === 'export' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Export
              </button>
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

      {/* Editor View */}
      {view === 'editor' && (
        <div className="max-w-7xl mx-auto px-6 py-6 flex gap-6">
          {/* Left sidebar */}
          <div className="w-72 flex-shrink-0">
            <div className="sticky top-20">
              <SectionNavigator
                sections={doc.sections}
                activeSection={activeSection}
                onSelect={setActiveSection}
              />
            </div>
          </div>

          {/* Main editor area */}
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
                  Review the full document in Preview, then export.
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => setView('preview')}
                    className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
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

      {/* Preview View */}
      {view === 'preview' && (
        <div className="max-w-4xl mx-auto px-6 py-6">
          <RequirementPreview sessionId={sessionId} reqId={doc.id} />
        </div>
      )}

      {/* Export View */}
      {view === 'export' && (
        <div className="max-w-2xl mx-auto px-6 py-6">
          <RequirementExport
            sessionId={sessionId}
            reqId={doc.id}
            projectId={projectId}
            onFinalized={() => {
              setDoc((prev) => prev ? { ...prev, status: 'finalized' } : prev);
            }}
            onGenerateArchitecture={
              onGenerateArchitecture && doc
                ? () => onGenerateArchitecture(doc.id)
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
