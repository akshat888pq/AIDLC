import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { initMermaid, mermaidToJpg, rasterizeSvg, triggerDownload } from '../services/mermaidImage';

/**
 * A Mermaid diagram with its source beside it.
 *
 * Deliberately phase-agnostic: it knows nothing about architecture, sessions or
 * the API. The caller owns the code and every action — this component renders,
 * validates, and reports edits upward. Design and testing can reuse it as-is.
 */

interface Props {
  /** The Mermaid source to render. Treated as the source of truth. */
  mermaidCode: string;
  /** Called (debounced) as the user types, so the caller can persist the edit. */
  onEdit?: (code: string) => void;
  /** Approve the diagram as it currently stands. Hidden when absent. */
  onApprove?: (code: string) => void;
  /** Ask the AI for a new version. Receives optional reviewer feedback. */
  onRegenerate?: (feedback?: string) => void;
  /** Finalize without a diagram. Hidden when absent. */
  onSkip?: () => void;
  /** Whether the code panel accepts edits. Default true. */
  editable?: boolean;
  /** A request is in flight — disables the action buttons. */
  busy?: boolean;
  /** Error from the caller's last action (generation failed, save failed, …). */
  error?: string | null;
  /** Shown on the Approve button once the diagram has been approved. */
  approved?: boolean;
  title?: string;
  subtitle?: string;
  /** Base name for downloaded files. Default 'diagram'. */
  fileName?: string;
  /** How long to wait after a keystroke before re-rendering. Default 500ms. */
  debounceMs?: number;
  /**
   * Store a JPG of the current diagram with the phase's output. Shows a "Save JPG"
   * action when present.
   */
  onSaveImage?: (jpg: Blob) => Promise<void>;
  /** A JPG of exactly this source is already stored. */
  imageSaved?: boolean;
}

