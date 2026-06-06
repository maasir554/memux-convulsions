"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ImageOff, X } from "lucide-react";
import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

import { cn } from "@/lib/utils";
import {
  hasTaskCheckbox,
  normalizeEquations,
  normalizeEquationsInline,
} from "@/lib/latex";
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
        const raw = src.slice("wikilink:".length);
        // Split the URL fragment out: `wikilink:<token>#bbox=<id>` carries
        // a named region reference. The token before the `#` is the
        // image's id (preferred) or title (legacy fallback).
        const hashIdx = raw.indexOf("#");
        const token = decodeWikiTitle(hashIdx >= 0 ? raw.slice(0, hashIdx) : raw);
        const fragment = hashIdx >= 0 ? raw.slice(hashIdx + 1) : "";
        const bboxId = parseFragmentBbox(fragment);
        const note = resolveWikiImage?.(token) ?? null;
        if (note) {
          return <WikilinkImage note={note} alt={alt ?? ""} bboxId={bboxId} />;
        }
        return <BrokenImage alt={alt ?? ""} reason={`Couldn't resolve ${token}`} />;
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
        remarkPlugins={[remarkGfm, remarkMath, remarkObsidian]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) =>
          url.startsWith("wikilink:") || url.startsWith("tag:")
            ? url
            : defaultUrlTransform(url)
        }
        components={components}
      >
        {/* Notes with task checkboxes map rendered line numbers back to the
            source to toggle them, so the equation transform must preserve line
            count there; notes without tasks get proper fenced display blocks. */}
        {hasTaskCheckbox(content)
          ? normalizeEquationsInline(content)
          : normalizeEquations(content)}
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
 * Renders an image whose source is a vault Note. Two modes:
 *
 *   • Without `bboxId`: render the full image (legacy + general case).
 *   • With `bboxId`: look up the named region on note.bboxes and render
 *     ONLY the cropped region inline via `object-fit:none` + scale, so we
 *     don't need to materialise a separate cropped image. Click opens a
 *     modal that shows the FULL image with a rectangle overlay around the
 *     region — preserves context the user might want.
 *
 * Falls back to the alt text while the OPFS read is in flight, and renders
 * a themed BrokenImage block if neither source is available or the bytes
 * don't decode.
 */
function WikilinkImage({
  note,
  alt,
  bboxId,
}: {
  note: Note;
  alt: string;
  bboxId: string | null;
}) {
  const blobUrl = useBlobUrl(note.blobKey);
  const [errored, setErrored] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const url = blobUrl ?? note.src ?? null;

  // Resolve the bbox metadata once when both the id + the note are present.
  const bbox = bboxId
    ? (note.bboxes ?? []).find((b) => b.id === bboxId) ?? null
    : null;

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

  const displayAlt = alt || bbox?.alt || note.title;

  if (bbox) {
    return (
      <>
        <BboxCropInline
          src={url}
          alt={displayAlt}
          bbox={bbox.bbox}
          onClick={() => setModalOpen(true)}
          onError={() => setErrored(true)}
        />
        {modalOpen && (
          <BboxModal
            src={url}
            alt={displayAlt}
            note={note}
            bbox={bbox.bbox}
            caption={bbox.caption || bbox.alt}
            onClose={() => setModalOpen(false)}
          />
        )}
      </>
    );
  }

  // Plain whole-image render.
  return (
    <img
      src={url}
      alt={displayAlt}
      onError={() => setErrored(true)}
      className="my-3 rounded-md border bg-muted/20 max-w-full"
    />
  );
}

/**
 * Inline cropped-region preview. We display the source image inside a
 * fixed-size container with `object-fit: none`, then translate + scale so
 * only the bbox region is visible — equivalent to cropping at render time
 * without ever encoding a separate file.
 *
 * `bbox` is `[ymin, xmin, ymax, xmax]` in the 0..1000 normalised space.
 * We need the image's intrinsic dimensions to compute pixel offsets, so
 * we read them from the `<img>`'s `onLoad` and re-render once available.
 */
