"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, PanelRight } from "lucide-react";

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
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Link
          href="/"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          MEMUX
        </Link>
        <div className="text-sm font-medium">Indexer</div>
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
        <QueueSidebar />
        <GroupEditor />
        <LiveView open={liveViewOpen} />
      </div>
      <DropOverlay />
    </div>
  );
}
