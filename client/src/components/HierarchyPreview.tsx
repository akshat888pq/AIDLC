import { useState } from 'react';
import type { TicketHierarchyNode } from '../types';

interface Props {
  reasoning: string;
  hierarchy: TicketHierarchyNode[];
  onConfirm: (hierarchy: TicketHierarchyNode[]) => void;
  onCancel: () => void;
  creating: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  epic: 'border-l-purple-500 bg-purple-50/50',
  feature: 'border-l-blue-500 bg-blue-50/50',
  story: 'border-l-green-500 bg-green-50/50',
  task: 'border-l-slate-400 bg-slate-50/50',
  subtask: 'border-l-slate-300 bg-slate-50/30',
};

const TYPE_BADGES: Record<string, string> = {
  epic: 'bg-purple-100 text-purple-700',
  feature: 'bg-blue-100 text-blue-700',
  story: 'bg-green-100 text-green-700',
  task: 'bg-slate-100 text-slate-700',
  subtask: 'bg-slate-100 text-slate-600',
};

function NodePreview({ node, depth }: { node: TicketHierarchyNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const badge = TYPE_BADGES[node.ticket.type] || TYPE_BADGES.task;
  const color = TYPE_COLORS[node.ticket.type] || TYPE_COLORS.task;

  const statusIcon = node.status === 'created' ? '✓' : node.status === 'failed' ? '✗' : node.status === 'creating' ? '...' : '';

  return (
    <div className={`border-l-4 ${color} rounded-r-md ${depth > 0 ? 'ml-6' : ''}`}>
      <div className="px-4 py-3">
        <div className="flex items-start gap-2">
          {hasChildren && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-slate-400 hover:text-slate-600 mt-0.5 text-xs w-4"
            >
              {expanded ? '▼' : '▶'}
            </button>
          )}
          {!hasChildren && <span className="w-4" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${badge}`}>
                {node.ticket.type.charAt(0).toUpperCase() + node.ticket.type.slice(1)}
              </span>
              <span className="text-sm font-medium text-slate-800">{node.ticket.title}</span>
              {node.ticket.storyPoints && (
                <span className="text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                  {node.ticket.storyPoints} SP
                </span>
              )}
              {node.ticket.priority && (
                <span className="text-xs text-slate-400">{node.ticket.priority}</span>
              )}
              {statusIcon && (
                <span className={`text-sm ${node.status === 'created' ? 'text-green-600' : node.status === 'failed' ? 'text-red-600' : 'text-slate-400'}`}>
                  {statusIcon}
                </span>
              )}
              {node.createdTicket && (
                <a
                  href={node.createdTicket.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline"
                >
                  {node.createdTicket.key}
                </a>
              )}
            </div>
            {node.ticket.description && (
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                {node.ticket.description.slice(0, 200)}
              </p>
            )}
            {node.error && (
              <p className="text-xs text-red-600 mt-1">Error: {node.error}</p>
            )}
          </div>
        </div>
      </div>
      {expanded && hasChildren && (
        <div className="pb-2">
          {node.children.map((child) => (
            <NodePreview key={child.tempId} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function countAll(nodes: TicketHierarchyNode[]): { epics: number; features: number; stories: number; tasks: number } {
  let epics = 0, features = 0, stories = 0, tasks = 0;
  function walk(n: TicketHierarchyNode) {
    switch (n.ticket.type) {
      case 'epic': epics++; break;
      case 'feature': features++; break;
      case 'story': stories++; break;
      default: tasks++; break;
    }
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return { epics, features, stories, tasks };
}

export default function HierarchyPreview({ reasoning, hierarchy, onConfirm, onCancel, creating }: Props) {
  const counts = countAll(hierarchy);
  const total = counts.epics + counts.features + counts.stories + counts.tasks;

  return (
    <div className="space-y-4">
      {/* Reasoning */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
        <p className="text-sm font-medium text-indigo-800 mb-1">Agent's Reasoning</p>
        <p className="text-sm text-indigo-700">{reasoning}</p>
      </div>

      {/* Counts summary */}
      <div className="flex gap-3 text-sm">
        <span className="bg-slate-100 rounded-md px-3 py-1.5 font-medium text-slate-700">
          {total} tickets total
        </span>
        {counts.epics > 0 && <span className="bg-purple-50 text-purple-700 rounded-md px-3 py-1.5">{counts.epics} Epic{counts.epics > 1 ? 's' : ''}</span>}
        {counts.features > 0 && <span className="bg-blue-50 text-blue-700 rounded-md px-3 py-1.5">{counts.features} Feature{counts.features > 1 ? 's' : ''}</span>}
        {counts.stories > 0 && <span className="bg-green-50 text-green-700 rounded-md px-3 py-1.5">{counts.stories} Stor{counts.stories > 1 ? 'ies' : 'y'}</span>}
        {counts.tasks > 0 && <span className="bg-slate-50 text-slate-700 rounded-md px-3 py-1.5">{counts.tasks} Task{counts.tasks > 1 ? 's' : ''}</span>}
      </div>

      {/* Hierarchy tree */}
      <div className="space-y-2">
        {hierarchy.map((node) => (
          <NodePreview key={node.tempId} node={node} depth={0} />
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={() => onConfirm(hierarchy)}
          disabled={creating}
          className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium text-sm disabled:opacity-50 transition-colors"
        >
          {creating ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating tickets...
            </span>
          ) : (
            `Confirm & Create ${total} Tickets`
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={creating}
          className="px-4 py-2.5 text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
