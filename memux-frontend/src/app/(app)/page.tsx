"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Files,
  FolderSearch,
  MessageSquare,
  Send,
  Sparkles,
  Users,
} from "lucide-react";

import { ShellSidebar } from "@/components/unified-shell";
import { cn } from "@/lib/utils";
import { useStore } from "@/memux/chat/lib/store";

const FEATURES = [
  {
    href: "/indexer",
    label: "Index knowledge",
    sub: "Turn files and context into a searchable collection.",
    Icon: Files,
    tone: "text-amber-300 bg-amber-300/10",
  },
  {
    href: "/chat",
    label: "Ask MEMUX",
    sub: "Think with your knowledge and a local or cloud model.",
    Icon: Sparkles,
    tone: "text-emerald-300 bg-emerald-300/10",
  },
  {
    href: "/vault",
    label: "Explore knowledge",
    sub: "Move through notes, documents, links, and graphs.",
    Icon: FolderSearch,
    tone: "text-violet-300 bg-violet-300/10",
  },
  {
    href: "/teams",
    label: "Work with a team",
    sub: "Open a shared space and continue the conversation.",
    Icon: Users,
    tone: "text-sky-300 bg-sky-300/10",
  },
] as const;

const STARTERS = [
  "Summarize what I worked on recently",
  "Find connections across my notes",
  "Help me plan my next project",
];

export default function MemuxHome() {
  const router = useRouter();
  const newChat = useStore((state) => state.newChat);
  const chats = useStore((state) => state.chats);
  const selectChat = useStore((state) => state.selectChat);
  const [prompt, setPrompt] = useState("");

  function startChat(text: string) {
    const value = text.trim();
    if (!value) return;
    newChat();
    window.sessionStorage.setItem("memux.pending-prompt", value);
    router.push("/chat");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    startChat(prompt);
  }

  return (
    <>
      <ShellSidebar>
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-sidebar-border px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Start here</div>
            <div className="mt-1 text-sm font-medium">Your MEMUX workspace</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {FEATURES.map(({ href, label, Icon }) => (
              <Link key={href} href={href} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
                <Icon className="size-4" />
                <span>{label}</span>
                <ArrowRight className="ml-auto size-3 opacity-40" />
              </Link>
            ))}
            {chats.length > 0 && (
              <div className="mt-5">
                <div className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recent chats</div>
                {chats.slice(0, 5).map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => {
                      selectChat(chat.id);
                      router.push("/chat");
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  >
                    <MessageSquare className="size-3.5 shrink-0" />
                    <span className="truncate">{chat.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </ShellSidebar>

      <main className="relative min-h-0 flex-1 overflow-y-auto bg-background">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_50%_-10%,color-mix(in_oklab,var(--foreground)_8%,transparent),transparent_64%)]" />
        <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col justify-center px-5 py-10 lg:px-10">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              Your work, connected.
            </h1>
            <p className="mt-4 text-sm leading-6 text-muted-foreground sm:text-base">
              Welcome back. What would you like to work on?
            </p>
          </div>

          <div className="mx-auto mt-9 w-full max-w-3xl">
            <form
              onSubmit={onSubmit}
              className="rounded-2xl bg-muted/45 p-2 shadow-[0_18px_70px_-32px_rgba(0,0,0,0.65)] backdrop-blur"
            >
              <div className="flex items-end gap-2">
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      startChat(prompt);
                    }
                  }}
                  rows={2}
                  placeholder="Ask MEMUX anything about your work…"
                  aria-label="Start a conversation"
                  className="max-h-40 min-h-16 flex-1 resize-none bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground/70"
                />
                <button
                  type="submit"
                  disabled={!prompt.trim()}
                  className="mb-1 flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity disabled:opacity-30"
                  aria-label="Start chat"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </form>

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => startChat(starter)}
                  className="rounded-full bg-muted/60 px-3 py-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ href, label, sub, Icon, tone }) => (
              <Link
                key={href}
                href={href}
                className="group rounded-2xl bg-muted/40 p-4 transition-all hover:-translate-y-0.5 hover:bg-muted/65"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={cn("flex size-9 items-center justify-center rounded-xl", tone)}>
                    <Icon className="size-4" />
                  </div>
                  <div className="flex size-8 items-center justify-center rounded-full bg-background/70 text-muted-foreground transition-colors group-hover:bg-background group-hover:text-foreground">
                    <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                </div>
                <div className="mt-4 text-sm font-medium">{label}</div>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{sub}</p>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
