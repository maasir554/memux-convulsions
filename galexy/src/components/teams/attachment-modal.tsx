/**
 * In-app preview for a chat attachment.
 *
 * Why a focused viewer rather than the vault ones in src/components/galexy/
 * viewers/*: those expect a `Note` object with blobKey/annotations/etc., a
 * model tailored to the editor pane. Chat attachments are simpler — just a
 * URL + filename + contentType — and the modal context wants a flat
 * "open / look / close" experience without sidebars or annotation editing.
 *
 * Renderers, by contentType:
 *   image/*    → <img> with object-contain fit; click toggles 1x ↔ 2x zoom
 *   application/pdf  → react-pdf Document scrolling through every page
 *   text/csv (or .csv extension) → parsed into a read-only table
 *   text/*     → raw <pre>
 *   anything else → file card with size + download button
 *
 * The modal owns the fetch for non-image content (so the URL goes through
 * the proxied /api/attachments and the session cookie comes along).
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Download,
  File as FileIcon,
  Loader2,
  X,
} from "lucide-react";

import { VisuallyHidden } from "radix-ui";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseCsv } from "@/lib/csv";
import { attachmentUrl } from "@/lib/teams/api";
import type { ChatAttachment } from "@/lib/teams/types";
import { cn } from "@/lib/utils";

// react-pdf must not run at SSR (pdfjs touches window). Dynamic import keeps
// the chat bundle slim too — the PDF code only loads when someone opens a
// PDF preview.
const PdfPreview = dynamic(() => import("./pdf-preview").then((m) => m.PdfPreview), {
  ssr: false,
  loading: () => (
    <PreviewMessage>
      <Loader2 className="size-4 animate-spin" /> Loading PDF viewer…
    </PreviewMessage>
  ),
});

export function AttachmentModal({
  attachment,
  onClose,
}: {
  attachment: ChatAttachment | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(attachment)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        // Override Dialog's default chrome: full-bleed body, no padding, and
        // hide the built-in top-right close (we render our own in the
        // header so it sits alongside the filename + Download button).
        className="flex h-[90vh] max-w-[min(96vw,72rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,72rem)] [&>[data-slot=dialog-close-button]]:hidden"
      >
        {attachment && <ModalBody attachment={attachment} onClose={onClose} />}
        <VisuallyHidden.Root>
          <DialogTitle>{attachment?.filename ?? "Attachment"}</DialogTitle>
        </VisuallyHidden.Root>
      </DialogContent>
    </Dialog>
  );
}

function ModalBody({
  attachment,
  onClose,
}: {
  attachment: ChatAttachment;
  onClose: () => void;
}) {
  const url = attachmentUrl(attachment.key);
  const kind = pickKind(attachment);

  return (
    <>
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{attachment.filename}</div>
          <div className="text-[10px] text-muted-foreground">
            {formatBytes(attachment.size)} · {attachment.contentType}
          </div>
        </div>
        <a
          href={url}
          download={attachment.filename}
          className="flex h-8 items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium hover:bg-accent"
        >
          <Download className="size-3.5" /> Download
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-md border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/20">
        {kind === "image" && <ImagePreview url={url} alt={attachment.filename} />}
        {kind === "pdf" && <PdfPreview url={url} />}
        {kind === "csv" && <CsvPreview url={url} />}
        {kind === "text" && <TextPreview url={url} />}
        {kind === "other" && <UnsupportedPreview attachment={attachment} url={url} />}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Kind dispatch
// ─────────────────────────────────────────────────────────────────────────

type Kind = "image" | "pdf" | "csv" | "text" | "other";

function pickKind(a: ChatAttachment): Kind {
  const ct = a.contentType.toLowerCase();
  const name = a.filename.toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (ct === "text/csv" || name.endsWith(".csv")) return "csv";
  if (ct.startsWith("text/") || name.endsWith(".md") || name.endsWith(".txt")) {
    return "text";
  }
  return "other";
}

// ─────────────────────────────────────────────────────────────────────────
// Image — click to toggle 1x ↔ 2x zoom (with scroll-pan when zoomed)
// ─────────────────────────────────────────────────────────────────────────

function ImagePreview({ url, alt }: { url: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <div
      className={cn(
        "h-full overflow-auto",
        zoomed ? "cursor-zoom-out" : "cursor-zoom-in",
      )}
      onClick={() => setZoomed((z) => !z)}
    >
      <div className="flex min-h-full min-w-full items-center justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          className={cn(
            "rounded-md shadow-sm transition-transform duration-150",
            zoomed
              ? "max-w-none origin-center scale-[2]"
              : "max-h-[calc(90vh-4rem)] max-w-full object-contain",
          )}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CSV — fetched, parsed, rendered as a sticky-header table
// ─────────────────────────────────────────────────────────────────────────

function CsvPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`fetch failed (${r.status})`);
        return r.text();
      })
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const rows = useMemo(() => (text ? parseCsv(text) : []), [text]);

  if (error) return <PreviewMessage>Couldn’t load: {error}</PreviewMessage>;
  if (text === null) {
    return (
      <PreviewMessage>
        <Loader2 className="size-4 animate-spin" /> Loading…
      </PreviewMessage>
    );
  }
  if (rows.length === 0) return <PreviewMessage>Empty CSV.</PreviewMessage>;

  const [header, ...body] = rows;
  return (
    <div className="h-full overflow-auto p-4">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-background">
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                className="border-b px-2 py-1.5 text-left font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="odd:bg-muted/30">
              {row.map((cell, ci) => (
                <td key={ci} className="border-b border-border/40 px-2 py-1 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Plain text
// ─────────────────────────────────────────────────────────────────────────

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`fetch failed (${r.status})`);
        return r.text();
      })
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <PreviewMessage>Couldn’t load: {error}</PreviewMessage>;
  if (text === null) {
    return (
      <PreviewMessage>
        <Loader2 className="size-4 animate-spin" /> Loading…
      </PreviewMessage>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <pre className="font-mono text-xs whitespace-pre-wrap break-words text-foreground/90">
        {text}
      </pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Unsupported fallback
// ─────────────────────────────────────────────────────────────────────────

function UnsupportedPreview({
  attachment,
  url,
}: {
  attachment: ChatAttachment;
  url: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-sm rounded-lg border bg-card p-6 text-center">
        <FileIcon className="mx-auto size-10 text-muted-foreground" />
        <div className="mt-3 truncate text-sm font-medium">{attachment.filename}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {formatBytes(attachment.size)} · {attachment.contentType}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          No inline preview for this file type.
        </p>
        <a
          href={url}
          download={attachment.filename}
          className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
        >
          <Download className="size-3.5" /> Download
        </a>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────

function PreviewMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
