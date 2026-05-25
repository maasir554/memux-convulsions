"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import type { GraphEdge, Note } from "@/lib/mock-notes";
import type {
  GraphColors,
  GraphLink,
  GraphNode,
} from "@/components/galexy/force-graph-canvas";

const ForceGraphCanvas = dynamic(
  () => import("@/components/galexy/force-graph-canvas"),
  { ssr: false },
);

const FALLBACK: GraphColors = {
  markdown: "#7aa2f7",
  code: "#5cf08a",
  csv: "#3bc9db",
  pdf: "#ff8787",
  image: "#d0a3ff",
  folder: "#ffd43b",
  active: "#ff6ac1",
  link: "#3b3f51",
  contains: "#ffd43b",
  text: "#c8ccd4",
};

function readColors(): GraphColors {
  if (typeof window === "undefined") return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    markdown: get("--graph-markdown", FALLBACK.markdown),
    code: get("--graph-code", FALLBACK.code),
    csv: get("--graph-csv", FALLBACK.csv),
    pdf: get("--graph-pdf", FALLBACK.pdf),
    image: get("--graph-image", FALLBACK.image),
    folder: get("--graph-folder", FALLBACK.folder),
    active: get("--graph-active", FALLBACK.active),
    link: get("--graph-link", FALLBACK.link),
    contains: get("--graph-contains", FALLBACK.contains),
    text: get("--graph-text", FALLBACK.text),
  };
}

type GraphViewProps = {
  items: Note[];
  edges: GraphEdge[];
  activeId: string | null;
  backlinkCount: Record<string, number>;
  onOpen: (id: string) => void;
};

export function GraphView({
  items,
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

  // Rebuild only when the structure changes (not on content edits).
  const nodeSignature = items
    .map((i) => {
      const val =
        i.type === "folder"
          ? (i.childIds?.length ?? 0)
          : (backlinkCount[i.id] ?? 0);
      return `${i.id}:${i.title}:${i.type}:${val}`;
    })
    .join("|");
  const edgeSignature = edges
    .map((e) => `${e.source}>${e.target}:${e.kind}`)
    .join("|");
  const graphData = useMemo<{ nodes: GraphNode[]; links: GraphLink[] }>(
    () => ({
      nodes: items.map((item) => ({
        id: item.id,
        name: item.title,
        type: item.type,
        val:
          item.type === "folder"
            ? Math.max(1, item.childIds?.length ?? 1)
            : 1 + (backlinkCount[item.id] ?? 0),
      })),
      links: edges.map((e) => ({
        source: e.source,
        target: e.target,
        kind: e.kind,
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeSignature, edgeSignature],
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
