import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { SettingsDialog } from "@/components/SettingsDialog";
import { DragDropOverlay } from "@/components/DragDropOverlay";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useStore } from "@/lib/store";

export default function App() {
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
    <TooltipProvider>
      <div className="h-full flex bg-background text-foreground">
        <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
        <ChatView
          pendingFiles={pendingFiles}
          consumePendingFiles={() => setPendingFiles([])}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <DragDropOverlay onFiles={(files) => setPendingFiles(files)} />
      </div>
    </TooltipProvider>
  );
}
