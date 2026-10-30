import { useState, useEffect, useCallback } from 'react';
import type { Project, ProjectStats } from '../types';
import ProjectStatsCards from '../components/ProjectStats';
import ProjectCard from '../components/ProjectCard';
import ProjectForm from '../components/ProjectForm';
import EmptyState from '../components/EmptyState';
import * as api from '../services/api';

interface Props {
  onOpenProject: (project: Project) => void;
  onNewRequirement: (project: Project) => void;
}

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'on-hold', label: 'On Hold' },
];

export default function Dashboard({ onOpenProject, onNewRequirement }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'lastActivity' | 'name' | 'requirementCount'>('lastActivity');
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [projectsData, statsData] = await Promise.all([
        api.getProjects_all(),
        api.getProjectStats(),
      ]);
      setProjects(projectsData);
      setStats(statsData);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleProjectCreated = (project: Project) => {
    setProjects((prev) => [project, ...prev]);
    setShowForm(false);
    if (stats) {
      setStats({ ...stats, totalProjects: stats.totalProjects + 1 });
    }
    // A new project goes straight to the requirement phase.
    onNewRequirement(project);
  };

  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeletingId(pendingDelete.id);
    setDeleteError(null);
    try {
      await api.deleteProject(pendingDelete.id);
      setProjects((prev) => prev.filter((p) => p.id !== pendingDelete.id));
      setPendingDelete(null);
      // Requirement and approval totals change with the project, so refetch rather
      // than guessing at the new numbers.
      api.getProjectStats().then(setStats).catch(() => {});
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setDeletingId(null);
    }
  }, [pendingDelete]);

  const filtered = projects
    .filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return p.name.toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'requirementCount') return b.requirementCount - a.requirementCount;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });

  const statusCounts: Record<string, number> = { all: projects.length };
  for (const p of projects) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
  const filterCount = (statusFilter !== 'all' ? 1 : 0) + (sortBy !== 'lastActivity' ? 1 : 0);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="inline-block w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Overview section */}
      {stats && (
        <section aria-labelledby="overview-heading" className="space-y-3">
          <h2 id="overview-heading" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Overview
          </h2>
          <ProjectStatsCards stats={stats} />
        </section>
      )}

      <hr className="border-slate-200" />

      {/* Projects section */}
      <section aria-labelledby="projects-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="projects-heading" className="text-xl font-semibold text-slate-800">Projects</h2>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap shadow-sm"
          >
            <span className="text-base leading-none">+</span> New Project
          </button>
        </div>

        {/* Search + collapsible filters */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
                viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              >
                <circle cx="9" cy="9" r="6" />
                <path d="M14 14l4 4" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by project or client name"
                aria-label="Search projects"
                className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-8 py-2.5 text-sm focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/20"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 text-xs leading-none"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors ${
                showFilters || filterCount > 0
                  ? 'border-accent/50 bg-accent/5 text-accent'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 5h14M6 10h8M9 15h2" />
              </svg>
              Filters
              {filterCount > 0 && (
                <span className="min-w-5 h-5 px-1 rounded-full bg-accent text-white text-xs flex items-center justify-center">
                  {filterCount}
                </span>
              )}
            </button>
          </div>

          {showFilters && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-end gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Status</div>
                <div role="tablist" aria-label="Filter by status" className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 overflow-x-auto">
                  {STATUS_TABS.map((tab) => {
                    const selected = statusFilter === tab.value;
                    return (
                      <button
                        key={tab.value}
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setStatusFilter(tab.value)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                          selected ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        {tab.label}
                        <span className={`ml-1.5 text-xs ${selected ? 'text-accent' : 'text-slate-400'}`}>
                          {statusCounts[tab.value] ?? 0}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Sort by</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  <option value="lastActivity">Last activity</option>
                  <option value="name">Name</option>
                  <option value="requirementCount">Requirements</option>
                </select>
              </label>

              {filterCount > 0 && (
                <button
                  onClick={() => { setStatusFilter('all'); setSortBy('lastActivity'); }}
                  className="md:ml-auto text-sm text-accent hover:underline whitespace-nowrap py-2"
                >
                  Reset filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Project Grid */}
        {filtered.length === 0 ? (
          <EmptyState
            title={projects.length === 0 ? 'No projects yet' : 'No matching projects'}
            description={
              projects.length === 0
                ? 'Create your first project to get started with AIDLC.'
                : 'Try adjusting your search or filter.'
            }
            actionLabel={projects.length === 0 ? 'Create Project' : undefined}
            onAction={projects.length === 0 ? () => setShowForm(true) : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => onOpenProject(project)}
                onNewRequirement={() => onNewRequirement(project)}
                onDelete={() => { setDeleteError(null); setPendingDelete(project); }}
                deleting={deletingId === project.id}
              />
            ))}
          </div>
        )}
      </section>

      {showForm && (
        <ProjectForm
          onCreated={handleProjectCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">Delete project</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                Delete <strong className="text-slate-900">{pendingDelete.name}</strong> and everything
                in it? Its documents, project understanding, requirements, architecture, design, test
                and release artifacts are removed permanently.
              </p>
              <p className="text-xs text-slate-400">This cannot be undone.</p>

              {deleteError && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{deleteError}</div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  disabled={deletingId !== null}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deletingId !== null}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {deletingId ? 'Deleting...' : 'Delete project'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
