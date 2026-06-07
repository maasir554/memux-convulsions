"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PanelRight } from "lucide-react";
import { usePanelRef, type PanelSize } from "react-resizable-panels";
import { useSearchParams } from "next/navigation";

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
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "@/components/galexy/confirm-dialog";

const ANIM_MS = 240;

export function AppShell() {
  const {
    notes: loadedNotes,
    folders: loadedFolders,
    updateContent,
    updateLinks,
    updateSheetMeta,
    updatePdfAnnotations,
    renameItem,
    renameFolder,
    moveItem,
    moveFolder,
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

  // Deep-link: /vault?open=<itemId> opens that item in a tab on mount and
  // every time the param changes. Chat citations and graph nodes both
  // navigate via this contract. We don't strip the param after consuming
  // — that way the back button still works to re-enter the same state.
  const searchParams = useSearchParams();
  const requestedOpen = searchParams.get("open");
  const lastOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedOpen) return;
    if (lastOpenedRef.current === requestedOpen) return;
    lastOpenedRef.current = requestedOpen;
    setActiveId(requestedOpen);
    setOpenTabs((tabs) =>
      tabs.includes(requestedOpen) ? tabs : [...tabs, requestedOpen],
    );
  }, [requestedOpen]);
  const [leftView, setLeftView] = useState<LeftView>("files");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [query, setQuery] = useState("");
  /** Pending confirmation request rendered by <ConfirmDialog>. */
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );

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
    () => {
      if (activeNote?.type !== "folder") return [] as Note[];
      // Direct file children (notes whose `folder` equals this path).
      const directFiles = resolve(activeNote.childIds ?? []);
      // Immediate sub-folder children (other folder nodes whose path is
      // exactly one segment deeper than this one). Without this, a
      // container folder like `_Indexes` that holds only sub-folders
      // would render as "0 items / This folder is empty" even though it
      // contains a whole subtree.
      const myPath = activeNote.title;
      const myPrefix = `${myPath}/`;
      const subFolders = allItems.filter((it) => {
        if (it.type !== "folder") return false;
        if (!it.title.startsWith(myPrefix)) return false;
        // Direct child only: no additional `/` after the prefix.
        return !it.title.slice(myPrefix.length).includes("/");
      });
      return [...subFolders, ...directFiles];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeNote, byId, allItems],
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

  function resolveWikiImage(token: string): Note | null {
    // Accept either an items.id (preferred for the new bbox-aware
    // references emitted by the indexer) or a case-insensitive title
    // (legacy crop wikilinks and human-typed `![alt](wikilink:My Pic)`).
    // Both `image` items and `pdf` items can back a bbox reference — a PDF
    // region renders the page on demand and crops it.
    const isRefTarget = (n: Note | undefined): n is Note =>
      !!n && (n.type === "image" || n.type === "pdf");
    const direct = byId.get(token);
    if (isRefTarget(direct)) return direct;
    const id = titleToId.get(token.toLowerCase());
    if (!id) return null;
    const note = byId.get(id);
    return isRefTarget(note) ? note : null;
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

  function handleDeleteItem(id: string) {
    const note = byId.get(id);
    const label = note?.title ?? "this item";
    setConfirmRequest({
      title: `Delete “${label}”?`,
      description: "This can't be undone.",
      confirmLabel: "Delete",
      onConfirm: async () => {
        dropTab(id);
        try {
          await removeItem(id);
        } catch {
          // useVault already logs + rolls back state; restore the tab so
          // the user isn't left without a record that the action failed.
          setOpenTabs((tabs) =>
            tabs.includes(id) ? tabs : [...tabs, id],
          );
        }
      },
    });
  }

  function handleDeleteFolder(name: string) {
    const prefix = `${name}/`;
    const childCount = notes.filter(
      (n) => n.folder === name || n.folder.startsWith(prefix),
    ).length;
    setConfirmRequest({
      title: `Delete folder “${name}”?`,
      description:
        childCount === 0
          ? "This folder is empty. It can't be recovered."
          : "Everything inside this folder will be deleted too. This can't be undone.",
      highlights:
        childCount === 0
          ? undefined
          : [
              `${childCount} item${childCount === 1 ? "" : "s"} will be removed`,
            ],
      confirmLabel: "Delete folder",
      onConfirm: async () => {
        const removed = await removeFolder(name, {
          cascade: childCount > 0,
        });
        for (const id of removed) dropTab(id);
      },
    });
  }

  /**
   * Bulk delete from the multi-select panel. Counts every item that would be
   * affected — directly-selected items + items inside any selected folder —
   * and shows one combined confirmation so the user isn't clicking through
   * N prompts.
   */
  function handleDeleteBulk(
    itemIds: string[],
    folderPaths: string[],
  ): void {
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

    const highlights: string[] = [];
    if (fileCount > 0)
      highlights.push(
        `${fileCount} item${fileCount === 1 ? "" : "s"} will be removed`,
      );
    if (folderCount > 0)
      highlights.push(
        `${folderCount} folder${folderCount === 1 ? "" : "s"} will be removed`,
      );

    setConfirmRequest({
      title: "Delete selected?",
      description: "This can't be undone.",
      highlights,
      confirmLabel: "Delete",
      onConfirm: async () => {
        // Items first, then folders — so cascade-counted items aren't
        // double-counted by removeFolder's own cascade walk.
        for (const id of itemIds) {
          dropTab(id);
          try {
            await removeItem(id);
          } catch {
            // useVault logs + rolls back state.
          }
        }
        for (const path of folderPaths) {
          const removed = await removeFolder(path, { cascade: true });
          for (const id of removed) dropTab(id);
        }
      },
    });
  }

  function handleRenameItem(id: string) {
    const note = byId.get(id);
    if (!note) return;
    const next = window.prompt("Rename to:", note.title);
    if (next == null) return; // user cancelled
    const trimmed = next.trim();
    if (!trimmed || trimmed === note.title) return;
    renameItem(id, trimmed);
  }

  function handleRenameFolder(path: string) {
    const lastSlash = path.lastIndexOf("/");
    const parent = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
    const oldSegment = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
    const next = window.prompt(
      `Rename folder "${oldSegment}":`,
      oldSegment,
    );
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === oldSegment) return;
    // Reject slashes — those would mean "move to a different parent", which
    // is a separate operation and we don't want to silently re-parent.
    if (trimmed.includes("/")) {
      window.alert("Folder names can't contain a slash.");
      return;
    }
    const newPath = parent ? `${parent}/${trimmed}` : trimmed;
    void renameFolder(path, newPath);
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
            className="overflow-hidden bg-sidebar"
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
              onRenameItem={handleRenameItem}
              onRenameFolder={handleRenameFolder}
              onMoveItem={moveItem}
              onMoveFolder={(old, newParent) => void moveFolder(old, newParent)}
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
            className="overflow-hidden bg-sidebar"
          >
            <RightSidebar
              activeNote={activeNote}
              backlinks={backlinks}
              outgoing={outgoing}
              allNotes={notes}
              onOpen={openNote}
              onUpdateLinks={updateLinks}
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

      {/* Custom confirmation dialog — replaces window.confirm() for the
          three delete flows so the modal matches app theming. */}
      <ConfirmDialog
        request={confirmRequest}
        onClose={() => setConfirmRequest(null)}
      />
    </div>
  );
}
