"use client";

import { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import type { Note } from "@/lib/mock-notes";

type GraphNode = {
  id: string;
  name: string;
  val: number;
  x?: number;
  y?: number;
};

type GraphLink = { source: string; target: string };

type ForceGraphProps = {
  width: number;
  height: number;
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  backgroundColor?: string;
  cooldownTicks?: number;
  linkColor?: () => string;
  linkWidth?: number;
  linkDirectionalArrowLength?: number;
  linkDirectionalArrowRelPos?: number;
  linkDirectionalArrowColor?: () => string;
  onNodeClick?: (node: GraphNode) => void;
  nodeCanvasObject?: (
    node: GraphNode,
    ctx: CanvasRenderingContext2D,
    scale: number,
  ) => void;
  nodePointerAreaPaint?: (
    node: GraphNode,
    color: string,
    ctx: CanvasRenderingContext2D,
  ) => void;
};

// Canvas + d3-force; client-only (touches window/canvas), so never SSR it.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
}) as unknown as ComponentType<ForceGraphProps>;

type GraphColors = { node: string; active: string; link: string; text: string };

const FALLBACK: GraphColors = {
  node: "#7aa2f7",
  active: "#ff6ac1",
  link: "#3b3f51",
  text: "#c8ccd4",
};

function readColors(): GraphColors {
  if (typeof window === "undefined") return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    node: get("--graph-node", FALLBACK.node),
    active: get("--graph-active", FALLBACK.active),
    link: get("--graph-link", FALLBACK.link),
    text: get("--graph-text", FALLBACK.text),
  };
}

type GraphViewProps = {
  notes: Note[];
  edges: GraphLink[];
  activeId: string | null;
  backlinkCount: Record<string, number>;
  onOpen: (id: string) => void;
};

export function GraphView({
  notes,
  edges,
  activeId,
  backlinkCount,
  onOpen,
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

  // The graph is mounted only while visible (overlay over the editor), so the
  // editor can't change notes underneath it — the simulation won't restart mid-view.
  const graphData = useMemo(
    () => ({
      nodes: notes.map((n) => ({
        id: n.id,
        name: n.title,
        val: 1 + (backlinkCount[n.id] ?? 0),
      })),
      links: edges.map((e) => ({ source: e.source, target: e.target })),
    }),
    [notes, edges, backlinkCount],
  );

  const radius = (node: GraphNode) => 3 + Math.sqrt(node.val) * 1.6;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {size.width > 0 && size.height > 0 && (
        <ForceGraph2D
            width={size.width}
            height={size.height}
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
              ctx.arc(node.x, node.y, radius(node) + 3, 0, 2 * Math.PI);
              ctx.fill();
            }}
        />
      )}
    </div>
  );
}
