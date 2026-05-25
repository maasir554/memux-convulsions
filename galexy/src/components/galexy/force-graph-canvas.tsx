"use client";

import ForceGraph2D from "react-force-graph-2d";

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

// Small visible circle...
const radius = (node: GraphNode) => 1.5 + Math.sqrt(node.val) * 0.8;
// ...but a comfortable invisible click target (not wide enough to occlude
// neighbouring nodes' hit areas).
const hitRadius = (node: GraphNode) => Math.max(radius(node) + 5, 8);

export default function ForceGraphCanvas({
  width,
  height,
  graphData,
  colors,
  activeId,
  onOpen,
}: ForceGraphCanvasProps) {
  return (
    <ForceGraph2D<GraphNode, GraphLink>
      width={width}
      height={height}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      cooldownTicks={120}
      linkColor={() => colors.link}
      linkWidth={1}
      linkDirectionalArrowLength={3}
      linkDirectionalArrowRelPos={1}
      linkDirectionalArrowColor={() => colors.link}
      onNodeClick={(node) => onOpen(node.id)}
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
      nodePointerAreaPaint={(node, color, ctx) => {
        if (node.x === undefined || node.y === undefined) return;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, hitRadius(node), 0, 2 * Math.PI);
        ctx.fill();
      }}
    />
  );
}
