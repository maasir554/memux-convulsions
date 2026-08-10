"use client";

import { useState } from "react";
import {
  MessageSquare,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { ShellSidebar, useUnifiedShell } from "@/components/unified-shell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/memux/chat/components/ui/dropdown-menu";
import { useStore, type ChatSession } from "@/memux/chat/lib/store";
import { cn } from "@/memux/chat/lib/utils";
import {
  DeleteChatModal,
  RenameChatModal,
} from "@/memux/chat/components/ChatConfirmModal";

/** Chat contributes its thread list to the shared MEMUX sidebar. */
export function Sidebar() {
  const chats = useStore((state) => state.chats);
  const activeId = useStore((state) => state.activeId);
  const newChat = useStore((state) => state.newChat);
  const selectChat = useStore((state) => state.selectChat);
  const deleteChat = useStore((state) => state.deleteChat);
  const renameChat = useStore((state) => state.renameChat);
  const { expandSidebar } = useUnifiedShell();

  const [renameTarget, setRenameTarget] = useState<ChatSession | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);

  function createChat() {
    newChat();
  }

  return (
    <>
      <ShellSidebar
        compact={
          <button
            type="button"
            onClick={() => {
              createChat();
              expandSidebar();
            }}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="size-4" />
          </button>
        }
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Conversations</div>
            </div>
            <button
              type="button"
              onClick={createChat}
              className="flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              <Plus className="size-3.5" />
              New chat
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {chats.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <MessageSquare className="mx-auto size-5 text-muted-foreground/50" />
                <div className="mt-2 text-xs text-muted-foreground">No conversations yet</div>
              </div>
            ) : (
              <div className="space-y-0.5">
                {chats.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeId}
                    onSelect={() => selectChat(chat.id)}
                    onRequestRename={() => setRenameTarget(chat)}
                    onRequestDelete={() => setDeleteTarget(chat)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </ShellSidebar>

      {renameTarget && (
        <RenameChatModal
          current={renameTarget.title}
          onClose={() => setRenameTarget(null)}
          onCommit={(title) => renameChat(renameTarget.id, title)}
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

function ChatRow({
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
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <MessageSquare className="size-3.5 shrink-0 opacity-55" />
      <span className="min-w-0 flex-1 truncate" title={chat.title || "Untitled"}>
        {chat.title || "Untitled"}
      </span>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(event) => event.stopPropagation()}
            aria-label="Chat options"
            className={cn(
              "shrink-0 rounded-full p-1 transition-opacity hover:bg-foreground/10",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <MoreVertical className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()} className="w-36">
          <DropdownMenuItem onSelect={onRequestRename}>
            <Pencil className="size-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRequestDelete} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
            <Trash2 className="size-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
