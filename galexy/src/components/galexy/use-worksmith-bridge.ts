"use client";

import { useEffect } from "react";

import type { useVault } from "@/components/galexy/use-vault";

/**
 * Bridge protocol — the worksmith extension's content script posts messages
 * shaped like this to the galexy tab:
 *
 *   window.postMessage({
 *     type: "memux.worksmith.captures",
 *     payload: WorksmithCapture[]
 *   }, window.location.origin);
 *
 * Galexy inserts each capture as a markdown note tagged `#worksmith` so the
 * existing search / graph / inbox views all see it. After ingest we post an
 * ack back so the extension can drop its outbound queue.
 */
export type WorksmithCapture = {
  /** Stable extension-side id, used in the ack reply. */
  externalId: string;
  url: string;
  title: string;
  /** Page text / a11y summary at capture time. */
  text?: string;
  /** ISO 8601. */
  capturedAt: string;
  tabId?: number;
};

const INBOUND = "memux.worksmith.captures";
const ACK = "memux.worksmith.ack";

type CreateNote = ReturnType<typeof useVault>["createNote"];
type UpdateContent = ReturnType<typeof useVault>["updateContent"];

function isInbound(data: unknown): data is {
  type: typeof INBOUND;
  payload: WorksmithCapture[];
} {
  if (!data || typeof data !== "object") return false;
  const m = data as { type?: unknown; payload?: unknown };
  return (
    m.type === INBOUND &&
    Array.isArray(m.payload) &&
    m.payload.every(
      (c) =>
        c &&
        typeof c === "object" &&
        typeof (c as WorksmithCapture).url === "string" &&
        typeof (c as WorksmithCapture).title === "string" &&
        typeof (c as WorksmithCapture).externalId === "string",
    )
  );
}

function captureToMarkdown(c: WorksmithCapture): string {
  const lines = [`# ${c.title || c.url}`, ""];
  lines.push("#worksmith #capture", "");
  lines.push(`- **URL**: ${c.url}`);
  lines.push(`- **Captured**: ${c.capturedAt}`);
  if (c.tabId !== undefined) lines.push(`- **Tab**: ${c.tabId}`);
  if (c.text && c.text.trim().length > 0) {
    lines.push("", "## Snapshot", "", c.text.trim());
  }
  return lines.join("\n") + "\n";
}

/**
 * Install the bridge listener for as long as the host component is mounted.
 * Only accepts messages from the same origin (the extension content script
 * runs there) so untrusted pages can't seed the vault.
 */
export function useWorksmithBridge(
  createNote: CreateNote,
  updateContent: UpdateContent,
): void {
  useEffect(() => {
    function handle(event: MessageEvent) {
      // Same-origin only — Chrome's content scripts inject at the page's
      // origin, so legitimate events satisfy this.
      if (event.origin !== window.location.origin) return;
      if (!isInbound(event.data)) return;

      const captures = event.data.payload;
      const acks: string[] = [];

      (async () => {
        for (const capture of captures) {
          try {
            const id = await createNote({
              type: "markdown",
              title: capture.title || capture.url,
              folder: "Worksmith",
            });
            // createNote seeds a stub body (`# Title`); replace it with the
            // full capture markdown.
            updateContent(id, captureToMarkdown(capture));
            acks.push(capture.externalId);
          } catch (err) {
            console.warn("[worksmith] ingest failed:", capture.externalId, err);
          }
        }
        if (acks.length > 0) {
          window.postMessage(
            { type: ACK, externalIds: acks },
            window.location.origin,
          );
        }
      })();
    }

    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [createNote, updateContent]);
}
