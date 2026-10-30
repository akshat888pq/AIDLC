import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MockupScreen, MockupSet } from '../types';
import * as phaseApi from '../services/phaseApi';

/**
 * Live UI mockups: an interactive HTML page for every screen of the design package,
 * generated from the approved screen definition (Section 7) and design system
 * (Section 6).
 *
 * Each mockup runs in a sandboxed iframe — scripts and forms, but no same-origin
 * access — so model-written code can never reach this app. Links between screens
 * (data-screen="SCR-00x") are relayed out of the frame by a small script injected at
 * render time, which turns the set into a clickable prototype. The injected script
 * is never saved: edits and downloads carry only the mockup's own code.
 */

interface Props {
  phaseId: string;
  sessionId: string;
  footer?: React.ReactNode;
}

type Device = 'desktop' | 'tablet' | 'mobile';
type View = 'preview' | 'split' | 'code';

const DEVICES: { key: Device; label: string; width: number; height: number }[] = [
  { key: 'desktop', label: 'Desktop', width: 1440, height: 900 },
  { key: 'tablet', label: 'Tablet', width: 768, height: 1024 },
  { key: 'mobile', label: 'Mobile', width: 375, height: 812 },
];

const SANDBOX = 'allow-scripts allow-forms allow-modals';
const LIVE_PREVIEW_DEBOUNCE_MS = 400;
const NAV_MESSAGE = 'aidlc-mockup-navigate';

const STATUS_CHIP: Record<MockupScreen['status'], string> = {
  approved: 'bg-emerald-100 text-emerald-700',
  draft: 'bg-amber-100 text-amber-700',
  pending: 'bg-slate-100 text-slate-500',
};

/** Relays in-mockup screen links to the host. Capture phase, so it wins over page handlers. */
const NAV_BRIDGE = `<script data-aidlc-bridge>(function(){document.addEventListener('click',function(e){var t=e.target&&e.target.closest&&e.target.closest('[data-screen],a[href^="#SCR-"]');if(!t)return;var id=t.getAttribute('data-screen')||(t.getAttribute('href')||'').slice(1);if(!/^SCR-\\d+$/.test(id))return;e.preventDefault();e.stopPropagation();parent.postMessage({type:'${NAV_MESSAGE}',screenId:id},'*');},true);})();</script>`;

function withBridge(html: string): string {
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at >= 0 ? `${html.slice(0, at)}${NAV_BRIDGE}${html.slice(at)}` : `${html}${NAV_BRIDGE}`;
}

