"use client";

/**
 * Inline citation chip rendered for `[title](vault:<itemId>)` links in
 * chat responses. Resolves the itemId to a vault Note (for the
 * type-appropriate icon + truthful title hint), and on click navigates
 * to `/vault?open=<itemId>` — the AppShell consumes the query param and
 * opens that item in a tab.
 */

import Link from "next/link";
import { FileBox, FileCode2, FileSpreadsheet, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { useVaultItem } from "@/lib/chat/vault-resolver";
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

export function VaultCitation({
  itemId,
  display,
}: {
  itemId: string;
  /** Whatever phrase the model wrote inside the markdown link's brackets. */
  display: React.ReactNode;
}) {
  const { item, loading } = useVaultItem(itemId);

  if (loading) {
    return (
      <span className="inline-flex items-baseline gap-1 align-baseline text-foreground/70">
        <Loader2 className="size-3 animate-spin self-center" />
        {display}
      </span>
    );
  }

  if (!item) {
    // Model fabricated an id, or the item was deleted post-citation.
    // Render a muted broken-link state so we don't pretend it works.
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
    <Link
      href={`/vault?open=${encodeURIComponent(item.id)}`}
      title={`${item.title} — ${item.folder || "(root)"}`}
      className={cn(
        "group/cite inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 align-baseline",
        "text-[0.86em] font-medium leading-snug text-foreground/90 no-underline",
        "transition-colors hover:border-foreground/30 hover:bg-muted/70",
      )}
    >
      <Icon className={cn("size-3 shrink-0", tint)} />
      <span className="truncate">{display}</span>
    </Link>
  );
}
