import Link from "next/link";
import { FilePlus, MessageSquare, FolderOpen, Users } from "lucide-react";

import { AccountChip } from "@/components/auth/account-chip";
import { cn } from "@/lib/utils";

const TILES = [
  {
    href: "/indexer",
    label: "Index",
    sub: "Drop files, add context, build a searchable index.",
    Icon: FilePlus,
    accent: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
  },
  {
    href: "/chat",
    label: "Chat",
    sub: "Talk to a local model. Streams from Plasma's backend.",
    Icon: MessageSquare,
    accent: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
  },
  {
    href: "/vault",
    label: "Browse",
    sub: "Open the vault: notes, sheets, PDFs, graph.",
    Icon: FolderOpen,
    accent: "bg-violet-500/10 text-violet-400 ring-violet-500/20",
  },
  {
    href: "/teams",
    label: "Teams",
    sub: "Real-time chat spaces. Create one, or join with a code.",
    Icon: Users,
    accent: "bg-sky-500/10 text-sky-400 ring-sky-500/20",
  },
] as const;

export default function MemuxHome() {
  return (
    <div className="relative flex flex-1 items-center justify-center bg-background p-8">
      <div className="absolute top-4 right-6">
        <AccountChip />
      </div>
      <div className="w-full max-w-4xl">
        <div className="mb-10 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            MEMUX · convulsions
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Future of Work & Productivity
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            One surface for the everyday tools you reach for. Pick where to go.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {TILES.map(({ href, label, sub, Icon, accent }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "group flex flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground transition-colors",
                "hover:border-foreground/30 hover:bg-card/80",
              )}
            >
              <div
                className={cn(
                  "flex size-10 items-center justify-center rounded-lg ring-1 ring-inset",
                  accent,
                )}
              >
                <Icon className="size-5" />
              </div>
              <div className="space-y-1">
                <div className="text-base font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{sub}</div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-center text-[10px] tracking-wide text-muted-foreground/70 uppercase">
          galexy · plasma · worksmith
        </div>
      </div>
    </div>
  );
}
