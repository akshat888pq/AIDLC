import { useState, useCallback, useEffect } from 'react';
import type { AnalysisResult, TicketHierarchyNode, TicketCreationSummary as Summary, TicketProject } from '../types';
import * as api from '../services/api';
import HierarchyPreview from './HierarchyPreview';
import TicketCreationSummary from './TicketCreationSummary';

interface Props {
  /** The project's session — the hierarchy is generated from its Second Brain. */
  sessionId: string;
  /** Workspace session holding the ticket provider connection. */
  workspaceSessionId: string;
  analysis: AnalysisResult;
}

type WorkflowStep = 'setup' | 'generating' | 'preview' | 'creating' | 'done';

export default function TicketWorkflow({ sessionId, workspaceSessionId, analysis }: Props) {
  const [step, setStep] = useState<WorkflowStep>('setup');
  const [provider, setProvider] = useState<string>('');
  const [projects, setProjects] = useState<TicketProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [hierarchy, setHierarchy] = useState<TicketHierarchyNode[]>([]);
  const [reasoning, setReasoning] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  useEffect(() => {
    async function checkConnections() {
      try {
        const connections = await api.getConnections(workspaceSessionId);
        const connected = connections.filter((c) => c.connected).map((c) => c.provider!);
        setConnectedProviders(connected);
        if (connected.length === 1) setProvider(connected[0]);
      } catch {}
    }
    checkConnections();
  }, [workspaceSessionId]);

  useEffect(() => {
    if (!provider) { setProjects([]); setProjectId(''); return; }
    async function loadProjects() {
      try {
        const projs = await api.getProjects(workspaceSessionId, provider);
        setProjects(projs);
      } catch (err: any) {
        setError(err.message);
      }
    }
    loadProjects();
  }, [workspaceSessionId, provider]);

  const handleGenerate = useCallback(async () => {
    if (!projectId || !provider) return;
    setStep('generating');
    setError(null);
    setDuplicateWarning(null);
    try {
      const result = await api.generateHierarchy(sessionId, projectId);
      setReasoning(result.reasoning);
      setHierarchy(result.hierarchy);

      // Check for duplicates
      const titles: string[] = [];
      function collectTitles(nodes: TicketHierarchyNode[]) {
        for (const n of nodes) {
          titles.push(n.ticket.title);
          collectTitles(n.children);
        }
      }
      collectTitles(result.hierarchy);

      try {
        const dupResult = await api.checkDuplicates(workspaceSessionId, provider, projectId, titles);
        if (dupResult.duplicates && dupResult.duplicates.length > 0) {
          const highSimilarity = dupResult.duplicates.filter((d: any) => d.similarity > 80);
          const medSimilarity = dupResult.duplicates.filter((d: any) => d.similarity >= 50 && d.similarity <= 80);
          let warning = '';
          if (highSimilarity.length > 0) {
            warning += `Likely duplicates found:\n${highSimilarity.map((d: any) => `- "${d.newTitle}" is very similar to ${d.existingKey}: "${d.existingTitle}" (${d.similarity}% match)`).join('\n')}`;
          }
          if (medSimilarity.length > 0) {
            warning += `${warning ? '\n\n' : ''}Similar tickets worth reviewing:\n${medSimilarity.map((d: any) => `- "${d.newTitle}" ~ ${d.existingKey}: "${d.existingTitle}" (${d.similarity}%)`).join('\n')}`;
          }
          if (warning) setDuplicateWarning(warning);
        }
      } catch {}

      setStep('preview');
    } catch (err: any) {
      setError(err.message);
      setStep('setup');
    }
  }, [sessionId, workspaceSessionId, provider, projectId]);

  const handleConfirmCreate = useCallback(async (finalHierarchy: TicketHierarchyNode[]) => {
    setStep('creating');
    setError(null);
    try {
      const result = await api.createTickets(workspaceSessionId, provider, finalHierarchy);
      setSummary(result);
      setStep('done');
    } catch (err: any) {
      setError(err.message);
      setStep('preview');
    }
  }, [workspaceSessionId, provider]);

  if (connectedProviders.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-slate-400">
        Connect a project management tool (Azure DevOps or Jira) in the Connections tab to create tickets from your requirements.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-500 hover:text-red-700">Dismiss</button>
        </div>
      )}

      {duplicateWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm font-medium text-amber-800 mb-1">Potential Duplicates Detected</p>
          <pre className="text-xs text-amber-700 whitespace-pre-wrap">{duplicateWarning}</pre>
          <p className="text-xs text-amber-600 mt-2">You can still proceed — review the hierarchy below and confirm.</p>
        </div>
      )}

      {step === 'setup' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            The agent will analyze your requirements and create a ticket hierarchy in your project management tool.
          </p>

          <div className="flex gap-3 flex-wrap">
            {connectedProviders.length > 1 && (
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                <option value="">Select provider...</option>
                {connectedProviders.map((p) => (
                  <option key={p} value={p}>{p === 'azure-devops' ? 'Azure DevOps' : 'Jira'}</option>
                ))}
              </select>
            )}

            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 min-w-[200px]"
              disabled={!provider}
            >
              <option value="">Select project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.key || p.id}>{p.name}{p.key ? ` (${p.key})` : ''}</option>
              ))}
            </select>

            <button
              onClick={handleGenerate}
              disabled={!projectId || !provider}
              className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md text-sm font-medium disabled:opacity-50 transition-colors"
            >
              Generate Ticket Hierarchy
            </button>
          </div>
        </div>
      )}

      {step === 'generating' && (
        <div className="text-center py-12">
          <div className="inline-block w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-700 font-medium">Generating ticket hierarchy...</p>
          <p className="text-sm text-slate-500 mt-1">The AI agent is deciding the best structure for your requirements</p>
        </div>
      )}

      {step === 'preview' && (
        <HierarchyPreview
          reasoning={reasoning}
          hierarchy={hierarchy}
          onConfirm={handleConfirmCreate}
          onCancel={() => { setStep('setup'); setDuplicateWarning(null); }}
          creating={false}
        />
      )}

      {step === 'creating' && (
        <HierarchyPreview
          reasoning={reasoning}
          hierarchy={hierarchy}
          onConfirm={() => {}}
          onCancel={() => {}}
          creating={true}
        />
      )}

      {step === 'done' && summary && (
        <TicketCreationSummary summary={summary} onClose={() => { setStep('setup'); setSummary(null); setDuplicateWarning(null); }} />
      )}
    </div>
  );
}
