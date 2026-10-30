import { useState, useEffect, useCallback } from 'react';
import type { GitProviderConnection } from '../types';
import * as api from '../services/api';

interface Props {
  sessionId: string;
  onConnectionChange?: () => void;
}

const GIT_PROVIDERS = [
  {
    id: 'github' as const,
    name: 'GitHub',
    description: 'Connect to GitHub to commit requirements and create PRs',
    color: 'bg-gray-800',
    icon: 'GH',
  },
  {
    id: 'gitlab' as const,
    name: 'GitLab',
    description: 'Connect to GitLab for repository integration',
    color: 'bg-orange-600',
    icon: 'GL',
  },
  {
    id: 'azure-repos' as const,
    name: 'Azure Repos',
    description: 'Uses your Azure DevOps connection for Git repos',
    color: 'bg-blue-600',
    icon: 'AR',
  },
];

export default function GitProviderCards({ sessionId, onConnectionChange }: Props) {
  const [connections, setConnections] = useState<Partial<GitProviderConnection>[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    try {
      const data = await api.getGitConnections(sessionId);
      setConnections(data);
    } catch {}
  }, [sessionId]);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === 'git-oauth-callback') {
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
      const result = await api.getGitOAuthUrl(sessionId, provider);
      if (result.autoConnected) {
        await loadConnections();
        onConnectionChange?.();
        setConnecting(null);
        return;
      }
      if (!result.url) { setConnecting(null); return; }
      const popup = window.open(result.url, 'aidlc-git-oauth', 'width=600,height=700,popup=yes');
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
      await api.disconnectGitProvider(sessionId, provider);
      await loadConnections();
      onConnectionChange?.();
    } catch (err: any) {
      alert(`Disconnect error: ${err.message}`);
    }
  };

  const handleTest = async (provider: string) => {
    setTesting(provider);
    try {
      const result = await api.testGitConnection(sessionId, provider);
      alert(result.ok
        ? `Connected! User: ${result.user}, Org: ${result.org}`
        : 'Connection test failed — try reconnecting.');
      await loadConnections();
    } catch (err: any) {
      alert(`Test failed: ${err.message}`);
    } finally {
      setTesting(null);
    }
  };

  const getConnection = (provider: string) => connections.find((c) => c.provider === provider);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {GIT_PROVIDERS.map((prov) => {
        const conn = getConnection(prov.id);
        const isConnected = conn?.connected;

        return (
          <div
            key={prov.id}
            className={`border rounded-xl p-4 transition-all ${
              isConnected ? 'border-green-200 bg-green-50/30' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className={`w-9 h-9 ${prov.color} text-white rounded-lg flex items-center justify-center text-xs font-bold`}>
                {prov.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-800 text-sm">{prov.name}</h3>
                  {isConnected && (
                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                      Connected
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">{prov.description}</p>
              </div>
            </div>

            {isConnected && conn?.userName && (
              <div className="text-xs text-slate-600 mb-3 bg-white/50 rounded px-2 py-1.5">
                <span className="text-slate-400">User:</span> {conn.userName}
              </div>
            )}

            <div className="flex gap-2">
              {isConnected ? (
                <>
                  <button
                    onClick={() => handleTest(prov.id)}
                    disabled={testing === prov.id}
                    className="px-2.5 py-1 text-xs border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50"
                  >
                    {testing === prov.id ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    onClick={() => handleDisconnect(prov.id)}
                    className="px-2.5 py-1 text-xs text-red-600 border border-red-200 rounded-md hover:bg-red-50"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleConnect(prov.id)}
                  disabled={connecting === prov.id}
                  className={`px-3 py-1 text-xs text-white rounded-md transition-colors disabled:opacity-50 ${prov.color} hover:opacity-90`}
                >
                  {connecting === prov.id ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
