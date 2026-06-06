"use client";

/**
 * Inline knowledge-graph widget rendered for
 * `![Alt](vault-graph:id1,id2,id3)` references in chat responses.
 *
 * This is the SAME force-directed engine the galaxy vault uses
 * (`GraphView` → `ForceGraphCanvas`) — tier backbone (You → workspace →
 * folders → files), real d3-force layout, theme colours, click-to-open.
 *
 * The chat-specific twist: rather than the whole vault, we render a focused
 * SUBGRAPH — the item(s) the answer drew from, plus their direct neighbours
 * and containing folders — then spotlight the referenced node(s) with the
 * accent treatment and zoom the camera to fit them.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Network } from "lucide-react";

import { GraphView } from "@/components/galexy/graph-view";
import { getVaultDb, loadAllItems, loadAllFolders } from "@/lib/db/vault-db";
import {
  FOLDER_PREFIX,
  buildContainmentEdges,
  buildItems,
  buildLinkGraph,
  type GraphEdge,
  type Note,
} from "@/lib/mock-notes";
import { safeDecodeURIComponent } from "@/memux/chat/lib/uri";

type SubGraph = {
  items: Note[];
  edges: GraphEdge[];
  backlinkCount: Record<string, number>;
  /** Referenced ids that actually resolved to an item — what we spotlight. */
  resolved: string[];
};

export function VaultGraphEmbed({ ids, alt }: { ids: string; alt: string }) {
  const router = useRouter();

  const itemIds = useMemo(
    () =>
      ids
        .split(",")
        .map((s) => safeDecodeURIComponent(s.trim()))
        .filter((s) => s.length > 0)
        .slice(0, 12), // visual cap
    [ids],
  );

  const { graph, loading } = useSubGraph(itemIds);

  const highlightIds = useMemo(
    () => new Set(graph?.resolved ?? []),
    [graph],
  );

  if (loading) {
    return (
      <div className="my-4 flex h-[260px] w-full max-w-2xl items-center justify-center rounded-xl border border-dashed border-border/40 bg-muted/10 text-xs text-muted-foreground">
        Building knowledge graph…
      </div>
    );
  }

  if (!graph || graph.resolved.length === 0) {
    return (
      <div className="my-4 flex h-[100px] w-full max-w-2xl items-center justify-center gap-2 rounded-xl border border-dashed border-border/40 bg-muted/10 text-xs italic text-muted-foreground">
        <Network className="size-3.5" />
        Graph: no resolvable items.
      </div>
    );
  }

  const focusCount = graph.resolved.length;

  return (
    <div className="ws-widget-frame my-4 w-full max-w-2xl overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-card/60 via-card/30 to-muted/20">
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
        <Network className="size-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Knowledge graph
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          · {focusCount} item{focusCount === 1 ? "" : "s"} in focus
        </span>
        {alt && (
          <span className="ml-auto truncate text-[11px] italic text-foreground/80">
            {alt}
          </span>
        )}
      </div>

      <div className="relative h-[340px] w-full">
        <GraphView
          items={graph.items}
          edges={graph.edges}
          backlinkCount={graph.backlinkCount}
          activeId={null}
          highlightIds={highlightIds}
          focusIds={highlightIds}
          dimUnfocused
          onOpen={(id) =>
            router.push(`/vault?open=${encodeURIComponent(id)}`)
          }
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------- data */

/**
 * Load the full vault, build the same node/edge/backlink structures the
 * galaxy vault shell builds, then slice out a focused subgraph:
 *   • the referenced items (spotlit),
 *   • their 1-hop wikilink neighbours (inbound + outbound),
 *   • the folders that contain any of the above (so the tier backbone reads).
 */
function useSubGraph(itemIds: string[]) {
  const [graph, setGraph] = useState<SubGraph | null>(null);
  const [loading, setLoading] = useState(true);

  // Stable key so the effect only re-runs when the actual id list changes.
  const key = itemIds.join(",");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (itemIds.length === 0) {
          if (!cancelled) setGraph(null);
          return;
        }
        const db = await getVaultDb();
        const [notes, folderNames] = await Promise.all([
          loadAllItems(db),
          loadAllFolders(db),
        ]);

        // Files + derived folders + the full link/containment graph — exactly
        // what app-shell.tsx feeds the vault GraphView.
        const allItems = buildItems(notes, folderNames);
        const byId = new Map(allItems.map((i) => [i.id, i]));
        const linkGraph = buildLinkGraph(allItems);
        const allEdges: GraphEdge[] = [];
        for (const [source, targets] of Object.entries(linkGraph.outgoing)) {
          for (const target of targets) {
            allEdges.push({ source, target, kind: "link" });
          }
        }
        allEdges.push(...buildContainmentEdges(allItems));

        const backlinkCount: Record<string, number> = {};
        for (const [id, list] of Object.entries(linkGraph.backlinks)) {
          backlinkCount[id] = list.length;
        }

        // Resolve referenced ids (preserve the model's order).
        const resolved = itemIds.filter((id) => byId.has(id));

        // Build the keep-set: referenced ∪ 1-hop neighbours ∪ containing
        // folders (incl. ancestor folders so nesting reads correctly).
        const keep = new Set<string>(resolved);
        for (const id of resolved) {
          for (const n of linkGraph.outgoing[id] ?? []) keep.add(n);
          for (const n of linkGraph.backlinks[id] ?? []) keep.add(n);
        }
        for (const id of [...keep]) {
          const note = byId.get(id);
          if (!note || note.type === "folder" || !note.folder) continue;
          let path = note.folder;
          keep.add(`${FOLDER_PREFIX}${path}`);
          while (path.includes("/")) {
            path = path.slice(0, path.lastIndexOf("/"));
            keep.add(`${FOLDER_PREFIX}${path}`);
          }
        }

        const subItems = allItems.filter((i) => keep.has(i.id));
        const subEdges = allEdges.filter(
          (e) => keep.has(e.source) && keep.has(e.target),
        );

        if (cancelled) return;
        setGraph({
          items: subItems,
          edges: subEdges,
          backlinkCount,
          resolved,
        });
      } catch (err) {
        console.warn("[vault-graph] load failed", err);
        if (!cancelled) setGraph(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { graph, loading };
}
