"use client";

/**
 * Concept pill cloud rendered for `![Alt](vault-concepts:term1,term2,…)`
 * references in chat responses. Each pill is a clickable concept; sizes
 * are proportional to their position in the list (the model is told to
 * put the most relevant first).
 *
 * Clicking a pill fires a `memux:compose-append` window event with the
 * concept text. ChatView listens for that and appends it to the
 * composer draft — so the user can ask a follow-up about that concept
 * in one click.
 */

import { useMemo } from "react";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

const MAX_CONCEPTS = 18;

export function VaultConceptCloud({
  concepts,
  alt,
}: {
  concepts: string;
  alt: string;
}) {
  const list = useMemo(
    () =>
      concepts
        .split(",")
        .map((s) => decodeURIComponent(s.trim()))
        .filter((s) => s.length > 0)
        .slice(0, MAX_CONCEPTS),
    [concepts],
  );

  if (list.length === 0) return null;

  return (
    <div className="ws-widget-frame my-4 w-full max-w-2xl overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-card/60 via-card/30 to-muted/20">
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Concepts
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          · click to add to the next question
        </span>
        {alt && (
          <span className="ml-auto truncate text-[11px] italic text-foreground/80">
            {alt}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 px-3 py-3">
        {list.map((c, i) => {
          // Pills earlier in the list are bigger + more saturated.
          // Quantise to four tiers so the cloud reads as visually
          // structured rather than chaotic.
          const tier = Math.min(3, Math.floor((i / list.length) * 4));
          const size = ["text-[14px]", "text-[13px]", "text-[12px]", "text-[11px]"][tier];
          const sat = [
            "border-primary/50 bg-primary/12 text-primary",
            "border-primary/35 bg-primary/8 text-primary/90",
            "border-border bg-muted/40 text-foreground/85",
            "border-border/60 bg-muted/20 text-muted-foreground",
          ][tier];
          return (
            <button
              key={`${c}-${i}`}
              type="button"
              onClick={() => emitComposeAppend(c)}
              className={cn(
                "ws-card-enter rounded-full border px-2.5 py-1 font-medium transition-all duration-150",
                "hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-sm",
                size,
                sat,
              )}
              style={{ animationDelay: `${40 + i * 50}ms` }}
            >
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function emitComposeAppend(text: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("memux:compose-append", { detail: { text } }),
  );
}
