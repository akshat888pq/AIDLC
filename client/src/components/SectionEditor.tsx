import { useState, useRef, useEffect, useCallback } from 'react';

interface SectionLike {
  number: number;
  title: string;
  status: string;
  content: string;
  versions: { version: number; content: string; generatedAt: string; feedback?: string; status: string; approvedAt?: string }[];
}

interface Props {
  section: SectionLike;
  isActive: boolean;
  isGenerating: boolean;
  onGenerate: (feedback?: string) => void;
  onApprove: (content?: string) => void;
  onSkip: () => void;
  onRevert: (version: number) => void;
}

export default function SectionEditor({
  section,
  isActive,
  isGenerating,
  onGenerate,
  onApprove,
  onSkip,
  onRevert,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(section.content);
  const [feedback, setFeedback] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditContent(section.content);
    setIsEditing(false);
  }, [section.content]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [isEditing]);

  const handleTextareaInput = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, []);

  const handleApprove = () => {
    if (isEditing && editContent !== section.content) {
      onApprove(editContent);
    } else {
      onApprove();
    }
  };

  const handleRegenerate = () => {
    onGenerate(feedback || undefined);
    setFeedback('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleApprove();
    }
  };

  const previousVersion = section.versions.length >= 2
    ? section.versions[section.versions.length - 2]
    : null;

  const statusColors: Record<string, string> = {
    pending: 'bg-slate-100 text-slate-500',
    generating: 'bg-amber-100 text-amber-700',
    draft: 'bg-blue-100 text-blue-700',
    approved: 'bg-emerald-100 text-emerald-700',
    skipped: 'bg-slate-100 text-slate-400',
  };

  if (!isActive && section.status === 'pending') {
    return (
      <div className="border border-slate-200 rounded-lg p-4 opacity-60">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-slate-600">
            {section.number}. {section.title}
          </h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors.pending}`}>
            Pending
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`border rounded-lg transition-all ${
        isActive ? 'border-accent shadow-sm ring-1 ring-accent/20' : 'border-slate-200'
      }`}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 rounded-t-lg border-b border-slate-200">
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold">
            {section.number}
          </span>
          <h3 className="font-semibold text-slate-800">{section.title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[section.status]}`}>
            {section.status.charAt(0).toUpperCase() + section.status.slice(1)}
          </span>
          {section.versions.length > 0 && (
            <span className="text-xs text-slate-400">v{section.versions.length}</span>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="p-4">
        {/* No content yet — generate button */}
        {section.status === 'pending' && isActive && (
          <div className="text-center py-8">
            <p className="text-sm text-slate-500 mb-4">
              Ready to generate this section from your documents and Q&A answers.
            </p>
            <button
              onClick={() => onGenerate()}
              disabled={isGenerating}
              className="px-5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isGenerating ? 'Generating...' : 'Generate Section'}
            </button>
            <button
              onClick={onSkip}
              className="ml-3 px-4 py-2 text-slate-500 hover:text-slate-700 text-sm"
            >
              Skip
            </button>
          </div>
        )}

        {/* Generating spinner */}
        {isGenerating && (
          <div className="text-center py-8">
            <div className="inline-block w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-slate-600">Generating section {section.number}...</p>
            <p className="text-xs text-slate-400 mt-1">This may take a moment</p>
          </div>
        )}

        {/* Content display/editor */}
        {section.content && !isGenerating && (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 mb-3 border-b border-slate-100 pb-3">
              <button
                onClick={() => { setShowPreview(true); setIsEditing(false); }}
                className={`px-3 py-1 text-xs rounded font-medium ${
                  showPreview && !isEditing ? 'bg-accent text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Preview
              </button>
              <button
                onClick={() => { setIsEditing(true); setShowPreview(false); }}
                className={`px-3 py-1 text-xs rounded font-medium ${
                  isEditing ? 'bg-accent text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Edit
              </button>
              {previousVersion && (
                <button
                  onClick={() => setShowDiff(!showDiff)}
                  className={`px-3 py-1 text-xs rounded font-medium ${
                    showDiff ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Diff
                </button>
              )}
              {section.versions.length > 1 && (
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className={`px-3 py-1 text-xs rounded font-medium ${
                    showHistory ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  History ({section.versions.length})
                </button>
              )}
            </div>

            {/* Diff View */}
            {showDiff && previousVersion && (
              <DiffView oldContent={previousVersion.content} newContent={section.content} />
            )}

            {/* Revision History */}
            {showHistory && (
              <div className="mb-4 bg-slate-50 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                {section.versions.map((v) => (
                  <div
                    key={v.version}
                    className="flex items-center justify-between text-xs bg-white rounded px-3 py-2 border border-slate-100"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">v{v.version}</span>
                      <span className="text-slate-400">
                        {new Date(v.generatedAt).toLocaleString()}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        v.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                        v.status === 'current' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-400'
                      }`}>
                        {v.status}
                      </span>
                      {v.feedback && (
                        <span className="text-slate-400 italic truncate max-w-[200px]">
                          "{v.feedback}"
                        </span>
                      )}
                    </div>
                    {v.status === 'superseded' && (
                      <button
                        onClick={() => onRevert(v.version)}
                        className="text-accent hover:text-accent-hover font-medium"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Preview */}
            {showPreview && !isEditing && !showDiff && (
              <div className="prose prose-sm max-w-none text-slate-700 whitespace-pre-wrap font-mono text-xs bg-slate-50 rounded-lg p-4 max-h-96 overflow-y-auto">
                {section.content}
              </div>
            )}

            {/* Edit */}
            {isEditing && (
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onInput={handleTextareaInput}
                className="w-full font-mono text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-4 resize-none focus:outline-none focus:ring-2 focus:ring-accent/30 min-h-[200px]"
                placeholder="Edit section content..."
              />
            )}

            {/* Feedback + Action Buttons */}
            {section.status !== 'approved' && (
              <div className="mt-4 space-y-3">
                {/* Regeneration feedback */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Optional: suggest changes before regenerating..."
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/30"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleRegenerate(); }
                    }}
                  />
                  <button
                    onClick={handleRegenerate}
                    disabled={isGenerating}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    Regenerate
                  </button>
                </div>

                {/* Action buttons */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={onSkip}
                    className="text-sm text-slate-400 hover:text-slate-600"
                  >
                    Skip this section
                  </button>
                  <div className="flex items-center gap-2">
                    {isEditing && editContent !== section.content && (
                      <span className="text-xs text-amber-600">Unsaved edits</span>
                    )}
                    <button
                      onClick={handleApprove}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      {isEditing && editContent !== section.content
                        ? 'Approve with Edits'
                        : 'Approve'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Approved state */}
            {section.status === 'approved' && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-emerald-600 font-medium">Section approved</span>
                <button
                  onClick={() => { setIsEditing(true); setShowPreview(false); }}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Edit & re-approve
                </button>
              </div>
            )}
          </>
        )}

        {/* Skipped state */}
        {section.status === 'skipped' && !section.content && (
          <div className="text-center py-6">
            <p className="text-sm text-slate-400">Section skipped</p>
            <button
              onClick={() => onGenerate()}
              className="mt-2 text-sm text-accent hover:text-accent-hover"
            >
              Generate anyway
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DiffView({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);

  const diffLines: { type: 'same' | 'add' | 'remove' | 'change'; old?: string; new?: string }[] = [];

  for (let i = 0; i < maxLen; i++) {
    const ol = oldLines[i];
    const nl = newLines[i];
    if (ol === nl) {
      diffLines.push({ type: 'same', old: ol, new: nl });
    } else if (ol === undefined) {
      diffLines.push({ type: 'add', new: nl });
    } else if (nl === undefined) {
      diffLines.push({ type: 'remove', old: ol });
    } else {
      diffLines.push({ type: 'change', old: ol, new: nl });
    }
  }

  return (
    <div className="mb-4 bg-slate-50 rounded-lg overflow-hidden text-xs font-mono max-h-72 overflow-y-auto">
      {diffLines.map((line, i) => (
        <div key={i}>
          {(line.type === 'remove' || line.type === 'change') && (
            <div className="bg-red-50 text-red-700 px-3 py-0.5 border-l-2 border-red-300">
              - {line.old}
            </div>
          )}
          {(line.type === 'add' || line.type === 'change') && (
            <div className="bg-emerald-50 text-emerald-700 px-3 py-0.5 border-l-2 border-emerald-300">
              + {line.new}
            </div>
          )}
          {line.type === 'same' && (
            <div className="text-slate-400 px-3 py-0.5">
              &nbsp; {line.old}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
