"use client";

import { type MouseEvent, useEffect, useMemo, useRef } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";

import type { ItemType } from "@/lib/mock-notes";
import { TIER_Y } from "@/components/galexy/graph-tiers";

// File items use ItemType; "user" and "workspace" are tree-tier synthetic
// nodes that live only in the graph layer.
export type GraphNodeKind = ItemType | "user" | "workspace";

export type GraphNode = {
  id: string;
  name: string;
  type: GraphNodeKind;
  val: number;
  /** Optional simulation pin (d3-force honors fx/fy on the node object). */
  fx?: number;
  fy?: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
};

export type GraphLink = {
  source: string;
  target: string;
  /** "tree" = structural backbone (User → Workspace → Folders). */
  kind: "link" | "contains" | "tree";
};

export type GraphColors = {
  markdown: string;
  code: string;
  csv: string;
  pdf: string;
  image: string;
  folder: string;
  user: string;
  workspace: string;
  active: string;
  /** Label colour for the active node — separate from its fill so the text
   *  reads as "I'm focused here" while the node circle stays its accent
   *  colour. */
  activeText: string;
  link: string;
  /** Wikilinks that POINT AT the active node (someone references me). */
  linkInbound: string;
  /** Wikilinks that POINT AWAY from the active node (I reference them). */
  linkOutbound: string;
  /** Both an inbound and an outbound wikilink exist between active and the
   *  same peer — a mutual reference. */
  linkMutual: string;
  contains: string;
  tree: string;
  text: string;
};

type ForceGraphCanvasProps = {
  width: number;
  height: number;
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  colors: GraphColors;
  activeId: string | null;
  onOpen: (id: string) => void;
  /**
   * Nodes to render with the "active" accent treatment (bright fill + bright
   * label). Used by the chat embed to spotlight the item(s) an answer drew
   * from. The galaxy-vault usage leaves this empty and relies on `activeId`.
   */
  highlightIds?: ReadonlySet<string>;
  /**
   * Once the simulation settles, pan/zoom the camera to fit exactly these
   * nodes. Drives the "in focus" behaviour for the chat embed.
   */
  focusIds?: ReadonlySet<string>;
  /**
   * When true (and `highlightIds` is non-empty), fade everything that isn't a
   * highlighted node or an edge touching one — so the focus pops.
   */
  dimUnfocused?: boolean;
};

const EMPTY_IDS: ReadonlySet<string> = new Set();

/** Alpha applied to nodes/edges that are dimmed out when focusing. */
const DIM_ALPHA = 0.28;

const TIER_TARGET_Y: Record<GraphNodeKind, number> = {
  user: TIER_Y.user,
  workspace: TIER_Y.workspace,
  folder: TIER_Y.folder,
  markdown: TIER_Y.file,
  code: TIER_Y.file,
  csv: TIER_Y.file,
  pdf: TIER_Y.file,
  image: TIER_Y.file,
};

// Files keep a soft pull (they can drift a little to avoid label collisions);
// folders are pinned via fy from graph-view.tsx, so their strength only acts
// as a stabilizer if the pin is removed.
const TIER_STRENGTH: Record<GraphNodeKind, number> = {
  user: 0.6,
  workspace: 0.6,
  folder: 0.4,
  markdown: 0.18,
  code: 0.18,
  csv: 0.18,
  pdf: 0.18,
  image: 0.18,
};

/** Max characters before the label gets ellipsized. */
/**
 * Zoom-aware label truncation.
 *
 * - At zoom 1× → CHARS_AT_1X characters fit before the ellipsis.
 * - Zoom in → more characters allowed (generous, because labels are big).
 * - Zoom out → fewer characters (tight, because labels crowd each other).
 *
 * Clamped to [MIN, MAX] so extreme zooms don't either disappear the text or
 * blow it out across other nodes.
 */
const LABEL_MIN_CHARS = 6;
const LABEL_MAX_CHARS = 32;
const LABEL_CHARS_AT_1X = 12;

function truncate(label: string, scale: number): string {
  const limit = Math.max(
    LABEL_MIN_CHARS,
    Math.min(LABEL_MAX_CHARS, Math.round(LABEL_CHARS_AT_1X * scale)),
  );
  if (label.length <= limit) return label;
  return label.slice(0, limit - 1) + "…";
}

const isTier = (kind: GraphNodeKind) => kind === "user" || kind === "workspace";

