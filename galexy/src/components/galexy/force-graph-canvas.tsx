"use client";

import { type MouseEvent, useRef } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";

export type GraphNode = {
  id: string;
  name: string;
  val: number;
  x?: number;
  y?: number;
};

export type GraphLink = { source: string; target: string };

export type GraphColors = {
  node: string;
  active: string;
  link: string;
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

// Offscreen context just for measuring label widths during hit-testing.
const measureCtx =
  typeof document !== "undefined"
    ? document.createElement("canvas").getContext("2d")
    : null;

export default function ForceGraphCanvas({
  width,
  height,
  graphData,
  colors,
  activeId,
  onOpen,
}: ForceGraphCanvasProps) {
  const fgRef =
    useRef<
      ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>>
    >(undefined);
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Our own hit-test (the library's shadow-canvas detection misses some nodes).
  function nodeAt(graphX: number, graphY: number): GraphNode | null {
    const scale = fgRef.current?.zoom() ?? 1;
    const fontSize = Math.max(12 / scale, 3);
    for (const node of graphData.nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const r = radius(node);
      // dot
      if (Math.hypot(node.x - graphX, node.y - graphY) <= r + 4) return node;
      // label box
      if (measureCtx) {
        measureCtx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        const halfText = measureCtx.measureText(node.name).width / 2 + 2;
        const withinX = Math.abs(graphX - node.x) <= halfText;
        const withinY =
          graphY >= node.y + r &&
          graphY <= node.y + r + 1.5 + fontSize + 2;
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
    // Ignore pans/drags (only treat near-stationary press as a click).
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y } = fg.screen2GraphCoords(
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    const node = nodeAt(x, y);
    if (node) onOpen(node.id);
  }

  // Custom hover tooltip (the library's native one uses the same broken hit
  // detection, so it skipped some nodes). Updated via refs to avoid re-renders.
  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const fg = fgRef.current;
    const tip = tooltipRef.current;
    if (!fg || !tip) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const { x, y } = fg.screen2GraphCoords(offsetX, offsetY);
    const node = nodeAt(x, y);
    if (node) {
      tip.textContent = node.name;
      tip.style.left = `${offsetX + 12}px`;
      tip.style.top = `${offsetY + 12}px`;
      tip.style.display = "block";
      e.currentTarget.style.cursor = "pointer";
    } else {
      tip.style.display = "none";
      e.currentTarget.style.cursor = "default";
    }
  }

  function handleMouseLeave() {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
  }

  return (
    <div
      className="relative h-full w-full"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-10 hidden max-w-48 truncate rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
      />
      <ForceGraph2D<GraphNode, GraphLink>
        ref={fgRef}
        width={width}
        height={height}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={120}
        enableNodeDrag={false}
        nodeLabel={() => ""}
        linkColor={() => colors.link}
        linkWidth={1}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={() => colors.link}
        nodeCanvasObject={(node, ctx, scale) => {
          if (node.x === undefined || node.y === undefined) return;
          const r = radius(node);
          const isActive = node.id === activeId;

          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = isActive ? colors.active : colors.node;
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
