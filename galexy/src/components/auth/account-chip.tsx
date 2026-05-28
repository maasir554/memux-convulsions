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
import { LogOut } from "lucide-react";

import { authClient, useSession } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

export function AccountChip() {
  const router = useRouter();
  const { data, isPending } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  if (isPending) {
    return <div className="size-8 animate-pulse rounded-full bg-muted" aria-hidden />;
  }

  if (!data?.user) {
    return (
      <Link
        href="/login"
        className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card hover:text-foreground"
      >
        Sign in
      </Link>
    );
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
    <div className="flex items-center gap-2">
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.image}
          alt=""
          className="size-7 rounded-full ring-1 ring-border"
        />
      ) : (
        <div className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold ring-1 ring-border">
          {user.name?.[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      <span className="text-xs font-medium text-foreground/90">{user.name}</span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className={cn(
          "rounded-md p-1 text-muted-foreground hover:bg-card hover:text-foreground",
          signingOut && "opacity-50",
        )}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className="size-3.5" />
      </button>
    </div>
  );
}
