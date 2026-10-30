import { useState, useCallback } from 'react';
import type { AnalysisResult, ClarifyingQuestion } from '../types';
import * as api from '../services/api';
import * as phaseApi from '../services/phaseApi';

interface Props {
  sessionId: string;
  analysis: AnalysisResult;
  onUpdated: (analysis: AnalysisResult) => void;
  /**
   * Which phase these questions belong to. Omitted for the requirement phase,
   * which answers through its own long-standing routes; any other phase routes
   * its answers through the generic phase engine.
   */
  phaseId?: string;
}

const PRIORITY_STYLES = {
  critical: { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700', label: 'Critical' },
  important: { bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700', label: 'Important' },
  'nice-to-have': { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700', label: 'Nice to Have' },
};

const CATEGORY_LABELS: Record<string, string> = {
  scope: 'Scope',
  timeline: 'Timeline',
  technical: 'Technical',
  stakeholder: 'Stakeholder',
  budget: 'Budget',
  risk: 'Risk',
  requirement: 'Requirement',
  other: 'Other',
};

function QuestionCard({
  question,
  onAnswer,
  onSkip,
}: {
  question: ClarifyingQuestion;
  onAnswer: (id: string, answer: string | string[]) => void;
  onSkip: (id: string) => void;
}) {
  const [textValue, setTextValue] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [otherText, setOtherText] = useState('');
  const ps = PRIORITY_STYLES[question.priority];

  const handleSubmit = () => {
    if (question.answerType === 'text') {
      if (!textValue.trim()) return;
      onAnswer(question.id, textValue.trim());
    } else if (question.answerType === 'single-select') {
      const custom = otherText.trim();
      const answer = custom || selectedOptions[0];
      if (!answer) return;
      onAnswer(question.id, answer);
    } else {
      const custom = otherText.trim();
      const combined = custom ? [...selectedOptions, custom] : selectedOptions;
      if (combined.length === 0) return;
      onAnswer(question.id, combined);
    }
  };

  if (question.status === 'answered') {
    return (
      <div className="border border-green-200 bg-green-50/50 rounded-lg p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-700">{question.question}</p>
            <p className="text-sm text-green-700 mt-2">
              <span className="font-medium">Answer:</span>{' '}
              {Array.isArray(question.answer) ? question.answer.join(', ') : question.answer}
            </p>
          </div>
          <span className="text-green-600 text-lg">✓</span>
        </div>
      </div>
    );
  }

  if (question.status === 'skipped') {
    return (
      <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-4 opacity-60">
        <p className="text-sm text-slate-500">{question.question}</p>
        <p className="text-xs text-slate-400 mt-1 italic">Skipped</p>
      </div>
    );
  }

  return (
    <div className={`border ${ps.border} ${ps.bg} rounded-lg p-4`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ps.badge}`}>
              {ps.label}
            </span>
            <span className="text-xs text-slate-400">
              {CATEGORY_LABELS[question.category] || question.category}
            </span>
          </div>
          <p className="text-sm font-medium text-slate-800">{question.question}</p>
          <p className="text-xs text-slate-500 mt-1">{question.context}</p>
        </div>
      </div>

      <div className="mt-3">
        {question.answerType === 'text' && (
          <textarea
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-y min-h-[80px] bg-white"
            placeholder="Type your answer..."
          />
        )}

        {question.answerType === 'single-select' && question.options && (
          <div className="space-y-2">
            {question.options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={question.id}
                  checked={selectedOptions[0] === opt && !otherText.trim()}
                  onChange={() => {
                    setSelectedOptions([opt]);
                    setOtherText('');
                  }}
                  className="w-4 h-4 text-accent"
                />
                <span className="text-sm text-slate-700">{opt}</span>
              </label>
            ))}
            <div className="pt-1">
              <label className="text-xs text-slate-500 mb-1 block">
                None of these fit? Type your own answer:
              </label>
              <input
                type="text"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Custom answer (overrides the selection above)"
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent bg-white"
              />
            </div>
          </div>
        )}

        {question.answerType === 'multi-select' && question.options && (
          <div className="space-y-2">
            {question.options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedOptions.includes(opt)}
                  onChange={(e) => {
                    setSelectedOptions((prev) =>
                      e.target.checked ? [...prev, opt] : prev.filter((o) => o !== opt)
                    );
                  }}
                  className="w-4 h-4 text-accent rounded"
                />
                <span className="text-sm text-slate-700">{opt}</span>
              </label>
            ))}
            <div className="pt-1">
              <label className="text-xs text-slate-500 mb-1 block">
                Add an answer not listed above (optional):
              </label>
              <input
                type="text"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Custom answer (added alongside your selections)"
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent bg-white"
              />
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-3">
          <button
            onClick={handleSubmit}
            className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md text-sm font-medium transition-colors"
          >
            Submit
          </button>
          <button
            onClick={() => onSkip(question.id)}
            className="px-4 py-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md text-sm transition-colors"
          >
            {question.priority === 'critical' ? 'Skip (not recommended)' : 'Skip'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function QuestionPanel({ sessionId, analysis, onUpdated, phaseId }: Props) {
  const questions = analysis.questions;
  const answered = questions.filter((q) => q.status === 'answered').length;
  const total = questions.length;

  const handleAnswer = useCallback(
    async (questionId: string, answer: string | string[]) => {
      try {
        if (phaseId) await phaseApi.answerPhaseQuestion(phaseId, sessionId, questionId, answer);
        else await api.answerQuestion(sessionId, questionId, answer);
        const q = questions.find((q) => q.id === questionId);
        if (q) {
          q.answer = answer;
          q.status = 'answered';
        }
        onUpdated({ ...analysis });
      } catch (err: any) {
        alert(`Failed to submit answer: ${err.message}`);
      }
    },
    [sessionId, analysis, questions, onUpdated, phaseId]
  );

  const handleSkip = useCallback(
    async (questionId: string) => {
      try {
        if (phaseId) await phaseApi.skipPhaseQuestion(phaseId, sessionId, questionId);
        else await api.skipQuestion(sessionId, questionId);
        const q = questions.find((q) => q.id === questionId);
        if (q) q.status = 'skipped';
        onUpdated({ ...analysis });
      } catch (err: any) {
        alert(`Failed to skip: ${err.message}`);
      }
    },
    [sessionId, analysis, questions, onUpdated, phaseId]
  );

  const groups = [
    { priority: 'critical' as const, items: questions.filter((q) => q.priority === 'critical') },
    { priority: 'important' as const, items: questions.filter((q) => q.priority === 'important') },
    { priority: 'nice-to-have' as const, items: questions.filter((q) => q.priority === 'nice-to-have') },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all"
            style={{ width: total > 0 ? `${(answered / total) * 100}%` : '0%' }}
          />
        </div>
        <span className="text-sm text-slate-500 tabular-nums">
          {answered}/{total} answered
        </span>
      </div>

      {groups.map((group) => (
        <div key={group.priority} className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
            {PRIORITY_STYLES[group.priority].label} ({group.items.length})
          </h3>
          {group.items.map((q) => (
            <QuestionCard key={q.id} question={q} onAnswer={handleAnswer} onSkip={handleSkip} />
          ))}
        </div>
      ))}
    </div>
  );
}
