"use client";

import { useMemo, useRef } from "react";
import { Workbook } from "@fortune-sheet/react";
import type { Cell, CellWithRowAndCol, Sheet } from "@fortune-sheet/core";
import "@fortune-sheet/react/dist/index.css";

import { parseCsv, serializeCsv } from "@/lib/csv";

// fortune-sheet inherits luckysheet's CJK font defaults which can render as
// serif on macOS. Stamp a sans-serif on every populated cell so the cell
// renderer uses it.
const SANS = "Arial, Helvetica, sans-serif";

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
          ff: SANS,
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
        const display = cell.m ?? cell.v ?? "";
        out.push(String(display));
      }
    }
    rows.push(out);
  }
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  if (rows.length === 0) return "";
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
    <div className="galexy-spreadsheet h-full w-full overflow-hidden bg-background">
      <Workbook
        data={initialData}
        onChange={handleChange}
        showSheetTabs={false}
      />
    </div>
  );
}
