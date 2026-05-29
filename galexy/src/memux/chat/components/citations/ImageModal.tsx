"use client";

/**
 * Shared full-screen image modal used by VaultImageEmbed and the
 * source-capture pill on VaultCitation. Keeps three affordances in the
 * header:
 *   - title + folder breadcrumb
 *   - "View source" link (favicon + domain) when the image came from a
 *     captured webpage
 *   - "Open in vault" link to jump to the item in the file explorer
 *
 * The favicon comes from DuckDuckGo's public icon service — no API keys,
 * no Google tracking, falls back silently to a generic icon if the host
 * doesn't have one.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ExternalLink, Globe, X } from "lucide-react";

export function ImageModal({
  src,
  alt,
  itemId,
  title,
  folder,
  sourceUrl,
  onClose,
}: {
  src: string;
  alt: string;
  itemId: string;
  title: string;
  folder: string;
  sourceUrl?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const host = parseHost(sourceUrl);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm"
    >
      <div
        className="relative flex max-h-[92vh] max-w-[92vw] flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 rounded-t-lg bg-card/80 px-4 py-2 text-sm backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold tracking-tight text-foreground">
              {title}
            </div>
            {folder && (
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {folder}
              </div>
            )}
          </div>
          {host && sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-[40ch] items-center gap-1.5 truncate rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] text-foreground/85 hover:border-foreground/30 hover:bg-muted/70 no-underline"
              title={sourceUrl}
            >
              <Favicon host={host} className="size-3.5" />
              <span className="truncate">{host}</span>
              <ExternalLink className="size-3 shrink-0 opacity-60" />
            </a>
          )}
          <Link
            href={`/vault?open=${encodeURIComponent(itemId)}`}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] text-foreground/85 hover:border-foreground/30 hover:bg-muted/70 no-underline"
            onClick={onClose}
          >
            <ExternalLink className="size-3" />
            Open in vault
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-border/60 bg-muted/40 p-1.5 text-muted-foreground hover:border-foreground/30 hover:bg-muted/70 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <img
          src={src}
          alt={alt}
          className="max-h-[80vh] max-w-[92vw] rounded-b-lg object-contain"
        />
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------------------------------- favicon */

/**
 * Tiny img wrapper for DDG's favicon service with a graceful fallback to
 * a Lucide globe glyph when the request 404s or the host has no icon.
 */
export function Favicon({
  host,
  className = "size-4",
}: {
  host: string;
  className?: string;
}) {
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
      alt=""
      className={className}
      onError={(e) => {
        // Swap to the inline Globe icon by replacing the node — cheapest
        // fallback without state. The parent re-renders are idempotent.
        const el = e.currentTarget;
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2");
        svg.setAttribute("class", el.className);
        const circle = document.createElementNS(svgNS, "circle");
        circle.setAttribute("cx", "12");
        circle.setAttribute("cy", "12");
        circle.setAttribute("r", "10");
        svg.appendChild(circle);
        el.replaceWith(svg);
      }}
      // Hide the broken-image glyph while DDG is fetching.
      style={{ minWidth: "1em", minHeight: "1em" }}
    />
  );
}

// Suppress unused-import warning when Globe is only used as a JSX-less
// fallback in onError — exported so future callers can reuse.
export const GlobeIcon = Globe;

export function parseHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}
