"use client";

import { useEffect, useState } from "react";

import { Sidebar } from "@/memux/chat/components/Sidebar";
import { ChatView } from "@/memux/chat/components/ChatView";
import { SettingsDialog } from "@/memux/chat/components/SettingsDialog";
import { DragDropOverlay } from "@/memux/chat/components/DragDropOverlay";
import { TopNav } from "@/memux/chat/components/TopNav";
import { useStore } from "@/memux/chat/lib/store";

/**
 * App shell. Vertical layout:
 *
 *   ┌─── TopNav (h-12, full width) ────────────────────────────────┐
 *   ├──────────┬────────────────────────────────┬────────────────┤
 *   │ Sidebar  │ ChatView (messages + input)    │  AgentPanel    │
 *   │          │                                │  (right-pane)  │
 *   └──────────┴────────────────────────────────┴────────────────┘
 *
 * TopNav owns the global controls (sidebar toggle, brand + chat title,
 * token meter, agent-panel toggle). Sidebar focuses purely on chat
 * navigation. ChatView is just the conversation + composer; its right-
 * side agent panel stays nested inside it because "right is fine".
 */
export function MemuxChatApp() {
  const chats = useStore((s) => s.chats);
  const activeId = useStore((s) => s.activeId);
  const newChat = useStore((s) => s.newChat);
  const selectChat = useStore((s) => s.selectChat);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Ensure we always have an active chat once the store has rehydrated.
  useEffect(() => {
    if (chats.length === 0) {
      newChat();
      return;
    }
    if (!activeId || !chats.find((c) => c.id === activeId)) {
      selectChat(chats[0]!.id);
    }
  }, [chats, activeId, newChat, selectChat]);

  // Layout:
  //   ┌──────────┬──────────────────────────────────────────┐
  //   │ Sidebar  │ TopNav  (spans this column only)         │
  //   │ (full    ├──────────────────────────┬───────────────┤
  //   │  height) │ Chat body                │ Agent panel   │
  //   └──────────┴──────────────────────────┴───────────────┘
  //
  // TopNav sits INSIDE the right-of-sidebar column rather than spanning
  // the whole viewport. This means the topnav and the chat row below it
  // share the same width baseline, so `w-[40%]` on the topnav's agent
  // header aligns perfectly with `w-[40%]` on the agent panel below.
  // A full-width topnav can't do that without hard-coded sidebar-width
  // math.
  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopNav />
        <ChatView
          pendingFiles={pendingFiles}
          consumePendingFiles={() => setPendingFiles([])}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <DragDropOverlay onFiles={(files) => setPendingFiles(files)} />
    </div>
  );
}
