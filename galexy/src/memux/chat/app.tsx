"use client";

import { useEffect, useState } from "react";

import { Sidebar } from "@/memux/chat/components/Sidebar";
import { ChatView } from "@/memux/chat/components/ChatView";
import { SettingsDialog } from "@/memux/chat/components/SettingsDialog";
import { DragDropOverlay } from "@/memux/chat/components/DragDropOverlay";
import { useStore } from "@/memux/chat/lib/store";

/**
 * Galexy-hosted port of plasma's App. Same components, same store, same
 * behaviour — only the surrounding shell (the back-to-MEMUX link) is new.
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

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <ChatView
        pendingFiles={pendingFiles}
        consumePendingFiles={() => setPendingFiles([])}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <DragDropOverlay onFiles={(files) => setPendingFiles(files)} />
    </div>
  );
}
