import { useState, useEffect, useCallback } from 'react';
import type { Ticket, TicketProject } from '../types';
import * as api from '../services/api';
import TicketCard from './TicketCard';

interface Props {
  sessionId: string;
  provider: string;
  onWorkOnTicket: (ticket: Ticket) => void;
}

export default function TicketBrowser({ sessionId, provider, onWorkOnTicket }: Props) {
  const [projects, setProjects] = useState<TicketProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const projs = await api.getProjects(sessionId, provider);
        setProjects(projs);
      } catch (err: any) {
        setError(err.message);
      }
    }
    load();
  }, [sessionId, provider]);

  const loadTickets = useCallback(async (projectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const filters: Record<string, string> = {};
      if (filterType) filters.type = filterType;
      if (filterStatus) filters.status = filterStatus;
      const data = await api.getTickets(sessionId, provider, projectId, filters);
      setTickets(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, provider, filterType, filterStatus]);

  useEffect(() => {
    if (selectedProject) loadTickets(selectedProject);
  }, [selectedProject, loadTickets]);

  const handleSearch = async () => {
    if (!searchQuery.trim() || !selectedProject) return;
    setSearching(true);
    setError(null);
    try {
      const results = await api.searchTickets(sessionId, provider, selectedProject, searchQuery.trim());
      setTickets(results);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    if (selectedProject) loadTickets(selectedProject);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          {provider === 'azure-devops' ? 'Azure DevOps' : 'Jira'} Tickets
        </span>
      </div>

      {/* Project selector */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 min-w-[200px]"
        >
          <option value="">Select a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.key || p.id}>{p.name}{p.key ? ` (${p.key})` : ''}</option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <option value="">All types</option>
          <option value="epic">Epic</option>
          <option value="feature">Feature</option>
          <option value="story">Story</option>
          <option value="task">Task</option>
          <option value="bug">Bug</option>
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <option value="">All statuses</option>
          <option value="To Do">To Do</option>
          <option value="In Progress">In Progress</option>
          <option value="Done">Done</option>
          <option value="New">New</option>
          <option value="Active">Active</option>
          <option value="Closed">Closed</option>
        </select>
      </div>

      {/* Search */}
      {selectedProject && (
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search tickets by title or description..."
            className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="px-4 py-2 bg-accent text-white rounded-md text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-md transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Ticket list */}
      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500 mt-2">Loading tickets...</p>
        </div>
      ) : !selectedProject ? (
        <div className="text-center py-12 text-sm text-slate-400">
          Select a project above to browse tickets
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-12 text-sm text-slate-400">
          No tickets found{searchQuery ? ` matching "${searchQuery}"` : ''}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-slate-400">{tickets.length} ticket{tickets.length !== 1 ? 's' : ''}</div>
          {tickets.map((t) => (
            <TicketCard key={t.id} ticket={t} onWorkOn={onWorkOnTicket} />
          ))}
        </div>
      )}
    </div>
  );
}
