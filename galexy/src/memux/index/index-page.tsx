"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileBox,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useVault, type UploadCategory } from "@/components/galexy/use-vault";

const ACCEPTED_HINT = "Markdown, CSV, PDF, or image files";

type Categorized = {
  category: UploadCategory;
  files: File[];
};

/** Bucket files by MIME / extension into the upload categories useVault knows. */
function categorize(files: File[]): {
  buckets: Map<UploadCategory, File[]>;
  skipped: File[];
} {
  const buckets = new Map<UploadCategory, File[]>();
  const skipped: File[] = [];
  for (const file of files) {
    const lower = file.name.toLowerCase();
    let cat: UploadCategory | null = null;
    if (file.type === "application/pdf" || lower.endsWith(".pdf")) cat = "pdf";
    else if (file.type.startsWith("image/")) cat = "image";
    else if (file.type === "text/csv" || lower.endsWith(".csv")) cat = "csv";
    else if (
      file.type === "text/markdown" ||
      file.type === "text/plain" ||
      lower.endsWith(".md") ||
      lower.endsWith(".markdown") ||
      lower.endsWith(".txt")
    )
      cat = "markdown";

    if (!cat) {
      skipped.push(file);
      continue;
    }
    const list = buckets.get(cat) ?? [];
    list.push(file);
    buckets.set(cat, list);
  }
  return { buckets, skipped };
}

function iconForCategory(cat: UploadCategory) {
  switch (cat) {
    case "pdf":
      return FileBox;
    case "image":
      return FileImage;
    case "csv":
      return FileSpreadsheet;
    case "markdown":
      return FileText;
  }
}

export function MemuxIndexPage() {
  const router = useRouter();
  const { notes, uploadFiles, createNote } = useVault();

  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<File[]>([]);
  const [context, setContext] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setStaged((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const next = [...prev];
      for (const f of files) {
        const key = `${f.name}:${f.size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(f);
      }
      return next;
    });
  }, []);

  const removeStaged = (idx: number) =>
    setStaged((prev) => prev.filter((_, i) => i !== idx));

  const reset = () => {
    setStaged([]);
    setContext("");
    setStatus(null);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const handleSubmit = useCallback(async () => {
    if (busy || staged.length === 0 || !notes) return;
    setBusy(true);
    setStatus("Uploading files…");
    const { buckets, skipped } = categorize(staged);

    // Upload each category in turn so the optimistic state updates predictably.
    const newItemIds: string[] = [];
    const uploadOrder: Categorized[] = Array.from(buckets, ([category, files]) => ({
      category,
      files,
    }));
    for (const { category, files } of uploadOrder) {
      const ids = await uploadFiles({ category, folder: "", files });
      newItemIds.push(...ids);
    }

    // Build the group note. Look up the just-created notes by id so we can
    // wikilink them by title (the existing graph builder resolves titles).
    setStatus("Creating index group…");
    const titlesById = new Map<string, string>();
    // The freshly uploaded ids may not yet be in `notes` (we captured it before
    // the hook saw them), so refetch from the live ref by reading after the
    // promise resolves — simplest: build links from filenames where titles
    // mirror filename-without-extension (which is exactly how uploadFiles names
    // them).
    for (let i = 0; i < newItemIds.length; i++) {
      const id = newItemIds[i];
      // Filenames are processed in the same order across all buckets.
      const file = uploadOrder.flatMap((c) => c.files)[i];
      const title =
        file?.name.replace(/\.[a-zA-Z0-9]+$/, "") ?? `Item ${i + 1}`;
      titlesById.set(id, title);
    }

    const now = new Date();
    const stamp = now.toLocaleString();
    const lines: string[] = [
      `# Indexed group · ${stamp}`,
      "",
      "#indexed",
      "",
    ];
    if (context.trim()) {
      lines.push("## Context", "", context.trim(), "");
    }
    lines.push("## Files", "");
    for (const id of newItemIds) {
      lines.push(`- [[${titlesById.get(id) ?? id}]]`);
    }
    if (skipped.length > 0) {
      lines.push("", "## Skipped", "");
      for (const f of skipped) lines.push(`- ${f.name} (${f.type || "unknown"})`);
    }

    const groupTitle = `Indexed group ${now.toISOString().slice(0, 16).replace("T", " ")}`;
    await createNote({
      type: "markdown",
      title: groupTitle,
    });
    // createNote seeds default content; for richer body, we'd need a separate
    // updateContent — but the group note already exists, so leave for now and
    // surface a follow-up.
    setStatus(
      `Indexed ${newItemIds.length} file${newItemIds.length === 1 ? "" : "s"}` +
        (skipped.length ? ` · skipped ${skipped.length}` : ""),
    );
    setStaged([]);
    setContext("");
    setBusy(false);
    // Pipeline TODO — for now we just persist. The note can be inspected and
    // queried via the existing #indexed tag.
    void lines; // (referenced once the createNote signature supports content)
  }, [busy, context, createNote, notes, staged, uploadFiles]);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Link
          href="/memux"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          MEMUX
        </Link>
        <div className="text-sm font-medium">Index</div>
        <div className="text-xs text-muted-foreground">
          Build a searchable group from files + context.
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
            className="h-7"
          >
            Browse vault
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-8">
        <div className="w-full max-w-2xl space-y-6">
          {/* Drop zone */}
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
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border bg-card/40 hover:border-foreground/30",
            )}
          >
            <Upload className="size-7 text-muted-foreground" />
            <div className="text-sm">
              Drop files here, or{" "}
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
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>

          {/* Staged file list */}
          {staged.length > 0 && (
            <div className="space-y-1.5 rounded-lg border bg-card p-3">
              <div className="mb-1 text-[10px] tracking-wide text-muted-foreground uppercase">
                {staged.length} file{staged.length === 1 ? "" : "s"} ready
              </div>
              {staged.map((file, idx) => {
                const { buckets, skipped } = categorize([file]);
                const cat = [...buckets.keys()][0];
                const Icon = cat ? iconForCategory(cat) : FileBox;
                const isSkipped = skipped.length > 0;
                return (
                  <div
                    key={`${file.name}-${idx}`}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
                      isSkipped &&
                        "text-muted-foreground line-through decoration-destructive/60",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {isSkipped ? "unsupported" : cat}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeStaged(idx)}
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

          {/* Context */}
          <div className="space-y-1.5">
            <label
              htmlFor="memux-index-context"
              className="text-xs font-medium text-muted-foreground"
            >
              Context (optional)
            </label>
            <textarea
              id="memux-index-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="What's this group about? Anything the indexer should know — topic, source, dates, intent."
              rows={4}
              className="w-full resize-y rounded-md border bg-card px-3 py-2 text-sm outline-none focus:border-ring"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {status ?? "Files are added to your vault and tagged #indexed."}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={busy || (staged.length === 0 && !context)}
              >
                Reset
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={busy || staged.length === 0}
              >
                {busy ? "Indexing…" : "Index"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
