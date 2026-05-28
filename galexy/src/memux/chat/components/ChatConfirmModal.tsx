"use client";

/**
 * Minimal centred modal used for chat-side confirms + rename. We don't
 * pull in Radix Dialog here on purpose: the galexy app already has a
 * shadcn AlertDialog stack, and this small module keeps the chat subtree
 * self-contained (no cross-tree imports). One portal, body-scroll lock,
 * Escape-closes — same conventions as VaultImageEmbed's modal.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/memux/chat/lib/utils";

export function ChatModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
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

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "ws-card-enter w-full max-w-md rounded-xl border border-border bg-card shadow-2xl",
        )}
      >
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
          <div className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </header>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------ Rename modal */

export function RenameChatModal({
  current,
  onClose,
  onCommit,
}: {
  current: string;
  onClose: () => void;
  onCommit: (next: string) => void;
}) {
  const [value, setValue] = useState(current);
  const trimmed = value.trim();
  const canCommit = trimmed.length > 0 && trimmed !== current;

  function commit() {
    if (!canCommit) return;
    onCommit(trimmed);
    onClose();
  }

  return (
    <ChatModalShell
      title="Rename chat"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground/80 hover:bg-muted/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!canCommit}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </>
      }
    >
      <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground">
        Title
      </label>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring"
        placeholder="Give this chat a name"
      />
    </ChatModalShell>
  );
}

/* ------------------------------------------------ Delete modal */

export function DeleteChatModal({
  title,
  onClose,
  onConfirm,
}: {
  title: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ChatModalShell
      title="Delete chat?"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground/80 hover:bg-muted/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90"
          >
            Delete
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-foreground/80">
        <span className="font-medium text-foreground">&ldquo;{title}&rdquo;</span>{" "}
        will be removed. This can&apos;t be undone.
      </p>
    </ChatModalShell>
  );
}
