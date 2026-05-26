"use client";

import { useMemo, useRef } from "react";
import { Workbook } from "@fortune-sheet/react";
import type { Cell, CellWithRowAndCol, Sheet } from "@fortune-sheet/core";
import "@fortune-sheet/react/dist/index.css";

import { parseCsv, serializeCsv } from "@/lib/csv";

function csvToWorkbook(csv: string): Sheet[] {
  const rows = parseCsv(csv);
  const celldata: CellWithRowAndCol[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const value = rows[r][c];
      if (value !== "") {
        const cell: Cell = {
          v: value,
          m: value,
          ct: { fa: "General", t: "g" },
        };
        celldata.push({ r, c, v: cell });
      }
    }
  }
  return [{ name: "Sheet1", celldata }];
}

function workbookToCsv(sheets: Sheet[]): string {
  const sheet = sheets[0];
  if (!sheet?.data) return "";
  const rows: string[][] = [];
  for (const row of sheet.data) {
    const out: string[] = [];
    for (const cell of row ?? []) {
      if (!cell) {
        out.push("");
      } else {
        // `m` holds the displayed/formatted value (after formula eval);
        // fall back to raw `v`.
        const display = cell.m ?? cell.v ?? "";
        out.push(String(display));
      }
    }
    rows.push(out);
  }
  // Trim trailing all-empty rows.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  if (rows.length === 0) return "";
  // Trim trailing all-empty columns.
  let lastCol = 0;
  for (const r of rows) {
    for (let c = r.length - 1; c >= 0; c--) {
      if (r[c] !== "") {
        if (c > lastCol) lastCol = c;
        break;
      }
    }
  }
  return serializeCsv(rows.map((r) => r.slice(0, lastCol + 1)));
}

type CsvSpreadsheetProps = {
  content: string;
  onChange: (content: string) => void;
};

export default function CsvSpreadsheet({
  content,
  onChange,
}: CsvSpreadsheetProps) {
  // Compute initial data once — re-initing would lose selection/scroll. The
  // component is keyed by item.id at the call site, so opening a different
  // CSV remounts cleanly.
  const initialData = useMemo(
    () => csvToWorkbook(content),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(data: Sheet[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onChange(workbookToCsv(data));
    }, 300);
  }

  return (
    <div className="h-full w-full overflow-hidden bg-white text-foreground">
      <Workbook data={initialData} onChange={handleChange} />
    </div>
  );
}
