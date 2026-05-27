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
import {
  buildContainmentEdges,
  buildItems,
  buildLinkGraph,
  type GraphEdge,
  type Note,
} from "@/lib/mock-notes";
import { useVault } from "@/components/galexy/use-vault";

const ANIM_MS = 240;

export function AppShell() {
  const {
    notes: loadedNotes,
    folders: loadedFolders,
    updateContent,
    updateSheetMeta,
    updatePdfAnnotations,
    createNote,
    createFolder,
    uploadFiles,
    removeItem,
    removeFolder,
  } = useVault();
  const notes = useMemo(() => loadedNotes ?? [], [loadedNotes]);
  const folderNames = useMemo(() => loadedFolders ?? [], [loadedFolders]);

  const [activeId, setActiveId] = useState<string | null>("welcome");
  const [openTabs, setOpenTabs] = useState<string[]>(["welcome"]);
  const [leftView, setLeftView] = useState<LeftView>("files");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [query, setQuery] = useState("");

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

  // Files + derived folder items = everything addressable (graph nodes, tabs).
  // folderNames lets empty folders persist past page reload.
  const allItems = useMemo(
    () => buildItems(notes, folderNames),
    [notes, folderNames],
  );
  const byId = useMemo(() => new Map(allItems.map((n) => [n.id, n])), [allItems]);
  const titleToId = useMemo(
    () => new Map(allItems.map((n) => [n.title.toLowerCase(), n.id])),
    [allItems],
  );
  const linkGraph = useMemo(() => buildLinkGraph(allItems), [allItems]);

  const edges = useMemo<GraphEdge[]>(() => {
    const list: GraphEdge[] = [];
    for (const [source, targets] of Object.entries(linkGraph.outgoing)) {
      for (const target of targets) list.push({ source, target, kind: "link" });
    }
    list.push(...buildContainmentEdges(allItems));
    return list;
  }, [linkGraph, allItems]);

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

  const folderChildren = useMemo(
    () =>
      activeNote?.type === "folder"
        ? resolve(activeNote.childIds ?? [])
        : ([] as Note[]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeNote, byId],
  );

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

  function openWikiLink(title: string) {
    const id = titleToId.get(title.toLowerCase());
    if (id) openNote(id);
  }

  function wikiLinkExists(title: string) {
    return titleToId.has(title.toLowerCase());
  }

  function resolveWikiImage(title: string): Note | null {
    const id = titleToId.get(title.toLowerCase());
    if (!id) return null;
    const note = byId.get(id);
    if (!note || note.type !== "image") return null;
    return note;
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

  if (!loadedNotes || !loadedFolders) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-sm text-muted-foreground">
        Loading vault…
      </div>
    );
  }

  async function handleCreateNote(input: {
    type: "markdown" | "code" | "csv";
    title: string;
    folder?: string;
    language?: string;
  }) {
    const id = await createNote(input);
    openNote(id);
  }

  async function handleUploadFiles(
    category: Parameters<typeof uploadFiles>[0]["category"],
    folder: string,
    files: File[],
  ) {
    const ids = await uploadFiles({ category, folder, files });
    if (ids.length > 0) openNote(ids[0]);
  }

  /** Drop a tab without going through the user-initiated close path. */
  function dropTab(id: string) {
    setOpenTabs((tabs) => {
      if (!tabs.includes(id)) return tabs;
      const next = tabs.filter((t) => t !== id);
      if (id === activeId) {
        const idx = tabs.indexOf(id);
        setActiveId(next[idx] ?? next[idx - 1] ?? next[0] ?? null);
      }
      return next;
    });
  }

  async function handleDeleteItem(id: string) {
    const note = byId.get(id);
    const label = note?.title ?? "this item";
    if (!window.confirm(`Delete “${label}”? This can't be undone.`)) return;
    dropTab(id);
    try {
      await removeItem(id);
    } catch {
      // useVault already logs + rolls back local state; surface tab again.
      setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
    }
  }

  async function handleDeleteFolder(name: string) {
    const prefix = `${name}/`;
    const childCount = notes.filter(
      (n) => n.folder === name || n.folder.startsWith(prefix),
    ).length;
    const msg =
      childCount === 0
        ? `Delete folder “${name}”?`
        : `Delete folder “${name}” and its ${childCount} item${
            childCount === 1 ? "" : "s"
          }? This can't be undone.`;
    if (!window.confirm(msg)) return;
    const removed = await removeFolder(name, { cascade: childCount > 0 });
    for (const id of removed) dropTab(id);
  }

  /**
   * Bulk delete from the multi-select panel. Counts every item that would be
   * affected — directly-selected items + items inside any selected folder —
   * and shows one combined confirmation so the user isn't clicking through
   * N prompts.
   */
  async function handleDeleteBulk(
    itemIds: string[],
    folderPaths: string[],
  ): Promise<void> {
    const cascadeIds = new Set<string>(itemIds);
    for (const path of folderPaths) {
      const prefix = `${path}/`;
      for (const n of notes) {
        if (n.folder === path || n.folder.startsWith(prefix)) {
          cascadeIds.add(n.id);
        }
      }
    }
    const fileCount = cascadeIds.size;
    const folderCount = folderPaths.length;
    if (fileCount === 0 && folderCount === 0) return;

    const parts: string[] = [];
    if (fileCount > 0)
      parts.push(`${fileCount} item${fileCount === 1 ? "" : "s"}`);
    if (folderCount > 0)
      parts.push(`${folderCount} folder${folderCount === 1 ? "" : "s"}`);
    const msg = `Delete ${parts.join(" and ")}? This can't be undone.`;
    if (!window.confirm(msg)) return;

    // Items first, then folders — so cascade-counted items aren't double-
    // counted by removeFolder's own cascade walk.
    for (const id of itemIds) {
      dropTab(id);
      try {
        await removeItem(id);
      } catch {
        // useVault logs + rolls back state; nothing else to do here.
      }
    }
    for (const path of folderPaths) {
      const removed = await removeFolder(path, { cascade: true });
      for (const id of removed) dropTab(id);
    }
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <div className="relative flex min-h-0 flex-1">
        <Ribbon
          leftView={leftView}
          onSelectLeftView={selectLeftView}
          onToggleLeft={toggleLeft}
          leftCollapsed={leftCollapsed}
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
            maxSize="50%"
            onResize={(size: PanelSize) =>
              setLeftCollapsed(size.asPercentage < 1)
            }
            className="overflow-hidden"
          >
            <LeftSidebar
              view={leftView}
              notes={notes}
              items={allItems}
              folderNames={folderNames}
              activeId={activeId ?? ""}
              onOpen={openNote}
              query={query}
              onQueryChange={setQuery}
              edges={edges}
              backlinkCount={backlinkCount}
              onCreateNote={handleCreateNote}
              onCreateFolder={createFolder}
              onUploadFiles={handleUploadFiles}
              onDeleteItem={handleDeleteItem}
              onDeleteFolder={handleDeleteFolder}
              onDeleteBulk={handleDeleteBulk}
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
            <EditorPane
              tabs={tabs}
              activeId={activeId}
              activeNote={activeNote}
              folderChildren={folderChildren}
              onActivate={setActiveId}
              onClose={closeTab}
              onOpen={openNote}
              onChange={updateContent}
              onSheetMetaChange={updateSheetMeta}
              onPdfAnnotationsChange={updatePdfAnnotations}
              linkExists={wikiLinkExists}
              onOpenWikiLink={openWikiLink}
              onOpenTag={openTag}
              resolveWikiImage={resolveWikiImage}
            />
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
