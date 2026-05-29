"use client";

/**
 * Inline citation chip rendered for `[title](vault:<itemId>)` links in
 * chat responses. Two layers:
 *
 *   1. Inline chip — type-tinted icon + the model's phrasing. Clicking
 *      navigates to `/vault?open=<itemId>` and AppShell drops the item
 *      into a tab.
 *   2. Hover preview card — after a short delay, a floating card fades
 *      in showing the source's title, folder, type, image thumbnail (if
 *      it's an image), and 2-line excerpt. Built with React Portal +
 *      manual positioning so it sits above streamdown's prose flow
 *      without disturbing line layout.
 *
 * The hover card is the headline upgrade — it converts the citation
 * from "here's a link" to "here's a glance of what I cited," which is
 * how Perplexity / Claude / ChatGPT all signal trust.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  ExternalLink,
  FileBox,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";

import { useVaultItem } from "@/lib/chat/vault-resolver";
import { useBlobUrl } from "@/components/galexy/use-blob-url";
import type { ItemType } from "@/lib/mock-notes";
import { cn } from "@/lib/utils";

const ICON_BY_TYPE: Partial<Record<ItemType, React.ComponentType<{ className?: string }>>> = {
  markdown: FileText,
  code: FileCode2,
  csv: FileSpreadsheet,
  pdf: FileBox,
  image: ImageIcon,
};

const TINT_BY_TYPE: Partial<Record<ItemType, string>> = {
  markdown: "text-sky-300",
  code: "text-emerald-300",
  csv: "text-teal-300",
  pdf: "text-rose-300",
  image: "text-violet-300",
};

const LABEL_BY_TYPE: Partial<Record<ItemType, string>> = {
  markdown: "Markdown",
  code: "Code",
  csv: "Spreadsheet",
  pdf: "PDF",
  image: "Image",
};

const OPEN_DELAY_MS = 220;
const CLOSE_DELAY_MS = 120;

export function VaultCitation({
  itemId,
  display,
}: {
  itemId: string;
  /** Whatever phrase the model wrote inside the markdown link's brackets. */
  display: React.ReactNode;
}) {
  const { item, loading } = useVaultItem(itemId);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open/close uses tiny delays so the card doesn't flicker as the user
  // sweeps the cursor across surrounding prose.
  function scheduleOpen() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (hoverOpen) return;
    openTimer.current = setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) setAnchorRect(rect);
      setHoverOpen(true);
    }, OPEN_DELAY_MS);
  }
  function scheduleClose() {
    if (openTimer.current) clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setHoverOpen(false), CLOSE_DELAY_MS);
  }

  useEffect(() => {
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  if (loading) {
    return (
      <span className="inline-flex items-baseline gap-1 align-baseline text-foreground/70">
        <Loader2 className="size-3 animate-spin self-center" />
        {display}
      </span>
    );
  }

  if (!item) {
    return (
      <span
        className="inline-flex items-baseline gap-1 rounded-md border border-dashed border-destructive/40 bg-destructive/5 px-1.5 py-0.5 align-baseline text-[0.86em] text-destructive/80"
        title={`Unknown vault item: ${itemId}`}
      >
        {display}
      </span>
    );
  }

  const Icon = ICON_BY_TYPE[item.type] ?? FileText;
  const tint = TINT_BY_TYPE[item.type] ?? "text-foreground/80";

  return (
    <>
      <Link
        ref={anchorRef}
        href={`/vault?open=${encodeURIComponent(item.id)}`}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={scheduleOpen}
        onBlur={scheduleClose}
        className={cn(
          "group/cite inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 align-baseline",
          "text-[0.86em] font-medium leading-snug text-foreground/90 no-underline",
          "transition-colors hover:border-foreground/30 hover:bg-muted/70",
        )}
      >
        <Icon className={cn("size-3 shrink-0", tint)} />
        <span className="truncate">{display}</span>
      </Link>
      {hoverOpen && anchorRect && (
        <SourcePreviewCard
          item={item}
          anchorRect={anchorRect}
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
        />
      )}
    </>
  );
}

/* ----------------------------------------------------- preview card */

function SourcePreviewCard({
  item,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: {
  item: ReturnType<typeof useVaultItem>["item"] & {};
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const blobUrl = useBlobUrl(item.type === "image" ? item.blobKey ?? undefined : undefined);
  const Icon = ICON_BY_TYPE[item.type] ?? FileText;
  const tint = TINT_BY_TYPE[item.type] ?? "text-foreground/80";
  const typeLabel = LABEL_BY_TYPE[item.type] ?? item.type;

  // Position above the chip when there's room above, otherwise below.
  // X-aligned with the chip's left edge but clamped into the viewport.
  const cardWidth = 320;
  const margin = 8;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 768;
  const placeAbove = anchorRect.top > 220;
  const top = placeAbove
    ? Math.max(margin, anchorRect.top - margin - 4)
    : Math.min(viewportH - margin, anchorRect.bottom + margin);
  const left = Math.max(
    margin,
    Math.min(viewportW - cardWidth - margin, anchorRect.left),
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "ws-card-enter pointer-events-auto fixed z-[150] rounded-xl border border-border bg-card/95 shadow-xl backdrop-blur",
      )}
      style={{
        width: cardWidth,
        left,
        top,
        // When placed above, anchor the card's bottom to the chip's top.
        transform: placeAbove ? "translateY(-100%)" : undefined,
      }}
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        {/* Thumbnail (image items) or icon tile (everything else). */}
        {item.type === "image" && blobUrl ? (
          <div className="size-14 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted/30">
            <img
              src={blobUrl}
              alt={item.title}
              className="size-full object-cover"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/30">
            <Icon className={cn("size-5", tint)} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
              {typeLabel}
            </span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
            {item.title}
          </div>
          {item.folder && (
            <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
              {item.folder}
            </div>
          )}
        </div>
      </div>

      {item.summary && (
        <div className="border-t border-border/40 px-3.5 py-2.5">
          <p className="line-clamp-3 text-[12px] leading-relaxed text-muted-foreground/90">
            {item.summary}
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-1 border-t border-border/40 px-3 py-2">
        <Link
          href={`/vault?open=${encodeURIComponent(item.id)}`}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[10.5px] font-medium text-foreground/85 hover:border-foreground/30 hover:bg-muted/60 no-underline"
        >
          <ExternalLink className="size-3" />
          Open in vault
        </Link>
      </div>
    </div>,
    document.body,
  );
}
