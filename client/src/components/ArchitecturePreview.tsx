import { useState, useEffect } from 'react';
import * as api from '../services/api';

interface Props {
  projectId: string;
  archId: string;
}

export default function ArchitecturePreview({ projectId, archId }: Props) {
  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await api.assembleArchitecture(projectId, archId);
        if (!cancelled) setMarkdown(result.markdown);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId, archId]);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm text-slate-500">Assembling architecture document...</p>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-600 text-sm p-4">Error: {error}</div>;
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Full Architecture Document</h3>
        <div className="flex items-center gap-2">
          <a
            href={api.getArchitectureDownloadUrl(projectId, archId)}
            className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded text-xs font-medium transition-colors"
          >
            Download .md
          </a>
        </div>
      </div>
      <div className="p-6 max-h-[70vh] overflow-y-auto">
        <pre className="whitespace-pre-wrap font-mono text-xs text-slate-700 leading-relaxed">
          {markdown}
        </pre>
      </div>
    </div>
  );
}
