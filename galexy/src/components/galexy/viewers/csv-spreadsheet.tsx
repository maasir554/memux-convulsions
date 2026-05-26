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

// A no-op worker script for Univer's RPC plugin. Without one, the plugin
// can't construct a Worker and the init can hang or throw. Formulas relying
// on the worker won't evaluate remotely — main-thread features work fine.
function noopWorkerUrl(): string {
  const blob = new Blob(["self.onmessage = () => {};"], {
    type: "application/javascript",
  });
  return URL.createObjectURL(blob);
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

    // Each effect run gets its own inner container. React Strict Mode (dev)
    // double-mounts effects; pairing an inner-div with the instance lets us
    // dispose the old one without touching whatever's already mounted next.
    const inner = document.createElement("div");
    inner.style.cssText =
      "position:relative;height:100%;width:100%;overflow:hidden";
    host.appendChild(inner);

    let cancelled = false;
    let cleanupHandlers: Array<() => void> = [];
    const workerURL = noopWorkerUrl();

    // Defer creation to a microtask so any in-flight React render completes.
    Promise.resolve().then(() => {
      if (cancelled) {
        if (host.contains(inner)) host.removeChild(inner);
        URL.revokeObjectURL(workerURL);
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
            workerURL,
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

      const themeObserver = new MutationObserver(() => {
        univerAPI.toggleDarkMode(isDarkMode());
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

    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    return () => {
      cancelled = true;
      if (saveTimer) clearTimeout(saveTimer);
      // Defer dispose so it doesn't run synchronously inside React's commit
      // (React 19 errors when a foreign root is unmounted mid-render).
      setTimeout(() => {
        for (const handler of cleanupHandlers) {
          try {
            handler();
          } catch {
            // best-effort teardown
          }
        }
        if (host.contains(inner)) host.removeChild(inner);
        URL.revokeObjectURL(workerURL);
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="galexy-spreadsheet" />;
}
