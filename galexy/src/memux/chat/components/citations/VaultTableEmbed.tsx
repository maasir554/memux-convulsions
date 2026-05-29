"use client";

/**
 * Compact comparison table rendered for
 *   ![label](vault-table:col1|col2|col3||row1c1|row1c2|row1c3||row2c1|row2c2|row2c3)
 *
 * `||` separates rows. `|` separates cells. First row = headers.
 *
 * Renders as a polished side-by-side comparison: header row tinted, body
 * rows alternating muted stripes, numeric cells right-aligned + tabular
 * numerals, primary-tinted accent border on the leftmost data column so
 * the table "leads" the reader's eye.
 */

import { useMemo } from "react";
import { Table } from "lucide-react";

import { cn } from "@/lib/utils";

export function VaultTableEmbed({ spec, alt }: { spec: string; alt: string }) {
  const { headers, rows } = useMemo(() => parseSpec(spec), [spec]);

  if (headers.length === 0 || rows.length === 0) {
    return (
      <div className="my-4 w-full max-w-2xl rounded-xl border border-dashed border-border/40 bg-muted/10 px-3 py-3 text-[11px] italic text-muted-foreground">
        Table: no data parsed
      </div>
    );
  }

  // Per-column numeric detection so we right-align value columns.
  const colIsNumeric = headers.map((_, ci) =>
    rows.every((r) => {
      const v = r[ci];
      if (v === undefined || v.trim() === "") return true; // empty doesn't disqualify
      return Number.isFinite(Number(v.replace(/[,\s%$]/g, "")));
    }),
  );

  return (
    <div className="my-4 w-full max-w-2xl overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-card/60 via-card/30 to-muted/20">
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <Table className="size-3.5 text-primary" aria-hidden />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Comparison
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          · {rows.length} row{rows.length === 1 ? "" : "s"} × {headers.length} col
          {headers.length === 1 ? "" : "s"}
        </span>
        {alt && (
          <span className="ml-auto truncate text-[11px] italic text-foreground/80">
            {alt}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-muted/30">
              {headers.map((h, i) => (
                <th
                  key={i}
                  className={cn(
                    "border-b border-border/40 px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground",
                    colIsNumeric[i] && "text-right",
                    i === 0 && "border-l-2 border-l-primary/40",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className={cn(
                  "ws-card-enter transition-colors",
                  ri % 2 === 1 && "bg-muted/10",
                  "hover:bg-muted/25",
                )}
                style={{ animationDelay: `${60 + ri * 40}ms` }}
              >
                {headers.map((_, ci) => {
                  const cell = row[ci] ?? "";
                  return (
                    <td
                      key={ci}
                      className={cn(
                        "border-b border-border/20 px-3 py-2 align-top text-foreground/90",
                        colIsNumeric[ci] &&
                          "text-right font-mono tabular-nums",
                        ci === 0 && "border-l-2 border-l-primary/30 font-medium",
                      )}
                    >
                      {cell || (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- parse */

function parseSpec(spec: string): { headers: string[]; rows: string[][] } {
  // Split on `||` for rows, then `|` for cells.
  const rowChunks = spec
    .split("||")
    .map((s) => s.trim())
    .filter(Boolean);
  if (rowChunks.length === 0) return { headers: [], rows: [] };

  const parseRow = (chunk: string) =>
    chunk.split("|").map((c) => decodeURIComponent(c.trim()));

  const headers = parseRow(rowChunks[0]);
  const rows = rowChunks.slice(1).map(parseRow);
  return { headers, rows };
}
