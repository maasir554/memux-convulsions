"use client";

import { useEffect, useMemo, useState } from "react";
import { Replace, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseCsv, serializeCsv } from "@/lib/csv";
import type { Note } from "@/lib/mock-notes";

type OverlayMode = "closed" | "find" | "replace";

type CsvViewerProps = {
  item: Note;
  onChange?: (content: string) => void;
};

export function CsvViewer({ item, onChange }: CsvViewerProps) {
  const rows = useMemo(() => parseCsv(item.content), [item.content]);
  const [mode, setMode] = useState<OverlayMode>("closed");
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setMode("find");
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setMode("replace");
      } else if (e.key === "Escape") {
        setMode("closed");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matchCount = useMemo(() => {
    if (!findQuery) return 0;
    const needle = findQuery.toLowerCase();
    let count = 0;
    for (const row of rows) {
      for (const cell of row) {
        if (cell.toLowerCase().includes(needle)) count++;
      }
    }
    return count;
  }, [rows, findQuery]);

  const isMatch = (value: string) =>
    findQuery.length > 0 &&
    value.toLowerCase().includes(findQuery.toLowerCase());

  function replaceAll() {
    if (!findQuery || !onChange) return;
    const next = rows.map((row) =>
      row.map((cell) => cell.split(findQuery).join(replaceQuery)),
    );
    onChange(serializeCsv(next));
  }

  const [header, ...body] = rows;

  return (
    <div className="relative flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b px-6 py-2">
        <Button
          variant={mode === "find" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setMode("find")}
        >
          <Search className="mr-1.5 size-3.5" />
          Find
          <kbd className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">⌘F</kbd>
        </Button>
        <Button
          variant={mode === "replace" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setMode("replace")}
        >
          <Replace className="mr-1.5 size-3.5" />
          Replace
          <kbd className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">⌘H</kbd>
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "row" : "rows"} · read-only
        </span>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Empty file.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {header?.map((cell, c) => (
                  <th
                    key={c}
                    className={cn(
                      "sticky top-0 border-b bg-sidebar px-3 py-2 text-left font-semibold",
                      isMatch(cell) && "bg-yellow-500/30 text-foreground",
                    )}
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r} className="hover:bg-accent/40">
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={cn(
                        "border-b px-3 py-1.5 text-muted-foreground",
                        isMatch(cell) && "bg-yellow-500/30 text-foreground",
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Overlay */}
      {mode !== "closed" && (
        <div className="absolute top-14 right-6 z-20 flex w-72 flex-col gap-2 rounded-md border bg-popover p-3 text-popover-foreground shadow-md">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {mode === "find" ? "Find" : "Find & Replace"}
            <span className="ml-auto font-normal">
              {matchCount} {matchCount === 1 ? "match" : "matches"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setMode("closed")}
              aria-label="Close"
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <Input
            autoFocus
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            placeholder="Find…"
          />
          {mode === "replace" && (
            <>
              <Input
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                placeholder="Replace with…"
              />
              <Button
                size="sm"
                onClick={replaceAll}
                disabled={!onChange || !findQuery}
              >
                Replace all
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
