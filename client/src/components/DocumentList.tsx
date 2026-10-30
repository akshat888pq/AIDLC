import type { UploadedFile } from '../types';

interface Props {
  files: UploadedFile[];
}

const STATUS_STYLES = {
  uploading: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Uploading' },
  parsing: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Parsing' },
  ready: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500', label: 'Ready' },
  error: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'Error' },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return '📄';
    case 'docx': return '📝';
    case 'xlsx': case 'xls': case 'csv': return '📊';
    case 'md': case 'markdown': return '📋';
    default: return '📃';
  }
}

export default function DocumentList({ files }: Props) {
  if (files.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
        Uploaded Documents ({files.length})
      </p>
      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
        {files.map((file) => {
          const s = STATUS_STYLES[file.status];
          return (
            <div key={file.id} className="flex items-center gap-3 px-4 py-3 bg-white">
              <span className="text-lg">{fileIcon(file.originalName)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{file.originalName}</p>
                <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                {s.label}
              </span>
              {file.error && (
                <p className="text-xs text-red-500 mt-0.5">{file.error}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
