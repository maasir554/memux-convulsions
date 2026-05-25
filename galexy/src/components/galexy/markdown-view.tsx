"use client";

import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { remarkObsidian } from "@/lib/remark-obsidian";

type MarkdownViewProps = {
  content: string;
  linkExists: (title: string) => boolean;
  onOpenWikiLink: (title: string) => void;
  onOpenTag: (tag: string) => void;
};

export function MarkdownView({
  content,
  linkExists,
  onOpenWikiLink,
  onOpenTag,
}: MarkdownViewProps) {
  const components: Components = {
    a({ href, children, node, ...props }) {
      void node;
      if (href?.startsWith("wikilink:")) {
        const title = href.slice("wikilink:".length);
        const exists = linkExists(title);
        return (
          <button
            type="button"
            onClick={() => onOpenWikiLink(title)}
            className={cn(
              "cursor-pointer font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary",
              !exists &&
                "text-muted-foreground decoration-dashed decoration-muted-foreground/50 hover:text-foreground",
            )}
          >
            {children}
          </button>
        );
      }

      if (href?.startsWith("tag:")) {
        return (
          <button
            type="button"
            onClick={() => onOpenTag(href.slice("tag:".length))}
            className="mx-0.5 cursor-pointer rounded-full bg-muted px-2 py-0.5 align-baseline text-[0.8em] font-medium text-muted-foreground no-underline hover:bg-accent hover:text-foreground"
          >
            {children}
          </button>
        );
      }

      return (
        <a href={href} target="_blank" rel="noreferrer" {...props}>
          {children}
        </a>
      );
    },
  };

  return (
    <div
      className={cn(
        "prose prose-neutral dark:prose-invert max-w-none",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none",
        "prose-a:font-medium",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkObsidian]}
        urlTransform={(url) =>
          url.startsWith("wikilink:") || url.startsWith("tag:")
            ? url
            : defaultUrlTransform(url)
        }
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
