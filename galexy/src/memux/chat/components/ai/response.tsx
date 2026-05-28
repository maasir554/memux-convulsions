"use client";

import { Streamdown } from "streamdown";
import type { Components } from "streamdown";
import { cn } from "@/memux/chat/lib/utils";
import { VaultCitation } from "@/memux/chat/components/citations/VaultCitation";
import { VaultImageEmbed } from "@/memux/chat/components/citations/VaultImageEmbed";

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

function rewriteCitationsForSanitizer(md: string): string {
  return md
    .replace(/]\(vault-image:([^)\s]+)\)/g, `](https://${VAULT_HOST}/image/$1)`)
    .replace(/]\(vault:([^)\s]+)\)/g, `](https://${VAULT_HOST}/item/$1)`);
}

/**
 * Pull the vault item id out of a URL the renderer thinks points at a
 * vault citation/embed. Accepts any of:
 *   • https://vault.local/item/<id>          (post-rewrite text citation)
 *   • https://vault.local/image/<id>         (post-rewrite image embed)
 *   • https://vault.local/<anything>/<id>    (defensive — model variants)
 *   • vault:<id>                             (raw, pre-rewrite)
 *   • vault-image:<id>                       (raw, pre-rewrite)
 *
 * We intentionally do NOT distinguish citation vs. embed by the URL path
 * — that decision is driven by the markdown element type (`<a>` → cite,
 * `<img>` → embed) at the call site. Letting the URL drive that choice
 * was load-bearing on the model getting the scheme exactly right, which
 * isn't a guarantee we can rely on. Now ANY vault.local URL with a path
 * segment after the host returns its id.
 */
function extractVaultId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.host === VAULT_HOST) {
      const m = u.pathname.match(/^\/[^/]+\/(.+)$/);
      if (m) return decodeURIComponent(m[1]);
    }
  } catch {
    // Not an absolute URL — fall through to direct-scheme checks below.
  }
  if (url.startsWith("vault:")) return url.slice("vault:".length);
  if (url.startsWith("vault-image:")) return url.slice("vault-image:".length);
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
    // Markdown `[…](…)` → text citation. Any vault.local URL or raw
    // vault: / vault-image: scheme resolves to a VaultCitation chip;
    // the path subkind (item / image / etc.) is ignored deliberately.
    const id = typeof href === "string" ? extractVaultId(href) : null;
    if (id) {
      return <VaultCitation itemId={id} display={children} />;
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
  img({ src, alt, ...rest }) {
    // Markdown `![…](…)` → inline embed. Same URL forms accepted; same
    // subkind-agnostic logic. If the resolved item isn't an image the
    // embed component shows the themed broken-image fallback.
    const id = typeof src === "string" ? extractVaultId(src) : null;
    if (id) {
      return (
        <VaultImageEmbed
          itemId={id}
          alt={typeof alt === "string" ? alt : ""}
        />
      );
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
