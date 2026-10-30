import { useState } from 'react';
import ConnectionsPanel from '../components/ConnectionsPanel';
import GitProviderCards from '../components/GitProviderCards';
import { getWorkspaceSessionId } from '../services/session';

export default function Connections() {
  // Provider connections are workspace-wide, shared by every project.
  const [sessionId] = useState(getWorkspaceSessionId);

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Ticket Providers */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-800">Project Management</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Connect Azure DevOps or Jira to browse tickets and auto-create work items
            </p>
          </div>
          <div className="p-6">
            <ConnectionsPanel sessionId={sessionId} />
          </div>
        </div>

        {/* Git Providers */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-800">Git Providers</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Connect a Git provider to auto-commit requirements and create PRs
            </p>
          </div>
          <div className="p-6">
            <GitProviderCards sessionId={sessionId} />
          </div>
        </div>

        {/* Setup Instructions */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Setup Instructions</h3>
          <div className="grid md:grid-cols-2 gap-6 text-sm text-slate-600">
            <div>
              <h4 className="font-medium text-slate-800 mb-2">Azure DevOps</h4>
              <ol className="list-decimal list-inside space-y-1.5 text-xs">
                <li>Register an app at <a href="https://app.vsaex.visualstudio.com/app/register" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">app.vsaex.visualstudio.com</a></li>
                <li>Scopes: <code className="bg-slate-100 px-1 rounded">vso.work_full</code>, <code className="bg-slate-100 px-1 rounded">vso.project</code>, <code className="bg-slate-100 px-1 rounded">vso.code_full</code></li>
                <li>Callback: <code className="bg-slate-100 px-1 rounded text-xs">http://localhost:3001/api/oauth/azure/callback</code></li>
                <li>Add <code className="bg-slate-100 px-1 rounded">AZURE_CLIENT_ID</code> and <code className="bg-slate-100 px-1 rounded">AZURE_CLIENT_SECRET</code> to .env</li>
              </ol>
            </div>
            <div>
              <h4 className="font-medium text-slate-800 mb-2">Jira Cloud</h4>
              <ol className="list-decimal list-inside space-y-1.5 text-xs">
                <li>Create an OAuth 2.0 app at <a href="https://developer.atlassian.com/console/myapps/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">developer.atlassian.com</a></li>
                <li>Scopes: <code className="bg-slate-100 px-1 rounded">read:jira-work</code>, <code className="bg-slate-100 px-1 rounded">write:jira-work</code>, <code className="bg-slate-100 px-1 rounded">read:jira-user</code></li>
                <li>Callback: <code className="bg-slate-100 px-1 rounded text-xs">http://localhost:3001/api/oauth/jira/callback</code></li>
                <li>Add <code className="bg-slate-100 px-1 rounded">JIRA_CLIENT_ID</code> and <code className="bg-slate-100 px-1 rounded">JIRA_CLIENT_SECRET</code> to .env</li>
              </ol>
            </div>
            <div>
              <h4 className="font-medium text-slate-800 mb-2">GitHub</h4>
              <ol className="list-decimal list-inside space-y-1.5 text-xs">
                <li>Go to <a href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">github.com/settings/developers</a></li>
                <li>Create a new OAuth App</li>
                <li>Callback: <code className="bg-slate-100 px-1 rounded text-xs">http://localhost:3001/api/git/oauth/github/callback</code></li>
                <li>Add <code className="bg-slate-100 px-1 rounded">GITHUB_CLIENT_ID</code> and <code className="bg-slate-100 px-1 rounded">GITHUB_CLIENT_SECRET</code> to .env</li>
              </ol>
            </div>
            <div>
              <h4 className="font-medium text-slate-800 mb-2">GitLab</h4>
              <ol className="list-decimal list-inside space-y-1.5 text-xs">
                <li>Go to <a href="https://gitlab.com/-/user_settings/applications" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">gitlab.com User Settings &gt; Applications</a></li>
                <li>Scopes: <code className="bg-slate-100 px-1 rounded">api</code>, <code className="bg-slate-100 px-1 rounded">read_repository</code>, <code className="bg-slate-100 px-1 rounded">write_repository</code></li>
                <li>Callback: <code className="bg-slate-100 px-1 rounded text-xs">http://localhost:3001/api/git/oauth/gitlab/callback</code></li>
                <li>Add <code className="bg-slate-100 px-1 rounded">GITLAB_CLIENT_ID</code> and <code className="bg-slate-100 px-1 rounded">GITLAB_CLIENT_SECRET</code> to .env</li>
              </ol>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
