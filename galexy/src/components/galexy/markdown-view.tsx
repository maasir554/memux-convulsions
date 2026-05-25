"use client";

import { createContext, useContext } from "react";
import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { remarkObsidian } from "@/lib/remark-obsidian";

// Passes a list item's source line number down to its task checkbox (the
// checkbox node itself carries no position).
const TaskLineContext = createContext<number | null>(null);

// react-markdown percent-encodes spaces in hrefs (e.g. "Graph%20View"), so
// decode the title back before resolving/navigating.
function decodeWikiTitle(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type MarkdownViewProps = {
  content: string;
  linkExists: (title: string) => boolean;
  onOpenWikiLink: (title: string) => void;
  onOpenTag: (tag: string) => void;
  onToggleTask?: (lineIndex: number) => void;
};

export function MarkdownView({
  content,
  linkExists,
  onOpenWikiLink,
  onOpenTag,
  onToggleTask,
}: MarkdownViewProps) {
  const components: Components = {
    li({ node, children, ...props }) {
      const line = node?.position?.start.line;
      if (line == null) {
        return <li {...props}>{children}</li>;
      }
      return (
        <li {...props}>
          <TaskLineContext.Provider value={line - 1}>
            {children}
          </TaskLineContext.Provider>
        </li>
      );
    },
    input({ node, type, checked, ...props }) {
      void node;
      if (type !== "checkbox") {
        return <input type={type} {...props} />;
      }
      return <TaskCheckbox checked={Boolean(checked)} onToggle={onToggleTask} />;
    },
    a({ href, children, node, ...props }) {
      void node;
      if (href?.startsWith("wikilink:")) {
        const title = decodeWikiTitle(href.slice("wikilink:".length));
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

function TaskCheckbox({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle?: (lineIndex: number) => void;
}) {
  const line = useContext(TaskLineContext);
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={!onToggle || line == null}
      onChange={() => {
        if (onToggle && line != null) onToggle(line);
      }}
      className="mr-1.5 cursor-pointer accent-primary disabled:cursor-default"
    />
  );
}