export default function MockupStudio({ phaseId, sessionId, footer }: Props) {
  const [set, setSet] = useState<MockupSet | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [screen, setScreen] = useState<MockupScreen | null>(null);
  const [viewVersion, setViewVersion] = useState<number>(0);
  const [code, setCode] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [device, setDevice] = useState<Device>('desktop');
  const [view, setView] = useState<View>('preview');
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ done: number; total: number; current: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cancelBatch = useRef(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const stageObserver = useRef<ResizeObserver | null>(null);

  // Callback ref: the stage mounts and unmounts with the view and with the first
  // generation, and the device frame is scaled to whatever width it has.
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    stageObserver.current?.disconnect();
    stageObserver.current = null;
    if (!el) return;
    setStageWidth(el.clientWidth);
    stageObserver.current = new ResizeObserver(() => setStageWidth(el.clientWidth));
    stageObserver.current.observe(el);
  }, []);

  const versionHtml = useMemo(
    () => screen?.versions.find((v) => v.version === viewVersion)?.html ?? '',
    [screen, viewVersion]
  );
  const dirty = code !== versionHtml;
  const isCurrent = screen ? viewVersion === screen.currentVersion : false;

  // ── Loading ──

  const refreshSet = useCallback(async () => {
    const next = await phaseApi.getMockupSet(phaseId, sessionId);
    setSet(next);
    return next;
  }, [phaseId, sessionId]);

  const loadScreen = useCallback(
    async (screenId: string, version?: number) => {
      const full = await phaseApi.getMockup(phaseId, sessionId, screenId);
      setScreen(full);
      const v = version ?? full.currentVersion;
      setViewVersion(v);
      const html = full.versions.find((x) => x.version === v)?.html ?? '';
      setCode(html);
      setPreviewHtml(html);
      return full;
    },
    [phaseId, sessionId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const next = await refreshSet();
        if (cancelled) return;
        const first = next.screens.find((s) => s.status !== 'approved') ?? next.screens[0];
        if (first) setActiveId(first.screenId);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSet]);

  useEffect(() => {
    if (!activeId) return;
    setShowFeedback(false);
    setFeedback('');
    loadScreen(activeId).catch((err) => setError(err.message));
  }, [activeId, loadScreen]);

  // Live preview while editing code.
  useEffect(() => {
    if (code === previewHtml) return;
    const t = setTimeout(() => setPreviewHtml(code), LIVE_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [code, previewHtml]);

  // Prototype navigation from inside the frame.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.type !== NAV_MESSAGE || typeof e.data.screenId !== 'string') return;
      const target = set?.screens.find((s) => s.screenId === e.data.screenId);
      if (!target) {
        setNotice(`${e.data.screenId} is not a screen in this package.`);
      } else if (dirty) {
        setNotice(`Link to ${target.screenId} ${target.screenName} — save or discard your edits to follow it.`);
      } else {
        setNotice(
          target.currentVersion > 0
            ? `Followed link → ${target.screenId} ${target.screenName}`
            : `Followed link → ${target.screenId} ${target.screenName} (no mockup yet)`
        );
        setActiveId(target.screenId);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [set, dirty]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Actions ──

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, []);

  const handleGenerate = useCallback(
    (withFeedback: boolean) =>
      run('generate', async () => {
        if (!activeId) return;
        await phaseApi.generateMockup(phaseId, sessionId, activeId, withFeedback ? feedback : undefined);
        await Promise.all([refreshSet(), loadScreen(activeId)]);
        setFeedback('');
        setShowFeedback(false);
      }),
    [run, activeId, phaseId, sessionId, feedback, refreshSet, loadScreen]
  );

  const handleSave = useCallback(
    () =>
      run('save', async () => {
        if (!activeId) return;
        await phaseApi.saveMockup(phaseId, sessionId, activeId, code);
        await Promise.all([refreshSet(), loadScreen(activeId)]);
      }),
    [run, activeId, phaseId, sessionId, code, refreshSet, loadScreen]
  );

  const handleApprove = useCallback(
    () =>
      run('approve', async () => {
        if (!activeId) return;
        await phaseApi.approveMockup(phaseId, sessionId, activeId, dirty || !isCurrent ? code : undefined);
        const next = await refreshSet();
        await loadScreen(activeId);
        const following = next.screens.find(
          (s) => s.screenId !== activeId && s.status !== 'approved' && s.currentVersion > 0
        );
        if (following) setNotice(`Approved. Next to review: ${following.screenId} ${following.screenName}`);
      }),
    [run, activeId, phaseId, sessionId, dirty, isCurrent, code, refreshSet, loadScreen]
  );

  const handleRestore = useCallback(
    () =>
      run('restore', async () => {
        if (!activeId) return;
        await phaseApi.revertMockup(phaseId, sessionId, activeId, viewVersion);
        await Promise.all([refreshSet(), loadScreen(activeId)]);
      }),
    [run, activeId, phaseId, sessionId, viewVersion, refreshSet, loadScreen]
  );

  /** Generate every screen that has no mockup yet, one at a time, so progress is visible. */
  const handleGenerateMissing = useCallback(async () => {
    const missing = (set?.screens ?? []).filter((s) => s.currentVersion === 0 && !s.orphaned);
    if (missing.length === 0) return;
    cancelBatch.current = false;
    setError(null);
    const failures: string[] = [];
    for (let i = 0; i < missing.length; i++) {
      if (cancelBatch.current) break;
      const s = missing[i];
      setBatch({ done: i, total: missing.length, current: `${s.screenId} ${s.screenName}` });
      try {
        await phaseApi.generateMockup(phaseId, sessionId, s.screenId);
        await refreshSet();
        if (s.screenId === activeId) await loadScreen(s.screenId);
      } catch (err: any) {
        failures.push(`${s.screenId}: ${err.message}`);
      }
    }
    setBatch(null);
    if (failures.length > 0) setError(`Some screens failed — ${failures.join(' · ')}`);
  }, [set, phaseId, sessionId, activeId, refreshSet, loadScreen]);

  const selectVersion = (v: number) => {
    setViewVersion(v);
    const html = screen?.versions.find((x) => x.version === v)?.html ?? '';
    setCode(html);
    setPreviewHtml(html);
  };

  const selectScreen = (id: string) => {
    if (id === activeId) return;
    if (dirty) {
      setNotice('Save or discard your code edits before switching screens.');
      return;
    }
    setActiveId(id);
  };

  // Tab inserts two spaces instead of leaving the editor.
  const onCodeKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b } = el;
    const next = `${code.slice(0, a)}  ${code.slice(b)}`;
    setCode(next);
    requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
  };

  // ── Render ──

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
        <div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm text-slate-600">Loading mockups…</p>
      </div>
    );
  }

  const screens = set?.screens ?? [];
  const approvedCount = screens.filter((s) => s.status === 'approved').length;
  const missingCount = screens.filter((s) => s.currentVersion === 0 && !s.orphaned).length;
  const anyGenerated = screens.some((s) => s.currentVersion > 0);
  const deviceSpec = DEVICES.find((d) => d.key === device)!;
  const scale = stageWidth > 0 ? Math.min(1, (stageWidth - 32) / deviceSpec.width) : 1;
  const frameViewportHeight = Math.min(deviceSpec.height, 900);
  const locked = Boolean(busy || batch);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Live UI Mockups</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Interactive HTML + Tailwind + vanilla JS for every screen, built from the approved screen definitions and
              design system. {screens.length > 0 && `${approvedCount} of ${screens.length} approved.`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {batch ? (
              <button
                onClick={() => (cancelBatch.current = true)}
                className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium"
              >
                Stop after this screen
              </button>
            ) : (
              <button
                onClick={handleGenerateMissing}
                disabled={!set?.ready || missingCount === 0 || locked}
                className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {missingCount > 0 ? `Generate ${missingCount} missing` : 'All screens generated'}
              </button>
            )}
            {anyGenerated && (
              <a
                href={phaseApi.mockupArchiveUrl(phaseId, sessionId)}
                className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium"
              >
                Download all (.zip)
              </a>
            )}
          </div>
        </div>

        {batch && (
          <div className="px-6 py-3 border-b border-slate-200 bg-indigo-50/50" role="status" aria-live="polite">
            <div className="flex items-center justify-between text-sm text-slate-700 mb-1.5">
              <span>
                Generating {batch.done + 1} of {batch.total} — <strong>{batch.current}</strong>
              </span>
              <span className="text-slate-500">{Math.round((batch.done / batch.total) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${(batch.done / batch.total) * 100}%` }} />
            </div>
          </div>
        )}

        {error && (
          <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-3 underline">
              Dismiss
            </button>
          </div>
        )}

        {!set?.ready && (
          <div className="m-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {set?.blockedReason ?? 'Mockups are not available yet.'}
          </div>
        )}

        {set?.ready && screens.length === 0 && (
          <div className="m-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No SCR-xxx screens were found in Section 7. Each screen definition needs a heading with its id, e.g.{' '}
            <code className="font-mono">### SCR-001: Login</code>.
          </div>
        )}

        {screens.length > 0 && (
          <div className="flex flex-col lg:flex-row min-h-[640px]">
            {/* Screen list */}
            <nav aria-label="Screens" className="lg:w-64 flex-shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200">
              <ul className="max-h-64 lg:max-h-none overflow-y-auto py-2">
                {screens.map((s) => (
                  <li key={s.screenId}>
                    <button
                      onClick={() => selectScreen(s.screenId)}
                      aria-current={s.screenId === activeId ? 'true' : undefined}
                      className={`w-full text-left px-4 py-2.5 flex items-start justify-between gap-2 transition-colors ${
                        s.screenId === activeId ? 'bg-accent/10' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-mono text-slate-500">{s.screenId}</span>
                        <span className="block text-sm font-medium text-slate-800 truncate">{s.screenName}</span>
                        {s.orphaned && <span className="block text-xs text-red-600">No longer in Section 7</span>}
                      </span>
                      <span className={`flex-shrink-0 text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_CHIP[s.status]}`}>
                        {s.status === 'pending' ? 'Not generated' : s.status === 'draft' ? `Draft v${s.currentVersion}` : 'Approved'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Workspace */}
            <div className="flex-1 min-w-0 flex flex-col">
              {screen && (
                <>
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">
                        {screen.screenId} — {screen.screenName}
                        {screen.route && <span className="ml-2 font-mono text-xs text-slate-400">{screen.route}</span>}
                      </div>
                      {screen.versions.length > 0 && (
                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                          <label htmlFor="mockup-version">Version</label>
                          <select
                            id="mockup-version"
                            value={viewVersion}
                            onChange={(e) => selectVersion(Number(e.target.value))}
                            disabled={dirty || locked}
                            className="border border-slate-300 rounded px-1.5 py-0.5 text-xs bg-white"
                          >
                            {[...screen.versions].reverse().map((v) => (
                              <option key={v.version} value={v.version}>
                                v{v.version} · {v.source === 'edited' ? 'hand edit' : v.feedback ? 'regenerated' : 'generated'}
                                {v.version === screen.approvedVersion ? ' · approved' : ''}
                                {v.version === screen.currentVersion ? ' · current' : ''}
                              </option>
                            ))}
                          </select>
                          {!isCurrent && !dirty && (
                            <button onClick={handleRestore} disabled={locked} className="text-accent hover:underline">
                              Make current
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Segmented
                        label="Device"
                        value={device}
                        onChange={setDevice}
                        options={DEVICES.map((d) => ({ value: d.key, label: `${d.label} ${d.width}` }))}
                      />
                      <Segmented
                        label="View"
                        value={view}
                        onChange={setView}
                        options={[
                          { value: 'preview', label: 'Preview' },
                          { value: 'split', label: 'Split' },
                          { value: 'code', label: 'Code' },
                        ]}
                      />
                    </div>
                  </div>

                  {screen.currentVersion === 0 ? (
                    <div className="flex-1 flex items-center justify-center p-10 text-center">
                      <div>
                        <p className="text-slate-700 font-medium mb-1">No mockup for this screen yet</p>
                        <p className="text-sm text-slate-500 mb-4">
                          Built from its Section 7 definition, its Section 5 wireframe and the Section 6 design system.
                        </p>
                        <button
                          onClick={() => handleGenerate(false)}
                          disabled={!set?.ready || locked}
                          className="px-5 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg text-sm font-medium"
                        >
                          {busy === 'generate' ? 'Generating… (up to a minute)' : 'Generate mockup'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex-1 min-h-0 flex ${view === 'split' ? 'flex-col xl:flex-row' : 'flex-col'}`}>
                      {view !== 'preview' && (
                        <div className={`${view === 'split' ? 'xl:w-[45%] border-b xl:border-b-0 xl:border-r' : ''} border-slate-200 flex flex-col min-h-0`}>
                          <label htmlFor="mockup-code" className="sr-only">
                            HTML source for {screen.screenId}
                          </label>
                          <textarea
                            id="mockup-code"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            onKeyDown={onCodeKeyDown}
                            spellCheck={false}
                            className="flex-1 w-full min-h-[560px] p-4 font-mono text-xs leading-relaxed text-slate-100 bg-slate-900 resize-none focus:outline-none"
                          />
                        </div>
                      )}

                      {view !== 'code' && (
                        <div ref={stageRef} className="flex-1 min-w-0 bg-slate-100 p-4 overflow-hidden">
                          <div
                            className="mx-auto bg-white shadow-lg rounded-md overflow-hidden ring-1 ring-slate-300"
                            style={{ width: deviceSpec.width * scale, height: frameViewportHeight * scale }}
                          >
                            {previewHtml ? (
                              <iframe
                                ref={frameRef}
                                title={`Mockup of ${screen.screenId} ${screen.screenName} at ${deviceSpec.label.toLowerCase()} width`}
                                sandbox={SANDBOX}
                                srcDoc={withBridge(previewHtml)}
                                style={{
                                  width: deviceSpec.width,
                                  height: frameViewportHeight,
                                  transform: `scale(${scale})`,
                                  transformOrigin: 'top left',
                                  border: 0,
                                  display: 'block',
                                }}
                              />
                            ) : null}
                          </div>
                          <p className="text-center text-xs text-slate-500 mt-2">
                            {deviceSpec.width} × {frameViewportHeight}px
                            {scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ''} · links to other screens are
                            clickable
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {screen.currentVersion > 0 && (
                    <div className="px-4 py-3 border-t border-slate-200 space-y-3">
                      {showFeedback && (
                        <div>
                          <label htmlFor="mockup-feedback" className="block text-sm font-medium text-slate-700 mb-1">
                            What should change?
                          </label>
                          <textarea
                            id="mockup-feedback"
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            rows={3}
                            placeholder="e.g. Move the filters into a collapsible panel on mobile; the status column needs coloured badges."
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                          />
                          <p className="text-xs text-slate-500 mt-1">
                            The current version is sent with your feedback, so only what you ask for changes.
                          </p>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3 text-sm">
                          <a
                            href={phaseApi.mockupFileUrl(phaseId, sessionId, screen.screenId)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-600 hover:text-slate-900 underline"
                          >
                            Open in new tab
                          </a>
                          <a
                            href={phaseApi.mockupFileUrl(phaseId, sessionId, screen.screenId, true)}
                            className="text-slate-600 hover:text-slate-900 underline"
                          >
                            Download .html
                          </a>
                          {screen.status === 'approved' && (
                            <span className="text-emerald-700">✓ v{screen.approvedVersion} approved</span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {dirty && (
                            <>
                              <button
                                onClick={() => {
                                  setCode(versionHtml);
                                  setPreviewHtml(versionHtml);
                                }}
                                disabled={locked}
                                className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800 underline"
                              >
                                Discard edits
                              </button>
                              <button
                                onClick={handleSave}
                                disabled={locked}
                                className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium"
                              >
                                {busy === 'save' ? 'Saving…' : 'Save as new version'}
                              </button>
                            </>
                          )}
                          {showFeedback ? (
                            <>
                              <button
                                onClick={() => setShowFeedback(false)}
                                className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800 underline"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleGenerate(true)}
                                disabled={!feedback.trim() || locked || dirty}
                                title={dirty ? 'Save or discard your edits first' : undefined}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
                              >
                                {busy === 'generate' ? 'Regenerating…' : 'Regenerate with feedback'}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setShowFeedback(true)}
                              disabled={locked || !set?.ready}
                              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-lg text-sm font-medium"
                            >
                              Request changes
                            </button>
                          )}
                          <button
                            onClick={handleApprove}
                            disabled={locked || (screen.status === 'approved' && isCurrent && !dirty && screen.approvedVersion === viewVersion)}
                            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
                          >
                            {busy === 'approve'
                              ? 'Approving…'
                              : dirty
                              ? 'Approve with edits'
                              : !isCurrent
                              ? `Approve v${viewVersion}`
                              : screen.status === 'approved'
                              ? 'Approved'
                              : 'Approve mockup'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {notice && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">
          {notice}
        </div>
      )}

      {footer}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            o.value === value ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
