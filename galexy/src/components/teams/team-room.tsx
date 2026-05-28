/**
 * TeamRoom — the actual chat surface.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ header: ← Teams · <team name> · <status dot> · invite button │
 *   ├────────────────────────────────────────┬─────────────────────┤
 *   │ message list (scrolls)                 │ presence sidebar    │
 *   │                                        │ (online: …)         │
 *   ├────────────────────────────────────────┴─────────────────────┤
 *   │ composer (Enter sends, Shift+Enter newline)                  │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Live updates: useTeamRoom() owns the WebSocket. Initial team detail
 * (members, name, role) comes from the REST API since the DO knows
 * about messages + presence but NOT about D1 membership/roles.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Loader2, Send, UserPlus, Users } from "lucide-react";

import { useSession } from "@/lib/auth/client";
import { teamsApi, ApiError } from "@/lib/teams/api";
import { useTeamRoom } from "@/lib/teams/use-team-room";
import type { ChatMessage, TeamDetail, TeamMember } from "@/lib/teams/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function TeamRoom({ teamId }: { teamId: string }) {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();

  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Auth gate.
  useEffect(() => {
    if (!sessionPending && !session?.user) {
      router.replace(`/login?next=/teams/${teamId}`);
    }
  }, [sessionPending, session?.user, router, teamId]);

  // Initial team detail (members + role).
  useEffect(() => {
    if (!session?.user) return;
    let cancelled = false;
    teamsApi
      .detail(teamId)
      .then(({ team }) => {
        if (!cancelled) setDetail(team);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setDetailError("You aren't a member of this team — or it doesn't exist.");
        } else {
          setDetailError(e instanceof Error ? e.message : "Failed to load team");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, session?.user]);

  const room = useTeamRoom(detail ? teamId : null);

  if (sessionPending || !session?.user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (detailError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="max-w-md text-sm text-muted-foreground">{detailError}</p>
        <Link href="/teams" className="text-xs underline">
          Back to teams
        </Link>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <RoomShell team={detail} room={room} />;
}

// ─────────────────────────────────────────────────────────────────────────
// Inner shell — narrower contract, easier to skim
// ─────────────────────────────────────────────────────────────────────────

function RoomShell({
  team,
  room,
}: {
  team: TeamDetail;
  room: ReturnType<typeof useTeamRoom>;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const canInvite = team.myRole === "owner" || team.myRole === "admin";

  // Build a lookup so the message rows can resolve sender → live presence info.
  const memberById = useMemo(() => {
    const m = new Map<string, TeamMember>();
    for (const member of team.members) m.set(member.userId, member);
    return m;
  }, [team.members]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Link
          href="/teams"
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Teams
        </Link>
        <div className="truncate text-sm font-medium">{team.name}</div>
        <StatusDot status={room.status} />
        <span className="text-xs text-muted-foreground">
          {team.members.length} member{team.members.length === 1 ? "" : "s"}
        </span>
        {canInvite && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7"
            onClick={() => setInviteOpen(true)}
          >
            <UserPlus className="mr-1 size-3.5" /> Invite
          </Button>
        )}
      </header>

      {/* Body: messages | presence */}
      <div className="flex min-h-0 flex-1">
        <MessageList messages={room.messages} myId={room.myId} />
        <PresenceSidebar
          members={team.members}
          online={room.presence}
          myId={room.myId}
        />
      </div>

      {/* Composer */}
      <Composer
        disabled={room.status !== "open"}
        onSend={(body) => room.send(body)}
      />

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        teamId={team.id}
      />

      {/* Quiet the unused-import warning if we ever stop using memberById */}
      <span hidden>{memberById.size}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Status dot
// ─────────────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: "connecting" | "open" | "closed" | "error" }) {
  const color =
    status === "open"
      ? "bg-emerald-500"
      : status === "connecting"
        ? "bg-amber-500 animate-pulse"
        : "bg-destructive";
  const label =
    status === "open"
      ? "Connected"
      : status === "connecting"
        ? "Connecting…"
        : status === "error"
          ? "Connection error"
          : "Disconnected";
  return (
    <span className="flex items-center gap-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
      <span className={cn("size-1.5 rounded-full", color)} />
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Message list
// ─────────────────────────────────────────────────────────────────────────

function MessageList({
  messages,
  myId,
}: {
  messages: ChatMessage[];
  myId: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickyBottomRef = useRef(true);

  // Track whether the user is currently pinned to the bottom. If yes,
  // auto-scroll on new messages. If they've scrolled up, leave them alone.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyBottomRef.current = dist < 80;
    }
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickyBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto px-4 py-3"
    >
      {messages.length === 0 ? (
        <div className="my-auto text-center text-xs text-muted-foreground">
          No messages yet. Say hi.
        </div>
      ) : (
        messages.map((m, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const sameSender =
            prev && prev.senderId === m.senderId &&
            Date.parse(m.createdAt) - Date.parse(prev.createdAt) < 5 * 60_000;
          return (
            <MessageRow
              key={m.id}
              msg={m}
              compact={Boolean(sameSender)}
              isMine={m.senderId === myId}
            />
          );
        })
      )}
    </div>
  );
}

