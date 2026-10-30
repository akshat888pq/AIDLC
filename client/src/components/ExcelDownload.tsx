import { useCallback, useEffect, useState } from 'react';
import type { EpicStoriesResult } from '../types';
import * as api from '../services/api';

interface Props {
  sessionId: string;
  /** The report can only be generated from a human-approved understanding. */
  approved: boolean;
}

function PriorityPill({ priority }: { priority: string }) {
  const tone =
    priority === 'High'
      ? 'bg-red-100 text-red-700'
      : priority === 'Low'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-amber-100 text-amber-700';
  return <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${tone}`}>{priority}</span>;
}

export default function ExcelDownload({ sessionId, approved }: Props) {
  const [result, setResult] = useState<EpicStoriesResult | null>(null);
  const [fileAvailable, setFileAvailable] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStories, setShowStories] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await api.getExcelReport(sessionId);
        if (cancelled) return;
        setResult(state.result);
        setFileAvailable(state.fileAvailable);
      } catch {
        // No report yet — nothing to show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleGenerate = useCallback(
    async (regenerate: boolean) => {
      setGenerating(true);
      setError(null);
      try {
        const generated = await api.generateExcelReport(sessionId, regenerate);
        setResult(generated);
        setFileAvailable(true);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setGenerating(false);
      }
    },
    [sessionId]
  );

  if (!approved) {
    return (
      <div className="border border-slate-200 rounded-lg px-4 py-3 bg-slate-50">
        <p className="text-sm text-slate-500">
          Approve the project understanding to unlock the Epic &amp; Stories Excel report.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">Epic &amp; User Stories Report</h4>
          <p className="text-xs text-slate-500 mt-0.5">
            One epic plus 10–12 user stories with Given/When/Then acceptance criteria and
            Fibonacci story points, as a formatted two-sheet Excel workbook.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm mb-3">
          {error}
        </div>
      )}

      {generating && (
        <div className="flex items-center gap-3 text-sm text-slate-600 mb-3">
          <span className="inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Writing the backlog from the project second brain...
        </div>
      )}

      {result && (
        <div className="mb-4 space-y-3">
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">{result.epic.title}</p>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">{result.epic.description}</p>
            <div className="flex flex-wrap gap-4 mt-2.5 text-xs text-slate-500">
              <span>
                <strong className="text-slate-700">{result.stories.length}</strong> stories
              </span>
              <span>
                <strong className="text-slate-700">{result.totalStoryPoints}</strong> story points
              </span>
              <span>Generated {new Date(result.generatedAt).toLocaleString()}</span>
            </div>
          </div>

          <button
            onClick={() => setShowStories((v) => !v)}
            className="text-xs text-accent hover:underline font-medium"
          >
            {showStories ? 'Hide' : 'Preview'} the {result.stories.length} user stories
          </button>

          {showStories && (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {result.stories.map((story) => (
                <li key={story.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-semibold text-slate-500">
                      {story.id}
                    </span>
                    <span className="text-sm font-medium text-slate-800">{story.title}</span>
                    <PriorityPill priority={story.priority} />
                    <span className="text-[11px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                      {story.storyPoints} pts
                    </span>
                    <span className="text-[11px] text-slate-400">{story.component}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 italic">{story.userStory}</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {story.acceptanceCriteria.map((ac, i) => (
                      <li key={i} className="text-[11px] text-slate-500 leading-relaxed">
                        • {ac}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!result && (
          <button
            onClick={() => handleGenerate(false)}
            disabled={generating}
            className="px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg font-semibold text-sm transition-colors"
          >
            {generating ? 'Generating...' : 'Generate Epic & Stories Excel'}
          </button>
        )}

        {result && fileAvailable && (
          <a
            href={api.getExcelReportDownloadUrl(sessionId)}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
              />
            </svg>
            Download Epic &amp; Stories Excel
          </a>
        )}

        {result && (
          <button
            onClick={() => handleGenerate(true)}
            disabled={generating}
            className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-800 underline disabled:opacity-50"
          >
            {generating ? 'Regenerating...' : 'Regenerate'}
          </button>
        )}
      </div>
    </div>
  );
}
