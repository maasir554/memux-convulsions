"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useIndexerStore } from "@/lib/indexer/queue-store";
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

  // Reset stale live-progress state from a previous mount before anything
  // else renders. Subsequent runs write fresh state via the orchestrator.
  useEffect(() => {
    useLiveProgress.getState().reset();
  }, []);

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
          href="/memux"
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

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <QueueSidebar />
        <GroupEditor />
        <LiveView />
      </div>
      <DropOverlay />
    </div>
  );
}
