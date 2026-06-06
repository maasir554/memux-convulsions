"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { FOLDER_PREFIX, type GraphEdge, type Note } from "@/lib/mock-notes";
import type {
  GraphColors,
  GraphLink,
  GraphNode,
} from "@/components/galexy/force-graph-canvas";
import { TIER_Y } from "@/components/galexy/graph-tiers";

const ForceGraphCanvas = dynamic(
  () => import("@/components/galexy/force-graph-canvas"),
  { ssr: false },
);

const FALLBACK: GraphColors = {
  markdown: "#7aa2f7",
  code: "#5cf08a",
  csv: "#3bc9db",
  pdf: "#ff8787",
  image: "#d0a3ff",
  folder: "#ffd43b",
  user: "#ff9f1c",
  workspace: "#a78bfa",
  active: "#ff6ac1",
  activeText: "#74c0fc",
  link: "#3b3f51",
  linkInbound: "#ff6ac1",
  linkOutbound: "#5cf08a",
  linkMutual: "#60a5fa",
  contains: "#ffd43b",
  tree: "#6c7693",
  text: "#c8ccd4",
};

function readColors(): GraphColors {
  if (typeof window === "undefined") return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    markdown: get("--graph-markdown", FALLBACK.markdown),
    code: get("--graph-code", FALLBACK.code),
    csv: get("--graph-csv", FALLBACK.csv),
    pdf: get("--graph-pdf", FALLBACK.pdf),
    image: get("--graph-image", FALLBACK.image),
    folder: get("--graph-folder", FALLBACK.folder),
    user: get("--graph-user", FALLBACK.user),
    workspace: get("--graph-workspace", FALLBACK.workspace),
    active: get("--graph-active", FALLBACK.active),
    activeText: get("--graph-active-text", FALLBACK.activeText),
    link: get("--graph-link", FALLBACK.link),
    linkInbound: get("--graph-link-inbound", FALLBACK.linkInbound),
    linkOutbound: get("--graph-link-outbound", FALLBACK.linkOutbound),
    linkMutual: get("--graph-link-mutual", FALLBACK.linkMutual),
    contains: get("--graph-contains", FALLBACK.contains),
    tree: get("--graph-tree", FALLBACK.tree),
    text: get("--graph-text", FALLBACK.text),
  };
}

// Synthetic tree-tier node IDs. The "__tier:" prefix won't collide with real
// item IDs and is what force-graph-canvas's click guard checks via node.type.
const USER_ID = "__tier:user";
const WORKSPACE_ID = "__tier:workspace";

// Display labels. The workspace name will become per-user / per-space data
// once multi-workspace support lands; for now it's the app name.
const USER_LABEL = "You";
const WORKSPACE_LABEL = "galexy";

type GraphViewProps = {
  items: Note[];
  edges: GraphEdge[];
  activeId: string | null;
  backlinkCount: Record<string, number>;
  onOpen: (id: string) => void;
  /** Nodes to spotlight with the accent treatment (chat embed). */
  highlightIds?: ReadonlySet<string>;
  /** Nodes the camera should zoom-to-fit once the layout settles. */
  focusIds?: ReadonlySet<string>;
  /** Fade everything that isn't highlighted / touching a highlight. */
  dimUnfocused?: boolean;
};

