"use client";

/**
 * Page/section extractors — one function per source type, all return an
 * async iterable of ExtractedSection. The orchestrator walks these.
 *
 * PDF extraction renders each page to an offscreen canvas; the canvas is
 * retained per page so the cropper (bbox → image) can re-use the bitmap
 * without re-rendering.
 */

import { readBlobUrl } from "@/lib/blob-store";
import type { IndexerFileRef } from "@/lib/db/schema";

export type ExtractedSection = {
  /** 1-based ordinal within the file. */
  ordinal: number;
  kind: "pdf-page" | "md-heading" | "csv-table" | "image" | "code-symbol";
  /** Display label (heading text, "Page N", filename for whole-file kinds). */
  label: string;
  /** When the section can be sent as text instead of vision (md/code/csv). */
  text?: string;
  /** When the section needs the VLM: base64 PNG, no data: prefix. */
  imageBase64?: string;
  mimeType?: string;
  /** Optional reference back to the source bitmap for cropping. */
  bitmap?: HTMLCanvasElement;
  /**
   * Small data URL (~120px wide) for the live progress thumbnail strip.
   * Only set for image-bearing kinds (pdf-page, image).
   */
  thumbnailDataUrl?: string;
  /** Full-resolution data URL of the page, for the live progress hero. */
  fullDataUrl?: string;
};

/* ------------------------------------------------------------------ pdf */

let pdfjsModule: typeof import("pdfjs-dist") | null = null;

async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (pdfjsModule) return pdfjsModule;
  // pdfjs-dist v5 is ESM-only; dynamic import to keep it out of SSR.
  const mod = await import("pdfjs-dist");
  // Worker URL — mirrors the one used in the PDF viewer.
  mod.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  pdfjsModule = mod;
  return mod;
}

const PDF_RENDER_SCALE = 1.75;

export async function* extractPdf(
  file: File,
): AsyncIterable<ExtractedSection> {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({
    data: buffer,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to acquire 2D context");
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), "image/png"),
      );
      if (!blob) throw new Error(`PDF page ${i} → blob failed`);
      const base64 = await blobToBase64(blob);

      const thumbnailDataUrl = await canvasToThumbDataUrl(canvas, 140);
      const fullDataUrl = `data:image/png;base64,${base64}`;
      yield {
        ordinal: i,
        kind: "pdf-page",
        label: `Page ${i}`,
        imageBase64: base64,
        mimeType: "image/png",
        bitmap: canvas,
        thumbnailDataUrl,
        fullDataUrl,
      };

      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}

/* ----------------------------------------------------------- markdown */

/** Split markdown by top-level headings (#, ##). Falls back to one section if no headings. */
export async function* extractMarkdown(
  file: File,
): AsyncIterable<ExtractedSection> {
  const text = await file.text();
  const lines = text.split("\n");
  const sections: { label: string; body: string[] }[] = [];
  let current: { label: string; body: string[] } = {
    label: file.name.replace(/\.[^.]+$/, ""),
    body: [],
  };
  for (const line of lines) {
    const heading = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current.body.length > 0 || current.label !== file.name.replace(/\.[^.]+$/, "")) {
        sections.push(current);
      }
      current = { label: heading[2], body: [line] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);

  // Filter out empty sections caused by a leading heading.
  const real = sections.filter((s) => s.body.join("").trim().length > 0);
  const list = real.length > 0 ? real : [sections[0]];

  for (let i = 0; i < list.length; i++) {
    yield {
      ordinal: i + 1,
      kind: "md-heading",
      label: list[i].label,
      text: list[i].body.join("\n").trim(),
    };
  }
}

/* ---------------------------------------------------------------- csv */

const CSV_ROWS_PER_CHUNK = 200;

export async function* extractCsv(
  file: File,
): AsyncIterable<ExtractedSection> {
  const text = await file.text();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return;
  const header = lines[0];
  const body = lines.slice(1).filter((l) => l.length > 0);
  if (body.length === 0) {
    yield {
      ordinal: 1,
      kind: "csv-table",
      label: file.name,
      text: header,
    };
    return;
  }
  const totalChunks = Math.ceil(body.length / CSV_ROWS_PER_CHUNK);
  for (let c = 0; c < totalChunks; c++) {
    const start = c * CSV_ROWS_PER_CHUNK;
    const slice = body.slice(start, start + CSV_ROWS_PER_CHUNK);
    yield {
      ordinal: c + 1,
      kind: "csv-table",
      label:
        totalChunks === 1
          ? file.name
          : `${file.name} rows ${start + 1}–${start + slice.length}`,
      text: [header, ...slice].join("\n"),
    };
  }
}

