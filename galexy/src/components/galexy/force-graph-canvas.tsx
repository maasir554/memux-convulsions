"use client";

import { type MouseEvent, useRef } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";

import type { ItemType } from "@/lib/mock-notes";

export type GraphNode = {
  id: string;
  name: string;
  type: ItemType;
  val: number;
  x?: number;
  y?: number;
};

export type GraphLink = {
  source: string;
  target: string;
  kind: "link" | "contains";
};

export type GraphColors = {
  markdown: string;
  code: string;
  csv: string;
  pdf: string;
  image: string;
  folder: string;
  active: string;
  link: string;
  contains: string;
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

const radius = (node: GraphNode) => 1.5 + Math.sqrt(node.val) * 0.8;
const hitRadius = (node: GraphNode) => Math.max(radius(node) + 5, 8);

const measureCtx =
  typeof document !== "undefined"
    ? document.createElement("canvas").getContext("2d")
    : null;

function endpointId(end: string | number | NodeObject<GraphNode>): string {
  return typeof end === "object" ? String(end.id) : String(end);
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
    if (node) onOpen(node.id);
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
        cooldownTicks={120}
        enableNodeDrag={false}
        nodeLabel={() => ""}
        linkWidth={(link) => (link.kind === "contains" ? 0.75 : 1)}
        linkColor={(link) => {
          if (link.kind !== "contains") return colors.link;
          return endpointId(link.source) === activeId
            ? colors.contains
            : colors.link;
        }}
        linkDirectionalArrowLength={(link) =>
          link.kind === "contains" ? 0 : 3
        }
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={() => colors.link}
        nodeCanvasObject={(node, ctx, scale) => {
          if (node.x === undefined || node.y === undefined) return;
          const r = radius(node);
          const isActive = node.id === activeId;

          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = isActive ? colors.active : colors[node.type];
          ctx.fill();

          const fontSize = Math.max(12 / scale, 3);
          ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = isActive ? colors.active : colors.text;
          ctx.fillText(node.name, node.x, node.y + r + 1.5);
        }}
      />
    </div>
  );
}
