"use client";

import Link from "next/link";
import { Loader2, LogIn, Users } from "lucide-react";

import { ShellSidebar } from "@/components/unified-shell";

export function TeamsAccessState({
  next,
  pending = false,
  backendAvailable = true,
}: {
  next: string;
  pending?: boolean;
  backendAvailable?: boolean;
}) {
  const signInHref = `/login?next=${encodeURIComponent(next)}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <ShellSidebar
        compact={
          <div className="flex size-9 items-center justify-center rounded-lg bg-sidebar-accent text-foreground">
            <Users className="size-4" />
          </div>
        }
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-sidebar-border p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Teams
            </div>
            <p className="mt-3 text-sm font-medium">Shared spaces</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Continue conversations with the people you work with.
            </p>
          </div>
          <div className="p-3">
            <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-3">
              <p className="text-xs font-medium">
                {pending
                  ? "Checking your account…"
                  : backendAvailable
                    ? "Sign in to see your teams"
                    : "Team services are offline"}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Your local MEMUX workspace remains available either way.
              </p>
            </div>
          </div>
        </div>
      </ShellSidebar>

      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Teams
        </div>
        <div className="text-sm font-medium">Shared spaces</div>
        <div className="text-xs text-muted-foreground">
          Work together without leaving MEMUX.
        </div>
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border bg-card text-muted-foreground shadow-sm">
            {pending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Users className="size-5" />
            )}
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            {pending
              ? "Getting Teams ready"
              : backendAvailable
                ? "Bring your team into the flow"
                : "Teams is temporarily unavailable"}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {pending
              ? "We’re checking your MEMUX account."
              : backendAvailable
                ? "Sign in to create shared spaces, join with an invite, and keep conversations connected to your work."
                : "The local Teams and sign-in service is not running. You can continue using Index, Chat, and Explore while it is offline."}
          </p>

          {!pending && backendAvailable && (
            <Link
              href={signInHref}
              className="mx-auto mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <LogIn className="size-4" />
              Sign in to Teams
            </Link>
          )}
          {!pending && !backendAvailable && (
            <Link
              href="/"
              className="mx-auto mt-6 inline-flex h-10 items-center justify-center rounded-lg border px-5 text-sm font-medium text-foreground hover:bg-card"
            >
              Return to workspace
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
