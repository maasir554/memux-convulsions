"use client";

/**
 * Section-outline tree rendered for
 *   ![label](vault-outline:1-Intro,2-Background,~2-Approach,~3-RRF,2-Results)
 *
 * Format: comma-separated `<level>-<text>` entries. Prefix an entry with
 * `~` to mark it as "I read this" — those rows are tinted primary +
 * given a filled bullet, signalling exactly which slices of the doc the
 * agent consulted.
 *
 * Visually: hierarchical indent by level, bullets vary by depth
 * (●/○/·), highlighted rows get a left accent bar. Optional alt text
 * shown above as the doc title.
 */

import { useMemo } from "react";
import { ListTree } from "lucide-react";

import { cn } from "@/lib/utils";
import { safeDecodeURIComponent } from "@/memux/chat/lib/uri";

type Entry = {
  level: number;
  text: string;
  highlighted: boolean;
};

export function VaultOutlineEmbed({
  spec,
  alt,
}: {
  spec: string;
  alt: string;
}) {
  const entries = useMemo(() => parseSpec(spec), [spec]);

  if (entries.length === 0) {
    return (
      <div className="my-4 w-full max-w-2xl rounded-xl border border-dashed border-border/40 bg-muted/10 px-3 py-3 text-[11px] italic text-muted-foreground">
        Outline: no entries parsed
      </div>
    );
  }

  const highlightedCount = entries.filter((e) => e.highlighted).length;

  return (
    <div className="ws-widget-frame my-4 w-full max-w-2xl overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-card/60 via-card/30 to-muted/20">
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <ListTree className="size-3.5 text-primary" aria-hidden />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Outline
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          · {entries.length} section{entries.length === 1 ? "" : "s"}
          {highlightedCount > 0 && (
            <> · {highlightedCount} read</>
          )}
        </span>
        {alt && (
          <span className="ml-auto truncate text-[11px] italic text-foreground/80">
            {alt}
          </span>
        )}
      </div>

      <ul className="flex flex-col py-2">
        {entries.map((e, i) => (
          <li
            key={i}
            className={cn(
              "ws-card-enter relative flex items-baseline gap-2 px-3 py-1 text-[12.5px]",
              e.highlighted && "text-foreground",
              !e.highlighted && "text-foreground/65",
            )}
            style={{
              animationDelay: `${50 + i * 35}ms`,
              paddingLeft: `${0.75 + (e.level - 1) * 1.1}rem`,
            }}
          >
            {/* Accent bar for highlighted rows */}
            {e.highlighted && (
              <span
                className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-sm bg-primary"
                aria-hidden
              />
            )}
            <span
              className={cn(
                "inline-flex shrink-0 items-center justify-center",
                e.level === 1 && "text-[14px]",
                e.level === 2 && "text-[12px]",
                e.level >= 3 && "text-[10px]",
                e.highlighted ? "text-primary" : "text-muted-foreground/60",
              )}
              aria-hidden
            >
              {bulletForLevel(e.level, e.highlighted)}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1",
                e.level === 1 && "font-semibold",
                e.level === 2 && "font-medium",
              )}
            >
              {e.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function bulletForLevel(level: number, highlighted: boolean): string {
  if (highlighted) return "●";
  if (level === 1) return "◆";
  if (level === 2) return "○";
  return "·";
}

/* ----------------------------------------------------- parse */

function parseSpec(spec: string): Entry[] {
  const raw = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const out: Entry[] = [];
  for (const item of raw) {
    let highlighted = false;
    let s = item;
    if (s.startsWith("~")) {
      highlighted = true;
      s = s.slice(1);
    }
    const dash = s.indexOf("-");
    if (dash < 0) continue;
    const levelStr = s.slice(0, dash).trim();
    const text = safeDecodeURIComponent(s.slice(dash + 1).trim());
    const level = Math.max(1, Math.min(6, parseInt(levelStr, 10) || 1));
    if (!text) continue;
    out.push({ level, text, highlighted });
  }
  return out;
}