function BboxCropInline({
  src,
  alt,
  bbox,
  onClick,
  onError,
}: {
  src: string;
  alt: string;
  bbox: [number, number, number, number];
  onClick: () => void;
  onError: () => void;
}) {
  // Bounding box the preview must fit inside. The crop is scaled to fit
  // within BOTH dimensions (contain), never to fill one and overflow the
  // other.
  const MAX_W = 560;
  const MAX_H = 320;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  // Read the intrinsic size. `onLoad` alone is unreliable: a cached/already
  // decoded image is `complete` before React attaches the handler, so the
  // load event never reaches us and the crop is stuck in its uncropped
  // fallback. A ref callback that measures eagerly when the element is
  // already complete closes that race.
  const measure = (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth > 0) {
      setNatural((prev) => prev ?? { w: el.naturalWidth, h: el.naturalHeight });
    }
  };

  const [ymin, xmin, ymax, xmax] = bbox;
  // Crop dimensions in pixels of the source image. Computed once we know
  // the natural size; until then we render the image whole so the box is
  // never wrong. Guard against degenerate (zero-area) boxes.
  const cropPx =
    natural && xmax > xmin && ymax > ymin
      ? {
          x: (xmin / 1000) * natural.w,
          y: (ymin / 1000) * natural.h,
          w: ((xmax - xmin) / 1000) * natural.w,
          h: ((ymax - ymin) / 1000) * natural.h,
        }
      : null;

  // Contain-fit: scale so the WHOLE crop region fits inside MAX_W × MAX_H,
  // preserving aspect ratio. The container is then sized to the scaled crop
  // exactly, and the image is translated so the crop's top-left anchors the
  // container's top-left. (Previously we scaled to fill a fixed height then
  // capped the width at 560px — which silently clipped the right edge of
  // wide/landscape crops.)
  const scale = cropPx ? Math.min(MAX_W / cropPx.w, MAX_H / cropPx.h) : 1;
  const containerWidth = cropPx ? cropPx.w * scale : 360;
  const containerHeight = cropPx ? cropPx.h * scale : 220;

  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to enlarge — full image + region overlay"
      className={cn(
        "group/bbox my-3 block overflow-hidden rounded-md border border-border bg-muted/20 p-0",
        "transition-all hover:border-foreground/30 hover:shadow-lg",
      )}
      style={{ height: containerHeight, width: containerWidth }}
    >
      <div
        className="relative h-full w-full overflow-hidden"
        style={{
          // We render the image at its natural size, scaled to make the
          // crop fit the preview, then translated so the crop's TL anchors
          // the container's TL.
        }}
      >
        <img
          src={src}
          alt={alt}
          ref={measure}
          onLoad={(e) => {
            const el = e.currentTarget;
            setNatural({ w: el.naturalWidth, h: el.naturalHeight });
          }}
          onError={onError}
          className="absolute select-none"
          draggable={false}
          style={{
            top: cropPx ? `${-cropPx.y * scale}px` : 0,
            left: cropPx ? `${-cropPx.x * scale}px` : 0,
            width: natural ? `${natural.w * scale}px` : "auto",
            height: natural ? `${natural.h * scale}px` : "100%",
            maxWidth: "none",
            // `prose` (tailwind typography) applies `margin: 2em 0` to every
            // <img>. On an absolutely-positioned element that margin shifts
            // the image ~32px, sliding the crop window off the bbox (cuts the
            // bottom, leaks white at the top). Neutralise it like maxWidth.
            margin: 0,
          }}
        />
      </div>
    </button>
  );
}

/**
 * Full-image modal with a rectangle overlay marking the bbox region.
 * Lets the user see the cropped region in context. Esc / backdrop click
 * closes.
 */
function BboxModal({
  src,
  alt,
  note,
  bbox,
  caption,
  onClose,
}: {
  src: string;
  alt: string;
  note: Note;
  bbox: [number, number, number, number];
  caption: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const [ymin, xmin, ymax, xmax] = bbox;
  const topPct = ymin / 10;
  const leftPct = xmin / 10;
  const widthPct = (xmax - xmin) / 10;
  const heightPct = (ymax - ymin) / 10;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm"
    >
      <div
        className="relative flex max-h-[92vh] max-w-[92vw] flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 rounded-t-lg bg-card/80 px-4 py-2 text-sm backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold tracking-tight text-foreground">
              {caption || note.title}
            </div>
            {note.folder && (
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {note.folder}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-border bg-muted/40 p-1.5 text-muted-foreground hover:border-foreground/30 hover:bg-muted/70 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="relative">
          <img
            src={src}
            alt={alt}
            className="max-h-[80vh] max-w-[92vw] rounded-b-lg object-contain"
          />
          {/* Rectangle overlay marking the bbox region. Uses % so the box
              tracks the rendered image regardless of object-fit scaling.
              `ws-bbox-pop` scales it in on mount, then pulses softly so
              the user's eye is drawn there immediately when the modal
              opens. */}
          <div
            className="ws-bbox-pop pointer-events-none absolute rounded-sm border-2 border-primary"
            style={{
              top: `${topPct}%`,
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              height: `${heightPct}%`,
            }}
            aria-hidden
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Parse the URL fragment of a wikilink: image to extract a bbox id.
 * Accepts `bbox=<id>` (preferred) or the trailing form `#<id>`.
 */
function parseFragmentBbox(fragment: string): string | null {
  if (!fragment) return null;
  const params = new URLSearchParams(fragment);
  const id = params.get("bbox");
  if (id) return id;
  return null;
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
