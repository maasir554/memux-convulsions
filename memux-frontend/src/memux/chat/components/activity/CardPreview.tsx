"use client";

/**
 * Compact, glanceable preview rendered inside each ActivityCard. One
 * branch per ToolUIPayload kind. Visual-first: thumbnails, icons, pills.
 * Less text than a full ToolView; the goal is "what did the agent just
 * find" in under a second of looking.
 */

import Link from "next/link";
import {
  ArrowUpRight,
  ExternalLink,
  Folder,
  Image as ImageIcon,
  Link2,
  Loader2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useBlobUrl } from "@/components/galexy/use-blob-url";
import { HorizontalScroller } from "@/memux/chat/components/activity/HorizontalScroller";
import { VaultItemThumb } from "@/memux/chat/components/activity/VaultItemThumb";
import type { ActivityStep } from "@/memux/chat/lib/agent-store";
import type { ToolUIPayload } from "@/lib/chat/types";

export function CardPreview({ step }: { step: ActivityStep }) {
  if (step.status === "running") {
    return <RunningPreview step={step} />;
  }
  if (!step.result?.ok) {
    const errText = step.result && !step.result.ok ? step.result.error : "Failed.";
    const isDuplicate = errText.startsWith("You already called");
    // For duplicates, show a tight neutral one-liner instead of the
    // full nag. The agent treats this as routine; the user shouldn't
    // see a wall of red text either.
    if (isDuplicate) {
      return (
        <div className="text-[11px] italic text-muted-foreground/70">
          Repeat call — already returned above.
        </div>
      );
    }
    return (
      <div className="text-[11px] italic text-destructive/80">{errText}</div>
    );
  }
  return <RenderPayload payload={step.result.ui} />;
}

/* ----------------------------------------------- running preview */

function RunningPreview({ step }: { step: ActivityStep }) {
  // While the tool is in flight we show the args (compact) so the user
  // sees WHAT we're working on right now. Skip when args is empty.
  const arg = summariseArgs(step.args);
  if (!arg) return null;
  return (
    <div className="flex items-center gap-1.5 text-[11px] italic text-muted-foreground">
      <Loader2 className="size-3 shrink-0 animate-spin opacity-60" aria-hidden />
      <span className="truncate">{arg}</span>
    </div>
  );
}

function summariseArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const o = args as Record<string, unknown>;
  if (typeof o.query === "string" && o.query.trim()) return `"${o.query.trim()}"`;
  if (typeof o.folderPath === "string" && o.folderPath) return o.folderPath;
  if (typeof o.itemId === "string" && o.itemId) return shortId(o.itemId);
  if (typeof o.name === "string" && o.name) return o.name;
  if (typeof o.sectionId === "string" && o.sectionId) return shortId(o.sectionId);
  return "";
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

/* ----------------------------------------------- payload switch */

function RenderPayload({ payload }: { payload: ToolUIPayload }) {
  switch (payload.kind) {
    case "search-results":
      return <SearchResultsPreview payload={payload} />;
    case "item-detail":
      return <ItemDetailPreview payload={payload} />;
    case "section-read":
      return <SectionReadPreview payload={payload} />;
    case "image-read":
      return <ImageReadPreview payload={payload} />;
    case "graph-fan":
      return <GraphFanPreview payload={payload} />;
    case "folder-list":
      return <FolderListPreview payload={payload} />;
    case "concept-detail":
      return <ConceptDetailPreview payload={payload} />;
    case "date-results":
      return <DateResultsPreview payload={payload} />;
    case "section-links":
      return <SectionLinksPreview payload={payload} />;
    case "tree-query":
      return <TreeQueryPreview payload={payload} />;
    default:
      return null;
  }
}

/* ----------------------------------------------- search-results */

function SearchResultsPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "search-results" }>;
}) {
  // Empty-result case: still surface the query so the user can see WHAT
  // was searched (otherwise a card that just reads "No results." gives
  // them no signal at all about what the agent tried).
  if (payload.results.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">
        <span className="italic">&ldquo;{payload.query}&rdquo;</span>{" "}
        <span className="text-muted-foreground/60">· no results</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="truncate text-[11px] text-muted-foreground">
        <span className="italic">&ldquo;{payload.query}&rdquo;</span>{" "}
        <span className="text-muted-foreground/60">· {payload.results.length} hits</span>
      </div>
      <HorizontalScroller className="-mx-1 px-1" ariaLabel="Search results">
        {payload.results.map((r) => (
          <VaultItemThumb
            key={r.itemId}
            itemId={r.itemId}
            title={r.title}
            type={r.type}
            caption={r.snippet || r.title}
          />
        ))}
      </HorizontalScroller>
    </div>
  );
}

/* ----------------------------------------------- item-detail */

function ItemDetailPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "item-detail" }>;
}) {
  return (
    <Link
      href={`/vault?open=${encodeURIComponent(payload.itemId)}`}
      className="group/itd flex flex-col gap-1"
    >
      <div className="truncate text-[12px] font-medium text-foreground/90 group-hover/itd:text-primary">
        {payload.title}
      </div>
      {payload.bodyMd && (
        <div className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/85">
          {stripMd(payload.bodyMd)}
        </div>
      )}
    </Link>
  );
}

/* ----------------------------------------------- section-read */

function SectionReadPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "section-read" }>;
}) {
  return (
    <Link
      href={`/vault?open=${encodeURIComponent(payload.noteItemId)}`}
      className="group/sec flex flex-col gap-1"
    >
      <div className="truncate text-[12px] font-medium text-foreground/90 group-hover/sec:text-primary">
        {payload.sectionTitle}
      </div>
      <div className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/85">
        {stripMd(payload.markdown)}
      </div>
    </Link>
  );
}

/* ----------------------------------------------- image-read */

function ImageReadPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "image-read" }>;
}) {
  const blobUrl = useBlobUrl(payload.blobKey);
  const src = blobUrl ?? payload.src ?? null;
  return (
    <Link
      href={`/vault?open=${encodeURIComponent(payload.itemId)}`}
      className="group/img flex items-start gap-2.5"
    >
      <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted/30 transition-colors group-hover/img:border-primary/50">
        {src ? (
          <img src={src} alt={payload.alt} className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="size-4 text-muted-foreground/50" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-foreground/90 group-hover/img:text-primary">
          {payload.alt}
        </div>
        <div className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground/85">
          {payload.description || "—"}
        </div>
      </div>
    </Link>
  );
}

/* ----------------------------------------------- graph-fan */

function GraphFanPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "graph-fan" }>;
}) {
  const inN = payload.incoming.length;
  const outN = payload.outgoing.length;
  // Merge with a tag so each tile carries an "in/out" indicator without
  // splitting the row into two scrollers (which would be cramped at 360px).
  const all = [
    ...payload.outgoing.map((r) => ({ ref: r, dir: "out" as const })),
    ...payload.incoming.map((r) => ({ ref: r, dir: "in" as const })),
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/85">
        <span>
          <span className="font-mono text-foreground">{outN}</span> out
        </span>
        <span className="size-1 rounded-full bg-muted-foreground/40" />
        <span>
          <span className="font-mono text-foreground">{inN}</span> in
        </span>
      </div>
      {all.length > 0 && (
        <HorizontalScroller className="-mx-1 px-1" ariaLabel="Graph neighbours">
          {all.map(({ ref, dir }) => (
            <div key={`${dir}-${ref.itemId}`} className="relative">
              <VaultItemThumb
                itemId={ref.itemId}
                title={ref.title}
                type={ref.type}
                caption={`${dir === "out" ? "→ outgoing" : "← incoming"} · ${ref.title}`}
              />
              <span
                className={cn(
                  "absolute left-1 top-1 rounded-sm px-1 py-px font-mono text-[8.5px] leading-none text-white shadow-sm",
                  dir === "out" ? "bg-sky-600/80" : "bg-violet-600/80",
                )}
              >
                {dir === "out" ? "→" : "←"}
              </span>
            </div>
          ))}
        </HorizontalScroller>
      )}
    </div>
  );
}

/* ----------------------------------------------- folder-list */

function FolderListPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "folder-list" }>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Folder className="size-3.5 text-amber-400" />
        <span className="truncate font-mono text-[10px]">{payload.folderPath}</span>
        <span className="text-muted-foreground/60">· {payload.entries.length}</span>
      </div>
      {payload.entries.length === 0 ? (
        <div className="text-[11px] italic text-muted-foreground/60">empty folder</div>
      ) : (
        <HorizontalScroller className="-mx-1 px-1" ariaLabel="Folder contents">
          {payload.entries.map((r) => (
            <VaultItemThumb
              key={r.itemId}
              itemId={r.itemId}
              title={r.title}
              type={r.type}
              caption={r.snippet || r.title}
            />
          ))}
        </HorizontalScroller>
      )}
    </div>
  );
}

/* ----------------------------------------------- concept-detail */

function ConceptDetailPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "concept-detail" }>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <div className="text-[12px] font-medium text-foreground/90">{payload.name}</div>
        <div className="text-[11px] text-muted-foreground/85">
          · {payload.mentions.length} mention{payload.mentions.length === 1 ? "" : "s"}
        </div>
      </div>
      {payload.mentions.length > 0 && (
        <HorizontalScroller className="-mx-1 px-1" ariaLabel="Concept mentions">
          {payload.mentions.map((r) => (
            <VaultItemThumb
              key={r.itemId}
              itemId={r.itemId}
              title={r.title}
              type={r.type}
              caption={r.snippet || r.title}
            />
          ))}
        </HorizontalScroller>
      )}
    </div>
  );
}

/* ----------------------------------------------- date-results */

function DateResultsPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "date-results" }>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-muted-foreground/85">
        <span className="font-mono text-foreground">
          {payload.range.from || "…"}
        </span>
        <span className="mx-1.5 text-muted-foreground/60">→</span>
        <span className="font-mono text-foreground">{payload.range.to || "now"}</span>
        <span className="ml-2 text-muted-foreground/60">
          · {payload.entries.length} item{payload.entries.length === 1 ? "" : "s"}
        </span>
      </div>
      {payload.entries.length > 0 && (
        <HorizontalScroller className="-mx-1 px-1" ariaLabel="Date-range items">
          {payload.entries.map((r) => (
            <VaultItemThumb
              key={r.itemId}
              itemId={r.itemId}
              title={r.title}
              type={r.type}
              caption={r.snippet || r.title}
            />
          ))}
        </HorizontalScroller>
      )}
    </div>
  );
}

/* ----------------------------------------------- section-links */

function SectionLinksPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "section-links" }>;
}) {
  const top = payload.links.slice(0, 4);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Link2 className="size-3.5 text-emerald-400" />
        <span className="truncate text-foreground/80">{payload.sectionTitle}</span>
        <span className="text-muted-foreground/60">· {payload.links.length}</span>
      </div>
      <div className="flex flex-col gap-1">
        {top.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noreferrer noopener"
            className="group/link flex items-center gap-1.5 truncate text-[11px] no-underline"
            title={l.href}
          >
            <ArrowUpRight className="size-3 shrink-0 text-muted-foreground/60 group-hover/link:text-foreground/80" />
            <span className="truncate text-foreground/85 group-hover/link:text-foreground">
              {l.anchor || cleanHostFromHref(l.href)}
            </span>
          </a>
        ))}
        {payload.links.length > top.length && (
          <span className="text-[10px] text-muted-foreground/60">
            +{payload.links.length - top.length} more
          </span>
        )}
      </div>
    </div>
  );
}

function cleanHostFromHref(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href.slice(0, 40);
  }
}

/* ----------------------------------------------- tree-query */

function TreeQueryPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "tree-query" }>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="line-clamp-1 text-[11px] italic text-muted-foreground">
        &ldquo;{payload.query}&rdquo;
      </div>
      <div className="text-[12px] leading-relaxed text-foreground/90">
        {payload.answer}
      </div>
      {payload.relevantNodes.length > 0 && (
        <div className="text-[10px] text-muted-foreground/60">
          {payload.relevantNodes.length} supporting node
          {payload.relevantNodes.length === 1 ? "" : "s"}
        </div>
      )}
      <ExternalLink className="hidden" aria-hidden />
    </div>
  );
}

/* ----------------------------------------------- helpers */

/** Strip basic markdown noise so a `line-clamp-2` snippet reads as prose. */
function stripMd(md: string): string {
  return md
    .replace(/^>+\s?/gm, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
