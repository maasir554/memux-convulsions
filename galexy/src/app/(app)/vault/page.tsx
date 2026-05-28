import { Suspense } from "react";

import { AppShell } from "@/components/galexy/app-shell";

/**
 * <AppShell> calls useSearchParams() to consume the ?open=<itemId>
 * deep-link. Production prerender requires a Suspense boundary around
 * any client subtree that does that, otherwise the build fails with
 * "Missing Suspense boundary with useSearchParams".
 */
export default function Home() {
  return (
    <Suspense>
      <AppShell />
    </Suspense>
  );
}
