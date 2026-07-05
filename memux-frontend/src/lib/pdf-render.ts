"use client";

/**
 * Shared pdf.js page rendering. Used by:
 *   • the indexer (extractors.ts) to rasterise pages for the vision model,
 *   • the notes renderer to render a referenced PDF page on demand + crop it,
 *   • the chat find_image_region tool to run vision on a single PDF page.
 *
 * We render the original PDF on demand rather than storing per-page bitmaps —
 * the vault holds the original file, not a pile of screenshots.
 */

let pdfjsModule: typeof import("pdfjs-dist") | null = null;

export async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (pdfjsModule) return pdfjsModule;
  // pdfjs-dist v5 is ESM-only; dynamic import to keep it out of SSR.
  const mod = await import("pdfjs-dist");
  mod.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  pdfjsModule = mod;
  return mod;
}

/** Default raster scale — matches the indexer's PDF render scale. */
export const PDF_RENDER_SCALE = 1.75;

/**
 * Render a single 1-based page of a PDF (given its bytes) to a canvas.
 * NOTE: pdf.js may detach the passed buffer — pass a buffer you own.
 */
export async function renderPdfPageToCanvas(
  data: ArrayBuffer | Uint8Array,
  page: number,
  scale: number = PDF_RENDER_SCALE,
): Promise<HTMLCanvasElement> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;
  try {
    const pg = await doc.getPage(page);
    const viewport = pg.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to acquire 2D context");
    await pg.render({ canvasContext: ctx, viewport, canvas }).promise;
    pg.cleanup();
    return canvas;
  } finally {
    await doc.destroy();
  }
}

// Cache rendered pages so re-mounting a note (or several figures on the same
// page) doesn't re-rasterise. Keyed by an explicit caller key + page + scale.
const dataUrlCache = new Map<string, Promise<string>>();

/** Render a PDF page to a PNG data URL. `cacheKey` (e.g. the blob key) memoises. */
export async function renderPdfPageToDataUrl(
  data: ArrayBuffer | Uint8Array,
  page: number,
  opts: { scale?: number; cacheKey?: string } = {},
): Promise<string> {
  const scale = opts.scale ?? PDF_RENDER_SCALE;
  const key = opts.cacheKey ? `${opts.cacheKey}:${page}:${scale}` : null;
  if (key) {
    const cached = dataUrlCache.get(key);
    if (cached) return cached;
  }
  const run = renderPdfPageToCanvas(data, page, scale).then((c) =>
    c.toDataURL("image/png"),
  );
  if (key) {
    dataUrlCache.set(key, run);
    // Drop the entry if the render rejects so a later attempt can retry.
    run.catch(() => dataUrlCache.delete(key));
  }
  return run;
}

/** Fetch a URL (blob: object URL or public path) into an ArrayBuffer. */
export async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.arrayBuffer();
}
