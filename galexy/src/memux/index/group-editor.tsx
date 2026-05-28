"use client";

import { useCallback, useRef, useState } from "react";
import {
  FileBox,
  FileImage,
  FileSpreadsheet,
  FileText,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  useActiveGroup,
  useIndexerStore,
} from "@/lib/indexer/queue-store";
import type { Group } from "@/lib/indexer/queue-db";
import {
  FilesSection,
  ScratchpadStream,
  SourceCard,
} from "./run-view";

const ACCEPTED_HINT = "Markdown, CSV, PDF, or image files";

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

  if (group.status === "draft") return <DraftEditor group={group} />;
  return <ReadOnlyGroupView group={group} />;
}

/* ------------------------------------------------------------------ draft */

function DraftEditor({ group }: { group: Group }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const patchActive = useIndexerStore((s) => s.patchActive);
  const attachToActive = useIndexerStore((s) => s.attachToActive);
  const removeFromActive = useIndexerStore((s) => s.removeFromActive);
  const enqueueActive = useIndexerStore((s) => s.enqueueActive);
  const deleteGroupById = useIndexerStore((s) => s.deleteGroupById);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="mx-auto w-full max-w-2xl space-y-6 p-8">
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

        {/* Browse target — drag is handled by the window-wide overlay. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-card/40 p-10 text-center outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Upload className="size-7 text-muted-foreground" />
          <div className="text-sm">
            Drop files anywhere, or{" "}
            <span className="underline underline-offset-2 hover:text-foreground">
              browse
            </span>
          </div>
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">
            {ACCEPTED_HINT}
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
        </div>

        {/* Attached files */}
        {group.files.length > 0 && (
          <div className="space-y-1.5 rounded-lg border bg-card p-3">
            <div className="mb-1 text-[10px] tracking-wide text-muted-foreground uppercase">
              {group.files.length} file{group.files.length === 1 ? "" : "s"} attached
            </div>
            {group.files.map((file) => {
              const Icon = iconForMime(file.mimeType, file.name);
              return (
                <div
                  key={file.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeFromActive(file.id)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    aria-label="Remove file"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Context prompt */}
        <div className="space-y-1.5">
          <label
            htmlFor="group-prompt"
            className="text-xs font-medium text-muted-foreground"
          >
            Context (optional)
          </label>
          <textarea
            id="group-prompt"
            value={group.prompt}
            onChange={(e) => void patchActive({ prompt: e.target.value })}
            placeholder="What's this group about? Anything the indexer should know — topic, source, dates, intent."
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
              "Files are added to your vault under _Indexes/<group>/ and tagged #indexed."
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
              disabled={busy || group.files.length === 0}
            >
              {busy ? "Queueing…" : "Index"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
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


/* ----------------------------------------------------------------- utils */

function iconForMime(mime: string, name: string) {
  const lower = name.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return FileBox;
  if (mime.startsWith("image/")) return FileImage;
  if (mime === "text/csv" || lower.endsWith(".csv")) return FileSpreadsheet;
  return FileText;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
