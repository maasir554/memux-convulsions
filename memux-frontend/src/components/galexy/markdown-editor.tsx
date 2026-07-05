"use client";

import { useMemo } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Render markdown tokens inline (bold is bold, italic italic, headings larger,
// syntax markers dimmed) — Obsidian's source-mode feel.
const markdownHighlight = HighlightStyle.define([
  {
    tag: t.heading1,
    color: "var(--cm-heading)",
    fontSize: "1.6em",
    fontWeight: "700",
    lineHeight: "1.4",
  },
  {
    tag: t.heading2,
    color: "var(--cm-heading)",
    fontSize: "1.35em",
    fontWeight: "700",
    lineHeight: "1.4",
  },
  {
    tag: t.heading3,
    color: "var(--cm-heading)",
    fontSize: "1.2em",
    fontWeight: "600",
  },
  {
    tag: [t.heading4, t.heading5, t.heading6],
    color: "var(--cm-heading)",
    fontWeight: "600",
  },
  { tag: t.strong, color: "var(--cm-bold)", fontWeight: "700" },
  { tag: t.emphasis, color: "var(--cm-italic)", fontStyle: "italic" },
  {
    tag: t.strikethrough,
    color: "var(--cm-quote)",
    textDecoration: "line-through",
  },
  { tag: [t.link, t.url, t.labelName], color: "var(--cm-link)" },
  {
    tag: t.monospace,
    color: "var(--cm-code)",
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
  },
  { tag: t.quote, color: "var(--cm-quote)", fontStyle: "italic" },
  { tag: t.list, color: "var(--cm-list)" },
  { tag: t.contentSeparator, color: "var(--cm-hr)" },
  // Syntax markers (**, *, #, -, >, backticks).
  { tag: [t.processingInstruction, t.meta], color: "var(--cm-marker)" },
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
