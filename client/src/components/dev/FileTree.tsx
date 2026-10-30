import { useState } from 'react';
import type { TreeNode } from '../../services/devApi';

interface Props {
  tree: TreeNode[];
  activePath: string | null;
  changedPaths: Set<string>;
  onOpen: (path: string) => void;
  onCreate: (path: string, type: 'file' | 'dir') => Promise<void>;
  onRename: (from: string, to: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onRefresh: () => void;
}

const EXT_BADGE: Record<string, { label: string; color: string }> = {
  ts: { label: 'TS', color: 'text-sky-400' },
  tsx: { label: 'TSX', color: 'text-sky-300' },
  js: { label: 'JS', color: 'text-yellow-300' },
  jsx: { label: 'JSX', color: 'text-yellow-200' },
  json: { label: '{}', color: 'text-amber-300' },
  md: { label: 'MD', color: 'text-slate-300' },
  css: { label: '#', color: 'text-pink-300' },
  html: { label: '<>', color: 'text-orange-300' },
  py: { label: 'PY', color: 'text-emerald-300' },
};

function badge(name: string) {
  if (name === 'secondbrain.md') return { label: '🧠', color: '' };
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_BADGE[ext] ?? { label: '•', color: 'text-slate-500' };
}

function parentOf(path: string) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export default function FileTree({ tree, activePath, changedPaths, onOpen, onCreate, onRename, onDelete, onRefresh }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedDir, setSelectedDir] = useState('');
  const [creating, setCreating] = useState<{ parent: string; type: 'file' | 'dir' } | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toggle = (path: string) => {
    setSelectedDir(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const startCreate = (type: 'file' | 'dir') => {
    setCreating({ parent: selectedDir, type });
    setDraft('');
    setError(null);
    if (selectedDir) setExpanded((prev) => new Set(prev).add(selectedDir));
  };

  const commitCreate = async () => {
    if (!creating) return;
    const name = draft.trim();
    if (!name) {
      setCreating(null);
      return;
    }
    const full = creating.parent ? `${creating.parent}/${name}` : name;
    try {
      await onCreate(full, creating.type);
      setCreating(null);
      if (creating.type === 'file') onOpen(full);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const rename = async (node: TreeNode) => {
    const next = window.prompt(`Rename ${node.path} to:`, node.path);
    if (!next || next === node.path) return;
    try {
      await onRename(node.path, next);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async (node: TreeNode) => {
    if (!window.confirm(`Delete ${node.path}${node.type === 'dir' ? ' and everything in it' : ''}?`)) return;
    try {
      await onDelete(node.path);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const createRow = (parent: string, depth: number) =>
    creating && creating.parent === parent ? (
      <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: depth * 12 + 8 }}>
        <span className="text-xs text-slate-500 w-4">{creating.type === 'dir' ? '▸' : '•'}</span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitCreate();
            if (e.key === 'Escape') setCreating(null);
          }}
          onBlur={() => void commitCreate()}
          placeholder={creating.type === 'dir' ? 'folder name' : 'file name'}
          className="flex-1 min-w-0 bg-slate-800 border border-accent rounded px-1.5 py-0.5 text-xs text-slate-100 outline-none"
        />
      </div>
    ) : null;

  const renderNodes = (nodes: TreeNode[], depth: number): JSX.Element[] =>
    nodes.map((node) => {
      const isOpen = expanded.has(node.path);
      const isActive = node.path === activePath;
      const changed = changedPaths.has(node.path);
      const b = badge(node.name);
      return (
        <div key={node.path}>
          <div
            className={`group flex items-center gap-1 pr-1 py-[3px] cursor-pointer text-[13px] select-none ${
              isActive ? 'bg-slate-700/70 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
            style={{ paddingLeft: depth * 12 + 8 }}
            onClick={() => (node.type === 'dir' ? toggle(node.path) : (setSelectedDir(parentOf(node.path)), onOpen(node.path)))}
            title={node.path}
          >
            {node.type === 'dir' ? (
              <span className="w-4 text-[10px] text-slate-500">{isOpen ? '▾' : '▸'}</span>
            ) : (
              <span className={`w-4 text-[9px] font-bold text-center ${b.color}`}>{b.label}</span>
            )}
            <span className={`truncate flex-1 ${node.type === 'dir' ? 'text-slate-200' : ''} ${changed ? 'text-amber-300' : ''}`}>
              {node.name}
            </span>
            {changed && <span className="text-[10px] text-amber-400 font-semibold" title="Changed by the agent">M</span>}
            <span className="hidden group-hover:flex items-center gap-0.5">
              <button onClick={(e) => (e.stopPropagation(), void rename(node))} className="px-1 text-[11px] text-slate-400 hover:text-white" title="Rename">✎</button>
              <button onClick={(e) => (e.stopPropagation(), void remove(node))} className="px-1 text-[11px] text-slate-400 hover:text-red-400" title="Delete">✕</button>
            </span>
          </div>
          {node.type === 'dir' && isOpen && (
            <div>
              {createRow(node.path, depth + 1)}
              {node.children && renderNodes(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });

  return (
    <div className="h-full flex flex-col bg-slate-900 text-slate-300">
      <div className="flex items-center justify-between px-3 h-9 border-b border-slate-800 shrink-0">
        <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Explorer</span>
        <div className="flex items-center gap-1">
          <button onClick={() => startCreate('file')} className="px-1.5 text-xs text-slate-400 hover:text-white" title="New file">+📄</button>
          <button onClick={() => startCreate('dir')} className="px-1.5 text-xs text-slate-400 hover:text-white" title="New folder">+📁</button>
          <button onClick={onRefresh} className="px-1.5 text-xs text-slate-400 hover:text-white" title="Refresh">⟳</button>
          <button onClick={() => setExpanded(new Set())} className="px-1.5 text-xs text-slate-400 hover:text-white" title="Collapse all">⊟</button>
        </div>
      </div>
      {error && (
        <div className="mx-2 mt-2 px-2 py-1 rounded bg-red-900/40 border border-red-800 text-[11px] text-red-200 flex justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}
      <div className="flex-1 overflow-auto py-1" onClick={(e) => e.target === e.currentTarget && setSelectedDir('')}>
        {createRow('', 0)}
        {renderNodes(tree, 0)}
        {tree.length === 0 && !creating && <p className="px-3 py-2 text-xs text-slate-500">The workspace is empty.</p>}
      </div>
    </div>
  );
}
