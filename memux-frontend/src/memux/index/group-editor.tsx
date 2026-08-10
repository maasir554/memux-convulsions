"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileBox,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Plus,
  Sparkles,
  Type,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  useActiveGroup,
  useIndexerStore,
} from "@/lib/indexer/queue-store";
import type { Group } from "@/lib/indexer/queue-db";
import type { IndexerFileRef } from "@/lib/db/schema";
import { fileFromRef } from "@/lib/indexer/extractors";
import { loadPdfjs } from "@/lib/pdf-render";
import {
  FilesSection,
  ScratchpadStream,
  SourceCard,
} from "./run-view";

export function GroupEditor() {
  const group = useActiveGroup();
  const newDraft = useIndexerStore((s) => s.newDraft);

  if (!group) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-sm rounded-xl border border-dashed bg-card/40 p-8 text-center">
          <Sparkles className="mx-auto mb-3 size-6 text-muted-foreground" />
          <div className="text-sm">Pick a group from the queue, or</div>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => void newDraft()}
          >
            Start a new group
          </Button>
        </div>
      </div>
    );
  }

  if (group.status === "draft") {
    return <DraftEditor key={group.id} group={group} />;
  }
  return <ReadOnlyGroupView group={group} />;
}

/* ------------------------------------------------------------------ draft */

