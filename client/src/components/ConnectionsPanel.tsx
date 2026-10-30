import { useState, useEffect, useCallback } from 'react';
import type { TicketProviderConnection } from '../types';
import * as api from '../services/api';

interface Props {
  sessionId: string;
  onConnectionChange?: () => void;
}

const PROVIDERS = [
  {
    id: 'azure-devops' as const,
    name: 'Azure DevOps',
    description: 'Connect to Azure DevOps to browse and create work items',
    color: 'bg-blue-600',
    icon: '◆',
    setupUrl: 'https://app.vsaex.visualstudio.com/app/register',
  },
  {
    id: 'jira' as const,
    name: 'Jira',
    description: 'Connect to Jira Cloud to browse and create issues',
    color: 'bg-indigo-600',
    icon: '▲',
    setupUrl: 'https://developer.atlassian.com/console/myapps/',
  },
];

export default function ConnectionsPanel({ sessionId, onConnectionChange }: Props) {
  const [connections, setConnections] = useState<Partial<TicketProviderConnection>[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [azureOrgUrl, setAzureOrgUrl] = useState('');
  const [showAzureOrgInput, setShowAzureOrgInput] = useState(false);

  const loadConnections = useCallback(async () => {
    try {
      const data = await api.getConnections(sessionId);
      setConnections(data);
    } catch {}
  }, [sessionId]);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === 'oauth-callback') {
        setConnecting(null);
        loadConnections();
        onConnectionChange?.();
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [loadConnections, onConnectionChange]);

  const handleConnect = async (provider: string) => {
    setConnecting(provider);
    try {
      const { url } = await api.getOAuthUrl(sessionId, provider);
      const popup = window.open(url, 'aidlc-oauth', 'width=600,height=700,popup=yes');
      if (!popup) {
        alert('Popup was blocked. Please allow popups for this site.');
        setConnecting(null);
      }
    } catch (err: any) {
      alert(`OAuth error: ${err.message}`);
      setConnecting(null);
    }
  };

  const handleDisconnect = async (provider: string) => {
    try {
      await api.disconnectProvider(sessionId, provider);
      await loadConnections();
      onConnectionChange?.();
    } catch (err: any) {
      alert(`Disconnect error: ${err.message}`);
    }
  };

  const handleTest = async (provider: string) => {
    setTesting(provider);
    try {
      const result = await api.testConnection(sessionId, provider);
      if (result.ok) {
        alert(`Connection successful!\nUser: ${result.user}\nOrganization: ${result.org}`);
        await loadConnections();
      } else {
        alert('Connection test failed. Token may be expired — try reconnecting.');
      }
    } catch (err: any) {
      alert(`Test failed: ${err.message}`);
    } finally {
      setTesting(null);
    }
  };

  const handleSaveAzureOrg = async () => {
    if (!azureOrgUrl.trim()) return;
    try {
      await api.setAzureOrg(sessionId, azureOrgUrl.trim());
      setShowAzureOrgInput(false);
      await loadConnections();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const getConnection = (provider: string) => connections.find((c) => c.provider === provider);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Connections</h2>
          <p className="text-sm text-slate-500">Connect your project management tools to enable ticket integration</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PROVIDERS.map((prov) => {
          const conn = getConnection(prov.id);
          const isConnected = conn?.connected;

          return (
            <div
              key={prov.id}
              className={`border rounded-xl p-5 transition-all ${
                isConnected ? 'border-green-200 bg-green-50/30' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className={`w-10 h-10 ${prov.color} text-white rounded-lg flex items-center justify-center text-lg font-bold`}>
                  {prov.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800">{prov.name}</h3>
                    {isConnected && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{prov.description}</p>
                </div>
              </div>

              {isConnected && (
                <div className="text-xs text-slate-600 space-y-1 mb-4 bg-white/50 rounded-lg p-3">
                  {conn?.userName && <div><span className="text-slate-400">User:</span> {conn.userName}</div>}
                  {conn?.orgName && <div><span className="text-slate-400">Organization:</span> {conn.orgName}</div>}
                  {conn?.organizationUrl && <div><span className="text-slate-400">URL:</span> {conn.organizationUrl}</div>}
                </div>
              )}

              {isConnected && prov.id === 'azure-devops' && !conn?.organizationUrl && (
                <div className="mb-4">
                  {showAzureOrgInput ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={azureOrgUrl}
                        onChange={(e) => setAzureOrgUrl(e.target.value)}
                        placeholder="https://dev.azure.com/your-org"
                        className="flex-1 border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      />
                      <button onClick={handleSaveAzureOrg} className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAzureOrgInput(true)}
                      className="text-sm text-blue-600 hover:text-blue-700 underline"
                    >
                      Set organization URL to enable API access
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                {isConnected ? (
                  <>
                    <button
                      onClick={() => handleTest(prov.id)}
                      disabled={testing === prov.id}
                      className="px-3 py-1.5 text-sm border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      {testing === prov.id ? 'Testing...' : 'Test Connection'}
                    </button>
                    <button
                      onClick={() => handleDisconnect(prov.id)}
                      className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleConnect(prov.id)}
                      disabled={connecting === prov.id}
                      className={`px-4 py-1.5 text-sm text-white rounded-md transition-colors disabled:opacity-50 ${prov.color} hover:opacity-90`}
                    >
                      {connecting === prov.id ? 'Connecting...' : 'Connect'}
                    </button>
                    <a
                      href={prov.setupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-sm text-slate-500 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
                    >
                      Setup Guide
                    </a>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {connections.every((c) => !c.connected) && (
        <div className="text-center py-6 text-sm text-slate-400">
          No platforms connected. Ticket features will be available after connecting a provider above.
        </div>
      )}
    </div>
  );
}
