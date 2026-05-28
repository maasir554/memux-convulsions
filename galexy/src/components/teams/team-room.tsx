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

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  File as FileIcon,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Send,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import dynamic from "next/dynamic";

import { useSession } from "@/lib/auth/client";
import { attachmentUrl, teamsApi, ApiError } from "@/lib/teams/api";
import { useTeamRoom } from "@/lib/teams/use-team-room";
import { AttachmentModal } from "@/components/teams/attachment-modal";

// Lazy-load: react-pdf is ~600KB minified; we only ever need it when the
// chat actually contains a PDF attachment.
const PdfThumb = dynamic(
  () => import("@/components/teams/pdf-thumb").then((m) => m.PdfThumb),
  {
    ssr: false,
    loading: () => (
      <div className="flex w-56 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading PDF…
      </div>
    ),
  },
);
import type {
  ChatAttachment,
  ChatMessage,
  TeamDetail,
  TeamMember,
} from "@/lib/teams/types";
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [modalAttachment, setModalAttachment] = useState<ChatAttachment | null>(null);
  const canInvite = team.myRole === "owner" || team.myRole === "admin";

  // Build a lookup so the message rows can resolve sender → live presence info.
  const memberById = useMemo(() => {
    const m = new Map<string, TeamMember>();
    for (const member of team.members) m.set(member.userId, member);
    return m;
  }, [team.members]);

  // Whole-shell drag-drop. Files dragged onto ANY part of the room get
  // forwarded to the composer's upload pipeline. We track depth (enter -
  // leave) instead of a single boolean because dragenter fires once per
  // child element you cross — a naive boolean would flicker as the cursor
  // moves over message rows.
  const composerRef = useRef<ComposerHandle | null>(null);
  const dragDepth = useRef(0);
  const [draggingFiles, setDraggingFiles] = useState(false);

  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types ?? []).includes("Files");

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDraggingFiles(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDraggingFiles(false);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); // required so onDrop fires
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDraggingFiles(false);
    if (e.dataTransfer.files.length > 0) {
      composerRef.current?.addFiles(e.dataTransfer.files);
    }
  }, []);

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col bg-background"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
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
        <div className="ml-auto flex items-center gap-2">
          {canInvite && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus className="mr-1 size-3.5" /> Invite
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide members" : "Show members"}
            aria-label={sidebarOpen ? "Hide members panel" : "Show members panel"}
            aria-pressed={sidebarOpen}
          >
            {sidebarOpen ? (
              <PanelRightClose className="size-4" />
            ) : (
              <PanelRightOpen className="size-4" />
            )}
          </Button>
        </div>
      </header>

      {/* Body: messages | presence */}
      <div className="flex min-h-0 flex-1">
        <MessageList
          messages={room.messages}
          myId={room.myId}
          onDelete={room.deleteMessage}
          onAttachmentClick={setModalAttachment}
        />
        <PresenceSidebar
          members={team.members}
          online={room.presence}
          myId={room.myId}
          open={sidebarOpen}
        />
      </div>

      {/* Composer */}
      <Composer
        ref={composerRef}
        disabled={room.status !== "open"}
        teamId={team.id}
        onSend={(body, atts) => room.send(body, atts)}
      />

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        teamId={team.id}
      />

      <AttachmentModal
        attachment={modalAttachment}
        onClose={() => setModalAttachment(null)}
      />

      {/* Drag-drop overlay. Pointer-events:none so dragleave still resolves
          correctly against the underlying shell when the cursor exits. */}
      {draggingFiles && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-primary/60 bg-card/80 px-10 py-8 text-center">
            <Upload className="mx-auto size-8 text-primary" />
            <div className="mt-3 text-sm font-medium">Drop to attach</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Files up to 25 MB
            </div>
          </div>
        </div>
      )}

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
  onDelete,
  onAttachmentClick,
}: {
  messages: ChatMessage[];
  myId: string | null;
  onDelete: (id: string, createdAt: string) => boolean;
  onAttachmentClick: (a: ChatAttachment) => void;
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
      className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-3"
    >
      {/* Width cap — keep messages readable on a wide monitor. */}
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-0.5">
        {messages.length === 0 ? (
          <div className="my-auto text-center text-xs text-muted-foreground">
            No messages yet. Say hi.
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = i > 0 ? messages[i - 1] : null;
            // "Continuous same person" — collapse the header + avatar.
            // Time isn't a factor anymore because each bubble carries
            // its own timestamp; a multi-hour gap stays legible.
            const sameSender = prev && prev.senderId === m.senderId;
            const isMine = m.senderId === myId;
            return (
              <MessageRow
                key={m.id}
                msg={m}
                compact={Boolean(sameSender)}
                isMine={isMine}
                onDelete={isMine ? () => onDelete(m.id, m.createdAt) : undefined}
                onAttachmentClick={onAttachmentClick}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function MessageRow({
  msg,
  compact,
  isMine,
  onDelete,
  onAttachmentClick,
}: {
  msg: ChatMessage;
  compact: boolean;
  isMine: boolean;
  /** Provided only when the viewer can delete this message (currently: own messages). */
  onDelete?: () => boolean;
  onAttachmentClick: (a: ChatAttachment) => void;
}) {
  function handleDelete() {
    if (!onDelete) return;
    if (!window.confirm("Delete this message? Attached files will also be removed.")) return;
    onDelete();
  }

  return (
    <div
      className={cn(
        "group flex gap-2.5",
        compact ? "mt-0.5" : "mt-3",
        isMine && "flex-row-reverse",
      )}
    >
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
      <div
        className={cn(
          "flex min-w-0 max-w-[80%] flex-col",
          isMine ? "items-end" : "items-start",
        )}
      >
        {!compact && (
          <div className="mb-0.5">
            <span className="text-sm font-medium">{msg.senderName}</span>
          </div>
        )}
        {msg.body && (
          <div
            className={cn(
              "flex items-center gap-1.5",
              isMine && "flex-row-reverse",
            )}
          >
            <div
              className={cn(
                "rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words",
                isMine
                  ? "bg-primary/15 text-foreground"
                  : "bg-muted/60 text-foreground/90",
              )}
            >
              {msg.body}
              {/* Trailing timestamp inside the bubble, iMessage-style.
                  Inline-block so a long message wraps the time onto a
                  fresh line right-aligned instead of forcing the bubble
                  to be one giant row. */}
              <span className="ml-2 inline-block translate-y-0.5 text-[10px] text-muted-foreground/70 align-baseline">
                {formatTime(msg.createdAt)}
              </span>
            </div>
            {onDelete && (
              <DeleteButton onClick={handleDelete} />
            )}
          </div>
        )}
        {msg.attachments && msg.attachments.length > 0 && (
          <div
            className={cn(
              "mt-1 flex flex-wrap items-end gap-2",
              isMine && "flex-row-reverse",
            )}
          >
            {msg.attachments.map((a) => (
              <AttachmentTile
                key={a.key}
                attachment={a}
                onClick={() => onAttachmentClick(a)}
              />
            ))}
            {/* When there's no body, the trash lives next to the
                attachments so image-only messages are still deletable. */}
            {!msg.body && onDelete && (
              <DeleteButton onClick={handleDelete} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Delete message"
      title="Delete message"
      className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100 focus:opacity-100"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

function AttachmentTile({
  attachment,
  onClick,
}: {
  attachment: ChatAttachment;
  onClick: () => void;
}) {
  const url = attachmentUrl(attachment.key);
  const isImage = attachment.contentType.startsWith("image/");
  const isPdf =
    attachment.contentType === "application/pdf" ||
    attachment.filename.toLowerCase().endsWith(".pdf");

  if (isImage) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={`${attachment.filename} — open preview`}
        className="block max-w-xs overflow-hidden rounded-md border bg-card text-left transition hover:ring-2 hover:ring-primary/40"
      >
        {/* Same-origin via the /api/attachments rewrite, so the browser
            sends the session cookie automatically — no crossOrigin needed. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={attachment.filename}
          className="block max-h-72 w-auto"
        />
      </button>
    );
  }

  // PDFs get a real first-page poster — the heavy react-pdf chunk only
  // loads when there's a PDF in view (lazy module).
  if (isPdf) {
    return (
      <PdfThumb
        url={url}
        filename={attachment.filename}
        sizeLabel={formatBytes(attachment.size)}
        onClick={onClick}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${attachment.filename} — open preview`}
      className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs text-foreground/90 transition hover:bg-card/80 hover:ring-2 hover:ring-primary/40"
    >
      <FileIcon className="size-3.5 text-muted-foreground" />
      <span className="max-w-[16rem] truncate">{attachment.filename}</span>
      <span className="text-muted-foreground">{formatBytes(attachment.size)}</span>
    </button>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
  open,
}: {
  members: TeamMember[];
  online: Set<string>;
  myId: string | null;
  /** When false the panel slides closed (width → 0). md+ only; below md the
   *  panel is hidden regardless to keep the chat usable on phones. */
  open: boolean;
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
    <aside
      className={cn(
        // The width transition is the toggle effect. Border + child overflow
        // are clipped while collapsed so the chat doesn't shift width.
        "hidden shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground transition-[width,border-left-width] duration-200 md:flex",
        open ? "w-56 border-l" : "w-0 border-l-0",
      )}
      aria-hidden={!open}
    >
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

/**
 * Pending attachment: tracks the local File + upload progress + the
 * server-returned ChatAttachment once upload finishes. Render a
 * skeleton chip while uploading; replace with the real chip on done.
 */
interface PendingAttachment {
  id: string;             // local-only key for React lists
  file: File;
  status: "uploading" | "done" | "error";
  attachment?: ChatAttachment;
  error?: string;
}

/** Imperative surface RoomShell uses to forward dropped files into the
 *  composer's existing upload pipeline. */
interface ComposerHandle {
  addFiles: (files: Iterable<File>) => void;
}

interface ComposerProps {
  disabled: boolean;
  teamId: string;
  onSend: (body: string, attachments?: ChatAttachment[]) => boolean;
}

const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { disabled, teamId, onSend },
  ref,
) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasUploading = pending.some((p) => p.status === "uploading");
  const ready = pending.filter((p) => p.status === "done" && p.attachment);
  const canSend =
    !disabled && !hasUploading && (value.trim().length > 0 || ready.length > 0);

  const submit = useCallback(() => {
    if (!canSend) return;
    const text = value.trim();
    const atts = ready.map((p) => p.attachment!);
    if (onSend(text, atts.length > 0 ? atts : undefined)) {
      setValue("");
      setPending([]);
    }
  }, [canSend, value, ready, onSend]);

  // Auto-grow up to 8 lines. Also derive multi-line state here so the
  // render path never reaches for the ref synchronously.
  const [isMultiLine, setIsMultiLine] = useState(false);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.min(ta.scrollHeight, 200);
    ta.style.height = `${next}px`;
    setIsMultiLine(next > 44);
  }, [value]);

  const handleFiles = useCallback(
    async (files: Iterable<File> | null) => {
      if (!files) return;
      const list = Array.from(files);
      if (list.length === 0) return;
      const additions: PendingAttachment[] = list.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        status: "uploading",
      }));
      setPending((prev) => [...prev, ...additions]);

      for (const item of additions) {
        try {
          const attachment = await teamsApi.uploadAttachment(teamId, item.file);
          setPending((prev) =>
            prev.map((p) =>
              p.id === item.id ? { ...p, status: "done", attachment } : p,
            ),
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Upload failed";
          setPending((prev) =>
            prev.map((p) =>
              p.id === item.id ? { ...p, status: "error", error: message } : p,
            ),
          );
        }
      }
    },
    [teamId],
  );

  useImperativeHandle(
    ref,
    () => ({
      addFiles: (files) => void handleFiles(files),
    }),
    [handleFiles],
  );

  return (
    <div className="shrink-0 border-t bg-background p-3">
      {/* Narrower than the message column — chat bars read better tight. */}
      <div className="mx-auto w-full max-w-2xl">
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((p) => (
              <PendingChip
                key={p.id}
                pending={p}
                onRemove={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
              />
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          {/* Circular attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            title="Attach files"
            aria-label="Attach files"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-card text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Paperclip className="size-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
          {/* Capsule input — flex item, expands with content */}
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={disabled ? "Connecting…" : "Type a message…"}
            disabled={disabled}
            rows={1}
            className={cn(
              "flex-1 resize-none border bg-card px-4 py-2 text-sm leading-5 outline-none transition-[border-radius] focus:ring-1 focus:ring-ring/50 disabled:opacity-60",
              isMultiLine ? "rounded-2xl" : "rounded-full",
            )}
          />
          {/* Circular send button — primary fill */}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            title="Send"
            aria-label="Send"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {hasUploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4 -translate-x-px translate-y-px" />
            )}
          </button>
        </div>
        <div className="mt-1.5 text-center text-[10px] text-muted-foreground">
          Enter sends · Shift+Enter for newline · drag &amp; drop files anywhere · 25 MB max
        </div>
      </div>
    </div>
  );
});

function PendingChip({
  pending,
  onRemove,
}: {
  pending: PendingAttachment;
  onRemove: () => void;
}) {
  const sizeLabel = formatBytes(pending.file.size);
  const isImage = pending.file.type.startsWith("image/");

  // Local preview for images. Lazy-init so the URL is computed once per
  // chip; the cleanup effect revokes it when this chip unmounts (remove
  // or send) — important on mobile to free the blob.
  const [previewUrl] = useState<string | null>(() =>
    pending.file.type.startsWith("image/") ? URL.createObjectURL(pending.file) : null,
  );
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // Image variant: thumbnail tile with overlay status + remove button.
  if (isImage) {
    return (
      <div
        className={cn(
          "group relative size-16 overflow-hidden rounded-md border bg-card",
          pending.status === "error" && "border-destructive/40",
        )}
        title={`${pending.file.name} · ${sizeLabel}`}
      >
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={pending.file.name}
            className="size-full object-cover"
          />
        )}
        {pending.status === "uploading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50">
            <Loader2 className="size-4 animate-spin text-foreground" />
          </div>
        )}
        {pending.status === "error" && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-destructive/20 text-[10px] font-semibold text-destructive uppercase"
            title={pending.error}
          >
            err
          </div>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-foreground/80 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100"
        >
          <X className="size-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1 text-xs",
        pending.status === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "bg-card",
      )}
    >
      {pending.status === "uploading" ? (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      ) : pending.status === "error" ? (
        <span className="text-[10px] font-semibold uppercase">err</span>
      ) : (
        <FileIcon className="size-3.5 text-muted-foreground" />
      )}
      <span className="max-w-[12rem] truncate">{pending.file.name}</span>
      <span className="text-muted-foreground">{sizeLabel}</span>
      {pending.status === "error" && (
        <span className="text-[10px]" title={pending.error}>
          {pending.error}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Remove"
      >
        <X className="size-3" />
      </button>
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
