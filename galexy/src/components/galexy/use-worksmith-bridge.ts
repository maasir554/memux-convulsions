"use client";

import { useEffect } from "react";

import { useIndexerStore } from "@/lib/indexer/queue-store";
import {
  attachFiles,
  createDraft,
  enqueue,
  setDomImages,
  setPrunedTree,
} from "@/lib/indexer/queue-db";
import { writeBlob } from "@/lib/blob-store";
import type { IndexerDomImage } from "@/lib/db/schema";

/**
 * Worksmith extension → memux indexer bridge.
 *
 * Protocol:
 *   The extension's content script posts to the page:
 *     { type: "memux.worksmith.captures", payload: WorksmithCapture[] }
 *   We respond, after ingesting:
 *     { type: "memux.worksmith.ack", externalIds: string[] }
 *
 * Each capture becomes one indexer draft group → attach screenshots → enqueue.
 * The pruned accessibility tree is appended to the group's prompt as JSON so
 * the Visioner has it as supplementary context.
 *
 * The bridge is mounted on /memux/index only. If the page isn't open, the
 * extension queues captures locally and retries when galexy is reopened.
 */

export type WorksmithCapture = {
  externalId: string;
  kind: "snap" | "full";
  url: string;
  title: string;
  capturedAt: string;
  context?: string;
  /** Data URLs (image/png typically) in capture order. */
  screenshots: string[];
  /** Pruned accessibility tree — small enough to drop in the prompt. */
  prunedTree?: unknown;
  nodeCount?: number;
  viewport?: { width: number; height: number };
  documentHeight?: number;
  /**
   * Images extracted from the captured page's DOM with bytes inlined as data
   * URIs. Cross-origin OK — the extension's service worker fetched these for
   * us. The bridge writes each to OPFS and stashes the blob keys on the
   * group's `domImages` field; the orchestrator materialises them as vault
   * items during finalise.
   */
  domImages?: Array<{
    src: string;
    alt?: string;
    dataUri?: string;
    mimeType?: string;
    width?: number;
    height?: number;
  }>;
};

const INBOUND = "memux.worksmith.captures";
const ACK = "memux.worksmith.ack";

function isInbound(
  data: unknown,
): data is { type: typeof INBOUND; payload: WorksmithCapture[] } {
  if (!data || typeof data !== "object") return false;
  const m = data as { type?: unknown; payload?: unknown };
  if (m.type !== INBOUND || !Array.isArray(m.payload)) return false;
  return m.payload.every((c) => {
    if (!c || typeof c !== "object") return false;
    const x = c as Partial<WorksmithCapture>;
    return (
      typeof x.externalId === "string" &&
      typeof x.url === "string" &&
      typeof x.title === "string" &&
      (x.kind === "snap" || x.kind === "full") &&
      Array.isArray(x.screenshots)
    );
  });
}

function dataUrlToFile(dataUrl: string, name: string): File | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  try {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new File([buf], name, { type: mime });
  } catch {
    return null;
  }
}

function buildPrompt(c: WorksmithCapture): string {
  // Per-LLM-call context kept tight on purpose: only the human-meaningful
  // metadata + the user's typed context. The pruned tree is stored
  // structurally on `group.prunedTree` and consumed programmatically by the
  // orchestrator (link enrichment, node-count signal); the LLM never reads
  // it, so we don't pay 8-20KB per Visioner/Summariser/Namer call to ship
  // JSON the model can't act on anyway.
  const lines: string[] = [];
  lines.push(`Captured from ${c.url}`);
  lines.push(`Title: ${c.title}`);
  lines.push(`Captured at: ${c.capturedAt}`);
  if (c.prunedTree) {
    // Tiny presence-only signal so anything that introspects the prompt
    // (e.g. the SourceCard's parser, or a model wanting to know "is there
    // more I could ask for?") can still tell a tree was captured.
    const counts = countTreeStructure(c.prunedTree);
    lines.push(
      `A pruned accessibility tree was captured (${counts.nodes} nodes, ${counts.interactive} interactive, ${counts.images} images). The orchestrator uses it for link enrichment after vision.`,
    );
  }
  if (c.context && c.context.trim()) {
    lines.push("", "User context:", c.context.trim());
  }
  return lines.join("\n");
}

/** Walk the tree once for a tight structural summary — no JSON in the prompt. */
function countTreeStructure(root: unknown): {
  nodes: number;
  interactive: number;
  images: number;
} {
  const INTERACTIVE = new Set([
    "button",
    "link",
    "textbox",
    "searchbox",
    "checkbox",
    "radio",
    "combobox",
    "switch",
    "tab",
    "menuitem",
  ]);
  let nodes = 0;
  let interactive = 0;
  let images = 0;
  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    nodes++;
    const role = (node as { role?: string }).role ?? "";
    if (INTERACTIVE.has(role)) interactive++;
    if (role === "img") images++;
    const children = (node as { children?: unknown[] }).children;
    if (Array.isArray(children)) for (const c of children) visit(c);
  }
  visit(root);
  return { nodes, interactive, images };
}

