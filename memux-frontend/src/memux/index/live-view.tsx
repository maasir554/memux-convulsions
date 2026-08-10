"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  CheckCircle2,
  CircleAlert,
  FileText,
  Image as ImageIcon,
  Loader2,
  ScanText,
  Sparkles,
  Type,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useActiveGroup } from "@/lib/indexer/queue-store";
import { useLiveProgress, type LivePhase } from "@/lib/indexer/live-progress";
import type { IndexerFileRef } from "@/lib/db/schema";
import { FilePreviewModal } from "./run-view";

/**
 * Limelight panel for the actively-running indexer.
 *
 * Layout:
 *   ┌─ header ──────────────────┐  (h-12)
 *   ├─ file meta ──────────────┤  (one line)
 *   ├─ hero (fills remainder) ─┤  (flex-1, object-contain)
 *   └─ thumbnail strip ────────┘  (fixed)
 *
 * Counters and recent activity live in the centre editor — this pane is
 * pure visual focus.
 */
export function LiveView({ open }: { open: boolean }) {
  const phase = useLiveProgress((s) => s.phase);
  const liveRunId = useLiveProgress((s) => s.runId);
  const groupName = useLiveProgress((s) => s.groupName);
  const activeFileName = useLiveProgress((s) => s.activeFileName);
  const activeFileIndex = useLiveProgress((s) => s.activeFileIndex);
  const totalFiles = useLiveProgress((s) => s.totalFiles);
  const activePageOrdinal = useLiveProgress((s) => s.activePageOrdinal);
  const activePageDataUrl = useLiveProgress((s) => s.activePageDataUrl);
  const thumbnails = useLiveProgress((s) => s.thumbnails);
  const currentTopic = useLiveProgress((s) => s.currentTopic);
  const treeUsed = useLiveProgress((s) => s.treeUsed);
  const group = useActiveGroup();

  const [previewFileIdx, setPreviewFileIdx] = useState<number | null>(null);

  // The pane stays mounted so width/opacity can transition. It's "active"
  // (taking up space + visible) only when (a) the user has it open AND (b)
  // the live store is tracking the currently-selected group. Otherwise it
  // collapses to width 0 with a fade — no abrupt unmount.
  const isActive =
    open && phase !== "idle" && !!group && group.id === liveRunId;
  const activeSource = group?.files[activeFileIndex] ?? null;

  return (
    <aside
      // Two layered transitions:
      //   - the outer width animates 0 → full so the centre pane reflows.
      //   - the inner content fades + translates so it doesn't pop into a
      //     0-width box and immediately re-flow at full opacity.
      // The overflow-hidden on the outer keeps the inner from leaking out
      // of a partially-collapsed pane mid-animation.
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden bg-gradient-to-b from-background to-card/60",
        "transition-[width,min-width,max-width,border-left-width,opacity] duration-300 ease-out motion-reduce:transition-none",
        isActive
          ? "w-[34%] min-w-[360px] max-w-[560px] border-l opacity-100"
          : "w-0 min-w-0 max-w-0 border-l-0 opacity-0",
      )}
      aria-hidden={!isActive}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
          isActive ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0",
        )}
      >
        <Header phase={phase} groupName={groupName} treeUsed={treeUsed} />

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          <FileMeta
            activeFileName={activeFileName}
            activeFileIndex={activeFileIndex}
            totalFiles={totalFiles}
            source={activeSource}
          />

          <Hero
            phase={phase}
            dataUrl={activePageDataUrl}
            activeOrdinal={activePageOrdinal}
            activeStripIndex={thumbnails.findIndex((t) => t.status === "active")}
            totalThumbnails={thumbnails.length}
            topic={currentTopic}
            source={activeSource}
          />

          <ThumbStrip
            thumbnails={thumbnails}
            onOpen={(fileIdx) => setPreviewFileIdx(fileIdx)}
          />
        </div>
      </div>

      {previewFileIdx !== null && group && isActive && (
        <FilePreviewModal
          files={group.files}
          initialIndex={previewFileIdx}
          onClose={() => setPreviewFileIdx(null)}
        />
      )}
    </aside>
  );
}

/* --------------------------------------------------------------- header */

const PHASE_LABEL: Record<LivePhase, string> = {
  idle: "",
  preparing: "Preparing",
  walking: "Reading",
  summarising: "Summarising",
  embedding: "Embedding",
  naming: "Naming",
  finalising: "Finalising",
  done: "Done",
  failed: "Failed",
};

