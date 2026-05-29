"use client";

import { Streamdown } from "streamdown";
import type { Components } from "streamdown";
import { cn } from "@/memux/chat/lib/utils";
import { VaultCitation } from "@/memux/chat/components/citations/VaultCitation";
import { VaultImageEmbed } from "@/memux/chat/components/citations/VaultImageEmbed";
import { VaultGraphEmbed } from "@/memux/chat/components/citations/VaultGraphEmbed";
import { VaultConceptCloud } from "@/memux/chat/components/citations/VaultConceptCloud";
import { VaultChartEmbed } from "@/memux/chat/components/citations/VaultChartEmbed";
import { VaultTimelineEmbed } from "@/memux/chat/components/citations/VaultTimelineEmbed";
import { VaultTableEmbed } from "@/memux/chat/components/citations/VaultTableEmbed";
import { VaultOutlineEmbed } from "@/memux/chat/components/citations/VaultOutlineEmbed";

/**
 * The agent emits citations as `vault:<itemId>` and `vault-image:<itemId>`
 * URL schemes. But Streamdown ships rehype-sanitize with a strict default
 * schema that only allows http/https for src/href — custom schemes are
 * dropped, then rehype-harden paints a `[Image blocked: …]` placeholder.
 *
 * Workaround: pre-process the markdown to rewrite our schemes to a private
 * https origin (`https://vault.local/item/<id>` and
 * `…/image/<id>`). Those survive sanitization unchanged. Our `a` / `img`
 * component overrides recognise the origin and delegate to the citation
 * components.
 *
 * The user never sees the placeholder URL — both renderers consume the id
 * and render a chip / embed without ever showing the synthetic href.
 */
const VAULT_HOST = "vault.local";

// The widget schemes — order matters: longer prefixes first, otherwise
// `vault:` would gobble `vault-concepts:` etc.
const VAULT_SCHEMES: Array<[string, string]> = [
  ["vault-timeline", "timeline"],
  ["vault-concepts", "concepts"],
  ["vault-outline", "outline"],
  ["vault-image", "image"],
  ["vault-graph", "graph"],
  ["vault-chart", "chart"],
  ["vault-table", "table"],
  ["vault", "item"],
];

function rewriteCitationsForSanitizer(md: string): string {
  // The regex MUST allow whitespace in the URL position — chart/timeline/
  // table/outline/concept specs frequently contain spaces in their labels
  // ("BFSI Cybersecurity", "Section 02 · Overview"). Markdown's own image
  // parser would bail on unescaped spaces, so we explicitly URL-encode
  // the captured value before substituting in the fake vault.local URL.
  // Without this, Streamdown sees `![alt](vault-concepts:A B,C D)` as
  // invalid and renders it as literal text.
  let out = md;
  for (const [scheme, path] of VAULT_SCHEMES) {
    const re = new RegExp(`\\]\\(${scheme}:([^)]+)\\)`, "g");
    out = out.replace(re, (_, value) => {
      // encodeURIComponent escapes spaces (%20), commas pass through.
      // Decoded back in extractVaultWidget so widget parsers see the
      // original characters.
      const encoded = encodeURIComponent(String(value).trim());
      return `](https://${VAULT_HOST}/${path}/${encoded})`;
    });
  }
  return out;
}

/** Identify the widget kind from a (post-rewrite) vault.local URL. */
type VaultWidget =
  | { kind: "item"; value: string }
  | { kind: "image"; value: string }
  | { kind: "graph"; value: string }
  | { kind: "concepts"; value: string }
  | { kind: "chart"; value: string }
  | { kind: "timeline"; value: string }
  | { kind: "table"; value: string }
  | { kind: "outline"; value: string };

const EMBED_KINDS = new Set([
  "image",
  "graph",
  "concepts",
  "chart",
  "timeline",
  "table",
  "outline",
]);

function extractVaultWidget(url: string): VaultWidget | null {
  try {
    const u = new URL(url);
    if (u.host === VAULT_HOST) {
      const m = u.pathname.match(/^\/([^/]+)\/(.+)$/);
      if (m) {
        const kind = m[1];
        const value = decodeURIComponent(m[2]);
        if (EMBED_KINDS.has(kind)) {
          return { kind: kind as Exclude<VaultWidget, { kind: "item" }>["kind"], value };
        }
        return { kind: "item", value };
      }
    }
  } catch {
    // Not absolute — fall through to raw-scheme checks.
  }
  // Raw schemes (pre-rewrite). Order matters — longer prefixes first.
  const rawMatchers: Array<[string, VaultWidget["kind"]]> = [
    ["vault-timeline:", "timeline"],
    ["vault-concepts:", "concepts"],
    ["vault-outline:", "outline"],
    ["vault-chart:", "chart"],
    ["vault-graph:", "graph"],
    ["vault-image:", "image"],
    ["vault-table:", "table"],
    ["vault:", "item"],
  ];
  for (const [prefix, kind] of rawMatchers) {
    if (url.startsWith(prefix)) {
      return { kind, value: url.slice(prefix.length) } as VaultWidget;
    }
  }
  return null;
}


