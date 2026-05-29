"use client";

/**
 * Horizontal chronology widget rendered for
 *   ![label](vault-timeline:Event A@2024-01-15,Event B@2024-02-03,…)
 *
 * Each entry: `<label>@<ISO date>`, optionally `<label>@<ISO date>#<itemId>`
 * — the optional `#<itemId>` makes the dot a link to the vault item.
 *
 * Renders a horizontal track with dots positioned proportionally between
 * the earliest and latest date, label below, date above on hover. Smooth
 * stagger entrance, hover halo, click → open in vault when itemId given.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Calendar } from "lucide-react";

import { cn } from "@/lib/utils";

type TimelineEvent = {
  label: string;
  date: Date;
  itemId: string | null;
};

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
    <div className="my-4 w-full max-w-2xl overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-card/60 via-card/30 to-muted/20">
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
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

  return (
    <div className="relative px-6 pb-10 pt-12">
      {/* Backbone */}
      <div
        className="absolute left-6 right-6 top-1/2 h-px"
        style={{
          background:
            "linear-gradient(to right, transparent, color-mix(in oklch, var(--primary) 35%, transparent), transparent)",
        }}
        aria-hidden
      />

      {events.map((e, i) => {
        const pct = span === 0 ? 50 : ((e.date.getTime() - minTs) / span) * 100;
        const isHovered = hovered === i;
        const dotInner = (
          <>
            <span
              className={cn(
                "absolute -inset-3 rounded-full transition-opacity duration-150",
                isHovered ? "bg-primary/20 opacity-100" : "opacity-0",
              )}
            />
            <span
              className={cn(
                "relative block size-3 rounded-full border-2 transition-all duration-150",
                isHovered
                  ? "border-primary bg-primary"
                  : "border-primary/70 bg-card",
              )}
            />
          </>
        );

        return (
          <div
            key={i}
            className="ws-card-enter absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `calc(${pct}% + 0px)`,
              animationDelay: `${80 + i * 70}ms`,
            }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            {/* Date above */}
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-muted-foreground/80">
              {formatDate(e.date)}
            </div>

            {e.itemId ? (
              <Link
                href={`/vault?open=${encodeURIComponent(e.itemId)}`}
                className="relative block focus:outline-none"
              >
                {dotInner}
              </Link>
            ) : (
              <div className="relative block">{dotInner}</div>
            )}

            {/* Label below — staggered offset so adjacent labels don't collide */}
            <div
              className={cn(
                "absolute left-1/2 mt-3 max-w-[120px] -translate-x-1/2 whitespace-normal text-center text-[11px] leading-tight transition-colors duration-150",
                isHovered ? "text-foreground" : "text-muted-foreground/90",
              )}
              style={{
                top: i % 2 === 0 ? "1rem" : "2.2rem",
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
    const left = decodeURIComponent(item.slice(0, at)).trim();
    const rest = item.slice(at + 1);
    const hash = rest.indexOf("#");
    const dateStr = (hash < 0 ? rest : rest.slice(0, hash)).trim();
    const itemId = hash < 0 ? null : decodeURIComponent(rest.slice(hash + 1)).trim() || null;
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
