"use client";

import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";

import { useIndexerStore } from "@/lib/indexer/queue-store";
import { attachFiles, createDraft } from "@/lib/indexer/queue-db";

/**
 * Window-wide drag-and-drop overlay. While a file is being dragged anywhere
 * in the document, a full-screen scrim appears with a single drop target
 * spanning the viewport. Dropping anywhere on the page attaches the files
 * to the active draft (creating one if none exists).
 *
 * Implementation uses the enter/leave counter pattern: dragenter on a child
 * also fires dragleave on the parent, so the only reliable way to know if
 * we're still inside the window is to track the net depth.
 */
export function DropOverlay() {
  const [active, setActive] = useState(false);
  const counterRef = useRef(0);
  // Pull current snapshots inside handlers via getState — no need to re-bind
  // the effect every time these change.
  useEffect(() => {
    function hasFiles(e: DragEvent): boolean {
      const types = e.dataTransfer?.types;
      if (!types) return false;
      for (let i = 0; i < types.length; i++) {
        if (types[i] === "Files") return true;
      }
      return false;
    }

    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      counterRef.current += 1;
      if (counterRef.current === 1) setActive(true);
    }
    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      counterRef.current = Math.max(0, counterRef.current - 1);
      if (counterRef.current === 0) setActive(false);
    }
    function onDragOver(e: DragEvent) {
      if (hasFiles(e)) e.preventDefault();
    }
    async function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      counterRef.current = 0;
      setActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      const state = useIndexerStore.getState();
      const groups = state.groups ?? [];
      const active = groups.find((g) => g.id === state.activeId);

      // Target: an active draft if there is one; otherwise spin up a fresh draft.
      let targetId = active && active.status === "draft" ? active.id : null;
      if (!targetId) {
        targetId = await createDraft();
        useIndexerStore.setState({ activeId: targetId });
      }
      try {
        await attachFiles(targetId, files);
      } catch (err) {
        console.warn("[drop] attach failed:", err);
      }
      await useIndexerStore.getState().load();
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/75 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-card/90 px-10 py-8 shadow-2xl">
        <Upload className="size-10 text-primary" />
        <div className="text-base font-medium">Drop to attach</div>
        <div className="text-xs text-muted-foreground">
          Files will be added to the current group.
        </div>
      </div>
    </div>
  );
}