/**
 * Custom renderers for the two citation schemes the agent emits:
 *   [title](vault:<itemId>)        → VaultCitation chip
 *   ![alt](vault-image:<itemId>)   → VaultImageEmbed (modal-on-click)
 *
 * Plain links and images fall through to streamdown's defaults.
 */
const citationComponents: Components = {
  a({ href, children, ...rest }) {
    // `[…](…)` → text citation. Always routes to VaultCitation regardless
    // of which subkind the model used; the path is the value.
    const w = typeof href === "string" ? extractVaultWidget(href) : null;
    if (w) {
      return <VaultCitation itemId={w.value} display={children} />;
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
  img({ src, alt, ...rest }) {
    // `![…](…)` → inline embed. The path subkind picks which widget:
    //   /graph/    → VaultGraphEmbed (mini knowledge graph)
    //   /concepts/ → VaultConceptCloud
    //   /chart/    → VaultChartEmbed (bar / pie / donut / line / area)
    //   /timeline/ → VaultTimelineEmbed (horizontal chronology)
    //   /table/    → VaultTableEmbed (side-by-side comparison)
    //   /outline/  → VaultOutlineEmbed (hierarchical with reads marked)
    //   /image/    → VaultImageEmbed
    //   /item/     → VaultImageEmbed (handles the not-an-image case
    //                gracefully — falls back to the themed broken state)
    const w = typeof src === "string" ? extractVaultWidget(src) : null;
    if (w) {
      const altText = typeof alt === "string" ? alt : "";
      if (w.kind === "graph") return <VaultGraphEmbed ids={w.value} alt={altText} />;
      if (w.kind === "concepts") return <VaultConceptCloud concepts={w.value} alt={altText} />;
      if (w.kind === "chart") return <VaultChartEmbed spec={w.value} alt={altText} />;
      if (w.kind === "timeline") return <VaultTimelineEmbed spec={w.value} alt={altText} />;
      if (w.kind === "table") return <VaultTableEmbed spec={w.value} alt={altText} />;
      if (w.kind === "outline") return <VaultOutlineEmbed spec={w.value} alt={altText} />;
      return <VaultImageEmbed itemId={w.value} alt={altText} />;
    }
    return <img src={src} alt={alt ?? ""} {...rest} />;
  },
};

/**
 * Models often write quasi-headings like `**1. Appearance and Size**` on
 * their own line without a blank line above, which renders as inline bold
 * jammed against the paragraph. Promote any line that is *only* a bold span
 * to a real `### heading` so it picks up heading spacing semantically.
 */
function promoteHeadings(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      const m = line.match(/^\s*\*\*([^*][\s\S]*?)\*\*\s*:?\s*$/);
      if (!m) return line;
      const inner = (m[1] ?? "").trim();
      if (!inner) return line;
      return `\n### ${inner}\n`;
    })
    .join("\n");
}

export function Response({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const processed = rewriteCitationsForSanitizer(promoteHeadings(content));
  return (
    <div
      className={cn(
        "prose prose-invert max-w-none",
        "text-[16.5px] leading-[1.5] text-foreground/90 font-[300]",
        "prose-p:my-5 prose-p:leading-[1.5] prose-p:font-[300]",
        "prose-ul:my-5 prose-ol:my-5 prose-li:my-2 prose-li:leading-[1.5] prose-li:font-[300]",
        "prose-headings:font-semibold prose-headings:text-foreground prose-headings:mt-8 prose-headings:mb-4",
        "prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-h4:text-lg",
        "prose-strong:font-semibold prose-strong:text-foreground",
        "prose-em:text-foreground/90",
        "prose-blockquote:border-l-2 prose-blockquote:border-foreground/30 prose-blockquote:text-foreground/80 prose-blockquote:not-italic prose-blockquote:font-[300] prose-blockquote:my-5",
        "prose-pre:bg-muted prose-pre:text-foreground prose-pre:rounded-md prose-pre:my-5 prose-pre:p-3 prose-pre:text-[13.5px] prose-pre:leading-6",
        "prose-code:bg-muted prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.875em] prose-code:font-normal prose-code:before:hidden prose-code:after:hidden",
        "prose-a:text-foreground prose-a:underline-offset-2 prose-a:decoration-foreground/40",
        "prose-hr:border-foreground/15 prose-hr:my-8",
        className,
      )}
    >
      <Streamdown
        components={citationComponents}
        linkSafety={{ enabled: false }}
      >
        {processed}
      </Streamdown>
    </div>
  );
}
