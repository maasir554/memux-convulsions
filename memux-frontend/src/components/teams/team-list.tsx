/**
 * Teams index — list teams I'm in, with affordances to create a new team
 * or join via invite code. Server-component-wrapping-client-component:
 * the page renders <TeamList /> which manages all state client-side.
 *
 * Auth gate: useSession() resolves async. While loading we show a
 * skeleton; if there's no session we redirect to /login?next=/teams.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, UserPlus, Users } from "lucide-react";

import { useSession } from "@/lib/auth/client";
import { AccountChip } from "@/components/auth/account-chip";
import { teamsApi, ApiError } from "@/lib/teams/api";
import type { TeamSummary } from "@/lib/teams/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function TeamList() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();

  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  // Auth gate.
  useEffect(() => {
    if (!sessionPending && !session?.user) {
      router.replace("/login?next=/teams");
    }
  }, [sessionPending, session?.user, router]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { teams } = await teamsApi.list();
      setTeams(teams);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load teams");
    }
  }, []);

  useEffect(() => {
    if (session?.user) void load();
  }, [session?.user, load]);

  if (sessionPending || !session?.user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← MEMUX
        </Link>
        <div className="text-sm font-medium">Teams</div>
        <div className="text-xs text-muted-foreground">
          Real-time chat with people you invite.
        </div>
        <div className="ml-auto">
          <AccountChip />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex items-center gap-2">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 size-3.5" /> Create team
            </Button>
            <Button size="sm" variant="outline" onClick={() => setJoinOpen(true)}>
              <UserPlus className="mr-1 size-3.5" /> Join with code
            </Button>
            {teams && (
              <span className="ml-auto text-xs text-muted-foreground">
                {teams.length} team{teams.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {loadError && (
            <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {loadError}
            </p>
          )}

          {teams === null ? (
            <SkeletonGrid />
          ) : teams.length === 0 ? (
            <EmptyState
              onCreate={() => setCreateOpen(true)}
              onJoin={() => setJoinOpen(true)}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {teams.map((t) => (
                <TeamCard key={t.id} team={t} />
              ))}
            </div>
          )}
        </div>
      </div>

      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          setCreateOpen(false);
          router.push(`/teams/${id}`);
        }}
      />
      <JoinTeamDialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        onJoined={(id) => {
          setJoinOpen(false);
          router.push(`/teams/${id}`);
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────

function TeamCard({ team }: { team: TeamSummary }) {
  return (
    <Link
      href={`/teams/${team.id}`}
      className={cn(
        "group flex flex-col gap-2 rounded-lg border bg-card p-4 transition-colors",
        "hover:border-foreground/30 hover:bg-card/80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate font-medium">{team.name}</div>
        <RoleBadge role={team.role} />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="size-3.5" />
        {team.memberCount} member{team.memberCount === 1 ? "" : "s"}
      </div>
    </Link>
  );
}

function RoleBadge({ role }: { role: "owner" | "admin" | "member" }) {
  const cls =
    role === "owner"
      ? "bg-amber-500/15 text-amber-400 ring-amber-500/30"
      : role === "admin"
        ? "bg-blue-500/15 text-blue-400 ring-blue-500/30"
        : "bg-muted text-muted-foreground ring-border";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ring-1 ring-inset",
        cls,
      )}
    >
      {role}
    </span>
  );
}

function EmptyState({
  onCreate,
  onJoin,
}: {
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 p-10 text-center">
      <Users className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-3 text-base font-medium">No teams yet</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Create your first team to start a real-time chat space, or join one
        you&apos;ve been invited to.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <Button size="sm" onClick={onCreate}>
          <Plus className="mr-1 size-3.5" /> Create
        </Button>
        <Button size="sm" variant="outline" onClick={onJoin}>
          <UserPlus className="mr-1 size-3.5" /> Join with code
        </Button>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[88px] animate-pulse rounded-lg border bg-card/40"
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Dialogs
// ─────────────────────────────────────────────────────────────────────────

function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { team } = await teamsApi.create(name.trim());
      onCreated(team.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create team");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create team</DialogTitle>
            <DialogDescription>
              A team is a private chat space. You&apos;ll be the owner and can
              invite others later.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4">
            <Input
              autoFocus
              placeholder="Team name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              disabled={submitting}
            />
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function JoinTeamDialog({
  open,
  onOpenChange,
  onJoined,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onJoined: (id: string) => void;
}) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCode("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { team } = await teamsApi.join(code.trim());
      onJoined(team.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) {
        setError("That invite is expired or revoked.");
      } else if (e instanceof ApiError && e.status === 404) {
        setError("Invalid invite code.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to join");
      }
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Join a team</DialogTitle>
            <DialogDescription>
              Paste the invite code you were given. Joining is instant.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4">
            <Input
              autoFocus
              placeholder="Invite code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={submitting}
              className="font-mono"
            />
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !code.trim()}>
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                "Join"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
