import { useRef, useCallback } from 'react';
import type { AnalysisResult } from '../types';
import * as api from '../services/api';

interface Props {
  sessionId: string;
  analysis: AnalysisResult;
  onImported: (analysis: AnalysisResult) => void;
}

export default function QuestionDocument({ sessionId, analysis, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const text = await file.text();
      try {
        const result = await api.importAnswers(sessionId, text);
        for (const q of result.questions) {
          const existing = analysis.questions.find((eq) => eq.id === q.id);
          if (existing) {
            existing.answer = q.answer;
            existing.status = q.status;
          }
        }
        onImported({ ...analysis });
        alert(`Imported ${result.importedCount} answers successfully.`);
      } catch (err: any) {
        alert(`Import failed: ${err.message}`);
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [sessionId, analysis, onImported]
  );

  return (
    <div className="flex items-center gap-2">
      <a
        href={api.getExportQuestionsUrl(sessionId)}
        className="px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/5 border border-accent/30 rounded-md transition-colors"
      >
        Download Questions
      </a>
      <button
        onClick={() => fileInputRef.current?.click()}
        className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 border border-slate-300 rounded-md transition-colors"
      >
        Upload Answers
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,.markdown"
        className="hidden"
        onChange={handleImport}
      />
    </div>
  );
}
