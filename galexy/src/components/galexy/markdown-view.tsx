"use client";

import { createContext, useContext, useState } from "react";
import { Check, ImageOff } from "lucide-react";
import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { remarkObsidian } from "@/lib/remark-obsidian";
import { useBlobUrl } from "@/components/galexy/use-blob-url";
import type { Note } from "@/lib/mock-notes";

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
  /**
   * Resolves an `![alt](wikilink:Title)` image reference to a vault Note so
   * the renderer can swap in the actual blob URL. Return null if the title
   * doesn't resolve to an image item. Without this prop, wikilink: image
   * srcs render as broken-image placeholders (browsers don't understand the
   * scheme).
   */
  resolveWikiImage?: (title: string) => Note | null;
};

export function MarkdownView({
  content,
  linkExists,
  onOpenWikiLink,
  onOpenTag,
  onToggleTask,
  resolveWikiImage,
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
              "cursor-pointer font-medium text-blue-700 underline decoration-blue-500/40 underline-offset-2 hover:decoration-blue-500 dark:text-blue-300 dark:decoration-blue-400/40 dark:hover:decoration-blue-400",
              !exists &&
                "text-muted-foreground decoration-dashed decoration-muted-foreground/50 hover:text-foreground dark:text-muted-foreground dark:decoration-muted-foreground/50",
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
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-blue-700 underline decoration-blue-500/40 underline-offset-2 hover:decoration-blue-500 dark:text-blue-300 dark:decoration-blue-400/40 dark:hover:decoration-blue-400"
          {...props}
        >
          {children}
        </a>
      );
    },
    img({ src, alt, node, ...props }) {
      void node;
      if (typeof src === "string" && src.startsWith("wikilink:")) {
        const title = decodeWikiTitle(src.slice("wikilink:".length));
        const note = resolveWikiImage?.(title) ?? null;
        if (note) {
          return <WikilinkImage note={note} alt={alt ?? ""} />;
        }
        return <BrokenImage alt={alt ?? ""} reason={`Couldn't resolve ${title}`} />;
      }
      return (
        <ExternalImage
          src={typeof src === "string" ? src : undefined}
          alt={alt ?? ""}
          {...props}
        />
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
  const disabled = !onToggle || line == null;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (onToggle && line != null) onToggle(line);
      }}
      className={cn(
        "mr-2 inline-flex size-[1.05em] shrink-0 translate-y-[0.12em] items-center justify-center rounded-full border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/50 hover:border-primary",
        disabled ? "cursor-default" : "cursor-pointer",
      )}
    >
      {checked && <Check className="size-[0.72em]" strokeWidth={3} />}
    </button>
  );
}

/**
 * Renders an image whose source is a vault Note — either an OPFS-backed blob
 * (Note.blobKey) or a packaged asset (Note.src). Falls back to the alt text
 * while the OPFS read is in flight, and renders a themed BrokenImage block
 * if neither source is available or the bytes don't decode.
 */
function WikilinkImage({ note, alt }: { note: Note; alt: string }) {
  const blobUrl = useBlobUrl(note.blobKey);
  const [errored, setErrored] = useState(false);
  const url = blobUrl ?? note.src ?? null;
  if (!url) {
    return (
      <span className="my-2 inline-block rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-xs italic text-muted-foreground">
        loading {alt || note.title}…
      </span>
    );
  }
  if (errored) {
    return <BrokenImage alt={alt || note.title} reason="Bytes wouldn't decode" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt || note.title}
      onError={() => setErrored(true)}
      className="my-3 rounded-md border bg-muted/20 max-w-full"
    />
  );
}

/**
 * External (non-wikilink) image with the same themed broken-image fallback
 * as WikilinkImage. We swap to BrokenImage on error so the reader never
 * sees the browser's native broken-image glyph in rendered markdown.
 */
function ExternalImage({
  src,
  alt,
  ...rest
}: { src?: string; alt: string } & React.ImgHTMLAttributes<HTMLImageElement>) {
  const [errored, setErrored] = useState(false);
  if (!src) return <BrokenImage alt={alt} reason="No source" />;
  if (errored) return <BrokenImage alt={alt} reason="Couldn't load" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} onError={() => setErrored(true)} {...rest} />
  );
}

/**
 * Themed placeholder for an image that couldn't be displayed. Matches the
 * rest of the app — rounded card, dashed muted border, gradient wash from
 * primary, a single soft icon, the alt text as the caption, and a tiny
 * reason line.
 *
 * Never renders a `<img>` so the browser's native broken-image glyph never
 * surfaces in rendered markdown.
 */
function BrokenImage({ alt, reason }: { alt: string; reason?: string }) {
  return (
    <span
      role="img"
      aria-label={alt || "broken image"}
      className={cn(
        "my-3 flex w-full max-w-md flex-col items-center justify-center gap-1.5",
        "rounded-lg border border-dashed border-muted-foreground/30",
        "bg-gradient-to-br from-primary/[0.04] via-muted/30 to-muted/10",
        "px-4 py-5",
      )}
    >
      <ImageOff className="size-5 text-muted-foreground/60" strokeWidth={1.5} />
      {alt && (
        <span className="line-clamp-2 text-center text-xs font-medium text-foreground/70">
          {alt}
        </span>
      )}
      {reason && (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
          {reason}
        </span>
      )}
    </span>
  );
}