function radius(node: GraphNode): number {
  if (isTier(node.type)) return 6 + Math.sqrt(node.val) * 0.6;
  if (node.type === "folder") {
    // Folder size hints at how full it is, but capped so a folder with 200
    // children doesn't dwarf the entire band. (sqrt(val) * 0.4) caps out
    // around radius 7 even for huge folders.
    return Math.min(7, 2.2 + Math.sqrt(node.val) * 0.4);
  }
  return 1.5 + Math.sqrt(node.val) * 0.8;
}

const hitRadius = (node: GraphNode) => Math.max(radius(node) + 5, 8);

const measureCtx =
  typeof document !== "undefined"
    ? document.createElement("canvas").getContext("2d")
    : null;

function endpointId(end: string | number | NodeObject<GraphNode>): string {
  return typeof end === "object" ? String(end.id) : String(end);
}

/**
 * Custom d3-force: nudges each node toward its tier's target y, leaving x and
 * within-tier dynamics free. Implements the d3-force `force(alpha)` /
 * `force.initialize(nodes)` interface.
 */
/**
 * Strength multiplier applied when a node has drifted ABOVE its tier band.
 * Keeps files strictly below folders — the link force can pull a file up
 * toward its parent folder, but this barrier overpowers it.
 */
const TIER_UPWARD_PENALTY = 6;

/** Total vertical range a file can occupy below the tier-Y.file line. */
const FILE_BAND_DEPTH = 360;

const FILE_TYPES = new Set<GraphNodeKind>([
  "markdown",
  "code",
  "csv",
  "pdf",
  "image",
]);

/**
 * Deterministic per-id y offset in [0, FILE_BAND_DEPTH). Each file gets its
 * own row inside the file band — without this, the link force (containment
 * edges from a folder above) springs every file back to one shared y line.
 */
function fileTargetY(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return TIER_Y.file + (Math.abs(h) % FILE_BAND_DEPTH);
}

function makeTierYForce() {
  let nodes: GraphNode[] = [];
  const force = (alpha: number) => {
    for (const node of nodes) {
      if (node.fy != null) continue; // pinned — skip
      const bandTop = TIER_TARGET_Y[node.type];
      const strength = TIER_STRENGTH[node.type];
      if (bandTop == null || strength == null) continue;
      const y = node.y ?? 0;
      if (y < bandTop) {
        node.vy =
          (node.vy ?? 0) +
          (bandTop - y) * strength * TIER_UPWARD_PENALTY * alpha;
      } else {
        node.vy = (node.vy ?? 0) + (bandTop - y) * strength * alpha;
      }
    }
  };
  /**
   * On initialize, pin every file's fy to its hashed row. d3-force's link
   * force has strength ~1/min(degA, degB), which for a low-degree file is
   * way higher than any reasonable tier-Y soft pull (the "spring effect"
   * you were seeing). The only way to defeat it on the y-axis is to make
   * fy non-null — d3-force then leaves vy alone for that node.
   *
   * x stays free, so charge + link force handle horizontal layout per
   * folder cluster as before.
   */
  force.initialize = (n: GraphNode[]) => {
    nodes = n;
    for (const node of nodes) {
      if (node.fy != null) continue;
      if (FILE_TYPES.has(node.type)) {
        node.fy = fileTargetY(node.id);
      }
    }
  };
  return force;
}

