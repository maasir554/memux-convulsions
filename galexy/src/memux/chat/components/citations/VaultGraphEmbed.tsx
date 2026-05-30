"use client";

/**
 * Inline knowledge-graph mini widget rendered for
 * `![Alt](vault-graph:id1,id2,id3)` references in chat responses.
 *
 * Goal: a glanceable "constellation of what the answer drew from".
 *
 * Layout — count-aware geometry rather than a one-size-fits-all radial:
 *   1 node  → single node centred.
 *   2 nodes → side by side.
 *   3 nodes → upward-pointing triangle (one apex, two base) — equal spacing
 *             between every pair, no collinear stacking.
 *   4 nodes → square / kite, rotated 45° so the visual centre stays.
 *   5+ nodes → first at centre (model's anchor), rest on a circle.
 *
 * Labels are rendered via <foreignObject> so they wrap naturally inside a
 * fixed max-width box rather than relying on hard-truncation. Click → vault.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { Network } from "lucide-react";

import { cn } from "@/lib/utils";
import { getVaultDb } from "@/lib/db/vault-db";
import { items } from "@/lib/db/schema";
import { safeDecodeURIComponent } from "@/memux/chat/lib/uri";
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
  code: "#86efac",     // emerald-300
  csv: "#5eead4",      // teal-300
  pdf: "#fda4af",      // rose-300
  image: "#c4b5fd",    // violet-300
  folder: "#fcd34d",   // amber-300
};

// Canvas in SVG user units. Wider-than-tall reads as a "graph card", and
// the inner content gets generous breathing room from these dimensions.
const CANVAS_W = 640;
const CANVAS_H = 320;
// Visible inset for label boxes — keep a margin from the SVG edge so labels
// near the perimeter don't clip the card border.
const NODE_LABEL_W = 130;
const NODE_LABEL_H = 36;

/* ----------------------------------------------------- root */

export function VaultGraphEmbed({ ids, alt }: { ids: string; alt: string }) {
  const itemIds = useMemo(
    () =>
      ids
        .split(",")
        .map((s) => safeDecodeURIComponent(s.trim()))
        .filter((s) => s.length > 0)
        .slice(0, 12), // visual cap
    [ids],
  );

  const { nodes, edges, loading } = useGraphData(itemIds);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="my-4 flex h-[260px] w-full max-w-2xl items-center justify-center rounded-xl border border-dashed border-border/40 bg-muted/10 text-xs text-muted-foreground">
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

  const positions = layoutNodes(nodes.length, CANVAS_W, CANVAS_H);

  return (
    <div className="ws-widget-frame my-4 w-full max-w-2xl overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-card/60 via-card/30 to-muted/20">
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
        <Network className="size-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Knowledge graph
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          · {nodes.length} item{nodes.length === 1 ? "" : "s"}
          {edges.length > 0 && (
            <> · {edges.length} link{edges.length === 1 ? "" : "s"}</>
          )}
        </span>
        {alt && (
          <span className="ml-auto truncate text-[11px] italic text-foreground/80">
            {alt}
          </span>
        )}
      </div>

      <div className="relative w-full" style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}>
        <svg
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 block h-full w-full"
          role="img"
          aria-label={alt || "Knowledge graph"}
        >
          {/* Edges first so nodes sit on top. */}
          <g>
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
                  stroke={highlighted ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.16)"}
                  strokeWidth={highlighted ? 1.4 : 1}
                  className="transition-[stroke,stroke-width] duration-150"
                />
              );
            })}
          </g>

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
                  animationDelay: `${80 + i * 90}ms`,
                  transformOrigin: "center",
                }}
                onMouseEnter={() => setHoveredId(n.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <NodeLink id={n.id}>
                  {/* Halo on hover */}
                  <circle
                    r={isHovered ? 16 : 0}
                    fill={tint}
                    opacity={0.18}
                    className="transition-[r] duration-200"
                  />
                  {/* Soft outer ring to lift the node off the background */}
                  <circle
                    r={isHovered ? 9 : 8}
                    fill={tint}
                    stroke="rgba(0,0,0,0.45)"
                    strokeWidth={0.75}
                    className="transition-[r] duration-200"
                  />
                  {/* Title label below the node — foreignObject lets the
                      browser wrap real text within a fixed box, then we
                      clamp to two lines with line-clamp for clean truncation. */}
                  <foreignObject
                    x={-NODE_LABEL_W / 2}
                    y={14}
                    width={NODE_LABEL_W}
                    height={NODE_LABEL_H}
                    style={{ pointerEvents: "none" }}
                  >
                    <div
                      className={cn(
                        "line-clamp-2 px-1 text-center text-[10.5px] leading-tight transition-opacity duration-200",
                        isHovered ? "text-foreground opacity-100" : "text-foreground/80 opacity-90",
                      )}
                      style={{ textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
                    >
                      {n.title}
                    </div>
                  </foreignObject>
                </NodeLink>
              </g>
            );
          })}
        </svg>
      </div>
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
 * Count-aware deterministic positions.
 *
 * The previous version used a "first at centre, rest on a circle" rule which
 * for N=3 placed three nodes collinearly along the vertical axis — visually
 * "bunched". This version branches on small counts.
 */
function layoutNodes(n: number, width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2 - 8; // bias up a touch so labels don't hit the bottom
  const out: Array<{ x: number; y: number }> = [];
  if (n === 0) return out;

  // Inner radius reserves room for halos + label boxes around the perimeter.
  const margin = Math.max(NODE_LABEL_W / 2 + 12, NODE_LABEL_H + 24);
  const r = Math.min(width - margin * 2, height - margin * 2) / 2;

  switch (n) {
    case 1: {
      out.push({ x: cx, y: cy });
      break;
    }
    case 2: {
      // Side by side, separated by ~60% of width so labels have room.
      const dx = Math.min(r, width * 0.28);
      out.push({ x: cx - dx, y: cy });
      out.push({ x: cx + dx, y: cy });
      break;
    }
    case 3: {
      // Upward-pointing equilateral triangle — apex at top, base at bottom.
      // Equilateral side ≈ r * √3; vertical span ≈ 1.5r.
      const triR = Math.min(r * 0.78, height / 2 - margin);
      out.push({ x: cx,                          y: cy - triR });
      out.push({ x: cx - triR * Math.sin(Math.PI / 3), y: cy + triR / 2 });
      out.push({ x: cx + triR * Math.sin(Math.PI / 3), y: cy + triR / 2 });
      break;
    }
    case 4: {
      // Kite (rotated square) — visually balanced, no central node.
      const dx = Math.min(r * 0.85, width * 0.32);
      const dy = Math.min(r * 0.7,  height * 0.32);
      out.push({ x: cx,      y: cy - dy });
      out.push({ x: cx + dx, y: cy      });
      out.push({ x: cx,      y: cy + dy });
      out.push({ x: cx - dx, y: cy      });
      break;
    }
    default: {
      // 5+ → centre anchor + ring of (n - 1) around it.
      out.push({ x: cx, y: cy });
      const outer = n - 1;
      const ringR = Math.min(r * 0.92, Math.min(width, height) / 2 - margin);
      for (let i = 0; i < outer; i++) {
        const angle = (i / outer) * Math.PI * 2 - Math.PI / 2;
        out.push({
          x: cx + Math.cos(angle) * ringR,
          y: cy + Math.sin(angle) * ringR,
        });
      }
    }
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
