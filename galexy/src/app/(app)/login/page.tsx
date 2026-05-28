/**
 * Sign-in surface for memux. Single button, Google-only for MVP.
 *
 * `authClient.signIn.social` does the POST to /api/auth/sign-in/social,
 * receives the OAuth state cookie (browser stores it), and then redirects
 * the browser to Google. After consent, Google → /api/auth/callback/google
 * (on the Worker) → session cookie set → redirect to callbackURL (back
 * here on the frontend).
 *
 * If already signed in, bounce to `?next=` or `/`.
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { authClient, useSession } from "@/lib/auth/client";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const { data, isPending } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && data?.user) {
      router.replace(next);
    }
  }, [isPending, data?.user, next, router]);

  async function handleGoogle() {
    setSubmitting(true);
    setError(null);
    try {
      const callbackURL =
        typeof window === "undefined" ? next : new URL(next, window.location.origin).toString();
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL,
      });
      // SDK normally navigates the window itself. If it didn't (returned
      // a url without redirecting), do it manually.
      if (result?.data && "url" in result.data && result.data.url) {
        window.location.href = result.data.url;
      }
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : "Sign-in failed");
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-background p-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            MEMUX · convulsions
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Sign in to continue
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Teams, sync, and shared spaces use your memux account. The vault on
            this device stays local either way.
          </p>
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={submitting || isPending}
          className="flex w-full items-center justify-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-card/80 disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <GoogleMark />
          )}
          Continue with Google
        </button>

        {error && (
          <p className="mt-4 text-center text-xs text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7C13.42 14.62 18.27 10.75 24 10.75z"
      />
    </svg>
  );
}
