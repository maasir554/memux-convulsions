"use client";

import * as React from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/memux/chat/components/ui/button";
import { cn } from "@/memux/chat/lib/utils";

/**
 * Scroll container that sticks to the bottom while messages stream, and shows
 * a "jump to latest" affordance when the user has scrolled up.
 */
export function Conversation({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = React.useState(true);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setPinned(atBottom);
  };

  React.useEffect(() => {
    const el = ref.current;
    if (!el || !pinned) return;
    el.scrollTop = el.scrollHeight;
  });

  return (
    <div className={cn("relative flex-1 min-h-0", className)} {...props}>
      <div
        ref={ref}
        onScroll={onScroll}
        className="h-full overflow-y-auto scroll-smooth"
      >
        <div className="mx-auto w-full max-w-3xl px-4 py-6">{children}</div>
      </div>
      {!pinned && (
        <Button
          size="icon"
          variant="secondary"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow"
          onClick={() => {
            const el = ref.current;
            if (el) {
              el.scrollTop = el.scrollHeight;
              setPinned(true);
            }
          }}
          aria-label="Jump to latest"
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  );
}

export function ConversationContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-6", className)} {...props} />;
}

export function ConversationEmptyState({
  title = "Start a conversation",
  description,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-24 text-muted-foreground",
        className,
      )}
    >
      <div className="text-base font-medium text-foreground/80">{title}</div>
      {description && (
        <div className="mt-1 text-sm max-w-md">{description}</div>
      )}
    </div>
  );
}
