import { useCallback, useEffect, useState } from 'react';
import type { PhaseAgentSummary, PhaseProjectEntry } from '../types';
import AgentHub from '../components/AgentHub';
import PhaseProjectList from '../components/PhaseProjectList';
import * as phaseApi from '../services/phaseApi';

interface Props {
  /** Open a project in a phase. The shell decides which screen that phase uses. */
  onOpenPhaseProject: (phaseId: string, project: PhaseProjectEntry) => void;
  onOpenAllProjects: () => void;
}

/**
 * The home screen: every phase agent, and the projects sitting in each.
 *
 * Two levels, no routing — the hub, then one agent's project list.
 */
export default function AgentDashboard({ onOpenPhaseProject, onOpenAllProjects }: Props) {
  const [agents, setAgents] = useState<PhaseAgentSummary[]>([]);
  const [selected, setSelected] = useState<PhaseAgentSummary | null>(null);
  const [projects, setProjects] = useState<PhaseProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await phaseApi.getAgents();
        if (!cancelled) setAgents(list);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openAgent = useCallback(async (agent: PhaseAgentSummary) => {
    setSelected(agent);
    setLoadingProjects(true);
    setError(null);
    try {
      setProjects(await phaseApi.getPhaseProjects(agent.id));
    } catch (err: any) {
      setError(err.message);
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="inline-block w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)} className="ml-3 underline text-red-500">
            Dismiss
          </button>
        </div>
      )}

      {!selected ? (
        <AgentHub agents={agents} onOpenAgent={openAgent} />
      ) : loadingProjects ? (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="inline-block w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <PhaseProjectList
          agent={selected}
          projects={projects}
          onBack={() => setSelected(null)}
          onOpenAllProjects={onOpenAllProjects}
          onContinue={(project) => onOpenPhaseProject(selected.id, project)}
        />
      )}
    </div>
  );
}