const SHIMMER_PHASES: ReadonlySet<LivePhase> = new Set([
  "preparing",
  "walking",
  "summarising",
  "embedding",
  "naming",
  "finalising",
]);

function Header({
  phase,
  groupName,
  treeUsed,
}: {
  phase: LivePhase;
  groupName: string;
  treeUsed: boolean;
}) {
  const PhaseIcon =
    phase === "done"
      ? CheckCircle2
      : phase === "failed"
        ? CircleAlert
        : phase === "summarising" || phase === "naming"
          ? Sparkles
          : Loader2;
  const inProgress = SHIMMER_PHASES.has(phase);
  const phaseToneClass =
    phase === "done"
      ? "text-emerald-500 dark:text-emerald-400"
      : phase === "failed"
        ? "text-destructive"
        : "text-foreground";

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Brain className="size-3.5 text-muted-foreground" />
        <div className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Live
        </div>
        <div className="truncate text-xs text-foreground/80">{groupName}</div>
      </div>
      <div className="flex items-center gap-2">
        {treeUsed && (
          <span
            className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-primary"
            title="The accessibility tree is included as context for the Visioner."
          >
            +a11y tree
          </span>
        )}
        <div className={cn("flex items-center gap-1 text-[11px] font-medium", phaseToneClass)}>
          <PhaseIcon
            className={cn(
              "size-3.5",
              PhaseIcon === Loader2 && "animate-spin [animation-duration:1.4s]",
            )}
          />
          <span className={cn(inProgress && "ai-text-shimmer")}>
            {PHASE_LABEL[phase]}
            {inProgress ? "…" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ file meta */

function FileMeta({
  activeFileName,
  activeFileIndex,
  totalFiles,
  source,
}: {
  activeFileName: string | null;
  activeFileIndex: number;
  totalFiles: number;
  source: IndexerFileRef | null;
}) {
  if (!activeFileName) {
    return (
      <div className="shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
        {totalFiles > 0 ? `${totalFiles} source${totalFiles === 1 ? "" : "s"} queued` : ""}
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1.5">
        {source?.sourceKind === "text" ? (
          <Type className="size-3.5" />
        ) : (
          <FileText className="size-3.5" />
        )}
        <span className="truncate text-foreground/80 normal-case tracking-normal">
          {source?.sourceKind === "text"
            ? source.heading?.trim() || "Pasted text"
            : activeFileName}
        </span>
      </div>
      {totalFiles > 1 && (
        <span>
          source {activeFileIndex + 1}/{totalFiles}
        </span>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- hero */

function Hero({
  phase,
  dataUrl,
  activeOrdinal,
  activeStripIndex,
  totalThumbnails,
  topic,
  source,
}: {
  phase: LivePhase;
  dataUrl: string | null;
  activeOrdinal: number | null;
  activeStripIndex: number;
  totalThumbnails: number;
  topic: string;
  source: IndexerFileRef | null;
}) {
  const stillness =
    phase === "done"
      ? "ai-still ai-done"
      : phase === "failed"
        ? "ai-still ai-failed"
        : phase === "walking" || phase === "preparing"
          ? ""
          : "ai-still";

  if (source?.sourceKind === "text") {
    return <TextCorpusHero source={source} phase={phase} topic={topic} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden rounded-xl bg-muted/40 ai-glow",
          stillness,
        )}
      >
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt={topic || "active page"}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="size-10 opacity-50" />
          </div>
        )}
        <div className="ai-scan-band" />
      </div>
      <div className="flex shrink-0 items-center justify-between text-[11px]">
        <span className="truncate text-foreground/80">{topic || "—"}</span>
        {activeOrdinal !== null && (
          <span className="font-mono text-muted-foreground">
            {totalThumbnails > 0
              ? `${activeStripIndex >= 0 ? activeStripIndex + 1 : totalThumbnails} / ${totalThumbnails}`
              : `p${activeOrdinal}`}
          </span>
        )}
      </div>
    </div>
  );
}

function TextCorpusHero({
  source,
  phase,
  topic,
}: {
  source: IndexerFileRef;
  phase: LivePhase;
  topic: string;
}) {
  const body = source.inlineText?.trim() ?? "";
  const heading =
    source.heading?.trim() || source.name.replace(/\.md$/i, "") || "Untitled corpus";
  const paragraphs = body.split(/\n{2,}/).filter((part) => part.trim().length > 0);
  const wordCount = body ? body.split(/\s+/).filter(Boolean).length : 0;
  const scanning = SHIMMER_PHASES.has(phase);
  const status =
    phase === "done"
      ? "Corpus indexed"
      : phase === "failed"
        ? "Scan interrupted"
        : "Scanning corpus";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        className={cn(
          "ai-corpus relative min-h-0 flex-1 overflow-hidden rounded-xl ai-glow",
          scanning && "ai-corpus-scanning",
          phase === "done" && "ai-still ai-done",
          phase === "failed" && "ai-still ai-failed",
        )}
      >
        <div className="relative z-10 flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                <ScanText className="size-3.5" />
              </span>
              Text corpus
            </div>
            <div className="font-mono text-[9px] text-muted-foreground/70">
              {wordCount.toLocaleString()} words · {body.length.toLocaleString()} chars
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden px-5 py-5">
            <div className="ai-corpus-copy h-full overflow-hidden">
              <h3 className="max-w-[28rem] text-xl font-semibold leading-tight tracking-tight text-foreground/95">
                {heading}
              </h3>
              <div className="mt-4 space-y-3 text-[12px] leading-6 text-foreground/65">
                {paragraphs.length > 0 ? (
                  paragraphs.map((paragraph, index) => (
                    <p key={`${index}-${paragraph.slice(0, 24)}`}>
                      {paragraph}
                    </p>
                  ))
                ) : (
                  <p className="italic text-muted-foreground">Waiting for corpus text…</p>
                )}
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-card via-card/75 to-transparent" />
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-white/8 px-4 py-2.5 text-[10px]">
            <span
              className={cn(
                "flex items-center gap-1.5 font-medium",
                phase === "done"
                  ? "text-emerald-400"
                  : phase === "failed"
                    ? "text-destructive"
                    : "text-cyan-300/80",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  phase === "done"
                    ? "bg-emerald-400"
                    : phase === "failed"
                      ? "bg-destructive"
                      : "animate-pulse bg-cyan-300",
                )}
              />
              {status}
            </span>
            <span className="max-w-[55%] truncate font-mono text-muted-foreground/70">
              {topic || source.name}
            </span>
          </div>
        </div>

        {scanning && (
          <>
            <div className="ai-corpus-scan-wash" />
            <div className="ai-corpus-scan-line" />
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------- thumbnail strip */

function ThumbStrip({
  thumbnails,
  onOpen,
}: {
  thumbnails: ReturnType<typeof useLiveProgress.getState>["thumbnails"];
  onOpen: (fileIndex: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeKey = thumbnails.find((t) => t.status === "active")?.key;
  // Multi-file groups (e.g. worksmith full-page captures: N images) → label
  // each thumb by its file index. Single-file groups (PDFs) → label by page.
  const hasMultipleFiles = useMemo(
    () => new Set(thumbnails.map((t) => t.fileIndex)).size > 1,
    [thumbnails],
  );

  useEffect(() => {
    if (!activeKey) return;
    const node = stripRef.current?.querySelector<HTMLElement>(
      `[data-thumb-key="${activeKey}"]`,
    );
    node?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeKey]);

  if (thumbnails.length === 0) return null;

  return (
    <div
      ref={stripRef}
      // px-1 + py-2 gives the active thumb's outline + transform some
      // breathing room — without it the parent's overflow-hidden + the
      // strip's own overflow-y-auto chops off the bottom of the last row.
      className="no-scrollbar flex max-h-44 shrink-0 flex-wrap gap-1.5 overflow-y-auto px-1 py-2"
    >
      {thumbnails.map((t) => (
        <button
          type="button"
          key={t.key}
          data-thumb-key={t.key}
          onClick={() => onOpen(t.fileIndex)}
          // Active state uses an INSET ring (via outline + outline-offset)
          // instead of an outset box-shadow so it can't escape the strip
          // and get clipped. Scale is kept modest for the same reason.
          className={cn(
            "group/thumb relative h-16 w-12 shrink-0 overflow-hidden rounded-md border bg-muted/40 transition-all",
            "hover:border-foreground/40",
            t.status === "active" &&
              "scale-[1.06] border-primary outline outline-2 outline-offset-1 outline-primary/40",
            t.status === "done" && "opacity-70",
            t.status === "pending" && "opacity-40",
          )}
          aria-label={`Preview file ${t.fileIndex + 1}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={t.thumbDataUrl}
            alt={`p${t.ordinal}`}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-0.5 py-px text-center text-[9px] font-mono leading-none text-white/90">
            {hasMultipleFiles ? t.fileIndex + 1 : t.ordinal}
          </div>
        </button>
      ))}
    </div>
  );
}
