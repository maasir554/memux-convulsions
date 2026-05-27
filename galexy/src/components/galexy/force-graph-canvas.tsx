"use client";

import { type MouseEvent, useEffect, useRef } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";

import type { ItemType } from "@/lib/mock-notes";

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
  link: string;
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
};

/** Target y-coordinate per tier (simulation units). */
const TIER_Y: Record<GraphNodeKind, number> = {
  user: -340,
  workspace: -200,
  folder: -70,
  markdown: 90,
  code: 90,
  csv: 90,
  pdf: 90,
  image: 90,
};

const TIER_STRENGTH: Record<GraphNodeKind, number> = {
  user: 0.6, // also pinned via fy, this just stabilizes
  workspace: 0.6,
  folder: 0.18,
  markdown: 0.08,
  code: 0.08,
  csv: 0.08,
  pdf: 0.08,
  image: 0.08,
};

const isTier = (kind: GraphNodeKind) => kind === "user" || kind === "workspace";

function radius(node: GraphNode): number {
  if (isTier(node.type)) return 6 + Math.sqrt(node.val) * 0.6;
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
function makeTierYForce() {
  let nodes: GraphNode[] = [];
  const force = (alpha: number) => {
    for (const node of nodes) {
      if (node.fy != null) continue; // pinned — skip
      const target = TIER_Y[node.type];
      const strength = TIER_STRENGTH[node.type];
      if (target == null || strength == null) continue;
      const y = node.y ?? 0;
      node.vy = (node.vy ?? 0) + (target - y) * strength * alpha;
    }
  };
  force.initialize = (n: GraphNode[]) => {
    nodes = n;
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
}: ForceGraphCanvasProps) {
  const fgRef = useRef<
    ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>>
  >(undefined);
  const downPos = useRef<{ x: number; y: number } | null>(null);

  // Install the tier-Y force once the graph is mounted, and tune link distance
  // so structural (tree/contains) edges spread the layout vertically.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("tierY", makeTierYForce());
    const linkForce = fg.d3Force("link") as
      | { distance: (fn: (link: GraphLink) => number) => unknown }
      | undefined;
    linkForce?.distance((link) => {
      if (link.kind === "tree") return 90;
      if (link.kind === "contains") return 50;
      return 30;
    });
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
        const halfText = measureCtx.measureText(node.name).width / 2 + 2;
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
        linkWidth={(link) => {
          if (link.kind === "tree") return 1.4;
          if (link.kind === "contains") return 0.75;
          return 1;
        }}
        linkColor={(link) => {
          if (link.kind === "tree") return colors.tree;
          if (link.kind !== "contains") return colors.link;
          return endpointId(link.source) === activeId
            ? colors.contains
            : colors.link;
        }}
        linkDirectionalArrowLength={(link) =>
          link.kind === "link" ? 3 : 0
        }
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={() => colors.link}
        nodeCanvasObject={(node, ctx, scale) => {
          if (node.x === undefined || node.y === undefined) return;
          const r = radius(node);
          const isActive = node.id === activeId;
          const tier = isTier(node.type);
          const fill = isActive ? colors.active : colorForNode(node);

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
          ctx.font = `${tier ? 600 : 400} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = isActive ? colors.active : colors.text;
          ctx.fillText(node.name, node.x, node.y + r + 1.5);
        }}
      />
    </div>
  );
}
