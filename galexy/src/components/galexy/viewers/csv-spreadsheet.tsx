"use client";

import { useEffect, useRef } from "react";
import {
  createUniver,
  defaultTheme,
  LocaleType,
  type IWorkbookData,
} from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";

// Univer's preset CSS isn't auto-imported by the JS — load the bundled
// stylesheet ourselves or the UI renders unstyled (toolbar collapses,
// context menus dump as plain text).
import "@univerjs/presets/lib/styles/preset-sheets-core.css";

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
  const hostRef = useRef<HTMLDivElement>(null);

  // Latest onChange via ref so the create-effect stays mount-only.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const inner = document.createElement("div");
    inner.style.cssText =
      "position:relative;height:100%;width:100%;overflow:hidden";
    host.appendChild(inner);

    let cancelled = false;
    let cleanupHandlers: Array<() => void> = [];
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    Promise.resolve().then(() => {
      if (cancelled) {
        if (host.contains(inner)) host.removeChild(inner);
        return;
      }

      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: UniverPresetSheetsCoreEnUS },
        theme: defaultTheme,
        darkMode: isDarkMode(),
        presets: [
          UniverSheetsCorePreset({
            container: inner,
            // Intentionally omit workerURL — without a real worker entry the
            // RPC plugin would spin trying to talk to nothing. Formulas that
            // would have run in a worker won't compute; main-thread features
            // (editing, formatting, drag, copy/paste) are unaffected.
            customFontFamily: [
              { value: "Geist", label: "Geist", category: "sans-serif" },
            ],
          }),
        ],
      });

      univerAPI.createWorkbook(csvToWorkbookSnapshot(content));

      const valueChangedDisposer = univerAPI.addEvent(
        univerAPI.Event.SheetValueChanged,
        () => {
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            const wb = univerAPI.getActiveWorkbook();
            if (!wb) return;
            onChangeRef.current(workbookToCsv(wb.save()));
          }, 300);
        },
      );

      // De-duped theme sync: only react when the app's dark/light *actually*
      // flips. Univer itself manipulates class names on elements (including
      // possibly documentElement); without this guard the observer would
      // call toggleDarkMode → Univer mutates the DOM → observer fires →
      // infinite loop → freeze.
      let lastDark = isDarkMode();
      const themeObserver = new MutationObserver(() => {
        const next = isDarkMode();
        if (next === lastDark) return;
        lastDark = next;
        univerAPI.toggleDarkMode(next);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      cleanupHandlers = [
        () => themeObserver.disconnect(),
        () => valueChangedDisposer.dispose(),
        () => univer.dispose(),
      ];
    });

    return () => {
      cancelled = true;
      if (saveTimer) clearTimeout(saveTimer);
      // Defer to avoid synchronously unmounting Univer's React root inside
      // the parent's commit (React 19 errors otherwise).
      setTimeout(() => {
        for (const handler of cleanupHandlers) {
          try {
            handler();
          } catch {
            // best-effort teardown
          }
        }
        if (host.contains(inner)) host.removeChild(inner);
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="galexy-spreadsheet" />;
}
