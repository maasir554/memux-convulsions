"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { ItemIcon } from "@/components/galexy/item-icon";
import type { Note } from "@/lib/mock-notes";

type TabStripProps = {
  tabs: Note[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
};

export function TabStrip({ tabs, activeId, onActivate, onClose }: TabStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  // Track overflow on either side to drive the fade + arrows. Re-runs when the
  // tab set changes; the ResizeObserver fires once on observe for the initial
  // read (so no setState in the effect body).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setCanLeft(el.scrollLeft > 1);
      setCanRight(
        Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth - 1,
      );
    };
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [tabs.length]);

  // Keep the active tab in view when it changes.
  useEffect(() => {
    if (!activeId) return;
    const el = scrollRef.current?.querySelector(`[data-tab-id="${activeId}"]`);
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeId]);

  const scrollToStart = () =>
    scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  const scrollToEnd = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  };

  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={scrollRef}
        className="no-scrollbar flex h-full items-stretch overflow-x-auto scroll-smooth"
      >
        {tabs.map((tab) => (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={cn(
                "group flex shrink-0 items-center gap-2 border-r px-3 text-sm",
                tab.id === activeId
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent",
              )}
            >
              <button
                type="button"
                onClick={() => onActivate(tab.id)}
                className="flex items-center gap-2 py-2"
              >
                <ItemIcon type={tab.type} className="size-3.5" />
                <span className="max-w-40 truncate">{tab.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                onClick={() => onClose(tab.id)}
                className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </div>
        ))}
      </div>

      {canLeft && (
        <button
          type="button"
          onClick={scrollToStart}
          aria-label="Scroll tabs to start"
          className="absolute inset-y-0 left-0 z-10 flex w-9 items-center justify-start bg-gradient-to-r from-sidebar via-sidebar/80 to-transparent pl-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
      )}

      {canRight && (
        <button
          type="button"
          onClick={scrollToEnd}
          aria-label="Scroll tabs to end"
          className="absolute inset-y-0 right-0 z-10 flex w-9 items-center justify-end bg-gradient-to-l from-sidebar via-sidebar/80 to-transparent pr-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      )}
    </div>
  );
}