export default function DiagramViewer({
  mermaidCode,
  onEdit,
  onApprove,
  onRegenerate,
  onSkip,
  editable = true,
  busy = false,
  error = null,
  approved = false,
  title = 'System Diagram',
  subtitle,
  fileName = 'diagram',
  debounceMs = 500,
  onSaveImage,
  imageSaved = false,
}: Props) {
  const [code, setCode] = useState(mermaidCode);
  const [svg, setSvg] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savingImage, setSavingImage] = useState(false);

  // A stable id per instance — mermaid.render() injects a <style> keyed on it, and
  // two viewers on one page must not collide.
  const renderId = useMemo(() => `mmd-${Math.random().toString(36).slice(2, 10)}`, []);
  const previewRef = useRef<HTMLDivElement>(null);
  const latestRender = useRef(0);

  // The caller replacing the code (a regenerate landed, a different diagram was
  // loaded) wins over whatever is in the editor.
  useEffect(() => {
    setCode(mermaidCode);
  }, [mermaidCode]);

  // Debounced render. Every render is tagged so a slow one cannot overwrite the
  // result of a newer one.
  useEffect(() => {
    const source = code.trim();
    if (!source) {
      setSvg('');
      setRenderError(null);
      return;
    }

    const token = ++latestRender.current;
    setRendering(true);
    const timer = window.setTimeout(async () => {
      try {
        initMermaid();
        // parse() throws with a readable message; render() throws too but can also
        // leave an error node behind, so validate first.
        await mermaid.parse(source);
        const { svg: rendered } = await mermaid.render(`${renderId}-${token}`, source);
        if (token !== latestRender.current) return;
        setSvg(rendered);
        setRenderError(null);
      } catch (err: any) {
        if (token !== latestRender.current) return;
        setSvg('');
        setRenderError(cleanMermaidError(err));
      } finally {
        if (token === latestRender.current) setRendering(false);
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [code, debounceMs, renderId]);

  // Mermaid can leave its error placeholder <div id="dmmd-…"> attached to <body>.
  useEffect(() => {
    return () => {
      document.querySelectorAll(`[id^="d${renderId}"]`).forEach((el) => el.remove());
    };
  }, [renderId]);

  const handleChange = useCallback(
    (next: string) => {
      setCode(next);
      onEdit?.(next);
    },
    [onEdit]
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the textarea is right there, nothing to recover from.
    }
  }, [code]);

  const downloadSvg = useCallback(() => {
    if (!svg) return;
    triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${fileName}.svg`);
  }, [svg, fileName]);

  const downloadPng = useCallback(async () => {
    if (!svg) return;
    try {
      const blob = await rasterizeSvg(svg, { scale: 2, type: 'image/png' });
      triggerDownload(blob, `${fileName}.png`);
    } catch (err: any) {
      setRenderError(`Could not export PNG: ${err.message}`);
    }
  }, [svg, fileName]);

  const downloadJpg = useCallback(async () => {
    if (!svg) return;
    try {
      triggerDownload(await mermaidToJpg(code), `${fileName}.jpg`);
    } catch (err: any) {
      setRenderError(`Could not export JPG: ${err.message}`);
    }
  }, [svg, code, fileName]);

  const saveImage = useCallback(async () => {
    if (!svg || !onSaveImage) return;
    setSavingImage(true);
    try {
      await onSaveImage(await mermaidToJpg(code));
    } catch (err: any) {
      setRenderError(`Could not save the JPG: ${err.message}`);
    } finally {
      setSavingImage(false);
    }
  }, [svg, code, onSaveImage]);

  const canAct = !busy && Boolean(code.trim());

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            {title}
            {approved && (
              <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                Approved
              </span>
            )}
          </h3>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={downloadSvg}
            disabled={!svg}
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-lg text-xs font-medium transition-colors"
          >
            Download SVG
          </button>
          <button
            onClick={downloadPng}
            disabled={!svg}
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-lg text-xs font-medium transition-colors"
          >
            Download PNG
          </button>
          <button
            onClick={downloadJpg}
            disabled={!svg}
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-lg text-xs font-medium transition-colors"
          >
            Download JPG
          </button>
          {onSaveImage && (
            <button
              onClick={saveImage}
              disabled={!svg || savingImage || busy}
              title="Store a JPG of this diagram with the phase output (it is committed to git with the package)"
              className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-lg text-xs font-medium transition-colors"
            >
              {savingImage ? 'Saving JPG…' : imageSaved ? '✓ JPG saved' : 'Save JPG to package'}
            </button>
          )}
          {onRegenerate && (
            <button
              onClick={() => setShowFeedback((v) => !v)}
              disabled={busy}
              className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 text-slate-700 rounded-lg text-xs font-medium transition-colors"
            >
              {busy ? 'Working...' : 'Regenerate'}
            </button>
          )}
          {onApprove && (
            <button
              onClick={() => onApprove(code)}
              disabled={!canAct || Boolean(renderError)}
              title={renderError ? 'Fix the Mermaid syntax first' : undefined}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg text-xs font-medium transition-colors"
            >
              {approved ? 'Re-approve Diagram' : 'Approve Diagram'}
            </button>
          )}
        </div>
      </div>

      {showFeedback && onRegenerate && (
        <div className="px-6 py-4 bg-indigo-50 border-b border-indigo-200 space-y-2">
          <label className="block text-xs font-semibold text-indigo-700 uppercase tracking-wide">
            What should change? (optional)
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="e.g. Split the data layer into its own subgraph and show the event bus between services."
            className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onRegenerate(feedback.trim() || undefined);
                setShowFeedback(false);
                setFeedback('');
              }}
              disabled={busy}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
            >
              {busy ? 'Generating...' : 'Generate New Version'}
            </button>
            <button
              onClick={() => setShowFeedback(false)}
              className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        {/* Left — Mermaid source */}
        <div className="flex flex-col min-w-0">
          <div className="px-4 py-2 flex items-center justify-between border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Mermaid source {editable ? '' : '(read-only)'}
            </span>
            <button
              onClick={handleCopy}
              className="text-xs text-slate-400 hover:text-slate-700 transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <textarea
            value={code}
            readOnly={!editable}
            spellCheck={false}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="graph TD&#10;  user((&quot;User&quot;)) --&gt;|&quot;HTTPS&quot;| api[&quot;API Gateway&quot;]"
            className={`flex-1 min-h-[380px] px-4 py-3 font-mono text-xs leading-relaxed text-slate-800 resize-y focus:outline-none ${
              editable ? 'bg-white' : 'bg-slate-50 cursor-default'
            }`}
          />
          {renderError && (
            <div className="px-4 py-3 bg-red-50 border-t border-red-200">
              <p className="text-xs font-semibold text-red-700 mb-1">Mermaid syntax error</p>
              <pre className="text-xs text-red-600 whitespace-pre-wrap font-mono leading-relaxed">
                {renderError}
              </pre>
              <p className="text-xs text-red-500 mt-2">
                The preview keeps the last valid diagram off-screen — fix the line above and it
                re-renders automatically.
              </p>
            </div>
          )}
        </div>

        {/* Right — rendered preview */}
        <div className="min-w-0 bg-slate-50/60 flex flex-col">
          <div className="px-4 py-2 flex items-center justify-between border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Preview
            </span>
            {rendering && <span className="text-xs text-slate-400">Rendering…</span>}
          </div>
          <div className="flex-1 min-h-[380px] overflow-auto p-4 flex items-center justify-center">
            {svg ? (
              <div
                ref={previewRef}
                className="cc-light w-full [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:mx-auto"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : (
              <p className="text-sm text-slate-400 text-center px-6">
                {renderError
                  ? 'Nothing to preview — the source above has a syntax error.'
                  : code.trim()
                  ? 'Rendering…'
                  : 'No diagram yet.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {onSkip && (
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 text-right">
          <button
            onClick={onSkip}
            disabled={busy}
            className="text-xs text-slate-500 hover:text-slate-800 underline disabled:opacity-50"
          >
            Continue without a diagram
          </button>
        </div>
      )}
    </div>
  );
}

/** Mermaid errors arrive with a stack and a banner line the user does not need. */
function cleanMermaidError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Parse error on line/, 'Parse error on line').split('\n').slice(0, 8).join('\n').trim();
}
