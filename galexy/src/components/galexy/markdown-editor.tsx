"use client";

import { useMemo } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Render markdown tokens inline (bold is bold, italic italic, headings larger,
// syntax markers dimmed) — Obsidian's source-mode feel.
const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.6em", fontWeight: "700", lineHeight: "1.4" },
  { tag: t.heading2, fontSize: "1.35em", fontWeight: "700", lineHeight: "1.4" },
  { tag: t.heading3, fontSize: "1.2em", fontWeight: "600" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600" },
  { tag: t.strong, fontWeight: "700", color: "var(--foreground)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--primary)" },
  { tag: t.url, color: "var(--muted-foreground)" },
  {
    tag: t.monospace,
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
    color: "var(--foreground)",
  },
  { tag: t.quote, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: t.list, color: "var(--foreground)" },
  { tag: t.contentSeparator, color: "var(--muted-foreground)" },
  // Syntax markers (**, *, #, -, >, backticks, [[ ]]) rendered dim.
  {
    tag: [t.processingInstruction, t.meta, t.labelName],
    color: "var(--muted-foreground)",
    opacity: "0.6",
  },
]);

const editorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "var(--foreground)",
      fontSize: "0.95rem",
      height: "100%",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      lineHeight: "1.7",
      overflow: "auto",
    },
    ".cm-content": { padding: "0", caretColor: "var(--foreground)" },
    ".cm-line": { padding: "0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "color-mix(in oklab, var(--primary) 28%, transparent)",
      },
    ".cm-gutters": { display: "none" },
  },
  { dark: true },
);

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

export function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(markdownHighlight),
      editorTheme,
      EditorView.lineWrapping,
    ],
    [],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="none"
      height="100%"
      className="h-full text-sm"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        highlightSelectionMatches: false,
        searchKeymap: false,
      }}
    />
  );
}
