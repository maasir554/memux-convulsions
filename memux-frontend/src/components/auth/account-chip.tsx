/**
 * Tiny client island shown in the launcher header. Three states:
 *   - loading      → muted skeleton dot
 *   - signed out   → "Sign in" link to /login
 *   - signed in    → avatar + name, click to sign out
 *
 * Avatar uses a plain <img> rather than next/image because Google's
 * lh3.googleusercontent.com host isn't in next.config domains, and we
 * don't gain anything from optimisation for a 28px avatar.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogIn, LogOut } from "lucide-react";

import { authClient, useSession } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

export function AccountChip({
  backendAvailable,
  compact = false,
}: {
  backendAvailable: boolean | null;
  compact?: boolean;
}) {
  if (backendAvailable === null) {
    return (
      <div
        className={cn(
          "h-9 animate-pulse rounded-lg bg-muted",
          compact ? "w-9" : "w-full",
        )}
        aria-hidden
      />
    );
  }

  if (!backendAvailable) return <SignedOutAccount compact={compact} />;

  return <ConnectedAccountChip compact={compact} />;
}

function SignedOutAccount({ compact }: { compact: boolean }) {
  return (
    <Link
      href="/login"
      className={cn(
        "flex h-9 min-w-0 items-center gap-2 rounded-lg text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
        compact ? "w-9 justify-center" : "w-full px-2",
      )}
      title="Sign in"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
        <LogIn className="size-3.5" />
      </span>
      {!compact && <span className="truncate font-medium">Sign in</span>}
    </Link>
  );
}

function ConnectedAccountChip({ compact }: { compact: boolean }) {
  const router = useRouter();
  const { data, isPending } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  if (isPending) {
    return <div className="size-9 animate-pulse rounded-lg bg-muted" aria-hidden />;
  }

  if (!data?.user) {
    return <SignedOutAccount compact={compact} />;
  }

  const { user } = data;

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className={cn("flex h-9 min-w-0 items-center", compact ? "justify-center" : "gap-2 px-1")}>
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.image}
          alt=""
          // Google's avatar CDN (lh3.googleusercontent.com) rate-limits per
          // Referer host. In dev, React StrictMode + HMR bursts requests
          // quickly enough to trip 429s. Sending no Referer makes Google
          // serve the image like any anonymous view.
          referrerPolicy="no-referrer"
          className="size-7 rounded-full ring-1 ring-border"
        />
      ) : (
        <div className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold ring-1 ring-border">
          {user.name?.[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      {!compact && (
        <>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">
            {user.name}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className={cn(
              "shrink-0 rounded-md p-1 text-muted-foreground hover:bg-card hover:text-foreground",
              signingOut && "opacity-50",
            )}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
