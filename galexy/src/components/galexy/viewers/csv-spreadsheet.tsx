"use client";

import { useEffect, useRef } from "react";
import {
  createUniver,
  defaultTheme,
  LocaleType,
  type FUniver,
  type IWorkbookData,
  type Univer,
} from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";

import { parseCsv, serializeCsv } from "@/lib/csv";

const CELL_FONT_FAMILY =
  '"Geist", -apple-system, "Helvetica Neue", Arial, sans-serif';

function isDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function csvToWorkbookSnapshot(csv: string): Partial<IWorkbookData> {
  const rows = parseCsv(csv);
  const cellData: Record<number, Record<number, { v: string }>> = {};
  for (let r = 0; r < rows.length; r++) {
    const cols: Record<number, { v: string }> = {};
    for (let c = 0; c < rows[r].length; c++) {
      const value = rows[r][c];
      if (value !== "") cols[c] = { v: value };
    }
    if (Object.keys(cols).length > 0) cellData[r] = cols;
  }
  const rowCount = Math.max(rows.length + 20, 50);
  const columnCount = Math.max((rows[0]?.length ?? 0) + 5, 10);
  return {
    id: "galexy-csv",
    name: "Sheet",
    appVersion: "0.24.0",
    locale: LocaleType.EN_US,
    styles: {},
    defaultStyle: { ff: CELL_FONT_FAMILY },
    sheetOrder: ["s1"],
    sheets: {
      s1: {
        id: "s1",
        name: "Sheet1",
        cellData,
        rowCount,
        columnCount,
      },
    },
  };
}

function workbookToCsv(snapshot: IWorkbookData): string {
  const sheetId = snapshot.sheetOrder?.[0] ?? Object.keys(snapshot.sheets)[0];
  const sheet = snapshot.sheets[sheetId];
  const cellData = sheet?.cellData as
    | Record<number, Record<number, { v?: string | number | boolean }>>
    | undefined;
  if (!cellData) return "";

  let maxR = -1;
  let maxC = -1;
  for (const rKey of Object.keys(cellData)) {
    const r = Number(rKey);
    if (r > maxR) maxR = r;
    for (const cKey of Object.keys(cellData[r] ?? {})) {
      const c = Number(cKey);
      if (c > maxC) maxC = c;
    }
  }
  if (maxR < 0) return "";

  const rows: string[][] = [];
  for (let r = 0; r <= maxR; r++) {
    const row: string[] = [];
    const cols = cellData[r];
    for (let c = 0; c <= maxC; c++) {
      const v = cols?.[c]?.v;
      row.push(v == null ? "" : String(v));
    }
    rows.push(row);
  }
  // Trim trailing empty rows.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  return rows.length === 0 ? "" : serializeCsv(rows);
}

type CsvSpreadsheetProps = {
  content: string;
  onChange: (content: string) => void;
};

export default function CsvSpreadsheet({
  content,
  onChange,
}: CsvSpreadsheetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ univer: Univer; api: FUniver } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest onChange in a ref so the create-effect doesn't have to
  // re-run when the parent passes a new callback identity.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: UniverPresetSheetsCoreEnUS },
      theme: defaultTheme,
      darkMode: isDarkMode(),
      presets: [
        UniverSheetsCorePreset({
          container,
          customFontFamily: [
            { value: "Geist", label: "Geist", category: "sans-serif" },
          ],
        }),
      ],
    });

    apiRef.current = { univer, api: univerAPI };

    univerAPI.createWorkbook(csvToWorkbookSnapshot(content));

    const disposer = univerAPI.addEvent(
      univerAPI.Event.SheetValueChanged,
      () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          const wb = univerAPI.getActiveWorkbook();
          if (!wb) return;
          onChangeRef.current(workbookToCsv(wb.save()));
        }, 300);
      },
    );

    // Sync dark/light when the app theme changes.
    const themeObserver = new MutationObserver(() => {
      univerAPI.toggleDarkMode(isDarkMode());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      themeObserver.disconnect();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      disposer.dispose();
      univer.dispose();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only; the workbook owns its own state thereafter

  return <div ref={containerRef} className="galexy-spreadsheet" />;
}
