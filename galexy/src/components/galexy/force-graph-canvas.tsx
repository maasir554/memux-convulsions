"use client";

import { useEffect, useRef } from "react";
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

  // Spread nodes out so labels don't crowd/overlap.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge");
    if (charge) {
      (charge as unknown as { strength: (n: number) => void }).strength(-180);
    }
    const link = fg.d3Force("link");
    if (link) {
      (link as unknown as { distance: (n: number) => void }).distance(50);
    }
    fg.d3ReheatSimulation();
  }, [graphData]);

  // Keep every node within the visible canvas (otherwise off-screen nodes
  // can't be clicked), and re-fit when the panel is resized.
  useEffect(() => {
    fgRef.current?.zoomToFit(300, 24);
  }, [width, height, graphData]);

  return (
    <ForceGraph2D<GraphNode, GraphLink>
      ref={fgRef}
      width={width}
      height={height}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      cooldownTicks={120}
      onEngineStop={() => fgRef.current?.zoomToFit(400, 24)}
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
      nodePointerAreaPaint={(node, color, ctx, scale) => {
        if (node.x === undefined || node.y === undefined) return;
        const r = radius(node);
        const fontSize = Math.max(12 / scale, 3);
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        const textWidth = ctx.measureText(node.name).width;
        // Hit area covers the circle and its label.
        const halfWidth = Math.max(r, textWidth / 2) + 2;
        const top = node.y - r - 2;
        const bottom = node.y + r + 1.5 + fontSize + 2;
        ctx.fillStyle = color;
        ctx.fillRect(node.x - halfWidth, top, halfWidth * 2, bottom - top);
      }}
    />
  );
}
