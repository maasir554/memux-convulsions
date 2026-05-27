#!/usr/bin/env node
/**
 * Generates the MEMUX Capture extension toolbar icons (16/32/48/128 px) as
 * RGBA PNGs into public/icons/. Uses Node's built-in `zlib` to compress IDAT
 * — no native deps required.
 *
 * Each icon is a pink → orange → yellow gradient-filled circle with a thin
 * white inner rim and per-pixel noise dusting, matching the in-popup mark.
 *
 * Run via `npm run gen:icons` (also wired into `prebuild`).
 */

import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Hex → [r, g, b]. */
function hex(h) {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const STOPS = [
  { at: 0.0, c: hex("#f472b6") }, // pink-400
  { at: 0.55, c: hex("#fb923c") }, // orange-400
  { at: 1.0, c: hex("#fde047") }, // yellow-300
];

function gradientAt(t) {
  // Clamp + find surrounding stops.
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i].at) {
      const a = STOPS[i - 1];
      const b = STOPS[i];
      const k = (x - a.at) / (b.at - a.at);
      return [
        Math.round(lerp(a.c[0], b.c[0], k)),
        Math.round(lerp(a.c[1], b.c[1], k)),
        Math.round(lerp(a.c[2], b.c[2], k)),
      ];
    }
  }
  return STOPS[STOPS.length - 1].c;
}

/** Build a 4-channel pixel buffer for the given size. */
function buildPixels(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const padding = Math.max(1, size * 0.06);
  const r = size / 2 - padding;
  const rimWidth = Math.max(0.5, size * 0.04);
  // Linear gradient axis from top-left to bottom-right of the circle's box.
  const ax0 = cx - r;
  const ay0 = cy - r;
  const ax1 = cx + r;
  const ay1 = cy + r;
  const axisDx = ax1 - ax0;
  const axisDy = ay1 - ay0;
  const axisLenSq = axisDx * axisDx + axisDy * axisDy;
  const noiseStrength = 18;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;

      // Soft AA at the outer edge so the circle doesn't look stair-stepped.
      const outerFade = 1 - Math.max(0, Math.min(1, dist - (r - 0.6)));
      if (outerFade <= 0) {
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 0;
        continue;
      }

      // Gradient parameter t along the diagonal axis.
      const t = ((x - ax0) * axisDx + (y - ay0) * axisDy) / axisLenSq;
      let [r0, g0, b0] = gradientAt(t);

      // Noise dust.
      const n = (Math.random() - 0.5) * noiseStrength;
      r0 = Math.max(0, Math.min(255, r0 + n));
      g0 = Math.max(0, Math.min(255, g0 + n));
      b0 = Math.max(0, Math.min(255, b0 + n));

      // Inner rim highlight — bright thin ring at distance ~ r - rimWidth.
      const rimDist = Math.abs(dist - (r - rimWidth / 2));
      const rimAlpha = Math.max(0, 1 - rimDist / (rimWidth / 2));
      const rimMix = rimAlpha * 0.22;
      r0 = Math.round(lerp(r0, 255, rimMix));
      g0 = Math.round(lerp(g0, 255, rimMix));
      b0 = Math.round(lerp(b0, 255, rimMix));

      pixels[i] = r0;
      pixels[i + 1] = g0;
      pixels[i + 2] = b0;
      pixels[i + 3] = Math.round(outerFade * 255);
    }
  }
  return pixels;
}

function encodePng(size, pixels) {
  // Prefix each scanline with a filter byte (0 = None).
  const stride = size * 4;
  const filtered = Buffer.alloc(size * (1 + stride));
  for (let y = 0; y < size; y++) {
    filtered[y * (1 + stride)] = 0;
    pixels.copy(filtered, y * (1 + stride) + 1, y * stride, y * stride + stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filtered)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sizes = [16, 32, 48, 128];
const outDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "icons",
);
mkdirSync(outDir, { recursive: true });
for (const size of sizes) {
  const png = encodePng(size, buildPixels(size));
  const file = resolve(outDir, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`  ✓ ${file} (${png.length} bytes)`);
}
console.log(`Generated ${sizes.length} icons.`);