function DraftEditor({ group }: { group: Group }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const patchActive = useIndexerStore((s) => s.patchActive);
  const attachToActive = useIndexerStore((s) => s.attachToActive);
  const addTextToActive = useIndexerStore((s) => s.addTextToActive);
  const updateTextInActive = useIndexerStore((s) => s.updateTextInActive);
  const removeFromActive = useIndexerStore((s) => s.removeFromActive);
  const enqueueActive = useIndexerStore((s) => s.enqueueActive);
  const deleteGroupById = useIndexerStore((s) => s.deleteGroupById);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const hasIndexableSource = group.files.some(
    (source) =>
      source.sourceKind !== "text" ||
      (source.inlineText?.trim().length ?? 0) > 0,
  );

  const onIndex = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await enqueueActive();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [enqueueActive]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-8">
        {/* Title (leave empty → AI names it on completion) */}
        <div className="space-y-1.5">
          <label
            htmlFor="group-title"
            className="text-xs font-medium text-muted-foreground"
          >
            Group title
          </label>
          <input
            id="group-title"
            value={group.groupName}
            onChange={(e) => void patchActive({ groupName: e.target.value })}
            placeholder="Leave empty and AI will name it"
            className="w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </div>

        <div
          className={`rounded-2xl bg-card/55 p-4 shadow-sm transition-colors ${
            dragActive ? "bg-card ring-1 ring-ring/50" : ""
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            if (event.dataTransfer.types.includes("Files")) setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragActive(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            const files = Array.from(event.dataTransfer.files);
            if (files.length > 0) void attachToActive(files);
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Group content</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Add pasted text, documents, spreadsheets, PDFs, or images to one collection.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8"
                onClick={() => void addTextToActive()}
              >
                <Plus className="mr-1 size-3.5" />
                Text body
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8"
                onClick={() => inputRef.current?.click()}
              >
                <Paperclip className="mr-1 size-3.5" />
                Add files
              </Button>
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void attachToActive(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.files.map((source) =>
              source.sourceKind === "text" ? (
                <TextSourceTile
                  key={source.id}
                  source={source}
                  onChange={(patch) =>
                    void updateTextInActive(source.id, patch)
                  }
                  onRemove={() => void removeFromActive(source.id)}
                />
              ) : (
                <FileSourceTile
                  key={source.id}
                  source={source}
                  onRemove={() => void removeFromActive(source.id)}
                />
              ),
            )}

            <button
              type="button"
              onClick={() => void addTextToActive()}
              className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background/25 text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-background/50 hover:text-foreground"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-muted">
                <Plus className="size-4" />
              </span>
              <span className="text-xs font-medium">Add another text body</span>
              <span className="text-[10px]">or drop files anywhere</span>
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="group-prompt"
            className="text-xs font-medium text-muted-foreground"
          >
            Group instructions (optional)
          </label>
          <textarea
            id="group-prompt"
            value={group.prompt}
            onChange={(e) => void patchActive({ prompt: e.target.value })}
            placeholder="Anything the indexer should know about this collection — topic, source, dates, or intent."
            rows={4}
            className="w-full resize-y rounded-md border bg-card px-3 py-2 text-sm outline-none focus:border-ring"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : (
              "All sources are indexed together under _Indexes/<group>/."
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void deleteGroupById(group.id)}
              disabled={busy}
            >
              Delete
            </Button>
            <Button
              size="sm"
              onClick={() => void onIndex()}
              disabled={busy || !hasIndexableSource}
            >
              {busy ? "Queueing…" : "Index"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TextSourceTile({
  source,
  onChange,
  onRemove,
}: {
  source: IndexerFileRef;
  onChange: (patch: { heading?: string; inlineText?: string }) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex h-48 min-w-0 flex-col rounded-xl bg-background/75 p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
          <Type className="size-3.5" />
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Pasted text
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Remove text body"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <input
        value={source.heading ?? ""}
        onChange={(event) => onChange({ heading: event.target.value })}
        placeholder="Heading (optional)"
        aria-label="Text body heading"
        className="mt-2 w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/55"
      />
      <textarea
        value={source.inlineText ?? ""}
        onChange={(event) => onChange({ inlineText: event.target.value })}
        placeholder="Paste or write text here…"
        aria-label="Text body"
        className="mt-2 min-h-0 flex-1 resize-none rounded-lg bg-muted/45 px-2.5 py-2 text-xs leading-5 outline-none placeholder:text-muted-foreground/55 focus:bg-muted/60"
      />
      <div className="mt-1.5 text-right text-[9px] tabular-nums text-muted-foreground/60">
        {(source.inlineText ?? "").length.toLocaleString()} chars
      </div>
    </div>
  );
}

function FileSourceTile({
  source,
  onRemove,
}: {
  source: IndexerFileRef;
  onRemove: () => void;
}) {
  return (
    <div className="relative flex h-48 min-w-0 flex-col overflow-hidden rounded-xl bg-background/75 p-3">
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 z-10 rounded-full bg-background/85 p-1.5 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
        aria-label={`Remove ${source.name}`}
      >
        <X className="size-3.5" />
      </button>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-muted/35">
        <FileSourcePreview source={source} />
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <FileKindIcon
          source={source}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {source.name}
        </span>
        <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">
          {formatBytes(source.size)}
        </span>
      </div>
    </div>
  );
}

type FilePreview =
  | { kind: "image"; src: string }
  | { kind: "text"; content: string }
  | { kind: "empty" };

function FileSourcePreview({ source }: { source: IndexerFileRef }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);

  useEffect(() => {
    let active = true;
    void buildFilePreview(source)
      .then((next) => {
        if (active) setPreview(next);
      })
      .catch(() => {
        if (active) setPreview({ kind: "empty" });
      });
    return () => {
      active = false;
    };
  }, [source]);

  if (preview?.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={preview.src}
        alt=""
        className="h-full w-full object-cover"
      />
    );
  }

  if (preview?.kind === "text") {
    return (
      <pre className="h-full overflow-hidden whitespace-pre-wrap break-words p-3 font-mono text-[9px] leading-4 text-muted-foreground">
        {preview.content}
      </pre>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <FileKindIcon source={source} className="size-8 opacity-55" />
      <span className="text-[9px] uppercase tracking-[0.14em] opacity-65">
        {preview ? source.mimeType.split("/").pop() : "Loading preview"}
      </span>
    </div>
  );
}

async function buildFilePreview(source: IndexerFileRef): Promise<FilePreview> {
  const file = await fileFromRef(source);
  const lower = source.name.toLowerCase();

  if (source.mimeType.startsWith("image/")) {
    return { kind: "image", src: await fileToDataUrl(file) };
  }

  if (source.mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    try {
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 0.32 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) return { kind: "empty" };
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      page.cleanup();
      return { kind: "image", src: canvas.toDataURL("image/jpeg", 0.72) };
    } finally {
      await doc.destroy();
    }
  }

  if (
    source.mimeType.startsWith("text/") ||
    /\.(md|markdown|txt|csv|json|js|jsx|ts|tsx|py|css|html)$/i.test(lower)
  ) {
    const content = (await file.text()).trim().slice(0, 700);
    return content ? { kind: "text", content } : { kind: "empty" };
  }

  return { kind: "empty" };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function FileKindIcon({
  source,
  className,
}: {
  source: IndexerFileRef;
  className?: string;
}) {
  const lower = source.name.toLowerCase();
  if (source.mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    return <FileBox className={className} />;
  }
  if (source.mimeType.startsWith("image/")) {
    return <FileImage className={className} />;
  }
  if (source.mimeType === "text/csv" || lower.endsWith(".csv")) {
    return <FileSpreadsheet className={className} />;
  }
  return <FileText className={className} />;
}

/* ----------------------------------------------------------------- view */

function ReadOnlyGroupView({ group }: { group: Group }) {
  const dequeueGroup = useIndexerStore((s) => s.dequeueGroup);
  const isQueued = group.status === "queued";
  const isRunning =
    group.status !== "draft" &&
    group.status !== "queued" &&
    group.status !== "done" &&
    group.status !== "failed" &&
    group.status !== "cancelled";
  const hasName = group.groupName.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-5 p-8">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {group.status}
          </div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">
            {hasName ? (
              group.groupName
            ) : isRunning ? (
              <>
                Indexing<span className="ws-indexing-dots">...</span>
              </>
            ) : (
              "(AI will name)"
            )}
          </div>
        </div>

        {group.prompt && <SourceCard prompt={group.prompt} />}

        <FilesSection files={group.files} />

        {group.scratchpadMd && <ScratchpadStream md={group.scratchpadMd} />}

        {group.error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {group.error}
          </div>
        )}

        {isQueued && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void dequeueGroup(group.id)}
            >
              Move back to draft
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}


function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
