import mermaid from 'mermaid';

/**
 * Mermaid rendering and rasterizing, shared by every diagram screen.
 *
 * Mermaid only runs in a browser, so this is where a diagram becomes an image: the
 * viewer uses it for PNG/JPG downloads, and the design phase uses it to store a JPG
 * of each approved diagram in the package.
 */

let initialized = false;

export function initMermaid() {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    flowchart: { htmlLabels: true, curve: 'basis', useMaxWidth: true },
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  });
  initialized = true;
}

let exportCounter = 0;

/**
 * Render for export. HTML labels are drawn inside <foreignObject>, which some
 * browsers refuse to rasterize onto a canvas (the canvas is "tainted" and toBlob
 * throws), so export renders use plain SVG text labels instead. A diagram that
 * already carries its own init directive is left alone.
 */
export async function renderMermaidForExport(code: string): Promise<string> {
  initMermaid();
  const source = code.trim();
  const directive = /^%%\{\s*init/i.test(source) ? '' : '%%{init: {"flowchart": {"htmlLabels": false}}}%%\n';
  const id = `mmd-export-${Date.now()}-${++exportCounter}`;
  try {
    const { svg } = await mermaid.render(id, `${directive}${source}`);
    return svg;
  } finally {
    document.querySelectorAll(`[id^="d${id}"]`).forEach((el) => el.remove());
  }
}

/**
 * Rasterize an SVG string.
 *
 * The SVG is inlined as a data URI rather than a blob URL: a blob URL taints the
 * canvas in Safari. Width and height are forced onto the root element because
 * mermaid emits a percentage width, which an <img> cannot size itself from. JPG has
 * no transparency, so the canvas is filled white first.
 */
export async function rasterizeSvg(
  svg: string,
  opts: { scale?: number; type?: 'image/png' | 'image/jpeg'; quality?: number } = {}
): Promise<Blob> {
  const scale = opts.scale ?? 2;
  const type = opts.type ?? 'image/png';
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;

  const viewBox = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const width = viewBox.length === 4 && viewBox[2] ? viewBox[2] : 1200;
  const height = viewBox.length === 4 && viewBox[3] ? viewBox[3] : 800;

  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const serialized = new XMLSerializer().serializeToString(root);
  const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the diagram could not be rasterized'));
    img.src = dataUri;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas is unavailable in this browser');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('the image came back empty'))),
      type,
      opts.quality ?? 0.92
    );
  });
}

/** Mermaid source → JPG, ready to download or upload. */
export async function mermaidToJpg(code: string, scale = 2): Promise<Blob> {
  return rasterizeSvg(await renderMermaidForExport(code), { scale, type: 'image/jpeg' });
}

export function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
