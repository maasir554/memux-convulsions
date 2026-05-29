"use client";

/**
 * Inline knowledge-graph mini widget rendered for
 * `![Alt](vault-graph:id1,id2,id3)` references in chat responses.
 *
 * Goal: show the constellation of vault items the answer drew from at a
 * glance — type-coloured nodes, edges where items share concepts or are
 * directly linked. The point isn't a richly-explorable graph; it's a
 * visual punchline that says "this is a knowledge base, not a chatbot."
 *
 * Layout: small force-free deterministic placement. The first node sits
 * at the centre; the rest distribute around it on a circle. Edges are
 * drawn between pairs whose `links` jsonb mentions the other's title or
 * whose `tags` intersect. SVG, no animation framework.
 *
 * Click a node → opens that item in the vault. Hover → highlights edges
 * + shows a tooltip with the title.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { Network } from "lucide-react";

import { cn } from "@/lib/utils";
import { getVaultDb } from "@/lib/db/vault-db";
import { items } from "@/lib/db/schema";
import type { ItemType } from "@/lib/mock-notes";

/** Slim row shape — we only use these fields, and avoid Note's strict
 *  updatedAt:string clashing with the Drizzle Date column type. */
type GraphRow = {
  id: string;
  title: string;
  type: ItemType;
  links: string[];
  tags: string[];
};

const TINT_BY_TYPE: Record<ItemType, string> = {
  markdown: "#7dd3fc", // sky-300
  code: "#86efac", // emerald-300
  csv: "#5eead4", // teal-300
  pdf: "#fda4af", // rose-300
  image: "#c4b5fd", // violet-300
  folder: "#fcd34d", // amber-300
};

/* ----------------------------------------------------- root */

