"use client";

/**
 * Inline chart widget rendered for
 *   ![label](vault-chart:<type>,label1:value1,label2:value2,…)
 *
 * Supported types: `bar`, `pie`, `donut`, `line`, `area`.
 *
 * Pure SVG, no recharts/visx dep. Tasteful palette (rotates a curated
 * 6-colour gradient set), staggered entrance per slice/bar, optional
 * centre label for pie/donut showing the total.
 *
 * Format examples the model can emit:
 *
 *   ![Time spent by topic](vault-chart:bar,Indexer:42,Chat:71,Vault:33)
 *   ![Concept coverage](vault-chart:pie,Embeddings:120,Retrieval:80,Ranking:55)
 *   ![Daily notes](vault-chart:line,Mon:3,Tue:7,Wed:5,Thu:12,Fri:8)
 *   ![Storage](vault-chart:donut,Captures:340,Indexed:120,Misc:80)
 */

import { useMemo } from "react";
import { BarChart3, ChartPie, LineChart as LineIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { safeDecodeURIComponent } from "@/memux/chat/lib/uri";

type ChartType = "bar" | "pie" | "donut" | "line" | "area";
type Datum = { label: string; value: number };

const PALETTE = [
  ["#c4b5fd", "#7c3aed"], // violet
  ["#7dd3fc", "#0284c7"], // sky
  ["#86efac", "#16a34a"], // emerald
  ["#fcd34d", "#d97706"], // amber
  ["#fda4af", "#e11d48"], // rose
  ["#5eead4", "#0d9488"], // teal
  ["#a5b4fc", "#4f46e5"], // indigo
  ["#fdba74", "#ea580c"], // orange
];

/* ----------------------------------------------------- root */

export function VaultChartEmbed({ spec, alt }: { spec: string; alt: string }) {
  const { type, data, error } = useMemo(() => parseSpec(spec), [spec]);

  if (error || !type || data.length === 0) {
    return (
      <div className="my-4 w-full max-w-2xl rounded-xl border border-dashed border-border/40 bg-muted/10 px-3 py-3 text-[11px] italic text-muted-foreground">
        Chart: {error ?? "no data"}
      </div>
    );
  }

  // Width policy varies by chart type:
  //   - pie / donut: a fixed-size SVG sits next to a legend. Stretching
  //     to max-w-2xl leaves dead horizontal space to the right of the
  //     legend (the SVG never grows past its `size` constant). Use
  //     `w-fit` so the card sizes to its content (capped at max-w-2xl
  //     for the very longest legend labels).
  //   - bar / line / area: the SVG uses `w-full` internally and the
  //     data spread benefits from horizontal room. Stay at
  //     `w-full max-w-2xl`.
  const widthClass =
    type === "pie" || type === "donut" ? "w-fit max-w-2xl" : "w-full max-w-2xl";

  return (
    <div
      className={cn(
        "ws-widget-frame my-4 overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-card/60 via-card/30 to-muted/20",
        widthClass,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <ChartHeaderIcon type={type} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {LABEL_BY_TYPE[type]}
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          · {data.length} item{data.length === 1 ? "" : "s"}
        </span>
        {alt && (
          <span className="ml-auto truncate text-[11px] italic text-foreground/80">
            {alt}
          </span>
        )}
      </div>

      <div className="px-3 py-3">
        {type === "bar" && <BarChart data={data} />}
        {(type === "pie" || type === "donut") && (
          <PieChart data={data} donut={type === "donut"} />
        )}
        {(type === "line" || type === "area") && (
          <LineChart data={data} area={type === "area"} />
        )}
      </div>
    </div>
  );
}

const LABEL_BY_TYPE: Record<ChartType, string> = {
  bar: "Bar chart",
  pie: "Pie chart",
  donut: "Donut chart",
  line: "Line chart",
  area: "Area chart",
};

function ChartHeaderIcon({ type }: { type: ChartType }) {
  const Icon =
    type === "pie" || type === "donut"
      ? ChartPie
      : type === "line" || type === "area"
        ? LineIcon
        : BarChart3;
  return <Icon className="size-3.5 text-primary" aria-hidden />;
}

/* ----------------------------------------------------- parse */

function parseSpec(
  spec: string,
): { type: ChartType | null; data: Datum[]; error: string | null } {
  const parts = spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { type: null, data: [], error: "expected: <type>,label:value,…" };
  }
  const rawType = parts[0].toLowerCase();
  const validTypes: ChartType[] = ["bar", "pie", "donut", "line", "area"];
  if (!(validTypes as string[]).includes(rawType)) {
    return { type: null, data: [], error: `unknown type "${rawType}"` };
  }
  const type = rawType as ChartType;

  const data: Datum[] = [];
  for (const p of parts.slice(1)) {
    const colon = p.lastIndexOf(":");
    if (colon < 0) continue;
    const label = safeDecodeURIComponent(p.slice(0, colon)).trim();
    const valueStr = p.slice(colon + 1).trim();
    const value = Number(valueStr);
    if (!Number.isFinite(value) || !label) continue;
    data.push({ label, value });
  }
  if (data.length === 0) {
    return { type, data, error: "no parseable label:value pairs" };
  }
  return { type, data, error: null };
}

/* ----------------------------------------------------- bar */

function BarChart({ data }: { data: Datum[] }) {
  const width = 540;
  const height = 220;
  const padX = 40;
  const padTop = 16;
  const padBottom = 36;

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const chartW = width - padX * 2;
  const chartH = height - padTop - padBottom;
  const gap = 12;
  const barW = Math.max(
    8,
    (chartW - gap * (data.length - 1)) / Math.max(1, data.length),
  );

  // Y-axis ticks: 0, 25%, 50%, 75%, 100% of max.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => maxValue * t);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" style={{ height }}>
      <defs>
        {data.map((_, i) => {
          const [light, dark] = PALETTE[i % PALETTE.length];
          return (
            <linearGradient
              key={i}
              id={`bar-grad-${i}`}
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor={light} />
              <stop offset="100%" stopColor={dark} />
            </linearGradient>
          );
        })}
      </defs>

      {/* Grid + Y ticks */}
      {ticks.map((t, i) => {
        const y = padTop + chartH - (t / maxValue) * chartH;
        return (
          <g key={i}>
            <line
              x1={padX}
              y1={y}
              x2={width - padX}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
            <text
              x={padX - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[9px]"
            >
              {formatNumber(t)}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const x = padX + i * (barW + gap);
        const h = (d.value / maxValue) * chartH;
        const y = padTop + chartH - h;
        return (
          <g key={i} className="ws-card-enter" style={{ animationDelay: `${60 + i * 60}ms`, transformOrigin: `${x + barW / 2}px ${padTop + chartH}px` }}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={3}
              fill={`url(#bar-grad-${i})`}
            />
            {/* Value label above bar */}
            <text
              x={x + barW / 2}
              y={y - 4}
              textAnchor="middle"
              className="fill-foreground text-[9.5px] font-medium tabular-nums"
            >
              {formatNumber(d.value)}
            </text>
            {/* Category label below */}
            <text
              x={x + barW / 2}
              y={padTop + chartH + 16}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {truncate(d.label, 12)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ----------------------------------------------------- pie / donut */

function PieChart({ data, donut }: { data: Datum[]; donut: boolean }) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r = 90;
  const innerR = donut ? 56 : 0;
  const total = data.reduce((s, d) => s + d.value, 0);

  // Precompute slice arcs so JSX stays pure (no mutable cursor across renders)
  const slices = data.reduce<{ start: number; end: number }[]>((acc, d) => {
    const prev = acc.length === 0 ? -Math.PI / 2 : acc[acc.length - 1].end;
    const sweep = (d.value / total) * Math.PI * 2;
    acc.push({ start: prev, end: prev + sweep });
    return acc;
  }, []);

  return (
    <div className="flex items-center gap-4">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="block shrink-0"
        style={{ width: size, height: size }}
      >
        <defs>
          {data.map((_, i) => {
            const [light, dark] = PALETTE[i % PALETTE.length];
            return (
              <linearGradient
                key={i}
                id={`pie-grad-${i}`}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor={light} />
                <stop offset="100%" stopColor={dark} />
              </linearGradient>
            );
          })}
        </defs>
        {data.map((d, i) => {
          const { start, end } = slices[i];
          return (
            <g
              key={i}
              className="ws-card-enter"
              style={{
                animationDelay: `${80 + i * 70}ms`,
                transformOrigin: `${cx}px ${cy}px`,
              }}
            >
              <path
                d={describeArc(cx, cy, r, innerR, start, end)}
                fill={`url(#pie-grad-${i})`}
                stroke="oklch(var(--background-l, 14%) 0)"
                strokeWidth={1}
                opacity={0.94}
              />
            </g>
          );
        })}
        {donut && (
          <>
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              className="fill-foreground text-[18px] font-semibold tabular-nums"
            >
              {formatNumber(total)}
            </text>
            <text
              x={cx}
              y={cy + 12}
              textAnchor="middle"
              className="fill-muted-foreground text-[9px] uppercase tracking-wider"
            >
              total
            </text>
          </>
        )}
      </svg>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {data.map((d, i) => {
          const [, dark] = PALETTE[i % PALETTE.length];
          const pct = (d.value / total) * 100;
          return (
            <div
              key={i}
              className="ws-card-enter flex items-center gap-2 text-[12px]"
              style={{ animationDelay: `${80 + i * 70}ms` }}
            >
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: dark }}
              />
              <span className="min-w-0 flex-1 truncate text-foreground/85">
                {d.label}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground/90">
                {formatNumber(d.value)}
              </span>
              <span className="shrink-0 w-10 text-right font-mono text-[10px] text-muted-foreground">
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Path describing an annular sector (donut slice) or pie slice. */
function describeArc(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + rOuter * Math.cos(a0);
  const y0 = cy + rOuter * Math.sin(a0);
  const x1 = cx + rOuter * Math.cos(a1);
  const y1 = cy + rOuter * Math.sin(a1);
  if (rInner <= 0) {
    return `M ${cx} ${cy} L ${x0} ${y0} A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1} Z`;
  }
  const ix0 = cx + rInner * Math.cos(a1);
  const iy0 = cy + rInner * Math.sin(a1);
  const ix1 = cx + rInner * Math.cos(a0);
  const iy1 = cy + rInner * Math.sin(a0);
  return `
    M ${x0} ${y0}
    A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}
    L ${ix0} ${iy0}
    A ${rInner} ${rInner} 0 ${large} 0 ${ix1} ${iy1}
    Z
  `;
}

/* ----------------------------------------------------- line / area */

function LineChart({ data, area }: { data: Datum[]; area: boolean }) {
  const width = 540;
  const height = 220;
  const padX = 40;
  const padTop = 16;
  const padBottom = 30;

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const chartW = width - padX * 2;
  const chartH = height - padTop - padBottom;

  const pts = data.map((d, i) => {
    const x = padX + (data.length === 1 ? chartW / 2 : (i * chartW) / (data.length - 1));
    const y = padTop + chartH - (d.value / maxValue) * chartH;
    return { x, y, d };
  });

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${padTop + chartH} L ${pts[0].x} ${padTop + chartH} Z`;

  const ticks = [0, 0.5, 1].map((t) => maxValue * t);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" style={{ height }}>
      <defs>
        <linearGradient id="line-fill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={PALETTE[0][1]} stopOpacity="0.4" />
          <stop offset="100%" stopColor={PALETTE[0][1]} stopOpacity="0" />
        </linearGradient>
      </defs>

      {ticks.map((t, i) => {
        const y = padTop + chartH - (t / maxValue) * chartH;
        return (
          <g key={i}>
            <line
              x1={padX}
              y1={y}
              x2={width - padX}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
            <text
              x={padX - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[9px]"
            >
              {formatNumber(t)}
            </text>
          </g>
        );
      })}

      {area && <path d={areaPath} fill="url(#line-fill)" />}
      <path
        d={linePath}
        fill="none"
        stroke={PALETTE[0][1]}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {pts.map((p, i) => (
        <g
          key={i}
          className="ws-card-enter"
          style={{
            animationDelay: `${100 + i * 60}ms`,
            transformOrigin: `${p.x}px ${p.y}px`,
          }}
        >
          <circle cx={p.x} cy={p.y} r={3.5} fill={PALETTE[0][1]} />
          <circle cx={p.x} cy={p.y} r={1.8} fill="white" />
          <text
            x={p.x}
            y={padTop + chartH + 16}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {truncate(p.d.label, 10)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ----------------------------------------------------- utils */

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(1);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Reserved for future variants (radial, etc.); silences lint of unused class.
void cn;
