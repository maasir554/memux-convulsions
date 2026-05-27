"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  MessageSquare,
  Plus,
  Trash2,
  Settings as SettingsIcon,
  Pencil,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/memux/chat/components/ui/button";
import { ScrollArea } from "@/memux/chat/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/memux/chat/components/ui/dropdown-menu";
import { useStore, type ChatSession } from "@/memux/chat/lib/store";
import { cn } from "@/memux/chat/lib/utils";

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const chats = useStore((s) => s.chats);
  const activeId = useStore((s) => s.activeId);
  const newChat = useStore((s) => s.newChat);
  const selectChat = useStore((s) => s.selectChat);
  const deleteChat = useStore((s) => s.deleteChat);
  const renameChat = useStore((s) => s.renameChat);

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-3 py-3">
        <Link
          href="/memux"
          aria-label="Back to MEMUX dashboard"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="font-semibold tracking-tight">memux chat</div>
        <div className="flex-1" />
        <Button
          size="icon"
          variant="ghost"
          aria-label="New chat"
          className="size-7"
          onClick={() => newChat()}
        >
          <Plus />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="flex flex-col gap-0.5 pb-3">
          {chats.length === 0 && (
            <div className="text-xs text-muted-foreground px-2 py-6 text-center">
              No chats yet
            </div>
          )}
          {chats.map((c) => (
            <SidebarChatItem
              key={c.id}
              chat={c}
              active={c.id === activeId}
              onSelect={() => selectChat(c.id)}
              onDelete={() => deleteChat(c.id)}
              onRename={(t) => renameChat(c.id, t)}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="border-t p-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={onOpenSettings}
        >
          <SettingsIcon className="h-4 w-4" />
          Settings
        </Button>
      </div>
    </aside>
  );
}

function SidebarChatItem({
  chat,
  active,
  onSelect,
  onDelete,
  onRename,
}: {
  chat: ChatSession;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(chat.title);

  function startRename() {
    setDraft(chat.title);
    setEditing(true);
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/60",
      )}
      onClick={() => !editing && onSelect()}
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const t = draft.trim();
            if (t && t !== chat.title) onRename(t);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(chat.title);
              setEditing(false);
            }
          }}
          className="flex-1 bg-background/40 outline-none px-1 rounded text-sm"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="flex-1 truncate">{chat.title || "Untitled"}</div>
      )}

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "p-1 rounded-sm text-muted-foreground/70 hover:text-foreground hover:bg-foreground/10 transition-opacity",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            onClick={(e) => e.stopPropagation()}
            aria-label="Chat options"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(e) => e.stopPropagation()}
          className="w-36"
        >
          <DropdownMenuItem onSelect={() => startRename()}>
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onDelete()}
            className="text-destructive focus:text-destructive focus:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