export function VaultGraphEmbed({ ids, alt }: { ids: string; alt: string }) {
  const itemIds = useMemo(
    () =>
      ids
        .split(",")
        .map((s) => decodeURIComponent(s.trim()))
        .filter((s) => s.length > 0)
        .slice(0, 12), // visual cap
    [ids],
  );

  const { nodes, edges, loading } = useGraphData(itemIds);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="my-4 flex h-[220px] w-full max-w-2xl items-center justify-center rounded-xl border border-dashed border-border/40 bg-muted/10 text-xs text-muted-foreground">
        Building knowledge graph…
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="my-4 flex h-[100px] w-full max-w-2xl items-center justify-center gap-2 rounded-xl border border-dashed border-border/40 bg-muted/10 text-xs italic text-muted-foreground">
        <Network className="size-3.5" />
        Graph: no resolvable items.
      </div>
    );
  }

  const positions = layoutNodes(nodes.length, 540, 200);

  return (
    <div className="my-4 w-full max-w-2xl overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-card/60 via-card/30 to-muted/20">
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <Network className="size-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Knowledge graph
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          · {nodes.length} item{nodes.length === 1 ? "" : "s"}
        </span>
        {alt && (
          <span className="ml-auto truncate text-[11px] italic text-foreground/80">
            {alt}
          </span>
        )}
      </div>

      <svg
        viewBox="0 0 540 220"
        className="block w-full"
        style={{ height: 220 }}
        role="img"
        aria-label={alt || "Knowledge graph"}
      >
        {/* Edges first so nodes sit on top. */}
        {edges.map((e, i) => {
          const a = positions[e.from];
          const b = positions[e.to];
          if (!a || !b) return null;
          const highlighted =
            hoveredId === nodes[e.from].id || hoveredId === nodes[e.to].id;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={highlighted ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)"}
              strokeWidth={highlighted ? 1.5 : 1}
              className="transition-[stroke,stroke-width] duration-150"
            />
          );
        })}

        {/* Nodes. */}
        {nodes.map((n, i) => {
          const p = positions[i];
          if (!p) return null;
          const tint = TINT_BY_TYPE[n.type] ?? "#cbd5e1";
          const isHovered = hoveredId === n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x}, ${p.y})`}
              className="ws-card-enter cursor-pointer"
              style={{
                animationDelay: `${60 + i * 60}ms`,
                transformOrigin: "center",
              }}
              onMouseEnter={() => setHoveredId(n.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <NodeLink id={n.id}>
                {/* Halo on hover */}
                <circle
                  r={isHovered ? 14 : 0}
                  fill={tint}
                  opacity={0.18}
                  className="transition-[r] duration-150"
                />
                <circle
                  r={isHovered ? 7 : 6}
                  fill={tint}
                  stroke="rgba(0,0,0,0.4)"
                  strokeWidth={0.5}
                  className="transition-[r] duration-150"
                />
                <text
                  x={0}
                  y={20}
                  textAnchor="middle"
                  className={cn(
                    "fill-foreground text-[10px] transition-opacity duration-150",
                    isHovered ? "opacity-100" : "opacity-75",
                  )}
                  style={{ pointerEvents: "none" }}
                >
                  {truncate(n.title, 22)}
                </text>
              </NodeLink>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ----------------------------------------------------- node link */

function NodeLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Link
      href={`/vault?open=${encodeURIComponent(id)}`}
      className="focus:outline-none"
    >
      {children}
    </Link>
  );
}

/* ----------------------------------------------------- layout */

/**
 * Distribute N nodes: first at the centre, the rest evenly around a
 * circle that fills most of the SVG. Deterministic, no physics.
 */
function layoutNodes(n: number, width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.36;
  if (n === 0) return [];
  const out: Array<{ x: number; y: number }> = [{ x: cx, y: cy }];
  if (n === 1) return out;
  const outer = n - 1;
  for (let i = 0; i < outer; i++) {
    const angle = (i / outer) * Math.PI * 2 - Math.PI / 2;
    out.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }
  return out;
}

/* ----------------------------------------------------- data */

type GraphNode = { id: string; title: string; type: ItemType };
type GraphEdge = { from: number; to: number };

function useGraphData(itemIds: string[]) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (itemIds.length === 0) {
          setNodes([]);
          setEdges([]);
          return;
        }
        const db = await getVaultDb();
        const rows = await db
          .select({
            id: items.id,
            title: items.title,
            type: items.type,
            links: items.links,
            tags: items.tags,
          })
          .from(items)
          .where(inArray(items.id, itemIds));
        // Preserve the order the model gave (so centre node is the
        // model's first pick).
        const byId = new Map<string, GraphRow>(
          rows.map((r) => [
            r.id,
            {
              id: r.id,
              title: r.title,
              type: r.type as ItemType,
              links: r.links ?? [],
              tags: r.tags ?? [],
            },
          ]),
        );
        const ordered: GraphRow[] = [];
        for (const id of itemIds) {
          const r = byId.get(id);
          if (r) ordered.push(r);
        }

        const nextNodes: GraphNode[] = ordered.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
        }));

        // Edge derivation:
        //   1. Outgoing links — if A.links contains B.title.
        //   2. Shared tags — at least one common tag between A and B
        //      (concept overlap). Only counts when the shared tag isn't
        //      generic ("indexed" / "dom-image" etc.).
        const GENERIC_TAGS = new Set([
          "indexed",
          "dom-image",
          "capture",
          "ui",
          "content",
          "decorative",
        ]);
        const edgeSet = new Set<string>();
        for (let i = 0; i < ordered.length; i++) {
          for (let j = i + 1; j < ordered.length; j++) {
            const a = ordered[i];
            const b = ordered[j];
            const aLinksB = (a.links ?? []).some(
              (l) => l.toLowerCase() === b.title.toLowerCase(),
            );
            const bLinksA = (b.links ?? []).some(
              (l) => l.toLowerCase() === a.title.toLowerCase(),
            );
            const tagsA = new Set(
              (a.tags ?? []).filter((t) => !GENERIC_TAGS.has(t)),
            );
            const sharedTag = (b.tags ?? []).some(
              (t) => !GENERIC_TAGS.has(t) && tagsA.has(t),
            );
            if (aLinksB || bLinksA || sharedTag) {
              const key = `${i}-${j}`;
              if (!edgeSet.has(key)) {
                edgeSet.add(key);
              }
            }
          }
        }
        const nextEdges: GraphEdge[] = Array.from(edgeSet).map((k) => {
          const [from, to] = k.split("-").map(Number);
          return { from, to };
        });

        if (cancelled) return;
        setNodes(nextNodes);
        setEdges(nextEdges);
      } catch (err) {
        console.warn("[vault-graph] load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemIds]);

  return { nodes, edges, loading };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
