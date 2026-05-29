"use client";

/**
 * Compact, glanceable preview rendered inside each ActivityCard. One
 * branch per ToolUIPayload kind. Visual-first: thumbnails, icons, pills.
 * Less text than a full ToolView; the goal is "what did the agent just
 * find" in under a second of looking.
 */

import {
  ArrowUpRight,
  ExternalLink,
  FileBox,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
  Link2,
  Loader2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useBlobUrl } from "@/components/galexy/use-blob-url";
import { useVaultItem } from "@/lib/chat/vault-resolver";
import type { ActivityStep } from "@/memux/chat/lib/agent-store";
import type { ItemRef, ToolUIPayload } from "@/lib/chat/types";
import type { ItemType } from "@/lib/mock-notes";

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

/* ------------------------------------------------- shared bits */

function ItemIconForType({ type }: { type: ItemType }) {
  const cls = "size-3.5 shrink-0";
  switch (type) {
    case "code": return <FileCode2 className={cn(cls, "text-sky-400")} />;
    case "csv": return <FileSpreadsheet className={cn(cls, "text-emerald-400")} />;
    case "pdf": return <FileBox className={cn(cls, "text-rose-400")} />;
    case "image": return <ImageIcon className={cn(cls, "text-violet-400")} />;
    case "markdown":
    default: return <FileText className={cn(cls, "text-sky-300")} />;
  }
}

/** Small thumbnail loader for image-type ItemRefs. Falls back to icon. */
function ResultThumb({ ref }: { ref: ItemRef }) {
  const { item } = useVaultItem(ref.type === "image" ? ref.itemId : null);
  const blobUrl = useBlobUrl(item?.blobKey ?? undefined);
  if (ref.type !== "image") {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted/30">
        <ItemIconForType type={ref.type} />
      </div>
    );
  }
  if (!blobUrl) {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted/30">
        <ImageIcon className="size-3.5 text-muted-foreground/50" />
      </div>
    );
  }
  return (
    <div className="size-12 shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted/30">
      <img src={blobUrl} alt={ref.title} className="size-full object-cover" loading="lazy" />
    </div>
  );
}

/* ----------------------------------------------- search-results */

function SearchResultsPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "search-results" }>;
}) {
  const top = payload.results.slice(0, 5);

  // Empty-result case: still surface the query so the user can see WHAT
  // was searched (otherwise a card that just reads "No results." gives
  // them no signal at all about what the agent tried).
  if (top.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">
        <span className="italic">&ldquo;{payload.query}&rdquo;</span>{" "}
        <span className="text-muted-foreground/60">· no results</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="truncate text-[11px] text-muted-foreground">
        <span className="italic">&ldquo;{payload.query}&rdquo;</span>{" "}
        <span className="text-muted-foreground/60">· {payload.results.length} hits</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {top.map((r, i) => (
          <div
            key={r.itemId}
            title={r.snippet || r.title}
            // Per-chip stagger entrance — same ws-card-enter keyframe the
            // outer card uses, just smaller delays so a wave of chips
            // cascades in instead of popping all at once.
            className="ws-card-enter flex max-w-full items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-1.5 py-1 text-[11px]"
            style={{ animationDelay: `${60 + i * 70}ms` }}
          >
            <ItemIconForType type={r.type} />
            <span className="max-w-[18ch] truncate font-medium text-foreground/85">
              {r.title}
            </span>
          </div>
        ))}
        {payload.results.length > top.length && (
          <span
            className="ws-card-enter self-center text-[10px] text-muted-foreground/60"
            style={{ animationDelay: `${60 + top.length * 70}ms` }}
          >
            +{payload.results.length - top.length} more
          </span>
        )}
      </div>
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
    <div className="flex flex-col gap-1">
      <div className="truncate text-[12px] font-medium text-foreground/90">
        {payload.title}
      </div>
      {payload.bodyMd && (
        <div className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/85">
          {stripMd(payload.bodyMd)}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------- section-read */

function SectionReadPreview({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "section-read" }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="truncate text-[12px] font-medium text-foreground/90">
        {payload.sectionTitle}
      </div>
      <div className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/85">
        {stripMd(payload.markdown)}
      </div>
    </div>
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
    <div className="flex items-start gap-2.5">
      <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted/30">
        {src ? (
          <img src={src} alt={payload.alt} className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="size-4 text-muted-foreground/50" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-foreground/90">{payload.alt}</div>
        <div className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground/85">
          {payload.description || "—"}
        </div>
      </div>
    </div>
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
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground/85">
      <span>
        <span className="font-mono text-foreground">{inN}</span> in
      </span>
      <span className="size-1 rounded-full bg-muted-foreground/40" />
      <span>
        <span className="font-mono text-foreground">{outN}</span> out
      </span>
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
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Folder className="size-3.5 text-amber-400" />
        <span className="truncate font-mono text-[10px]">{payload.folderPath}</span>
        <span className="text-muted-foreground/60">· {payload.entries.length}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {payload.entries.slice(0, 4).map((r) => (
          <ResultThumb key={r.itemId} ref={r} />
        ))}
        {payload.entries.length > 4 && (
          <span className="self-center text-[10px] text-muted-foreground/60">
            +{payload.entries.length - 4}
          </span>
        )}
      </div>
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
    <div className="flex flex-col gap-1">
      <div className="text-[12px] font-medium text-foreground/90">{payload.name}</div>
      <div className="text-[11px] text-muted-foreground/85">
        {payload.mentions.length} mention{payload.mentions.length === 1 ? "" : "s"}
      </div>
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
    <div className="text-[11px] text-muted-foreground/85">
      <span className="font-mono text-foreground">
        {payload.range.from || "…"}
      </span>
      <span className="mx-1.5 text-muted-foreground/60">→</span>
      <span className="font-mono text-foreground">{payload.range.to || "now"}</span>
      <span className="ml-2 text-muted-foreground/60">· {payload.entries.length} items</span>
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
