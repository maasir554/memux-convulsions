import {
  FileCode2,
  FileSpreadsheet,
  Folder,
  Image as ImageIcon,
} from "lucide-react";

import type { ItemType } from "@/lib/mock-notes";

/* ---------------- per-type accent colours ---------------------------------- */

const MD_COLOR = "#519aba"; // markdown logo blue
const PDF_COLOR = "#e63946"; // PDF red
const CSV_COLOR = "#1d6f42"; // Excel green
const IMAGE_COLOR = "#a78bfa"; // soft violet (matches --graph-image dark)

/**
 * Per-language tint for code files. Pulled from GitHub Linguist's canonical
 * language colours so each file is recognisable at a glance the way it would
 * be in an editor sidebar.
 */
const CODE_LANG_COLOR: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#3178c6",
  js: "#f1e05a",
  jsx: "#f1e05a",
  mjs: "#f1e05a",
  cjs: "#f1e05a",
  py: "#3572a5",
  rs: "#dea584",
  ru: "#dea584", // also accept the abbreviation the user typed for Rust
  go: "#00add8",
  cpp: "#f34b7d",
  cxx: "#f34b7d",
  cc: "#f34b7d",
  hpp: "#f34b7d",
  "c++": "#f34b7d",
  c: "#555555",
  h: "#555555",
  java: "#b07219",
  kt: "#a97bff",
  swift: "#fa7343",
  rb: "#cc342d",
  php: "#777bb4",
  sh: "#89e051",
  bash: "#89e051",
  zsh: "#89e051",
  json: "#cbcb41",
  yaml: "#cb171e",
  yml: "#cb171e",
  toml: "#9c4221",
  css: "#264de4",
  scss: "#c6538c",
  html: "#e34c26",
  sql: "#dad8d8",
  md: MD_COLOR,
};
const CODE_DEFAULT_COLOR = "#abb2bf";

/* ---------------- custom SVG icons ----------------------------------------- */

/**
 * Custom Markdown file glyph — a file outline with a small "M↓" inside,
 * tinted in the canonical markdown blue. Distinct from FileText (which we
 * used to use here) so md files don't look identical to plain text.
 */
function MarkdownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: MD_COLOR }}
    >
      {/* file outline */}
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      {/* "M" peak */}
      <path d="M7 17 v-4 l1.5 2 l1.5-2 v4" />
      {/* "↓" — down arrow */}
      <line x1="15" y1="13" x2="15" y2="17" />
      <polyline points="13 15 15 17 17 15" />
    </svg>
  );
}

/**
 * Custom PDF file glyph — file outline with the letters "PDF" in red, since
 * lucide ships no PDF-specific icon and the generic `File` reads as "I am
 * an unknown file".
 */
function PdfIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: PDF_COLOR }}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      {/* "PDF" letters — fill not stroke for legibility at 16px */}
      <text
        x="12"
        y="18"
        textAnchor="middle"
        fontSize="6.5"
        fontWeight="900"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fill="currentColor"
        stroke="none"
      >
        PDF
      </text>
    </svg>
  );
}

/* ---------------- public ItemIcon ------------------------------------------ */

export function ItemIcon({
  type,
  language,
  className,
}: {
  type: ItemType;
  /** Code-file language extension (without leading dot). Tints the icon. */
  language?: string;
  className?: string;
}) {
  switch (type) {
    case "code": {
      const key = language?.toLowerCase();
      const color =
        (key && CODE_LANG_COLOR[key]) ?? CODE_DEFAULT_COLOR;
      return <FileCode2 className={className} style={{ color }} />;
    }
    case "csv":
      return (
        <FileSpreadsheet
          className={className}
          style={{ color: CSV_COLOR }}
        />
      );
    case "pdf":
      return <PdfIcon className={className} />;
    case "image":
      return (
        <ImageIcon className={className} style={{ color: IMAGE_COLOR }} />
      );
    case "folder":
      return (
        <Folder
          className={className}
          style={{ color: "var(--graph-folder)" }}
        />
      );
    case "markdown":
    default:
      return <MarkdownIcon className={className} />;
  }
}
