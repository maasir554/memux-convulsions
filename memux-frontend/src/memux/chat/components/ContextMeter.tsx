"use client";

import { cn } from "@/memux/chat/lib/utils";

export function ContextMeter({
  used,
  total,
  className,
}: {
  used: number;
  total: number;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const tone =
    pct < 60 ? "bg-emerald-500" : pct < 85 ? "bg-amber-500" : "bg-red-500";
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
      title={`${used.toLocaleString()} of ${total.toLocaleString()} tokens (~${pct}%)`}
    >
      <span className="font-mono tabular-nums">
        {used.toLocaleString()}
        <span className="text-foreground/40"> / </span>
        {total.toLocaleString()}
      </span>
      <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(tone, "h-full transition-[width] duration-200")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
