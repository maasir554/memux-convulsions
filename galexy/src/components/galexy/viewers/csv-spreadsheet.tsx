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

import "@univerjs/presets/lib/styles/preset-sheets-core.css";

import { parseCsv, serializeCsv } from "@/lib/csv";
import type { SheetMeta } from "@/lib/mock-notes";

const CELL_FONT_FAMILY =
  '"Geist", -apple-system, "Helvetica Neue", Arial, sans-serif';

// Auto-fit tuning (px). Conservative defaults so columns feel sized to content
// without ever taking over the viewport.
const COL_MIN_PX = 56;
const COL_MAX_PX = 280;
const COL_CHAR_PX = 7; // approx width of one Geist character at default size
const COL_PADDING_PX = 18;

function isDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/** Width for a column derived from its longest cell's text length. */
function computeAutoFitWidths(rows: string[][]): Record<number, number> {
  const widths: Record<number, number> = {};
  let cols = 0;
  for (const row of rows) if (row.length > cols) cols = row.length;
  for (let c = 0; c < cols; c++) {
    let max = 0;
    for (const row of rows) {
      const len = (row[c] ?? "").length;
      if (len > max) max = len;
    }
    if (max === 0) continue;
    const w = Math.min(
      COL_MAX_PX,
      Math.max(COL_MIN_PX, max * COL_CHAR_PX + COL_PADDING_PX),
    );
    widths[c] = w;
  }
  return widths;
}

function csvToWorkbookSnapshot(
  csv: string,
  meta: SheetMeta | undefined,
): Partial<IWorkbookData> {
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

  // Apply saved widths if we have them, otherwise auto-fit from content.
  const widths = meta?.columnWidths ?? computeAutoFitWidths(rows);
  const columnData: Record<number, { w: number }> = {};
  for (const [key, w] of Object.entries(widths)) columnData[Number(key)] = { w };

  const rowData: Record<number, { h: number }> = {};
  if (meta?.rowHeights) {
    for (const [key, h] of Object.entries(meta.rowHeights)) {
      rowData[Number(key)] = { h };
    }
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
        columnData,
        rowData,
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

function extractMeta(snapshot: IWorkbookData): SheetMeta {
  const sheetId = snapshot.sheetOrder?.[0] ?? Object.keys(snapshot.sheets)[0];
  const sheet = snapshot.sheets[sheetId];
  const meta: SheetMeta = {};

  const colMap = sheet?.columnData as
    | Record<number, { w?: number } | undefined>
    | undefined;
  if (colMap) {
    const widths: Record<number, number> = {};
    for (const [c, data] of Object.entries(colMap)) {
      if (data?.w != null) widths[Number(c)] = data.w;
    }
    if (Object.keys(widths).length > 0) meta.columnWidths = widths;
  }

  const rowMap = sheet?.rowData as
    | Record<number, { h?: number } | undefined>
    | undefined;
  if (rowMap) {
    const heights: Record<number, number> = {};
    for (const [r, data] of Object.entries(rowMap)) {
      if (data?.h != null) heights[Number(r)] = data.h;
    }
    if (Object.keys(heights).length > 0) meta.rowHeights = heights;
  }

  return meta;
}

function metasEqual(a: SheetMeta | undefined, b: SheetMeta): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b);
}

type CsvSpreadsheetProps = {
  content: string;
  meta?: SheetMeta;
  onChange: (content: string) => void;
  onMetaChange?: (meta: SheetMeta) => void;
};

export default function CsvSpreadsheet({
  content,
  meta,
  onChange,
  onMetaChange,
}: CsvSpreadsheetProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  // Keep latest callbacks in refs so the mount-only effect doesn't re-run.
  const onChangeRef = useRef(onChange);
  const onMetaChangeRef = useRef(onMetaChange);
  useEffect(() => {
    onChangeRef.current = onChange;
    onMetaChangeRef.current = onMetaChange;
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
    let lastSavedMeta: SheetMeta | undefined = meta;

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
            customFontFamily: [
              { value: "Geist", label: "Geist", category: "sans-serif" },
            ],
          }),
        ],
      });

      univerAPI.createWorkbook(csvToWorkbookSnapshot(content, meta));

      let editing: { row: number; col: number; value: string } | null = null;

      const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          const wb = univerAPI.getActiveWorkbook();
          if (!wb) return;
          const snap = wb.save();

          if (editing) {
            const sheetId =
              snap.sheetOrder?.[0] ?? Object.keys(snap.sheets)[0];
            const sheet = snap.sheets[sheetId] as
              | { cellData?: Record<number, Record<number, { v?: unknown }>> }
              | undefined;
            if (sheet) {
              if (!sheet.cellData) sheet.cellData = {};
              if (!sheet.cellData[editing.row]) sheet.cellData[editing.row] = {};
              sheet.cellData[editing.row][editing.col] = { v: editing.value };
            }
          }

          onChangeRef.current(workbookToCsv(snap));

          if (onMetaChangeRef.current) {
            const nextMeta = extractMeta(snap);
            if (!metasEqual(lastSavedMeta, nextMeta)) {
              lastSavedMeta = nextMeta;
              onMetaChangeRef.current(nextMeta);
            }
          }
        }, 300);
      };

      const valueChangedDisposer = univerAPI.addEvent(
        univerAPI.Event.SheetValueChanged,
        scheduleSave,
      );
      const editChangingDisposer = univerAPI.addEvent(
        univerAPI.Event.SheetEditChanging,
        (params) => {
          editing = {
            row: params.row,
            col: params.column,
            value: params.value.toPlainText(),
          };
          scheduleSave();
        },
      );
      const editEndedDisposer = univerAPI.addEvent(
        univerAPI.Event.SheetEditEnded,
        () => {
          editing = null;
          scheduleSave();
        },
      );
      // CommandExecuted catches the rest: column resize, row resize, insert /
      // delete rows/cols, paste, etc. The metasEqual check inside scheduleSave
      // prevents a save when nothing actually changed.
      const commandDisposer = univerAPI.addEvent(
        univerAPI.Event.CommandExecuted,
        scheduleSave,
      );

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

      const onKey = (e: KeyboardEvent) => {
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        const key = e.key.toLowerCase();
        const isUndo = key === "z" && !e.shiftKey;
        const isRedo = (key === "z" && e.shiftKey) || key === "y";
        if (!isUndo && !isRedo) return;
        if (inner.contains(document.activeElement)) return;
        e.preventDefault();
        if (isRedo) void univerAPI.redo();
        else void univerAPI.undo();
      };
      window.addEventListener("keydown", onKey);

      cleanupHandlers = [
        () => window.removeEventListener("keydown", onKey),
        () => themeObserver.disconnect(),
        () => valueChangedDisposer.dispose(),
        () => editChangingDisposer.dispose(),
        () => editEndedDisposer.dispose(),
        () => commandDisposer.dispose(),
        () => univer.dispose(),
      ];
    });

    return () => {
      cancelled = true;
      if (saveTimer) clearTimeout(saveTimer);
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