export function GraphView({
  items,
  edges,
  activeId,
  backlinkCount,
  onOpen,
  highlightIds,
  focusIds,
  dimUnfocused,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [colors, setColors] = useState<GraphColors>(() => readColors());

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Rebuild only when the structure changes (not on content edits).
  const nodeSignature = items
    .map((i) => {
      const val =
        i.type === "folder"
          ? (i.childIds?.length ?? 0)
          : (backlinkCount[i.id] ?? 0);
      return `${i.id}:${i.title}:${i.type}:${val}`;
    })
    .join("|");
  const edgeSignature = edges
    .map((e) => `${e.source}>${e.target}:${e.kind}`)
    .join("|");
  const graphData = useMemo<{ nodes: GraphNode[]; links: GraphLink[] }>(
    () => {
      // File + folder nodes — the existing graph layer.
      // Folders get fy pinned to their tier line so every folder sits at the
      // exact same y. Files stay free vertically so they can drift a few
      // pixels to avoid label collisions.
      // Derived folder items carry their FULL path as `title` (e.g.
      // "_Indexes/Beever AI Comm..."). For the graph label we show only the
      // last segment so a nested folder reads as its own name, not the
      // chain leading to it.
      const baseNodes: GraphNode[] = items.map((item) => {
        const displayName =
          item.type === "folder"
            ? item.title.split("/").pop() || item.title
            : item.title;
        return {
          id: item.id,
          name: displayName,
          type: item.type,
          val:
            item.type === "folder"
              ? Math.max(1, item.childIds?.length ?? 1)
              : 1 + (backlinkCount[item.id] ?? 0),
          ...(item.type === "folder" ? { fy: TIER_Y.folder } : {}),
        };
      });
      const baseLinks: GraphLink[] = edges.map((e) => ({
        source: e.source,
        target: e.target,
        kind: e.kind,
      }));

      // Tier-tier synthetic backbone: User → Workspace → (folders + root files).
      const tierNodes: GraphNode[] = [
        {
          id: USER_ID,
          name: USER_LABEL,
          type: "user",
          val: 4,
          fx: 0,
          fy: TIER_Y.user,
        },
        {
          id: WORKSPACE_ID,
          name: WORKSPACE_LABEL,
          type: "workspace",
          val: 4,
          fx: 0,
          fy: TIER_Y.workspace,
        },
      ];

      const tierLinks: GraphLink[] = [
        { source: USER_ID, target: WORKSPACE_ID, kind: "tree" },
      ];
      // Anchor every top-level item to the workspace. A folder is
      // "top-level" only when its path has no `/` separator — nested
      // folders (e.g. `_Indexes/Group X`) link to their parent folder
      // node instead, so the hierarchy reads correctly and we don't get
      // both `_Indexes` and `_Indexes/X` floating as siblings off the
      // workspace.
      const folderIds = new Set(
        items
          .filter((it) => it.type === "folder")
          .map((it) => it.id),
      );
      for (const item of items) {
        if (item.type === "folder") {
          const path = item.title;
          const slashIdx = path.lastIndexOf("/");
          if (slashIdx === -1) {
            // Top-level folder — link to workspace.
            tierLinks.push({
              source: WORKSPACE_ID,
              target: item.id,
              kind: "tree",
            });
          } else {
            const parentPath = path.slice(0, slashIdx);
            const parentId = `${FOLDER_PREFIX}${parentPath}`;
            if (folderIds.has(parentId)) {
              tierLinks.push({
                source: parentId,
                target: item.id,
                kind: "tree",
              });
            } else {
              // Parent row missing (shouldn't happen — deriveFolders adds
              // entries for every distinct folder + extras — but fall
              // back to workspace so the node isn't orphaned).
              tierLinks.push({
                source: WORKSPACE_ID,
                target: item.id,
                kind: "tree",
              });
            }
          }
        } else if (item.folder === "") {
          tierLinks.push({
            source: WORKSPACE_ID,
            target: item.id,
            kind: "tree",
          });
        }
      }

      return {
        nodes: [...tierNodes, ...baseNodes],
        links: [...tierLinks, ...baseLinks],
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeSignature, edgeSignature],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {size.width > 0 && size.height > 0 && (
        <ForceGraphCanvas
          width={size.width}
          height={size.height}
          graphData={graphData}
          colors={colors}
          activeId={activeId}
          onOpen={onOpen}
          highlightIds={highlightIds}
          focusIds={focusIds}
          dimUnfocused={dimUnfocused}
        />
      )}
    </div>
  );
}
