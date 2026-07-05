// Sync pdfjs-dist runtime assets into public/ so they can be referenced by
// absolute URL at runtime. Copies on every install so the worker, cmaps,
// standard fonts, and WASM decoders stay in lock-step with the installed
// pdfjs-dist version.
//
// Without the wasm decoders, scanned books that use JPEG2000 (JPX)
// compression render as blank pages (pdfjs logs "Dependent image isn't ready
// yet" for every image because openjpeg.wasm never loaded).

import { cpSync, copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

const FILES = [["node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs"]];

const DIRS = [
  ["node_modules/pdfjs-dist/cmaps", "public/pdfjs/cmaps"],
  ["node_modules/pdfjs-dist/standard_fonts", "public/pdfjs/standard_fonts"],
  ["node_modules/pdfjs-dist/wasm", "public/pdfjs/wasm"],
];

function ensureDir(p) {
  mkdirSync(dirname(p), { recursive: true });
}

function safeStat(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

for (const [src, dst] of FILES) {
  const s = safeStat(src);
  if (!s) {
    console.warn(`[pdfjs-assets] missing ${src} — skipped`);
    continue;
  }
  ensureDir(dst);
  copyFileSync(src, dst);
}

for (const [src, dst] of DIRS) {
  const s = safeStat(src);
  if (!s) {
    console.warn(`[pdfjs-assets] missing ${src} — skipped`);
    continue;
  }
  cpSync(src, dst, { recursive: true });
}

console.log("[pdfjs-assets] synced");