function MessageRow({
  msg,
  compact,
  isMine,
}: {
  msg: ChatMessage;
  compact: boolean;
  isMine: boolean;
}) {
  return (
    <div className={cn("flex gap-2.5", compact ? "mt-0.5" : "mt-3")}>
      <div className="w-8 shrink-0">
        {!compact &&
          (msg.senderImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={msg.senderImage}
              alt=""
              referrerPolicy="no-referrer"
              className="size-7 rounded-full ring-1 ring-border"
            />
          ) : (
            <div className="flex size-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold ring-1 ring-border">
              {msg.senderName?.[0]?.toUpperCase() ?? "?"}
            </div>
          ))}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className={cn("text-sm font-medium", isMine && "text-foreground")}>
              {msg.senderName}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatTime(msg.createdAt)}
            </span>
          </div>
        )}
        <div className="text-sm whitespace-pre-wrap break-words text-foreground/90">
          {msg.body}
        </div>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─────────────────────────────────────────────────────────────────────────
// Presence sidebar
// ─────────────────────────────────────────────────────────────────────────

function PresenceSidebar({
  members,
  online,
  myId,
}: {
  members: TeamMember[];
  online: Set<string>;
  myId: string | null;
}) {
  // Sort: me first, then online, then offline. Within each group, alphabetic.
  const sorted = useMemo(() => {
    const copy = [...members];
    copy.sort((a, b) => {
      if (a.userId === myId) return -1;
      if (b.userId === myId) return 1;
      const aOn = online.has(a.userId);
      const bOn = online.has(b.userId);
      if (aOn !== bOn) return aOn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return copy;
  }, [members, online, myId]);

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Users className="size-3.5" /> Members
        <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
          {online.size}/{members.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {sorted.map((m) => {
          const isOnline = online.has(m.userId);
          return (
            <div
              key={m.userId}
              className="flex items-center gap-2 rounded-md px-1.5 py-1.5"
            >
              <div className="relative">
                {m.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.image}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="size-6 rounded-full ring-1 ring-border"
                  />
                ) : (
                  <div className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold ring-1 ring-border">
                    {m.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <span
                  className={cn(
                    "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-sidebar",
                    isOnline ? "bg-emerald-500" : "bg-muted-foreground/40",
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">
                  {m.name}
                  {m.userId === myId && (
                    <span className="ml-1 text-muted-foreground">(you)</span>
                  )}
                </div>
                <div className="text-[10px] tracking-wide text-muted-foreground uppercase">
                  {m.role}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Composer
// ─────────────────────────────────────────────────────────────────────────

function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (body: string) => boolean;
}) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    if (onSend(text)) setValue("");
  }, [value, disabled, onSend]);

  // Auto-grow up to 8 lines.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  return (
    <div className="shrink-0 border-t bg-background p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter newlines. Cmd/Ctrl+Enter also sends
            // for users with Slack-style muscle memory.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? "Connecting…" : "Type a message…  (Enter to send)"}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring/50 disabled:opacity-60"
        />
        <Button onClick={submit} disabled={disabled || !value.trim()}>
          <Send className="size-3.5" />
        </Button>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        @userId mentions are stored on the message and will route notifications
        later.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Invite dialog — generates an invite link and shows the code
// ─────────────────────────────────────────────────────────────────────────

function InviteDialog({
  open,
  onOpenChange,
  teamId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  teamId: string;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(null);
      setError(null);
      setGenerating(false);
      setCopied(false);
    }
  }, [open]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const { invite } = await teamsApi.createInvite(teamId, {
        expiresInHours: 24,
      });
      setCode(invite.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setGenerating(false);
    }
  }

  function copy() {
    if (!code) return;
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to this team</DialogTitle>
          <DialogDescription>
            Generate a one-time-shareable code. Expires in 24 hours.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4">
          {!code ? (
            <Button onClick={generate} disabled={generating} className="w-full">
              {generating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                "Generate invite"
              )}
            </Button>
          ) : (
            <div className="flex items-center gap-2 rounded-md border bg-card p-3">
              <code className="flex-1 font-mono text-sm break-all">{code}</code>
              <Button size="sm" variant="outline" onClick={copy}>
                <Copy className="mr-1 size-3.5" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
