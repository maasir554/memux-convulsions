"use client";

/**
 * Left-side chat list. Two states:
 *   - expanded: full-width labels + 3-dot menu per row
 *   - collapsed: 56-px icon rail; the chat list collapses to small dots
 *     with tooltips; the New / Settings buttons remain
 *
 * Logo is no longer here — it lives in the top strip of ChatView so the
 * header reads as one consistent surface across collapsed states. The
 * sidebar focuses purely on chat navigation.
 *
 * Rename + delete are modal-driven (ChatConfirmModal), not inline. The
 * inline edit pattern was easy to fat-finger and gave no confirmation
 * for destructive ops.
 */

import { useState } from "react";
import {
  Plus,
  Trash2,
  Settings as SettingsIcon,
  Pencil,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/memux/chat/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/memux/chat/components/ui/tooltip";
import { useStore, type ChatSession } from "@/memux/chat/lib/store";
import { useClient } from "@/memux/chat/lib/clientSettings";
import { cn } from "@/memux/chat/lib/utils";
import {
  RenameChatModal,
  DeleteChatModal,
} from "@/memux/chat/components/ChatConfirmModal";

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const chats = useStore((s) => s.chats);
  const activeId = useStore((s) => s.activeId);
  const newChat = useStore((s) => s.newChat);
  const selectChat = useStore((s) => s.selectChat);
  const deleteChat = useStore((s) => s.deleteChat);
  const renameChat = useStore((s) => s.renameChat);

  const collapsed = useClient((s) => s.sidebarCollapsed);
  const setCollapsed = useClient((s) => s.setSidebarCollapsed);

  const [renameTarget, setRenameTarget] = useState<ChatSession | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);

  return (
    <>
      <aside
        className={cn(
          "hidden md:flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground",
          "transition-[width] duration-200 ease-out",
          collapsed ? "w-14" : "w-64",
        )}
      >
        {/* Sidebar's own top row: collapse toggle + new chat. The toggle
            sits INSIDE the sidebar (per design) — not on the topnav —
            so the rail's collapse affordance is contextual to the rail.
            When collapsed, both buttons stack vertically. */}
        <div
          className={cn(
            "flex items-center py-2",
            collapsed ? "flex-col gap-1 px-2" : "justify-between px-2.5",
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? "Expand sidebar" : "Collapse sidebar"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => newChat()}
                aria-label="New chat"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                <Plus className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New chat</TooltipContent>
          </Tooltip>
        </div>

        {/* Chat list — plain overflow-y-auto, NOT Radix ScrollArea. Radix's
            Viewport wraps children in a `display:table` div internally
            (for its custom scrollbar), which forces child widths to be
            content-based and silently breaks `truncate` no matter how
            many `min-w-0`s we sprinkle. The native scrollbar here is
            fine for a small list.
            When the sidebar is collapsed the list is hidden entirely —
            the rail becomes a pure action surface (collapse, new chat,
            settings). The user expands the sidebar to navigate to a
            specific chat. */}
        {!collapsed && (
          <div className="flex-1 overflow-y-auto px-2">
            <div className="flex w-full flex-col gap-0.5 pb-3">
              {chats.length === 0 && (
                <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                  No chats yet
                </div>
              )}
              {chats.map((c) => (
                <ExpandedRow
                  key={c.id}
                  chat={c}
                  active={c.id === activeId}
                  onSelect={() => selectChat(c.id)}
                  onRequestRename={() => setRenameTarget(c)}
                  onRequestDelete={() => setDeleteTarget(c)}
                />
              ))}
            </div>
          </div>
        )}
        {/* When collapsed, push the footer to the bottom of the rail. */}
        {collapsed && <div className="flex-1" />}

        {/* Footer: settings */}
        <div className="border-t p-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label="Settings"
                className={cn(
                  "flex items-center gap-2 rounded-md text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                  collapsed
                    ? "size-9 justify-center self-center"
                    : "h-9 w-full px-2.5",
                )}
              >
                <SettingsIcon className="size-4 shrink-0" />
                {!collapsed && <span>Settings</span>}
              </button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Settings</TooltipContent>}
          </Tooltip>
        </div>
      </aside>

      {renameTarget && (
        <RenameChatModal
          current={renameTarget.title}
          onClose={() => setRenameTarget(null)}
          onCommit={(t) => renameChat(renameTarget.id, t)}
        />
      )}
      {deleteTarget && (
        <DeleteChatModal
          title={deleteTarget.title || "Untitled"}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteChat(deleteTarget.id)}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------- expanded row */

function ExpandedRow({
  chat,
  active,
  onSelect,
  onRequestRename,
  onRequestDelete,
}: {
  chat: ChatSession;
  active: boolean;
  onSelect: () => void;
  onRequestRename: () => void;
  onRequestDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

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
        // `w-full min-w-0` is what makes the inner `truncate` work — flex
        // items default to `min-content` width, so without `min-w-0` the
        // row would grow to its longest child instead of clipping.
        "group flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm outline-none",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/60",
      )}
    >
      <span className="min-w-0 flex-1 truncate" title={chat.title || "Untitled"}>
        {chat.title || "Untitled"}
      </span>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            aria-label="Chat options"
            className={cn(
              "shrink-0 rounded-full p-1 transition-opacity duration-150 hover:bg-foreground/10 hover:text-foreground",
              // Hover-only (per design): hidden by default, revealed on
              // row-hover, kept visible while the menu is open.
              menuOpen
                ? "opacity-100 text-foreground"
                : "opacity-0 text-muted-foreground/80 group-hover:opacity-100",
            )}
          >
            <MoreVertical className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(e) => e.stopPropagation()}
          className="w-36"
        >
          <DropdownMenuItem onSelect={onRequestRename}>
            <Pencil className="size-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onRequestDelete}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

