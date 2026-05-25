"use client";

import { useEffect, useState } from "react";

import { ViewerFallback } from "@/components/galexy/viewers/viewer-fallback";
import type { Note } from "@/lib/mock-notes";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

export function CsvViewer({ item }: { item: Note }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item.src) return;
    let active = true;
    fetch(item.src)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (active) setRows(parseCsv(text));
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      active = false;
    };
  }, [item.src]);

  if (!item.src) return <ViewerFallback label="No CSV source set for this file." />;
  if (error) return <ViewerFallback label={`Couldn't load CSV — ${error}.`} />;
  if (!rows) return <ViewerFallback label="Loading CSV…" />;

  const [header, ...body] = rows;

  return (
    <div className="h-full overflow-auto p-6">
      <table className="w-full border-collapse text-sm">
        {header && (
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th
                  key={i}
                  className="sticky top-0 border-b bg-sidebar px-3 py-2 text-left font-semibold"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((cells, r) => (
            <tr key={r} className="hover:bg-accent/50">
              {cells.map((cell, c) => (
                <td key={c} className="border-b px-3 py-1.5 text-muted-foreground">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
