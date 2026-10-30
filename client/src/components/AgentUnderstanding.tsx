import type { AnalysisResult } from '../types';

interface Props {
  analysis: AnalysisResult;
  round: number;
  onProceedToQuestions: () => void;
}

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-confirmed' : score >= 50 ? 'bg-uncertain' : 'bg-missing';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-sm font-semibold text-slate-700 tabular-nums w-10 text-right">
        {score}%
      </span>
    </div>
  );
}

function InfoCard({
  title,
  status,
  children,
}: {
  title: string;
  status: 'found' | 'partial' | 'missing';
  children: React.ReactNode;
}) {
  const borderColor =
    status === 'found'
      ? 'border-l-confirmed'
      : status === 'partial'
      ? 'border-l-uncertain'
      : 'border-l-missing';

  return (
    <div className={`border border-slate-200 rounded-lg p-4 border-l-4 ${borderColor}`}>
      <h4 className="text-sm font-semibold text-slate-700 mb-2">{title}</h4>
      <div className="text-sm text-slate-600 leading-relaxed">{children}</div>
    </div>
  );
}

function detectStatus(value: string | string[]): 'found' | 'partial' | 'missing' {
  const str = Array.isArray(value) ? value.join(' ') : value;
  if (!str || str === 'NOT FOUND in documents') return 'missing';
  if (str.toLowerCase().includes('unclear') || str.toLowerCase().includes('not specified'))
    return 'partial';
  return 'found';
}

function ListItems({ items, emptyText }: { items: string[]; emptyText?: string }) {
  if (items.length === 0) {
    return <p className="text-slate-400 italic">{emptyText || 'NOT FOUND in documents'}</p>;
  }
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-slate-400 mt-0.5">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AgentUnderstanding({ analysis, round, onProceedToQuestions }: Props) {
  const u = analysis.understanding;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            {round > 1 ? '3. Refined Understanding' : '3. Agent Understanding'}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {round > 1
              ? 'Updated analysis incorporating your answers'
              : "Here's what the agent understood from your documents"}
          </p>
        </div>
        {round > 1 && (
          <span className="text-xs bg-accent/10 text-accent px-2.5 py-1 rounded-full font-medium">
            Round {round}
          </span>
        )}
      </div>

      <div className="p-6 space-y-5">
        {/* Confidence */}
        <div>
          <p className="text-sm font-medium text-slate-600 mb-2">Overall Confidence</p>
          <ConfidenceBar score={analysis.confidenceScore} />
        </div>

        {/* Grid of understanding sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoCard title="Project Overview" status={detectStatus(u.projectOverview)}>
            <p>{u.projectOverview}</p>
          </InfoCard>

          <InfoCard title="Business Objective" status={detectStatus(u.businessObjective)}>
            <p>{u.businessObjective}</p>
          </InfoCard>

          <InfoCard title="In Scope" status={u.scope.inScope.length > 0 ? 'found' : 'missing'}>
            <ListItems items={u.scope.inScope} />
          </InfoCard>

          <InfoCard title="Out of Scope" status={u.scope.outOfScope.length > 0 ? 'found' : 'partial'}>
            <ListItems items={u.scope.outOfScope} emptyText="Not explicitly defined" />
          </InfoCard>

          <InfoCard title="Unclear Scope" status={u.scope.unclear.length > 0 ? 'partial' : 'found'}>
            <ListItems items={u.scope.unclear} emptyText="No ambiguities found" />
          </InfoCard>

          <InfoCard title="Stakeholders" status={u.stakeholders.length > 0 ? 'found' : 'missing'}>
            <ListItems items={u.stakeholders} />
          </InfoCard>

          <InfoCard title="Timeline" status={detectStatus(u.timeline)}>
            <p>{u.timeline}</p>
          </InfoCard>

          <InfoCard title="Tech Stack" status={detectStatus(u.techStack)}>
            <p>{u.techStack}</p>
          </InfoCard>

          <InfoCard title="Deliverables" status={u.deliverables.length > 0 ? 'found' : 'missing'}>
            <ListItems items={u.deliverables} />
          </InfoCard>

          <InfoCard title="Constraints" status={u.constraints.length > 0 ? 'found' : 'partial'}>
            <ListItems items={u.constraints} emptyText="None mentioned" />
          </InfoCard>

          <InfoCard title="Assumptions" status={u.assumptions.length > 0 ? 'partial' : 'found'}>
            <ListItems items={u.assumptions} emptyText="No assumptions identified" />
          </InfoCard>

          <InfoCard title="Risks" status={u.risks.length > 0 ? 'partial' : 'found'}>
            <ListItems items={u.risks} emptyText="No risks identified" />
          </InfoCard>

          <InfoCard title="Dependencies" status={u.dependencies.length > 0 ? 'partial' : 'found'}>
            <ListItems items={u.dependencies} emptyText="None identified" />
          </InfoCard>
        </div>

        {analysis.questions.length > 0 && (
          <div className="flex justify-end pt-2">
            <button
              onClick={onProceedToQuestions}
              className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium text-sm transition-colors"
            >
              Proceed to Questions ({analysis.questions.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
