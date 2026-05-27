"use client";

import { Streamdown } from "streamdown";
import { cn } from "@/memux/chat/lib/utils";

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
  const processed = promoteHeadings(content);
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
      <Streamdown>{processed}</Streamdown>
    </div>
  );
}
