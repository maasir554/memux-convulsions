"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PanelRight, Plus } from "lucide-react";

import { ShellSidebar, useUnifiedShell } from "@/components/unified-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIndexerStore, useActiveGroup } from "@/lib/indexer/queue-store";
import { useIndexerSupervisor } from "@/lib/indexer/supervisor";
import { useLiveProgress } from "@/lib/indexer/live-progress";
import { cleanupEmptyIndexFolders } from "@/lib/indexer/materialise";
import { useWorksmithBridge } from "@/components/galexy/use-worksmith-bridge";

import { DropOverlay } from "./drop-overlay";
import { GroupEditor } from "./group-editor";
import { LiveView } from "./live-view";
import { QueueSidebar } from "./queue-sidebar";

export function MemuxIndexPage() {
  const router = useRouter();
  const load = useIndexerStore((s) => s.load);
  const newDraft = useIndexerStore((s) => s.newDraft);
  const { expandSidebar } = useUnifiedShell();
  // Toggle for the live-progress right pane. Only visible when the active
  // group also happens to be the in-flight run (the LiveView component
  // does its own gating on that as well).
  const [liveViewOpen, setLiveViewOpen] = useState(true);
  const activeGroup = useActiveGroup();
  const liveRunId = useLiveProgress((s) => s.runId);
  const livePhase = useLiveProgress((s) => s.phase);
  const showLiveButton =
    livePhase !== "idle" && activeGroup && activeGroup.id === liveRunId;

  // No reset here: persisting across vault → indexer navigation means the
  // right pane (and its visibility) reflects the actual run state when the
  // user returns. The orchestrator's own startRun resets fields for new runs.

  useEffect(() => {
    void (async () => {
      // Sweep orphan _Indexes/* folders left behind by failed/cancelled runs
      // before they wrote anything. Cheap; runs only on mount.
      const removed = await cleanupEmptyIndexFolders();
      if (removed > 0) {
        console.log(`[indexer] cleaned up ${removed} empty index folder(s)`);
      }
      await load();
    })();
  }, [load]);

  // Auto-runs queued groups while this page is open.
  useIndexerSupervisor();
  // Accepts inbound captures from the worksmith extension while this page is open.
  useWorksmithBridge();

  return (
    <>
      <ShellSidebar
        compact={
          <button
            type="button"
            onClick={() => {
              void newDraft();
              expandSidebar();
            }}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            aria-label="New index"
            title="New index"
          >
            <Plus className="size-4" />
          </button>
        }
      >
        <QueueSidebar />
      </ShellSidebar>

    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Index</div>
        <div className="text-sm font-medium">Knowledge builder</div>
        <div className="text-xs text-muted-foreground">
          Build searchable groups from files + context.
        </div>
        <div className="ml-auto flex items-center gap-2">
          {showLiveButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLiveViewOpen((v) => !v)}
              className={cn(
                "h-7",
                liveViewOpen
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground",
              )}
              title={liveViewOpen ? "Hide live pane" : "Show live pane"}
              aria-label={liveViewOpen ? "Hide live pane" : "Show live pane"}
            >
              <PanelRight className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/vault")}
            className="h-7"
          >
            Browse vault
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <GroupEditor />
        <LiveView open={liveViewOpen} />
      </div>
      <DropOverlay />
    </div>
    </>
  );
}
