"use client";

import { cn } from "@/memux/chat/lib/utils";

/**
 * Renders the Lemonade mark. The actual file lives at
 * `frontend/public/lemonade.svg`, so it's served as a static asset from `/`
 * and can be swapped for the canonical PNG/SVG just by overwriting the file.
 */
export function LemonadeLogo({ className }: { className?: string }) {
  return (
    <img
      src="/lemonade-logo.ico"
      alt="Lemonade"
      className={cn("inline-block select-none object-contain", className)}
      draggable={false}
    />
  );
}
