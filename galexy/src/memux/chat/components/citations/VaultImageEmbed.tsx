"use client";

/**
 * Inline image embed for `![alt](vault-image:<itemId>)` references in
 * chat responses. Resolves the itemId to an image item, reads bytes from
 * OPFS, renders at a fixed visual height for consistent layout, and on
 * click opens a modal with the full-resolution image + an "Open in
 * vault" link.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ExternalLink, ImageOff, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useBlobUrl } from "@/components/galexy/use-blob-url";
import { useVaultItem } from "@/lib/chat/vault-resolver";

const PREVIEW_HEIGHT_PX = 200;

export function VaultImageEmbed({
  itemId,
  alt,
}: {
  itemId: string;
  alt: string;
}) {
  const { item, loading } = useVaultItem(itemId);
  const blobUrl = useBlobUrl(item?.blobKey ?? undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [errored, setErrored] = useState(false);

  if (loading) {
    return (
      <span
        className="my-2 inline-block animate-pulse rounded-md border border-dashed border-muted-foreground/30 bg-muted/30"
        style={{ width: 320, height: PREVIEW_HEIGHT_PX }}
        aria-label={`Loading image ${alt}`}
      />
    );
  }

  if (!item || item.type !== "image") {
    return <BrokenImage alt={alt} reason="Unknown vault image" />;
  }

  const src = blobUrl ?? item.src ?? null;
  if (!src || errored) {
    return (
      <BrokenImage
        alt={alt || item.title}
        reason={!src ? "No bytes available" : "Wouldn't decode"}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        title={`${item.title} — click to enlarge`}
        className={cn(
          "group/img my-3 block overflow-hidden rounded-md border border-border/60 bg-muted/20 p-0",
          "transition-all hover:border-foreground/30 hover:shadow-lg",
        )}
        style={{ height: PREVIEW_HEIGHT_PX }}
      >
        <img
          src={src}
          alt={alt || item.title}
          onError={() => setErrored(true)}
          className="h-full w-auto object-contain"
          loading="lazy"
        />
      </button>
      {modalOpen && (
        <ImageModal
          src={src}
          alt={alt || item.title}
          itemId={item.id}
          title={item.title}
          folder={item.folder}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

/* ----------------------------------------------------- modal */

function ImageModal({
  src,
  alt,
  itemId,
  title,
  folder,
  onClose,
}: {
  src: string;
  alt: string;
  itemId: string;
  title: string;
  folder: string;
  onClose: () => void;
}) {
  // Lock body scroll + close on Escape while the modal is open.
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
              {title}
            </div>
            {folder && (
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {folder}
              </div>
            )}
          </div>
          <Link
            href={`/vault?open=${encodeURIComponent(itemId)}`}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] text-foreground/85 hover:border-foreground/30 hover:bg-muted/70"
            onClick={onClose}
          >
            <ExternalLink className="size-3" />
            Open in vault
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-border/60 bg-muted/40 p-1.5 text-muted-foreground hover:border-foreground/30 hover:bg-muted/70 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <img
          src={src}
          alt={alt}
          className="max-h-[80vh] max-w-[92vw] rounded-b-lg object-contain"
        />
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------------------------------- broken state */

function BrokenImage({ alt, reason }: { alt: string; reason: string }) {
  return (
    <span
      role="img"
      aria-label={alt || "broken image"}
      className={cn(
        "my-3 flex w-full max-w-md flex-col items-center justify-center gap-1.5",
        "rounded-lg border border-dashed border-muted-foreground/30",
        "bg-gradient-to-br from-primary/[0.04] via-muted/30 to-muted/10 px-4 py-5",
      )}
    >
      <ImageOff className="size-5 text-muted-foreground/60" strokeWidth={1.5} />
      {alt && (
        <span className="line-clamp-2 text-center text-xs font-medium text-foreground/70">
          {alt}
        </span>
      )}
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
        {reason}
      </span>
    </span>
  );
}
