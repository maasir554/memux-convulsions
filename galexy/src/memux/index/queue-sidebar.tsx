"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  useIndexerStore,
  useQueuedGroups,
} from "@/lib/indexer/queue-store";
import type { Group } from "@/lib/indexer/queue-db";

const STATUS_LABEL: Record<Group["status"], string> = {
  draft: "Draft",
  queued: "Queued",
  preparing: "Preparing",
  walking: "Reading",
  sectioning: "Sectioning",
  summarising: "Summarising",
  embedding: "Embedding",
  naming: "Naming",
  finalising: "Finalising",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<Group["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  queued: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  preparing: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  walking: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  sectioning: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  summarising: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  embedding: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  naming: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  finalising: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function QueueSidebar() {
  const groups = useQueuedGroups();
  const activeId = useIndexerStore((s) => s.activeId);
  const setActive = useIndexerStore((s) => s.setActive);
  const newDraft = useIndexerStore((s) => s.newDraft);
  const deleteGroupById = useIndexerStore((s) => s.deleteGroupById);

  // Section the list: drafts at top, then queued (in order), then running, then completed/failed.
  const sectioned = useMemo(() => {
    const drafts: Group[] = [];
    const queued: Group[] = [];
    const running: Group[] = [];
    const finished: Group[] = [];
    for (const g of groups) {
      if (g.status === "draft") drafts.push(g);
      else if (g.status === "queued") queued.push(g);
      else if (g.status === "done" || g.status === "failed" || g.status === "cancelled")
        finished.push(g);
      else running.push(g);
    }
    queued.sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));
    return { drafts, queued, running, finished };
  }, [groups]);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-sidebar/30">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Queue
        </div>
        <button
          type="button"
          onClick={() => void newDraft()}
          className="flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-sidebar-accent"
        >
          <Plus className="size-3.5" />
          New
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
        {groups.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            No groups yet. Click <span className="font-medium">New</span> to start.
          </div>
        ) : null}

        {sectioned.running.length > 0 && (
          <SidebarSection label="Running">
            {sectioned.running.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                active={activeId === g.id}
                onSelect={() => setActive(g.id)}
                onDelete={null}
              />
            ))}
          </SidebarSection>
        )}

        {sectioned.queued.length > 0 && (
          <SidebarSection label="Queued">
            {sectioned.queued.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                active={activeId === g.id}
                onSelect={() => setActive(g.id)}
                onDelete={() => void deleteGroupById(g.id)}
              />
            ))}
          </SidebarSection>
        )}

        {sectioned.drafts.length > 0 && (
          <SidebarSection label="Drafts">
            {sectioned.drafts.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                active={activeId === g.id}
                onSelect={() => setActive(g.id)}
                onDelete={() => void deleteGroupById(g.id)}
              />
            ))}
          </SidebarSection>
        )}

        {sectioned.finished.length > 0 && (
          <SidebarSection label="Finished">
            {sectioned.finished.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                active={activeId === g.id}
                onSelect={() => setActive(g.id)}
                onDelete={() => void deleteGroupById(g.id)}
              />
            ))}
          </SidebarSection>
        )}
      </div>
    </aside>
  );
}

function SidebarSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function GroupRow({
  group,
  active,
  onSelect,
  onDelete,
}: {
  group: Group;
  active: boolean;
  onSelect: () => void;
  onDelete: (() => void) | null;
}) {
  const title = displayTitle(group);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group/row flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm outline-none transition-colors",
        active
          ? "border-border bg-sidebar-accent text-foreground"
          : "hover:bg-sidebar-accent/50",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm leading-tight">{title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span
            className={cn(
              "rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide",
              STATUS_TONE[group.status],
            )}
          >
            {STATUS_LABEL[group.status]}
            {group.status === "queued" && group.queuePosition
              ? ` · #${group.queuePosition}`
              : ""}
          </span>
          <span>
            {group.files.length} file{group.files.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover/row:opacity-100"
          aria-label="Delete group"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function displayTitle(g: Group): string {
  return g.groupName.trim() || "(AI will name)";
}
