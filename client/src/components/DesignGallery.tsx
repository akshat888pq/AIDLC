import { useCallback, useEffect, useMemo, useState } from 'react';
import * as phaseApi from '../services/phaseApi';
import type { RenderedImage } from '../services/phaseApi';

/**
 * The JPG screen designs rendered from the finalized design package: a lo-fi
 * wireframe, a hi-fi desktop mockup and a hi-fi mobile mockup per screen, plus the
 * design-system style guide.
 *
 * Rendering is the "design-images" deliverable; this panel can trigger it too, so a
 * reviewer never has to leave the images to produce them.
 */

interface Props {
  phaseId: string;
  sessionId: string;
  /** Rendering needs a finalized package. */
  finalized: boolean;
}

type Variant = 'wireframe' | 'desktop' | 'mobile';

const VARIANTS: { key: Variant; label: string }[] = [
  { key: 'wireframe', label: 'Lo-fi wireframe' },
  { key: 'desktop', label: 'Hi-fi desktop' },
  { key: 'mobile', label: 'Hi-fi mobile' },
];

const DELIVERABLE_ID = 'design-images';

export default function DesignGallery({ phaseId, sessionId, finalized }: Props) {
  const [images, setImages] = useState<RenderedImage[]>([]);
  const [variant, setVariant] = useState<Variant>('desktop');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  // Cache-buster so re-rendered JPGs replace the browser's copy.
  const [version, setVersion] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [list, deliverables] = await Promise.all([
      phaseApi.getRenderedImages(phaseId, sessionId),
      phaseApi.getPhaseDeliverables(phaseId, sessionId),
    ]);
    setImages(list);
    const d = deliverables.find((x) => x.id === DELIVERABLE_ID);
    setZipUrl(d?.fileAvailable ? phaseApi.deliverableDownloadUrl(phaseId, sessionId, DELIVERABLE_ID) : null);
  }, [phaseId, sessionId]);

  useEffect(() => {
    load().catch(() => {
      // Nothing rendered yet.
    });
  }, [load]);

  const handleRender = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await phaseApi.generatePhaseDeliverable(phaseId, sessionId, DELIVERABLE_ID, images.length > 0);
      await load();
      setVersion(Date.now());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [phaseId, sessionId, images.length, load]);

  const screens = useMemo(() => {
    const byScreen = new Map<string, { id: string; name: string; files: Partial<Record<Variant, RenderedImage>> }>();
    for (const img of images) {
      if (!img.screenId || img.variant === 'style-guide') continue;
      const entry = byScreen.get(img.screenId) ?? { id: img.screenId, name: img.screenName ?? img.screenId, files: {} };
      entry.files[img.variant] = img;
      byScreen.set(img.screenId, entry);
    }
    return [...byScreen.values()];
  }, [images]);

  const styleGuide = images.find((i) => i.variant === 'style-guide');
  const src = (img: RenderedImage) => `${phaseApi.packageFileUrl(phaseId, sessionId, `images/${img.file}`)}&v=${version}`;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Screen designs (JPG)</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Rendered from the approved wireframes and design-system tokens — relative layouts only, responsive rules
            applied per screen.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {zipUrl && (
            <a
              href={zipUrl}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Download all (.zip)
            </a>
          )}
          <button
            onClick={handleRender}
            disabled={busy || !finalized}
            title={finalized ? undefined : 'Finalize the design package first'}
            className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            {busy ? 'Rendering…' : images.length > 0 ? 'Re-render images' : 'Render screen designs'}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      {images.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-slate-500">
          {finalized
            ? 'No images yet. Render them to get a wireframe, a desktop mockup and a mobile mockup for every screen.'
            : 'Finalize the design package, then render its screens as JPG images.'}
        </p>
      ) : (
        <div className="p-6 space-y-6">
          <div role="tablist" aria-label="Rendering" className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50">
            {VARIANTS.map((v) => (
              <button
                key={v.key}
                role="tab"
                aria-selected={variant === v.key}
                onClick={() => setVariant(v.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  variant === v.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className={`grid gap-5 ${variant === 'mobile' ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2'}`}>
            {screens.map((screen) => {
              const img = screen.files[variant];
              if (!img) return null;
              return (
                <figure key={screen.id} className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                  <a href={src(img)} target="_blank" rel="noreferrer" className="block bg-white">
                    <img
                      src={src(img)}
                      alt={`${screen.id} ${screen.name} — ${VARIANTS.find((v) => v.key === variant)?.label}`}
                      loading="lazy"
                      className={`w-full object-cover object-top ${variant === 'mobile' ? 'aspect-[9/19]' : 'aspect-[16/11]'}`}
                    />
                  </a>
                  <figcaption className="px-3 py-2 flex items-center justify-between gap-2 border-t border-slate-200">
                    <span className="text-xs text-slate-700 truncate">
                      <span className="font-mono text-slate-500">{screen.id}</span> {screen.name}
                    </span>
                    <a
                      href={phaseApi.packageFileUrl(phaseId, sessionId, `images/${img.file}`, true)}
                      className="text-xs text-accent hover:text-accent-hover font-medium shrink-0"
                    >
                      JPG ↓
                    </a>
                  </figcaption>
                </figure>
              );
            })}
          </div>

          {styleGuide && (
            <figure className="border border-slate-200 rounded-lg overflow-hidden">
              <a href={src(styleGuide)} target="_blank" rel="noreferrer" className="block bg-white">
                <img src={src(styleGuide)} alt="Design system style guide" loading="lazy" className="w-full" />
              </a>
              <figcaption className="px-3 py-2 flex items-center justify-between border-t border-slate-200 bg-slate-50">
                <span className="text-xs font-medium text-slate-700">Design system style guide</span>
                <a
                  href={phaseApi.packageFileUrl(phaseId, sessionId, `images/${styleGuide.file}`, true)}
                  className="text-xs text-accent hover:text-accent-hover font-medium"
                >
                  JPG ↓
                </a>
              </figcaption>
            </figure>
          )}
        </div>
      )}
    </div>
  );
}