export default function ForceGraphCanvas({
  width,
  height,
  graphData,
  colors,
  activeId,
  onOpen,
  highlightIds = EMPTY_IDS,
  focusIds = EMPTY_IDS,
  dimUnfocused = false,
}: ForceGraphCanvasProps) {
  const fgRef = useRef<
    ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>>
  >(undefined);
  const downPos = useRef<{ x: number; y: number } | null>(null);
  // Guards the one-shot camera fit so a later simulation reheat doesn't yank
  // the view back after the user has panned/zoomed.
  const didFit = useRef(false);

  /**
   * Peers of the active node that have BOTH an inbound and an outbound
   * wikilink relative to active — i.e. mutual references. Edges to/from
   * these peers are drawn in the mutual colour instead of green/pink.
   */
  const mutualPeers = useMemo(() => {
    const peers = new Set<string>();
    if (!activeId) return peers;
    const out = new Set<string>();
    const inn = new Set<string>();
    for (const link of graphData.links) {
      if (link.kind !== "link") continue;
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      if (s === activeId) out.add(t);
      if (t === activeId) inn.add(s);
    }
    for (const v of out) if (inn.has(v)) peers.add(v);
    return peers;
  }, [graphData.links, activeId]);

  // Install the tier-Y force once the graph is mounted, and tune link distance
  // so structural (tree/contains) edges spread the layout vertically. Boost
  // the charge force so file nodes don't clump together (the default ~ -30
  // produces overlapping labels for any vault > a handful of items).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("tierY", makeTierYForce());
    const linkForce = fg.d3Force("link") as
      | { distance: (fn: (link: GraphLink) => number) => unknown }
      | undefined;
    linkForce?.distance((link) => {
      if (link.kind === "tree") return 60;
      if (link.kind === "contains") return 55;
      return 35;
    });
    const chargeForce = fg.d3Force("charge") as
      | {
          strength: (fn: (n: GraphNode) => number) => unknown;
          distanceMax: (v: number) => unknown;
        }
      | undefined;
    chargeForce?.strength((n) => {
      // Tier-band nodes barely repel — their position is mostly pinned.
      if (n.type === "user" || n.type === "workspace") return -40;
      // Folders are pinned on y too, so charge acts purely horizontally —
      // strong enough that sibling folders never collide on their shared row.
      if (n.type === "folder") return -600;
      // Files: aggressive horizontal push so the link force from a shared
      // parent folder can't drag them onto the same x-column. Files are
      // pinned on y (per-id row), so this charge effectively only spreads
      // them horizontally.
      return -700;
    });
    chargeForce?.distanceMax(900);
    didFit.current = false; // new structure → allow one fresh camera fit
    fg.d3ReheatSimulation();
  }, [graphData]);

  function nodeAt(graphX: number, graphY: number): GraphNode | null {
    const scale = fgRef.current?.zoom() ?? 1;
    const fontSize = Math.max(12 / scale, 3);
    for (const node of graphData.nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const r = radius(node);
      if (Math.hypot(node.x - graphX, node.y - graphY) <= hitRadius(node)) {
        return node;
      }
      if (measureCtx) {
        measureCtx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        const halfText =
          measureCtx.measureText(truncate(node.name, scale)).width / 2 + 2;
        const withinX = Math.abs(graphX - node.x) <= halfText;
        const withinY =
          graphY >= node.y + r && graphY <= node.y + r + 1.5 + fontSize + 2;
        if (withinX && withinY) return node;
      }
    }
    return null;
  }

  function handleMouseDown(e: MouseEvent<HTMLDivElement>) {
    downPos.current = { x: e.clientX, y: e.clientY };
  }

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const fg = fgRef.current;
    if (!fg) return;
    const down = downPos.current;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y } = fg.screen2GraphCoords(
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    const node = nodeAt(x, y);
    if (!node) return;
    // Tier nodes have no underlying item — don't try to open them.
    if (isTier(node.type)) return;
    onOpen(node.id);
  }

  function colorForNode(node: GraphNode): string {
    if (node.type === "user") return colors.user;
    if (node.type === "workspace") return colors.workspace;
    return colors[node.type];
  }

  return (
    <div
      className="h-full w-full"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <ForceGraph2D<GraphNode, GraphLink>
        ref={fgRef}
        width={width}
        height={height}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={150}
        enableNodeDrag={false}
        nodeLabel={() => ""}
        onEngineStop={() => {
          const fg = fgRef.current;
          if (!fg || didFit.current || focusIds.size === 0) return;
          didFit.current = true;
          // Pan/zoom so the spotlit nodes fill the frame with breathing room.
          fg.zoomToFit(600, 48, (n) => focusIds.has(String(n.id)));
        }}
        // Replace default link rendering so widths + arrow sizes stay constant
        // across zoom levels (default rendering uses graph units, so widths
        // scale with the camera).
        linkCanvasObjectMode={() => "replace"}
        linkCanvasObject={(link, ctx, globalScale) => {
          const s =
            typeof link.source === "object"
              ? (link.source as NodeObject<GraphNode>)
              : null;
          const t =
            typeof link.target === "object"
              ? (link.target as NodeObject<GraphNode>)
              : null;
          if (
            !s ||
            !t ||
            s.x == null ||
            s.y == null ||
            t.x == null ||
            t.y == null
          )
            return;

          // Resolve colour per kind. For wikilinks (kind === "link") we also
          // tint the edge based on its direction relative to the active node:
          //   active → peer        →  outbound (green)
          //   peer  → active       →  inbound  (pink)
          //   mutual (both exist)  →  both edges drawn in mutual (blue)
          const sourceId = endpointId(link.source);
          const targetId = endpointId(link.target);
          let stroke: string;
          if (link.kind === "tree") stroke = colors.tree;
          else if (link.kind === "contains") {
            stroke =
              sourceId === activeId ? colors.contains : colors.link;
          } else if (activeId && sourceId === activeId) {
            stroke = mutualPeers.has(targetId)
              ? colors.linkMutual
              : colors.linkOutbound;
          } else if (activeId && targetId === activeId) {
            stroke = mutualPeers.has(sourceId)
              ? colors.linkMutual
              : colors.linkInbound;
          } else {
            stroke = colors.link;
          }

          // Fade edges that don't touch a highlighted node when focusing, so
          // the spotlit constellation reads clearly against the rest.
          const dimEdge =
            dimUnfocused &&
            highlightIds.size > 0 &&
            !highlightIds.has(sourceId) &&
            !highlightIds.has(targetId);
          ctx.globalAlpha = dimEdge ? DIM_ALPHA : 1;

          // Target on-screen widths in CSS px (dividing by globalScale
          // converts to graph units at the current zoom).
          const widthPx =
            link.kind === "tree"
              ? 1.4
              : link.kind === "contains"
              ? 0.6
              : 0.9;
          ctx.lineWidth = widthPx / globalScale;
          ctx.strokeStyle = stroke;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();

          // Arrowhead only for wikilinks (the directional reference edges).
          // Tree and contains links are structural — undirected visually.
          if (link.kind === "link") {
            const dx = t.x - s.x;
            const dy = t.y - s.y;
            const len = Math.hypot(dx, dy);
            if (len >= 0.001) {
              const ux = dx / len;
              const uy = dy / len;
              const tr = radius(t as GraphNode);
              // Base of the arrow sits just outside the target node.
              const baseX = t.x - ux * (tr + 1 / globalScale);
              const baseY = t.y - uy * (tr + 1 / globalScale);
              const arrowLen = 5 / globalScale; // constant on-screen px
              const arrowWid = 3 / globalScale;
              // Perpendicular vector.
              const px = -uy;
              const py = ux;
              ctx.beginPath();
              ctx.moveTo(baseX, baseY);
              ctx.lineTo(
                baseX - ux * arrowLen + px * arrowWid,
                baseY - uy * arrowLen + py * arrowWid,
              );
              ctx.lineTo(
                baseX - ux * arrowLen - px * arrowWid,
                baseY - uy * arrowLen - py * arrowWid,
              );
              ctx.closePath();
              // Arrowhead matches the line color so the inbound/outbound tint
              // reads as one continuous cue.
              ctx.fillStyle = stroke;
              ctx.fill();
            }
          }
          ctx.globalAlpha = 1; // reset — canvas state is shared across draws
        }}
        nodeCanvasObject={(node, ctx, scale) => {
          if (node.x === undefined || node.y === undefined) return;
          const r = radius(node);
          const tier = isTier(node.type);
          // A node is "highlighted" if it's the active item OR one of the
          // chat-embed's spotlit nodes. Both get the accent treatment.
          const isActive = node.id === activeId || highlightIds.has(node.id);
          const fill = isActive ? colors.active : colorForNode(node);

          // Fade non-highlighted file/folder nodes when focusing so the
          // spotlit nodes read first. Tier backbone stays at full strength.
          const dimNode =
            dimUnfocused && highlightIds.size > 0 && !isActive && !tier;
          ctx.globalAlpha = dimNode ? DIM_ALPHA : 1;

          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = fill;
          ctx.fill();

          // Tree-tier nodes get a thin outer ring for visual separation from
          // the file/folder graph below.
          if (tier) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 2.2, 0, 2 * Math.PI);
            ctx.strokeStyle = fill;
            ctx.globalAlpha = 0.4;
            ctx.lineWidth = 0.9;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }

          const fontSize = tier
            ? Math.max(13 / scale, 3.5)
            : Math.max(12 / scale, 3);
          // Active label: bolder weight + a soft dark shadow underneath so
          // the lighter blue text pops on any backdrop (other nodes / edges
          // can pass behind it). Non-active labels stay clean.
          const weight = isActive ? 700 : tier ? 600 : 400;
          ctx.font = `${weight} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          if (isActive) {
            ctx.save();
            ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
            ctx.shadowBlur = 6 / scale;
            ctx.shadowOffsetY = 1 / scale;
          }
          ctx.fillStyle = isActive ? colors.activeText : colors.text;
          ctx.fillText(
            truncate(node.name, scale),
            node.x,
            node.y + r + 1.5,
          );
          if (isActive) ctx.restore();
          ctx.globalAlpha = 1; // reset — canvas state is shared across draws
        }}
      />
    </div>
  );
}
