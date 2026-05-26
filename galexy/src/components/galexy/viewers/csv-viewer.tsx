"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Note } from "@/lib/mock-notes";

// --- CSV parse / serialize --------------------------------------------------

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

function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function serializeCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\n") + "\n";
}

// --- Component --------------------------------------------------------------

type CsvViewerProps = {
  item: Note;
  onChange?: (content: string) => void;
};

export function CsvViewer({ item, onChange }: CsvViewerProps) {
  const readOnly = !onChange;

  const [rows, setRows] = useState<string[][]>(() => {
    const parsed = parseCsv(item.content);
    return parsed.length > 0 ? parsed : [[""]];
  });

  function commit(next: string[][]) {
    setRows(next);
    onChange?.(serializeCsv(next));
  }

  function updateCell(r: number, c: number, value: string) {
    if (rows[r]?.[c] === value) return;
    const next = rows.map((row, i) =>
      i === r ? row.map((cell, j) => (j === c ? value : cell)) : row,
    );
    commit(next);
  }

  function addRow() {
    const cols = Math.max(1, rows[0]?.length ?? 1);
    commit([...rows, Array.from({ length: cols }, () => "")]);
  }

  function deleteRow(r: number) {
    if (rows.length <= 1 || r === 0) return; // keep header
    commit(rows.filter((_, i) => i !== r));
  }

  const [header, ...body] = rows;

  return (
    <div className="h-full overflow-auto p-6">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {header?.map((cell, c) => (
              <th
                key={c}
                className="sticky top-0 border-b bg-sidebar text-left"
              >
                <Cell
                  value={cell}
                  readOnly={readOnly}
                  isHeader
                  onCommit={(v) => updateCell(0, c, v)}
                />
              </th>
            ))}
            {!readOnly && <th className="w-9 border-b bg-sidebar" />}
          </tr>
        </thead>
        <tbody>
          {body.map((row, i) => {
            const r = i + 1;
            return (
              <tr key={r} className="group">
                {row.map((cell, c) => (
                  <td key={c} className="border-b">
                    <Cell
                      value={cell}
                      readOnly={readOnly}
                      onCommit={(v) => updateCell(r, c, v)}
                    />
                  </td>
                ))}
                {!readOnly && (
                  <td className="w-9 border-b text-center align-middle">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                      onClick={() => deleteRow(r)}
                      aria-label={`Delete row ${r}`}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {!readOnly && (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-1 size-3.5" />
            Add row
          </Button>
        </div>
      )}
    </div>
  );
}

function Cell({
  value,
  readOnly,
  isHeader,
  onCommit,
}: {
  value: string;
  readOnly: boolean;
  isHeader?: boolean;
  onCommit: (value: string) => void;
}) {
  // Uncontrolled input; key remounts when external value changes so the
  // defaultValue stays in sync without setState-in-effect.
  return (
    <input
      key={value}
      defaultValue={value}
      readOnly={readOnly}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={cn(
        "w-full bg-transparent px-3 py-1.5 outline-none focus:bg-accent",
        isHeader ? "font-semibold" : "text-muted-foreground focus:text-foreground",
        readOnly && "cursor-default",
      )}
    />
  );
}
