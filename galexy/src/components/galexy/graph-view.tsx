"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import type { Note } from "@/lib/mock-notes";
import type {
  GraphColors,
  GraphLink,
  GraphNode,
} from "@/components/galexy/force-graph-canvas";

// Canvas + d3-force; client-only (touches window/canvas), so never SSR it.
const ForceGraphCanvas = dynamic(
  () => import("@/components/galexy/force-graph-canvas"),
  { ssr: false },
);

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

  const graphData = useMemo(
    () => ({
      nodes: notes.map(
        (n): GraphNode => ({
          id: n.id,
          name: n.title,
          val: 1 + (backlinkCount[n.id] ?? 0),
        }),
      ),
      links: edges.map((e): GraphLink => ({ source: e.source, target: e.target })),
    }),
    [notes, edges, backlinkCount],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {size.width > 0 && size.height > 0 && (
        <ForceGraphCanvas
          width={size.width}
          height={size.height}
          graphData={graphData}
          colors={colors}
          activeId={activeId}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}
