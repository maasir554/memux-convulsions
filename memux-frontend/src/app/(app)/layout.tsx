import type { Metadata } from "next";

import { UnifiedShell } from "@/components/unified-shell";

export const metadata: Metadata = {
  title: "MEMUX",
  description:
    "MEMUX dashboard — index, chat, and browse the convulsions superapp.",
};

/**
 * One persistent MEMUX shell wraps every authenticated route. Individual
 * products contribute contextual navigation into the shell's middle slot,
 * while the high-level mode switcher and global controls remain stable.
 */
export default function MemuxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <UnifiedShell>{children}</UnifiedShell>;
}
