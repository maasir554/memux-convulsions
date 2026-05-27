"use client";

import { useEffect } from "react";

import { useIndexerStore } from "@/lib/indexer/queue-store";
import { attachFiles, createDraft, enqueue } from "@/lib/indexer/queue-db";

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
  const lines: string[] = [];
  lines.push(`Captured from ${c.url}`);
  lines.push(`Title: ${c.title}`);
  lines.push(`Captured at: ${c.capturedAt}`);
  if (c.context && c.context.trim()) {
    lines.push("", "User context:", c.context.trim());
  }
  if (c.prunedTree) {
    lines.push("", "Pruned accessibility tree (use as supplementary structure):");
    lines.push("```json");
    try {
      lines.push(JSON.stringify(c.prunedTree, null, 0));
    } catch {
      lines.push("{}");
    }
    lines.push("```");
  }
  return lines.join("\n");
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
  await enqueue(id);
  return id;
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
