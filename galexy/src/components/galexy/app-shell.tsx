"use client";

import { useMemo, useState } from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Ribbon, type LeftView } from "@/components/galexy/ribbon";
import { LeftSidebar } from "@/components/galexy/left-sidebar";
import { EditorPane } from "@/components/galexy/editor-pane";
import { RightSidebar } from "@/components/galexy/right-sidebar";
import { StatusBar } from "@/components/galexy/status-bar";
import { buildLinkGraph, NOTES, type Note } from "@/lib/mock-notes";

export function AppShell() {
  const [notes, setNotes] = useState<Note[]>(NOTES);
  const [activeId, setActiveId] = useState<string | null>("welcome");
  const [openTabs, setOpenTabs] = useState<string[]>(["welcome"]);
  const [leftView, setLeftView] = useState<LeftView>("files");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [query, setQuery] = useState("");

  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const linkGraph = useMemo(() => buildLinkGraph(notes), [notes]);

  const activeNote = activeId ? (byId.get(activeId) ?? null) : null;
  const tabs = openTabs.map((id) => byId.get(id)).filter(Boolean) as Note[];

  const resolve = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter(Boolean) as Note[];
  const backlinks = activeId ? resolve(linkGraph.backlinks[activeId] ?? []) : [];
  const outgoing = activeId ? resolve(linkGraph.outgoing[activeId] ?? []) : [];

  function openNote(id: string) {
    setActiveId(id);
    setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
  }

  function closeTab(id: string) {
    setOpenTabs((tabs) => {
      const next = tabs.filter((t) => t !== id);
      if (id === activeId) {
        const idx = tabs.indexOf(id);
        setActiveId(next[idx] ?? next[idx - 1] ?? next[0] ?? null);
      }
      return next;
    });
  }

  function updateContent(id: string, content: string) {
    setNotes((notes) =>
      notes.map((n) => (n.id === id ? { ...n, content } : n)),
    );
  }

  function selectLeftView(view: LeftView) {
    if (!leftCollapsed && view === leftView) {
      setLeftCollapsed(true); // toggle off if re-clicking the active view
      return;
    }
    setLeftView(view);
    setLeftCollapsed(false);
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <Ribbon
          leftView={leftView}
          onSelectLeftView={selectLeftView}
          onToggleLeft={() => setLeftCollapsed((v) => !v)}
          leftCollapsed={leftCollapsed}
        />

        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          {!leftCollapsed && (
            <>
              <ResizablePanel
                id="left"
                defaultSize="20%"
                minSize="14%"
                maxSize="34%"
              >
                <LeftSidebar
                  view={leftView}
                  notes={notes}
                  activeId={activeId ?? ""}
                  onOpen={openNote}
                  query={query}
                  onQueryChange={setQuery}
                />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}

          <ResizablePanel id="main" defaultSize="58%" minSize="30%">
            <EditorPane
              tabs={tabs}
              activeId={activeId}
              activeNote={activeNote}
              onActivate={setActiveId}
              onClose={closeTab}
              onChange={updateContent}
              onToggleRight={() => setRightCollapsed((v) => !v)}
              rightCollapsed={rightCollapsed}
            />
          </ResizablePanel>

          {!rightCollapsed && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="right"
                defaultSize="22%"
                minSize="16%"
                maxSize="34%"
              >
                <RightSidebar
                  activeNote={activeNote}
                  backlinks={backlinks}
                  outgoing={outgoing}
                  onOpen={openNote}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      <StatusBar activeNote={activeNote} backlinkCount={backlinks.length} />
    </div>
  );
}
