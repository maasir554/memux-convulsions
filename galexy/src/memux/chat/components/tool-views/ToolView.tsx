"use client";

/**
 * Single entry point for rendering a tool's live view. The AgentPanel
 * gives this component the focused step's UI payload; it switches on
 * `kind` and delegates to the appropriate sub-renderer.
 *
 * Each sub-renderer is intentionally small + visual — text + an
 * appropriate "real artifact" view (search-results grid, rendered md,
 * image bytes via OPFS, etc.). The model never sees these; the user
 * does.
 */

import { ExternalLink, Folder, Image as ImageIcon, FileText, FileCode2, FileSpreadsheet, FileBox } from "lucide-react";

import { cn } from "@/lib/utils";
import { useBlobUrl } from "@/components/galexy/use-blob-url";
import type { ToolUIPayload, ItemRef } from "@/lib/chat/types";
import type { ItemType } from "@/lib/mock-notes";

export function ToolView({ payload }: { payload: ToolUIPayload | null }) {
  if (!payload) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Pick a step on the left to inspect.
      </div>
    );
  }
  switch (payload.kind) {
    case "search-results":
      return <SearchResultsView payload={payload} />;
    case "item-detail":
      return <ItemDetailView payload={payload} />;
    case "section-read":
      return <SectionReadView payload={payload} />;
    case "image-read":
      return <ImageReadView payload={payload} />;
    case "graph-fan":
      return <GraphFanView payload={payload} />;
    case "folder-list":
      return <FolderListView payload={payload} />;
    case "concept-detail":
      return <ConceptDetailView payload={payload} />;
    case "date-results":
      return <DateResultsView payload={payload} />;
    case "pdf-page":
    case "scratchpad-merge":
    default:
      return (
        <pre className="overflow-auto rounded-md bg-muted/40 p-3 text-[10px]">
          {JSON.stringify(payload, null, 2)}
        </pre>
      );
  }
}

/* ============================================================ shared */

function ItemIconSmall({ type }: { type: ItemType }) {
  const cls = "size-3.5 shrink-0";
  switch (type) {
    case "code":
      return <FileCode2 className={cn(cls, "text-sky-400")} />;
    case "csv":
      return <FileSpreadsheet className={cn(cls, "text-emerald-400")} />;
    case "pdf":
      return <FileBox className={cn(cls, "text-rose-400")} />;
    case "image":
      return <ImageIcon className={cn(cls, "text-violet-400")} />;
    case "markdown":
    default:
      return <FileText className={cn(cls, "text-sky-300")} />;
  }
}

function ItemRow({ r }: { r: ItemRef }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 py-2 text-xs hover:border-foreground/30 hover:bg-card/70">
      <ItemIconSmall type={r.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">{r.title}</span>
          {typeof r.score === "number" && (
            <span className="shrink-0 rounded-full bg-muted/50 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
              {r.score.toFixed(2)}
            </span>
          )}
        </div>
        {r.snippet && (
          <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
            {r.snippet}
          </div>
        )}
        {r.folder && (
          <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/60">
            {r.folder}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================ kinds */

function SearchResultsView({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "search-results" }>;
}) {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="text-[11px] text-muted-foreground">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] text-primary">
          {payload.tool}
        </span>{" "}
        · query <span className="font-medium text-foreground/80">&ldquo;{payload.query}&rdquo;</span> ·{" "}
        {payload.results.length} hit{payload.results.length === 1 ? "" : "s"}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {payload.results.length === 0 ? (
          <div className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-4 text-center text-xs text-muted-foreground">
            No results.
          </div>
        ) : (
          payload.results.map((r) => <ItemRow key={r.itemId} r={r} />)
        )}
      </div>
    </div>
  );
}

function ItemDetailView({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "item-detail" }>;
}) {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Item</div>
        <div className="mt-0.5 text-sm font-semibold tracking-tight text-foreground">
          {payload.title}
        </div>
      </div>
      {payload.metaPairs && payload.metaPairs.length > 0 && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px]">
          {payload.metaPairs.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate text-foreground/80">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {payload.bodyMd && (
        <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-3 text-[11px] leading-relaxed text-foreground/85">
          {payload.bodyMd}
        </pre>
      )}
    </div>
  );
}

function SectionReadView({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "section-read" }>;
}) {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Section</div>
        <div className="mt-0.5 text-sm font-semibold tracking-tight text-foreground">
          {payload.sectionTitle}
        </div>
      </div>
      <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-3 text-[11px] leading-relaxed text-foreground/85">
        {payload.markdown}
      </pre>
    </div>
  );
}

function ImageReadView({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "image-read" }>;
}) {
  const blobUrl = useBlobUrl(payload.blobKey);
  const src = blobUrl ?? payload.src ?? null;
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Image</div>
        <div className="mt-0.5 text-sm font-semibold tracking-tight text-foreground">
          {payload.alt}
        </div>
      </div>
      <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-[3fr_2fr]">
        <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted/20">
          {src ? (
            <img
              src={src}
              alt={payload.alt}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImageIcon className="size-8 text-muted-foreground/40" />
          )}
        </div>
        <div className="min-h-0 overflow-y-auto rounded-md border border-border/60 bg-card/40 p-3 text-[11px] leading-relaxed text-foreground/85">
          {payload.description}
        </div>
      </div>
    </div>
  );
}

function GraphFanView({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "graph-fan" }>;
}) {
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Graph fan</div>
        <div className="mt-0.5 font-mono text-[11px] text-foreground/80">
          {payload.centerItemId}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <FanColumn label={`Incoming (${payload.incoming.length})`} refs={payload.incoming} />
        <FanColumn label={`Outgoing (${payload.outgoing.length})`} refs={payload.outgoing} />
      </div>
    </div>
  );
}

function FanColumn({ label, refs }: { label: string; refs: ItemRef[] }) {
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {refs.length === 0 ? (
          <div className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-4 text-center text-xs text-muted-foreground">
            None.
          </div>
        ) : (
          refs.map((r) => <ItemRow key={r.itemId} r={r} />)
        )}
      </div>
    </div>
  );
}

function FolderListView({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "folder-list" }>;
}) {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Folder className="size-3.5 text-amber-400" />
        <span className="font-mono text-foreground/80">{payload.folderPath}</span>
        <span>·</span>
        <span>{payload.entries.length} entries</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {payload.entries.map((r) => (
          <ItemRow key={r.itemId} r={r} />
        ))}
      </div>
    </div>
  );
}

function ConceptDetailView({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "concept-detail" }>;
}) {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Concept</div>
        <div className="mt-0.5 text-sm font-semibold tracking-tight text-foreground">
          {payload.name}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {payload.mentions.length} mention{payload.mentions.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {payload.mentions.map((r) => (
          <ItemRow key={r.itemId} r={r} />
        ))}
      </div>
    </div>
  );
}

function DateResultsView({
  payload,
}: {
  payload: Extract<ToolUIPayload, { kind: "date-results" }>;
}) {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <ExternalLink className="size-3.5" />
        <span>
          {payload.range.from || "…"} → {payload.range.to || "now"}
        </span>
        <span>·</span>
        <span>{payload.entries.length} item{payload.entries.length === 1 ? "" : "s"}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {payload.entries.map((r) => (
          <ItemRow key={r.itemId} r={r} />
        ))}
      </div>
    </div>
  );
}
