"use client";

/**
 * 1:1 preview tile for a vault item, used everywhere the agent stream
 * lists files (Shortlist, Search hits, Folder contents, Date range, …).
 *
 * Each tile is a small square — the user gets a glanceable "this is a
 * PDF, this is a markdown note, this is an image" signal without having
 * to read titles. The title sits below the square, two-line clamped.
 *
 * Renderers, per ItemType:
 *   image    → blob/src image filling the square
 *   pdf      → first page rendered via react-pdf (lazy chunk; only
 *              loaded the first time a PDF tile mounts)
 *   markdown → small excerpt of the summary on a paper-like background
 *   code     → small inline-mono excerpt + .ext badge
 *   csv      → spreadsheet icon + small "rows × cols" affordance
 *   folder   → folder icon
 *
 * Wrapped in a Link to /vault?open=<itemId> so a click opens the item
 * in the main vault surface. Hover lifts a primary halo, mirrors the
 * other interactive widgets in the right panel.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  FileBox,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useBlobUrl } from "@/components/galexy/use-blob-url";
import { useVaultItem } from "@/lib/chat/vault-resolver";
import type { ItemType } from "@/lib/mock-notes";

// react-pdf is ~600KB minified; defer to the first PDF mount.
const PdfMicroThumb = dynamic(
  () => import("./PdfMicroThumb").then((m) => m.PdfMicroThumb),
  {
    ssr: false,
    loading: () => <CenteredIcon><FileBox className="size-4 text-rose-400/70" /></CenteredIcon>,
  },
);

export interface VaultItemThumbProps {
  itemId: string;
  title: string;
  type: ItemType;
  /** Optional caption rendered as a tooltip on hover (e.g. score, snippet). */
  caption?: string;
}

const TILE_PX = 84;

export function VaultItemThumb({ itemId, title, type, caption }: VaultItemThumbProps) {
  const { item } = useVaultItem(itemId);

  return (
    <Link
      href={`/vault?open=${encodeURIComponent(itemId)}`}
      title={caption || title}
      className="group/thumb shrink-0 [scroll-snap-align:start]"
      style={{ width: TILE_PX }}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-md border border-border/60 bg-muted/30",
          "transition-[transform,border-color,box-shadow] duration-200",
          "group-hover/thumb:-translate-y-0.5 group-hover/thumb:border-primary/50",
          "group-hover/thumb:shadow-[0_4px_12px_-4px_color-mix(in_oklch,var(--primary)_35%,transparent)]",
        )}
        style={{ width: TILE_PX, height: TILE_PX }}
      >
        <ThumbContent type={type} item={item} />
        <TypeBadge type={type} />
      </div>
      <div
        className="mt-1.5 line-clamp-2 text-[10.5px] leading-tight text-foreground/85 group-hover/thumb:text-foreground"
        style={{ width: TILE_PX }}
      >
        {title}
      </div>
    </Link>
  );
}

/* ----------------------------------------------- per-type render */

function ThumbContent({
  type,
  item,
}: {
  type: ItemType;
  item: ReturnType<typeof useVaultItem>["item"];
}) {
  switch (type) {
    case "image":
      return <ImageThumb item={item} />;
    case "pdf":
      return <PdfMicroThumb blobKey={item?.blobKey ?? null} src={item?.src ?? null} />;
    case "markdown":
      return <MarkdownThumb summary={item?.summary ?? ""} />;
    case "code":
      return <CodeThumb summary={item?.summary ?? ""} />;
    case "csv":
      return <CenteredIcon><FileSpreadsheet className="size-5 text-emerald-400/80" /></CenteredIcon>;
    case "folder":
      return <CenteredIcon><Folder className="size-5 text-amber-400/80" /></CenteredIcon>;
    default:
      return <CenteredIcon><FileText className="size-5 text-sky-300/80" /></CenteredIcon>;
  }
}

function ImageThumb({
  item,
}: {
  item: ReturnType<typeof useVaultItem>["item"];
}) {
  const blobUrl = useBlobUrl(item?.blobKey ?? undefined);
  const src = blobUrl ?? item?.src ?? null;
  if (!src) {
    return (
      <CenteredIcon><ImageIcon className="size-4 text-muted-foreground/40" /></CenteredIcon>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="size-full object-cover"
      loading="lazy"
    />
  );
}

function MarkdownThumb({ summary }: { summary: string }) {
  const text = stripMd(summary).slice(0, 220);
  // "Paper" texture: warm off-white card, soft top-bar to suggest a
  // document, tiny dense lines for body.
  return (
    <div className="relative h-full w-full bg-[#f5f3ee]">
      <div className="absolute inset-x-1.5 top-1.5 h-1 rounded-sm bg-stone-300/80" />
      <div
        className="absolute inset-x-1.5 top-3.5 line-clamp-6 overflow-hidden font-mono text-[6.5px] leading-[1.5] text-stone-700"
        // Slight saturation/contrast pull so the tile looks intentional,
        // not faded.
        style={{ wordBreak: "break-word", filter: "saturate(0.9)" }}
      >
        {text || "—"}
      </div>
    </div>
  );
}

function CodeThumb({ summary }: { summary: string }) {
  const text = (summary || "").split("\n").slice(0, 6).join("\n");
  return (
    <div className="relative h-full w-full bg-zinc-950">
      <div className="absolute left-1.5 top-1 flex gap-0.5">
        <span className="size-1 rounded-full bg-rose-500/70" />
        <span className="size-1 rounded-full bg-amber-500/70" />
        <span className="size-1 rounded-full bg-emerald-500/70" />
      </div>
      <pre
        className="absolute inset-x-1.5 top-3.5 line-clamp-6 overflow-hidden font-mono text-[6.5px] leading-[1.5] text-emerald-300/80"
        style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}
      >
        {text || "—"}
      </pre>
    </div>
  );
}

function CenteredIcon({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

/* ----------------------------------------------- type badge */

function TypeBadge({ type }: { type: ItemType }) {
  // PDF tiles already read as "PDF" from the rendered page; same for
  // images. Only badge the cases where the tile content alone is
  // ambiguous (markdown excerpt could be code, code excerpt could be md).
  const map: Partial<Record<ItemType, { label: string; cls: string }>> = {
    markdown: { label: "MD", cls: "bg-sky-500/80 text-white" },
    code:     { label: "</>", cls: "bg-emerald-500/80 text-white" },
    csv:      { label: "CSV", cls: "bg-teal-500/80 text-white" },
    folder:   { label: "DIR", cls: "bg-amber-500/80 text-white" },
  };
  const meta = map[type];
  if (!meta) return null;
  return (
    <span
      className={cn(
        "absolute right-1 top-1 rounded-sm px-1 py-px font-mono text-[7.5px] leading-none shadow-sm",
        meta.cls,
      )}
    >
      {meta.label}
    </span>
  );
}

/* ----------------------------------------------- helpers */

function stripMd(md: string): string {
  return md
    .replace(/^>+\s?/gm, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