async function ingestOne(capture: WorksmithCapture): Promise<string | null> {
  const files: File[] = [];
  capture.screenshots.forEach((dataUrl, i) => {
    const name = capture.kind === "full"
      ? `${sanitise(capture.title) || "capture"}-${String(i + 1).padStart(2, "0")}.png`
      : `${sanitise(capture.title) || "capture"}.png`;
    const file = dataUrlToFile(dataUrl, name);
    if (file) files.push(file);
  });
  if (files.length === 0) return null;

  // Empty groupName → orchestrator's Namer agent will pick one on completion.
  const id = await createDraft({
    groupName: "",
    prompt: buildPrompt(capture),
  });
  await attachFiles(id, files);

  // Stash the pruned tree on the draft so the orchestrator can walk it for
  // link enrichment + emit a node-count signal to live progress.
  if (capture.prunedTree) {
    await setPrunedTree(id, capture.prunedTree);
  }

  // DOM images — decode each dataUri to OPFS bytes once, stash the resulting
  // blob keys on the run. The orchestrator turns them into vault items at
  // finalise so the section md / manifest can `![alt](wikilink:dom-N)` them.
  //
  // Three-layer filter:
  //   1. MIME must be image/*  (catches HTML/text bodies that slipped through
  //      the extension's content-type check).
  //   2. dataUri payload must be ≥ 200 bytes  (rejects empty/broken bodies).
  //   3. Image actually decodes AND is ≥ MIN_AREA px²  (rejects icons,
  //      trackers, and bytes that LOOK like a PNG but render as the broken-
  //      image glyph).
  if (capture.domImages && capture.domImages.length > 0) {
    const stashed: IndexerDomImage[] = [];
    for (const img of capture.domImages) {
      if (!img.dataUri) continue;

      const guessed = guessMimeFromDataUri(img.dataUri);
      const mimeType = img.mimeType || guessed || "";
      if (!mimeType.toLowerCase().startsWith("image/")) {
        console.warn(
          "[worksmith→indexer] dropping non-image dom asset:",
          img.src,
          "(mime:",
          mimeType || "unknown",
          ")",
        );
        continue;
      }

      // Crude size check on the encoded payload — anything below 200 bytes
      // (after the `data:...;base64,` header) can't possibly be a useful
      // image and was almost certainly a placeholder / empty body.
      const payloadLen = img.dataUri.length - (img.dataUri.indexOf(",") + 1);
      if (payloadLen < 200) {
        console.warn(
          "[worksmith→indexer] dropping tiny dom asset:",
          img.src,
          `(payload ${payloadLen}B)`,
        );
        continue;
      }

      // Decode-verify: if the bytes don't decode as an image, or the result
      // is below MIN_AREA, drop. This is what kills the "broken icon"
      // placeholder cases — they're either undecodable or ~16×16.
      const dims = await probeImageDimensions(img.dataUri).catch(() => null);
      if (!dims) {
        console.warn(
          "[worksmith→indexer] dropping undecodable dom asset:",
          img.src,
        );
        continue;
      }
      const MIN_DIMENSION = 48;
      if (dims.width < MIN_DIMENSION || dims.height < MIN_DIMENSION) {
        console.warn(
          "[worksmith→indexer] dropping tiny dom asset:",
          img.src,
          `(${dims.width}×${dims.height})`,
        );
        continue;
      }

      const ext = mimeType.split("/")[1]?.split(";")[0] ?? "png";
      const file = dataUrlToFile(img.dataUri, `dom-${stashed.length + 1}.${ext}`);
      if (!file) continue;
      try {
        const blobKey = await writeBlob(file);
        stashed.push({
          src: img.src,
          alt: img.alt,
          blobKey,
          mimeType,
          // Prefer the actually-decoded dimensions over the page-reported
          // ones — those are render-time CSS box sizes and often lie.
          width: dims.width,
          height: dims.height,
        });
      } catch (err) {
        console.warn("[worksmith→indexer] DOM image OPFS write failed:", err);
      }
    }
    if (stashed.length > 0) {
      await setDomImages(id, stashed);
    }
  }

  await enqueue(id);
  return id;
}

function guessMimeFromDataUri(dataUri: string): string | null {
  const m = /^data:([^;]+);/.exec(dataUri);
  return m ? m[1] : null;
}

/**
 * Decode-verify an image data URI. Returns its natural dimensions on
 * success, null on decode failure. Used to filter undecodable bodies and
 * trivially-small assets (icons, trackers) out of the indexer's input.
 */
function probeImageDimensions(
  dataUri: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        reject(new Error("Image decoded to 0×0"));
        return;
      }
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = dataUri;
  });
}

function sanitise(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 60);
}

/** Install the bridge listener for as long as the host component is mounted. */
export function useWorksmithBridge(): void {
  const load = useIndexerStore((s) => s.load);

  useEffect(() => {
    function handle(event: MessageEvent) {
      // Same-origin only — Chrome content scripts inject at the page's origin.
      if (event.origin !== window.location.origin) return;
      if (!isInbound(event.data)) return;

      const captures = event.data.payload;
      (async () => {
        const acks: string[] = [];
        for (const capture of captures) {
          try {
            const id = await ingestOne(capture);
            if (id) acks.push(capture.externalId);
          } catch (err) {
            console.warn("[worksmith→indexer] ingest failed:", capture.externalId, err);
          }
        }
        if (acks.length > 0) {
          window.postMessage(
            { type: ACK, externalIds: acks },
            window.location.origin,
          );
          // Reload the queue so the new draft + queued groups appear in the sidebar.
          await load();
        }
      })();
    }

    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [load]);
}
