import type { PhaseAgentSummary } from '../types';
import AgentCard from './AgentCard';

interface Props {
  agents: PhaseAgentSummary[];
  onOpenAgent: (agent: PhaseAgentSummary) => void;
}

/** The grid of every phase agent in the lifecycle, in delivery order. */
export default function AgentHub({ agents, onOpenAgent }: Props) {
  const totalProjects = agents.reduce((sum, a) => sum + a.totalProjects, 0);

  return (
    <div className="space-y-5">
      <div className="bg-navy text-white rounded-xl px-6 py-5">
        <h1 className="text-xl font-bold tracking-tight">AIDLC — AI Delivery Lifecycle</h1>
        <p className="text-sm text-slate-300 mt-1">
          Select a phase to begin or continue. Each phase is an agent with its own Second Brain;
          work moves forward only when you say so.
        </p>
        {totalProjects > 0 && (
          <p className="text-xs text-slate-400 mt-2">
            {totalProjects} phase engagement{totalProjects === 1 ? '' : 's'} across your projects.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onOpen={() => onOpenAgent(agent)} />
        ))}
      </div>
    </div>
  );
}
