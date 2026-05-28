import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MEMUX",
  description:
    "MEMUX dashboard — index, chat, and browse the convulsions superapp.",
};

export default function MemuxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex h-full min-h-0 flex-col">{children}</div>;
}