/* --------------------------------------------------------------- image */

export async function* extractImage(
  file: File,
): AsyncIterable<ExtractedSection> {
  const base64 = await blobToBase64(file);
  const mimeType = file.type || "image/png";
  const fullDataUrl = `data:${mimeType};base64,${base64}`;
  // Both a small thumbnail AND a full-resolution canvas — the latter is what
  // writeCropImage uses to crop diagrams the Visioner detects. Without it,
  // the orchestrator would emit empty wikilink: refs (broken markdown).
  const [thumbnailDataUrl, bitmap] = await Promise.all([
    imageBlobToThumbDataUrl(file, 140).catch(() => fullDataUrl),
    imageBlobToCanvas(file).catch(() => null),
  ]);
  yield {
    ordinal: 1,
    kind: "image",
    label: file.name,
    imageBase64: base64,
    mimeType,
    thumbnailDataUrl,
    fullDataUrl,
    bitmap: bitmap ?? undefined,
  };
}

/* ---------------------------------------------------------------- code */

const CODE_LINES_PER_CHUNK = 400;

export async function* extractCode(
  file: File,
): AsyncIterable<ExtractedSection> {
  const text = await file.text();
  const lines = text.split("\n");
  const totalChunks = Math.ceil(lines.length / CODE_LINES_PER_CHUNK);
  for (let c = 0; c < totalChunks; c++) {
    const start = c * CODE_LINES_PER_CHUNK;
    const slice = lines.slice(start, start + CODE_LINES_PER_CHUNK);
    yield {
      ordinal: c + 1,
      kind: "code-symbol",
      label:
        totalChunks === 1
          ? file.name
          : `${file.name} L${start + 1}–${start + slice.length}`,
      text: slice.join("\n"),
    };
  }
}

/* ------------------------------------------------------ dispatch ----- */

/** Pick the right extractor by mime+name. */
export function extractorFor(
  ref: IndexerFileRef,
): (file: File) => AsyncIterable<ExtractedSection> {
  const lower = ref.name.toLowerCase();
  if (ref.mimeType === "application/pdf" || lower.endsWith(".pdf")) return extractPdf;
  if (ref.mimeType.startsWith("image/")) return extractImage;
  if (ref.mimeType === "text/csv" || lower.endsWith(".csv")) return extractCsv;
  if (
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    ref.mimeType === "text/markdown"
  )
    return extractMarkdown;
  // Default everything else (txt + source code) through the code path.
  return extractCode;
}

/** Re-hydrate a File from OPFS by blobKey. */
export async function fileFromRef(ref: IndexerFileRef): Promise<File> {
  if (!ref.blobKey) throw new Error(`File ref ${ref.id} has no blobKey`);
  const url = await readBlobUrl(ref.blobKey);
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new File([blob], ref.name, {
      type: ref.mimeType || blob.type || "application/octet-stream",
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------ helpers ------ */

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result ?? "");
      const idx = dataUrl.indexOf("base64,");
      if (idx < 0) {
        reject(new Error("Reader returned non-base64 data URL"));
        return;
      }
      resolve(dataUrl.slice(idx + "base64,".length));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Downscale a canvas to `maxWidth` (preserving aspect) and return a data URL. */
async function canvasToThumbDataUrl(
  source: HTMLCanvasElement,
  maxWidth: number,
): Promise<string> {
  const scale = Math.min(1, maxWidth / source.width);
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return out.toDataURL("image/jpeg", 0.7);
}

/** Decode an image blob into a full-resolution canvas (for cropping). */
async function imageBlobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image decode failed"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to acquire 2D context");
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decode an image blob, downscale, and return a data URL. */
async function imageBlobToThumbDataUrl(
  blob: Blob,
  maxWidth: number,
): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image decode failed"));
      el.src = url;
    });
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}
