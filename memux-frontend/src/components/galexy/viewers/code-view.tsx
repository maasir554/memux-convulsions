"use client";

import { useMemo } from "react";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const codeHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--cm-italic)" },
  { tag: [t.string, t.special(t.string)], color: "var(--cm-code)" },
  { tag: t.comment, color: "var(--cm-quote)", fontStyle: "italic" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "var(--cm-link)",
  },
  { tag: [t.number, t.bool, t.null], color: "var(--cm-bold)" },
  { tag: [t.typeName, t.className], color: "var(--cm-heading)" },
  { tag: t.propertyName, color: "var(--cm-link)" },
  { tag: [t.operator, t.punctuation], color: "var(--cm-marker)" },
]);

const codeTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "var(--foreground)", height: "100%" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      lineHeight: "1.7",
      overflow: "auto",
    },
    ".cm-content": { caretColor: "var(--foreground)" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--muted-foreground)",
      border: "none",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "color-mix(in oklab, var(--primary) 28%, transparent)" },
  },
  { dark: true },
);

function languageExtension(language?: string): Extension[] {
  switch (language) {
    case "javascript":
    case "js":
    case "jsx":
      return [javascript({ jsx: true })];
    case "typescript":
    case "ts":
    case "tsx":
      return [javascript({ jsx: true, typescript: true })];
    default:
      return [];
  }
}

type CodeViewProps = {
  value: string;
  language?: string;
  onChange: (value: string) => void;
};

export function CodeView({ value, language, onChange }: CodeViewProps) {
  const extensions = useMemo(
    () => [
      ...languageExtension(language),
      syntaxHighlighting(codeHighlight),
      codeTheme,
      EditorView.lineWrapping,
    ],
    [language],
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
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        highlightSelectionMatches: false,
      }}
    />
  );
}
