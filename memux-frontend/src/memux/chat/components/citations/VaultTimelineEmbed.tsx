"use client";

/**
 * Horizontal chronology widget rendered for
 *   ![label](vault-timeline:Event A@2024-01-15,Event B@2024-02-03,…)
 *
 * Each entry: `<label>@<ISO date>`, optionally `<label>@<ISO date>#<itemId>`
 * — the optional `#<itemId>` makes the dot a link to the vault item.
 *
 * Layout philosophy:
 *  - Endpoints are inset 6% from each edge so first/last dots can't bleed
 *    past the card chrome.
 *  - Events live inside an inner content area with explicit padding rather
 *    than scratching against the frame border.
 *  - Dates above the dot, label below — both centred on the dot.
 *  - Labels alternate two row offsets so back-to-back events at close
 *    dates don't sit on top of each other.
 *
 * Animation:
 *  - A primary-coloured progress bar grows over 5s underneath the static
 *    track. Driven by ws-timeline-progress (see globals.css).
 *  - Each dot has animation-delay = positionPct * 5s so it pops in
 *    exactly when the progress front reaches it.
 *  - Date + label fade up shortly after their dot lands.
 *
 * The duration is exposed as a CSS custom property (--ws-timeline-duration)
 * so it can be tuned without touching this file.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Calendar } from "lucide-react";

import { cn } from "@/lib/utils";
import { safeDecodeURIComponent } from "@/memux/chat/lib/uri";

type TimelineEvent = {
  label: string;
  date: Date;
  itemId: string | null;
};

const DURATION_MS = 5000;
// Endpoints render at these percentages of the track width rather than 0/100,
// so the dots + their labels stay clear of the card border.
const INSET_START = 0.06;
const INSET_END = 0.94;

export function VaultTimelineEmbed({
  spec,
  alt,
}: {
  spec: string;
  alt: string;
}) {
  const events = useMemo(() => parseSpec(spec), [spec]);

  if (events.length === 0) {
    return (
      <div className="my-4 w-full max-w-2xl rounded-xl border border-dashed border-border/40 bg-muted/10 px-3 py-3 text-[11px] italic text-muted-foreground">
        Timeline: no events parsed
      </div>
    );
  }

  const minTs = events[0].date.getTime();
  const maxTs = events[events.length - 1].date.getTime();
  const span = Math.max(1, maxTs - minTs);

  return (
    <div className="ws-widget-frame my-4 w-full max-w-2xl overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-card/60 via-card/30 to-muted/20">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
        <Calendar className="size-3.5 text-primary" aria-hidden />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Timeline
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          · {events.length} event{events.length === 1 ? "" : "s"}
          {minTs !== maxTs && (
            <> · {formatDate(events[0].date)} → {formatDate(events[events.length - 1].date)}</>
          )}
        </span>
        {alt && (
          <span className="ml-auto truncate text-[11px] italic text-foreground/80">
            {alt}
          </span>
        )}
      </div>

      <TimelineTrack events={events} minTs={minTs} span={span} />
    </div>
  );
}

function TimelineTrack({
  events,
  minTs,
  span,
}: {
  events: TimelineEvent[];
  minTs: number;
  span: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  // Position helper — turn a timestamp into a percentage along the inset range.
  function pctFor(date: Date): number {
    const t = span === 0 ? 0.5 : (date.getTime() - minTs) / span;
    return INSET_START + t * (INSET_END - INSET_START);
  }

  return (
    <div
      className="relative px-5"
      style={{
        // Tall enough to fit: date row (1.25rem) + track (1px + padding) +
        // two label rows (each ~1.5rem), with generous margins.
        paddingTop: "2.25rem",
        paddingBottom: "3.75rem",
        ["--ws-timeline-duration" as string]: `${DURATION_MS}ms`,
      }}
    >
      {/* Track base (full width, dim). */}
      <div
        className="absolute left-5 right-5 top-1/2 h-px -translate-y-1/2 rounded-full bg-border/50"
        aria-hidden
      />

      {/* Track progress overlay — animates from left to right over 5s. */}
      <div
        className="absolute left-5 right-5 top-1/2 h-px -translate-y-1/2 overflow-hidden rounded-full"
        aria-hidden
      >
        <div
          className="ws-timeline-progress h-full origin-left"
          style={{
            // A soft primary gradient with feathered edges so the leading
            // front feels like a real signal, not a hard bar.
            background:
              "linear-gradient(to right, color-mix(in oklch, var(--primary) 25%, transparent), color-mix(in oklch, var(--primary) 80%, transparent) 35%, color-mix(in oklch, var(--primary) 80%, transparent) 65%, color-mix(in oklch, var(--primary) 25%, transparent))",
            boxShadow:
              "0 0 8px 0 color-mix(in oklch, var(--primary) 45%, transparent)",
          }}
        />
      </div>

      {events.map((e, i) => {
        const pct = pctFor(e.date);
        const delayMs = (pct - INSET_START) / (INSET_END - INSET_START) * DURATION_MS;
        const isHovered = hovered === i;
        // Alternate label row offset so adjacent labels don't overlap when
        // events are bunched in time.
        const labelOffsetTop = i % 2 === 0 ? "1.25rem" : "2.5rem";

        const dot = (
          <span className="relative block">
            {/* Hover halo */}
            <span
              className={cn(
                "absolute -inset-3 rounded-full bg-primary/15 transition-opacity duration-200",
                isHovered ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
            {/* Dot itself — small, two-tone, scales up on hover */}
            <span
              className={cn(
                "ws-timeline-dot relative block size-3 rounded-full border-2 transition-[transform,border-color,background-color] duration-200",
                isHovered
                  ? "scale-110 border-primary bg-primary"
                  : "border-primary/80 bg-card",
              )}
              style={{ animationDelay: `${delayMs}ms` }}
            />
          </span>
        );

        return (
          <div
            key={i}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `calc(${pct * 100}%)` }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            {/* Date above the track */}
            <div
              className="ws-timeline-meta pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tracking-wide text-muted-foreground/80"
              style={{ animationDelay: `${delayMs + 120}ms` }}
            >
              {formatDate(e.date)}
            </div>

            {e.itemId ? (
              <Link
                href={`/vault?open=${encodeURIComponent(e.itemId)}`}
                className="relative block focus:outline-none"
              >
                {dot}
              </Link>
            ) : (
              <div className="relative block">{dot}</div>
            )}

            {/* Label below — alternating row so dense clusters stay readable */}
            <div
              className={cn(
                "ws-timeline-meta absolute left-1/2 -translate-x-1/2 whitespace-normal text-center text-[11px] leading-tight transition-colors duration-200",
                "max-w-[140px]",
                isHovered ? "text-foreground" : "text-muted-foreground/90",
              )}
              style={{
                top: labelOffsetTop,
                animationDelay: `${delayMs + 180}ms`,
              }}
            >
              {e.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------- parse */

function parseSpec(spec: string): TimelineEvent[] {
  const raw = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const events: TimelineEvent[] = [];
  for (const item of raw) {
    // `label@date#itemId` — itemId optional
    const at = item.lastIndexOf("@");
    if (at < 0) continue;
    const left = safeDecodeURIComponent(item.slice(0, at)).trim();
    const rest = item.slice(at + 1);
    const hash = rest.indexOf("#");
    const dateStr = (hash < 0 ? rest : rest.slice(0, hash)).trim();
    const itemId = hash < 0 ? null : safeDecodeURIComponent(rest.slice(hash + 1)).trim() || null;
    const date = new Date(dateStr);
    if (!Number.isFinite(date.getTime()) || !left) continue;
    events.push({ label: left, date, itemId });
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  return events;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
