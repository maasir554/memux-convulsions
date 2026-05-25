"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PanelRight } from "lucide-react";
import { usePanelRef, type PanelSize } from "react-resizable-panels";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Ribbon, type LeftView } from "@/components/galexy/ribbon";
import { LeftSidebar } from "@/components/galexy/left-sidebar";
import { EditorPane } from "@/components/galexy/editor-pane";
import { RightSidebar } from "@/components/galexy/right-sidebar";
import { StatusBar } from "@/components/galexy/status-bar";
import { GraphView } from "@/components/galexy/graph-view";
import { buildLinkGraph, NOTES, type Note } from "@/lib/mock-notes";

const ANIM_MS = 240;

export function AppShell() {
  const [notes, setNotes] = useState<Note[]>(NOTES);
  const [activeId, setActiveId] = useState<string | null>("welcome");
  const [openTabs, setOpenTabs] = useState<string[]>(["welcome"]);
  const [leftView, setLeftView] = useState<LeftView>("files");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [query, setQuery] = useState("");
  const [showGraph, setShowGraph] = useState(false);

  const leftPanel = usePanelRef();
  const rightPanel = usePanelRef();
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (animTimer.current) clearTimeout(animTimer.current);
    },
    [],
  );

  function pulseAnimation() {
    setAnimating(true);
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimating(false), ANIM_MS + 40);
  }

  function toggleLeft() {
    const panel = leftPanel.current;
    if (!panel) return;
    pulseAnimation();
    if (leftCollapsed) panel.expand();
    else panel.collapse();
  }

  function toggleRight() {
    const panel = rightPanel.current;
    if (!panel) return;
    pulseAnimation();
    if (rightCollapsed) panel.expand();
    else panel.collapse();
  }

  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const titleToId = useMemo(
    () => new Map(notes.map((n) => [n.title.toLowerCase(), n.id])),
    [notes],
  );
  const linkGraph = useMemo(() => buildLinkGraph(notes), [notes]);

  const edges = useMemo(() => {
    const list: { source: string; target: string }[] = [];
    for (const [source, targets] of Object.entries(linkGraph.outgoing)) {
      for (const target of targets) list.push({ source, target });
    }
    return list;
  }, [linkGraph]);

  const backlinkCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [id, list] of Object.entries(linkGraph.backlinks)) {
      counts[id] = list.length;
    }
    return counts;
  }, [linkGraph]);

  const activeNote = activeId ? (byId.get(activeId) ?? null) : null;
  const tabs = openTabs.map((id) => byId.get(id)).filter(Boolean) as Note[];

  const resolve = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter(Boolean) as Note[];
  const backlinks = activeId ? resolve(linkGraph.backlinks[activeId] ?? []) : [];
  const outgoing = activeId ? resolve(linkGraph.outgoing[activeId] ?? []) : [];

  function openNote(id: string) {
    setActiveId(id);
    setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
    setShowGraph(false); // graph "opens" the note into the editor pane
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

  function openWikiLink(title: string) {
    const id = titleToId.get(title.toLowerCase());
    if (id) openNote(id);
  }

  function wikiLinkExists(title: string) {
    return titleToId.has(title.toLowerCase());
  }

  function openTag(tag: string) {
    setQuery(tag);
    setLeftView("search");
    if (leftCollapsed) toggleLeft();
  }

  function selectLeftView(view: LeftView) {
    if (!leftCollapsed && view === leftView) {
      toggleLeft(); // re-clicking the active view collapses the sidebar
      return;
    }
    setLeftView(view);
    if (leftCollapsed) toggleLeft();
  }

  function toggleGraph() {
    setShowGraph((v) => !v);
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <div className="relative flex min-h-0 flex-1">
        <Ribbon
          leftView={leftView}
          onSelectLeftView={selectLeftView}
          onToggleLeft={toggleLeft}
          leftCollapsed={leftCollapsed}
          onToggleGraph={toggleGraph}
          graphActive={showGraph}
        />

        <ResizablePanelGroup
          orientation="horizontal"
          className={cn("min-w-0 flex-1", animating && "galexy-animating")}
        >
          <ResizablePanel
            id="left"
            panelRef={leftPanel}
            collapsible
            collapsedSize={0}
            defaultSize="20%"
            minSize="14%"
            maxSize="34%"
            onResize={(size: PanelSize) =>
              setLeftCollapsed(size.asPercentage < 1)
            }
            className="overflow-hidden"
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

          <ResizableHandle
            withHandle
            className={cn(
              "transition-opacity duration-200",
              leftCollapsed && "pointer-events-none opacity-0",
            )}
          />

          <ResizablePanel id="main" defaultSize="58%" minSize="30%">
            <div className="relative h-full">
              <EditorPane
                tabs={tabs}
                activeId={activeId}
                activeNote={activeNote}
                onActivate={setActiveId}
                onClose={closeTab}
                onChange={updateContent}
                linkExists={wikiLinkExists}
                onOpenWikiLink={openWikiLink}
                onOpenTag={openTag}
              />
              {showGraph && (
                <div className="absolute inset-0 z-20">
                  <GraphView
                    notes={notes}
                    edges={edges}
                    activeId={activeId}
                    backlinkCount={backlinkCount}
                    onOpen={openNote}
                    onClose={() => setShowGraph(false)}
                  />
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle
            withHandle
            className={cn(
              "transition-opacity duration-200",
              rightCollapsed && "pointer-events-none opacity-0",
            )}
          />

          <ResizablePanel
            id="right"
            panelRef={rightPanel}
            collapsible
            collapsedSize={0}
            defaultSize="22%"
            minSize="16%"
            maxSize="34%"
            onResize={(size: PanelSize) =>
              setRightCollapsed(size.asPercentage < 1)
            }
            className="overflow-hidden"
          >
            <RightSidebar
              activeNote={activeNote}
              backlinks={backlinks}
              outgoing={outgoing}
              onOpen={openNote}
              onToggleRight={toggleRight}
            />
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Keep a right-sidebar trigger pinned to the rightmost edge even when
            the panel is collapsed. */}
        {rightCollapsed && (
          <div className="absolute top-0 right-0 flex h-9 items-center border-b border-l bg-sidebar px-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={toggleRight}
                  aria-label="Show right sidebar"
                  aria-pressed={false}
                >
                  <PanelRight className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Show right sidebar</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      <StatusBar activeNote={activeNote} backlinkCount={backlinks.length} />
    </div>
  );
}
