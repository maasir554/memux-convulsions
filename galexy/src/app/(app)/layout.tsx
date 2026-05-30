import type { Metadata } from "next";

import { AppRail } from "@/components/app-rail";

export const metadata: Metadata = {
  title: "MEMUX",
  description:
    "MEMUX dashboard — index, chat, and browse the convulsions superapp.",
};

/**
 * Authenticated-app layout. Lays out a thin top-level icon rail on the
 * left edge of every page in the `(app)` route group, with the actual
 * page content filling the rest of the viewport in its original column
 * orientation.
 *
 * `min-w-0` on the content column is load-bearing: without it, any
 * inner descendant that has its own horizontal overflow (the chat
 * lane, the indexer table, etc.) would push the flex track wider than
 * the viewport and the rail would scroll out of view.
 */
export default function MemuxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0">
      <AppRail />
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
