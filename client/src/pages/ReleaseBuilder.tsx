import { useState, useCallback, useEffect } from 'react';
import type { ReleaseDoc } from '../types';
import SectionEditor from '../components/SectionEditor';
import SectionNavigator from '../components/SectionNavigator';
import ReleasePreview from '../components/ReleasePreview';
import ReleaseExport from '../components/ReleaseExport';
import * as api from '../services/api';

interface Props {
  projectId: string;
  sessionId: string;
  requirementId: string;
  architectureId: string;
  designId: string;
  testId: string;
  releaseId?: string;
  onBack: () => void;
  onStartDevelopment?: () => void;
}

type View = 'editor' | 'preview' | 'export';

export default function ReleaseBuilder({
  projectId, sessionId, requirementId, architectureId, designId, testId, releaseId, onBack, onStartDevelopment,
}: Props) {
  const [doc, setDoc] = useState<ReleaseDoc | null>(null);
  const [activeSection, setActiveSection] = useState(1);
  const [generatingSection, setGeneratingSection] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('editor');
  const [loading, setLoading] = useState(true);
  const [refExpanded, setRefExpanded] = useState(false);
  const [refMarkdown, setRefMarkdown] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        let result: ReleaseDoc;
        if (releaseId) {
          result = await api.getRelease(projectId, releaseId);
        } else {
          result = await api.initRelease(projectId, requirementId, architectureId, designId, testId);
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
  }, [projectId, requirementId, architectureId, designId, testId, releaseId]);

  const handleGenerate = useCallback(async (sectionNumber: number, feedback?: string) => {
    if (!doc) return;
    setGeneratingSection(sectionNumber);
    setError(null);
    try {
      await api.generateReleaseSection(projectId, doc.id, sectionNumber, feedback);
      const updated = await api.getRelease(projectId, doc.id);
      setDoc(updated);
    } catch (err: any) { setError(err.message); }
    finally { setGeneratingSection(null); }
  }, [projectId, doc]);

  const handleApprove = useCallback(async (sectionNumber: number, content?: string) => {
    if (!doc) return;
    setError(null);
    try {
      const updated = await api.approveReleaseSection(projectId, doc.id, sectionNumber, content);
      setDoc(updated);
      const next = updated.sections.find((s) => s.number > sectionNumber && s.status !== 'approved' && s.status !== 'skipped');
      if (next) setActiveSection(next.number);
    } catch (err: any) { setError(err.message); }
  }, [projectId, doc]);

  const handleSkip = useCallback(async (sectionNumber: number) => {
    if (!doc) return;
    setError(null);
    try {
      const updated = await api.skipReleaseSectionApi(projectId, doc.id, sectionNumber);
      setDoc(updated);
      const next = updated.sections.find((s) => s.number > sectionNumber && s.status !== 'approved' && s.status !== 'skipped');
      if (next) setActiveSection(next.number);
    } catch (err: any) { setError(err.message); }
  }, [projectId, doc]);

  const handleRevert = useCallback(async (sectionNumber: number, version: number) => {
    if (!doc) return;
    setError(null);
    try {
      const updated = await api.revertReleaseSection(projectId, doc.id, sectionNumber, version);
      setDoc(updated);
    } catch (err: any) { setError(err.message); }
  }, [projectId, doc]);

  const handleAutoGenerate = useCallback(async () => {
    if (!doc) return;
    for (const section of doc.sections) {
      if (section.status === 'pending') {
        setActiveSection(section.number);
        await handleGenerate(section.number);
      }
    }
  }, [doc, handleGenerate]);

  const loadRefMarkdown = useCallback(async () => {
    if (refMarkdown) { setRefExpanded(!refExpanded); return; }
    try {
      const result = await api.assembleTest(projectId, testId);
      setRefMarkdown(result.markdown);
      setRefExpanded(true);
    } catch {
      setRefMarkdown('Could not load test plan document.');
      setRefExpanded(true);
    }
  }, [projectId, testId, refMarkdown, refExpanded]);

  const allDone = doc?.sections.every((s) => s.status === 'approved' || s.status === 'skipped');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-700 font-medium">Initializing release notes document...</p>
          <p className="text-xs text-slate-400 mt-1">Reading all upstream artifacts</p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || 'Failed to initialize release notes.'}</p>
          <button onClick={onBack} className="text-accent hover:text-accent-hover text-sm font-medium">Go back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-bold text-slate-800">{doc.id}: Release Notes</h1>
              <p className="text-xs text-slate-500">{doc.projectName} &middot; Full chain: {doc.requirementId} &rarr; {doc.architectureId} &rarr; {doc.designId} &rarr; {doc.testId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              {(['editor', 'preview', 'export'] as View[]).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${view === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            {!allDone && (
              <button onClick={handleAutoGenerate} disabled={generatingSection !== null} className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                Auto-generate All
              </button>
            )}
            {onStartDevelopment && (
              <button onClick={onStartDevelopment} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-colors">
                💻 Start Development →
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            <strong>Error:</strong> {error}
            <button onClick={() => setError(null)} className="ml-3 text-red-500 hover:text-red-700">Dismiss</button>
          </div>
        </div>
      )}

      {view === 'editor' && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="bg-orange-50 border border-orange-200 rounded-lg overflow-hidden">
            <button onClick={loadRefMarkdown} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Source Test Plan</span>
                <span className="font-mono text-sm font-bold text-orange-600">{testId}</span>
              </div>
              <span className="text-xs text-orange-500">{refExpanded ? 'Collapse' : 'Expand to reference'}</span>
            </button>
            {refExpanded && refMarkdown && (
              <div className="border-t border-orange-200 px-4 py-3 max-h-64 overflow-y-auto">
                <pre className="whitespace-pre-wrap font-mono text-xs text-slate-700 leading-relaxed">{refMarkdown}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'editor' && (
        <div className="max-w-7xl mx-auto px-6 py-6 flex gap-6">
          <div className="w-72 flex-shrink-0">
            <div className="sticky top-20">
              <SectionNavigator sections={doc.sections} activeSection={activeSection} onSelect={setActiveSection} />
            </div>
          </div>
          <div className="flex-1 min-w-0 space-y-4">
            {doc.sections.map((section) => (
              <SectionEditor
                key={section.number} section={section} isActive={section.number === activeSection}
                isGenerating={generatingSection === section.number}
                onGenerate={(feedback) => handleGenerate(section.number, feedback)}
                onApprove={(content) => handleApprove(section.number, content)}
                onSkip={() => handleSkip(section.number)}
                onRevert={(version) => handleRevert(section.number, version)}
              />
            ))}
            {allDone && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-center">
                <h3 className="text-lg font-semibold text-emerald-800 mb-2">All Sections Complete</h3>
                <p className="text-sm text-emerald-600 mb-4">Review the full release notes in Preview, then export.</p>
                <div className="flex items-center justify-center gap-3">
                  <button onClick={() => setView('preview')} className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors">View Full Document</button>
                  <button onClick={() => setView('export')} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors">Export</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'preview' && (
        <div className="max-w-4xl mx-auto px-6 py-6">
          <ReleasePreview projectId={projectId} releaseId={doc.id} />
        </div>
      )}

      {view === 'export' && (
        <div className="max-w-2xl mx-auto px-6 py-6">
          <ReleaseExport
            projectId={projectId} releaseId={doc.id}
            onFinalized={() => setDoc((prev) => prev ? { ...prev, status: 'finalized' } : prev)}
            onStartDevelopment={onStartDevelopment}
          />
        </div>
      )}
    </div>
  );
}
