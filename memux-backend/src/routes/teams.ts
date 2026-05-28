/**
 * Teams CRUD routes.
 *
 * Authorisation model:
 *   - All routes require a session (requireUser middleware).
 *   - Membership: the caller must be in team_member to read or leave a team.
 *   - Roles: owner > admin > member.
 *       - owner   can: delete team, manage members, manage invites, leave (if not sole owner)
 *       - admin   can: manage members (except owners), manage invites
 *       - member  can: read team detail, leave
 *
 * Atomicity:
 *   D1 supports batching via env.DB.batch(); we use it for create-team
 *   (team + owner membership in one round-trip) and join-via-invite
 *   (membership insert + invite uses++).
 */

import { Hono } from "hono";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { team, teamInvite, teamMember, user } from "../db/schema";
import { getDb } from "../lib/db";
import { genId, genInviteCode } from "../lib/ids";
import { signWsToken, tokenExpiry } from "../lib/ws-token";
import { requireUser, type AuthedVariables } from "../middleware/auth";
import annotationsRouter from "./annotations";
import { teamAttachmentsRouter } from "./attachments";
import type { WorkerEnv } from "../env";

const teams = new Hono<{ Bindings: WorkerEnv; Variables: AuthedVariables }>();

teams.use("*", requireUser);

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

type Role = "owner" | "admin" | "member";

async function getMembership(env: WorkerEnv, teamId: string, userId: string) {
  const db = getDb(env);
  const row = await db
    .select({ role: teamMember.role })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .get();
  return (row?.role ?? null) as Role | null;
}

function isAdminOrOwner(role: Role | null): boolean {
  return role === "owner" || role === "admin";
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/teams — create a team. Creator becomes the owner.
// ─────────────────────────────────────────────────────────────────────────

teams.post("/", async (c) => {
  const me = c.var.user;
  const body = (await c.req.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) return c.json({ error: "name required" }, 400);
  if (name.length > 100) return c.json({ error: "name too long (max 100)" }, 400);

  const id = genId();
  const now = Math.floor(Date.now() / 1000);

  // team + owner membership in one batch — either both land or neither.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO team (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
    ).bind(id, name, me.id, now),
    c.env.DB.prepare(
      "INSERT INTO team_member (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    ).bind(id, me.id, now),
  ]);

  return c.json(
    {
      team: { id, name, createdAt: new Date(now * 1000).toISOString(), role: "owner" as Role },
    },
    201,
  );
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/teams — list teams I'm a member of, with my role + member count.
// ─────────────────────────────────────────────────────────────────────────

teams.get("/", async (c) => {
  const me = c.var.user;
  const db = getDb(c.env);

  // Drizzle doesn't infer subquery counts cleanly across providers, so use
  // a raw SQL builder. Same correctness, less generic gymnastics.
  const rows = await db
    .select({
      id: team.id,
      name: team.name,
      createdAt: team.createdAt,
      role: teamMember.role,
      memberCount: sql<number>`(SELECT COUNT(*) FROM team_member tm2 WHERE tm2.team_id = ${team.id})`,
    })
    .from(team)
    .innerJoin(teamMember, and(eq(teamMember.teamId, team.id), eq(teamMember.userId, me.id)))
    .orderBy(desc(team.createdAt))
    .all();

  return c.json({
    teams: rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: new Date(Number(r.createdAt) * 1000).toISOString(),
      role: r.role as Role,
      memberCount: Number(r.memberCount),
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/teams/:id — team detail + members (members-only)
// ─────────────────────────────────────────────────────────────────────────

teams.get("/:id", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  const role = await getMembership(c.env, teamId, me.id);
  if (!role) return c.json({ error: "not a member" }, 404);

  const db = getDb(c.env);
  const t = await db.select().from(team).where(eq(team.id, teamId)).get();
  if (!t) return c.json({ error: "team not found" }, 404);

  const members = await db
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
      role: teamMember.role,
      joinedAt: teamMember.joinedAt,
    })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(eq(teamMember.teamId, teamId))
    .orderBy(desc(teamMember.joinedAt))
    .all();

  return c.json({
    team: {
      id: t.id,
      name: t.name,
      createdAt: new Date(Number(t.createdAt) * 1000).toISOString(),
      myRole: role,
      members: members.map((m) => ({
        userId: m.userId,
        name: m.name,
        image: m.image,
        role: m.role as Role,
        joinedAt: new Date(Number(m.joinedAt) * 1000).toISOString(),
      })),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/teams/:id — owner only. Cascades to members + invites via FK.
// (Messages live on the DO and need a separate cleanup hook in Phase 4.)
// ─────────────────────────────────────────────────────────────────────────

teams.delete("/:id", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  const role = await getMembership(c.env, teamId, me.id);
  if (!role) return c.json({ error: "not a member" }, 404);
  if (role !== "owner") return c.json({ error: "owner only" }, 403);

  const db = getDb(c.env);
  await db.delete(team).where(eq(team.id, teamId));
  return c.body(null, 204);
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/teams/:id/leave — leave a team. Sole owner cannot leave.
// ─────────────────────────────────────────────────────────────────────────

teams.post("/:id/leave", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  const role = await getMembership(c.env, teamId, me.id);
  if (!role) return c.json({ error: "not a member" }, 404);

  const db = getDb(c.env);

  if (role === "owner") {
    const ownerCount = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(teamMember)
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.role, "owner")))
      .get();
    if (Number(ownerCount?.n ?? 0) <= 1) {
      return c.json(
        { error: "you are the only owner — transfer ownership or delete the team first" },
        409,
      );
    }
  }

  await db
    .delete(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, me.id)));
  return c.body(null, 204);
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/teams/:id/invites — create an invite (admin+ only)
//   body: { maxUses?: number, expiresInHours?: number }
// ─────────────────────────────────────────────────────────────────────────

teams.post("/:id/invites", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  const role = await getMembership(c.env, teamId, me.id);
  if (!isAdminOrOwner(role)) return c.json({ error: "admin or owner only" }, 403);

  const body = (await c.req.json().catch(() => ({}))) as {
    maxUses?: number;
    expiresInHours?: number;
  };
  const maxUses = body.maxUses && body.maxUses > 0 ? Math.floor(body.maxUses) : null;
  const expiresAt =
    body.expiresInHours && body.expiresInHours > 0
      ? Math.floor(Date.now() / 1000) + Math.floor(body.expiresInHours) * 3600
      : null;

  const id = genId();
  const code = genInviteCode();
  const db = getDb(c.env);
  await db.insert(teamInvite).values({
    id,
    teamId,
    code,
    createdBy: me.id,
    maxUses,
    expiresAt: expiresAt ? new Date(expiresAt * 1000) : undefined,
  });

  return c.json(
    {
      invite: {
        id,
        code,
        maxUses,
        uses: 0,
        expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
      },
    },
    201,
  );
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/teams/:id/invites — list active invites (admin+ only)
// ─────────────────────────────────────────────────────────────────────────

teams.get("/:id/invites", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  const role = await getMembership(c.env, teamId, me.id);
  if (!isAdminOrOwner(role)) return c.json({ error: "admin or owner only" }, 403);

  const db = getDb(c.env);
  const rows = await db
    .select()
    .from(teamInvite)
    .where(eq(teamInvite.teamId, teamId))
    .orderBy(desc(teamInvite.createdAt))
    .all();

  return c.json({
    invites: rows.map((r) => ({
      id: r.id,
      code: r.code,
      maxUses: r.maxUses,
      uses: r.uses,
      expiresAt: r.expiresAt ? new Date(Number(r.expiresAt) * 1000).toISOString() : null,
      createdAt: new Date(Number(r.createdAt) * 1000).toISOString(),
      revokedAt: r.revokedAt ? new Date(Number(r.revokedAt) * 1000).toISOString() : null,
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/teams/:id/invites/:inviteId — revoke (admin+ only)
// Soft-revoke via revoked_at so older shared links return a clear error.
// ─────────────────────────────────────────────────────────────────────────

teams.delete("/:id/invites/:inviteId", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  const inviteId = c.req.param("inviteId");
  const role = await getMembership(c.env, teamId, me.id);
  if (!isAdminOrOwner(role)) return c.json({ error: "admin or owner only" }, 403);

  const db = getDb(c.env);
  await db
    .update(teamInvite)
    .set({ revokedAt: new Date() })
    .where(and(eq(teamInvite.id, inviteId), eq(teamInvite.teamId, teamId)));
  return c.body(null, 204);
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/teams/join — join via { code }. Idempotent if already a member.
// ─────────────────────────────────────────────────────────────────────────

teams.post("/join", async (c) => {
  const me = c.var.user;
  const body = (await c.req.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim();
  if (!code) return c.json({ error: "code required" }, 400);

  const db = getDb(c.env);
  const invite = await db.select().from(teamInvite).where(eq(teamInvite.code, code)).get();
  if (!invite) return c.json({ error: "invalid invite" }, 404);
  if (invite.revokedAt) return c.json({ error: "invite revoked" }, 410);

  const now = Math.floor(Date.now() / 1000);
  if (invite.expiresAt && Number(invite.expiresAt) <= now) {
    return c.json({ error: "invite expired" }, 410);
  }
  if (invite.maxUses != null && invite.uses >= invite.maxUses) {
    return c.json({ error: "invite exhausted" }, 410);
  }

  // Already a member? Return the team without double-incrementing uses.
  const existing = await getMembership(c.env, invite.teamId, me.id);
  if (existing) {
    const t = await db.select().from(team).where(eq(team.id, invite.teamId)).get();
    return c.json({ team: { id: t!.id, name: t!.name }, alreadyMember: true });
  }

  // Insert membership + bump uses atomically.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO team_member (team_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    ).bind(invite.teamId, me.id, now),
    c.env.DB.prepare("UPDATE team_invite SET uses = uses + 1 WHERE id = ?").bind(invite.id),
  ]);

  const t = await db.select().from(team).where(eq(team.id, invite.teamId)).get();
  return c.json({ team: { id: t!.id, name: t!.name }, alreadyMember: false });
});

// ─────────────────────────────────────────────────────────────────────────
// TeamRoom (Phase 4) — forward to the per-team Durable Object.
//
// The DO is identified by `idFromName(teamId)` so we always hit the same
// instance for a given team. Auth + membership check happen here in the
// Worker; the DO trusts the headers we attach.
// ─────────────────────────────────────────────────────────────────────────

function teamRoomStub(env: WorkerEnv, teamId: string) {
  return env.TEAM_ROOM.get(env.TEAM_ROOM.idFromName(teamId));
}

function withUserHeaders(headers: Headers, user: { id: string; name: string; image: string | null }) {
  const h = new Headers(headers);
  h.set("x-memux-user-id", user.id);
  h.set("x-memux-user-name", user.name);
  if (user.image) h.set("x-memux-user-image", user.image);
  return h;
}

// GET /api/teams/:id/ws-token — mint a short-lived signed token the browser
// uses to authenticate the WebSocket upgrade. This endpoint sits behind
// session auth (HTTP, cookie reaches it via the Vercel rewrite); the token
// it returns survives a direct cross-origin WS connection to workers.dev.
teams.get("/:id/ws-token", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  const role = await getMembership(c.env, teamId, me.id);
  if (!role) return c.json({ error: "not a member" }, 404);

  const exp = tokenExpiry();
  const token = await signWsToken(c.env.BETTER_AUTH_SECRET, {
    teamId,
    userId: me.id,
    userName: me.name,
    userImage: me.image,
    exp,
  });
  return c.json({ token, expiresAt: new Date(exp * 1000).toISOString() });
});

// GET /api/teams/:id/ws — WebSocket upgrade into the TeamRoom DO.
// Auth: either the session cookie OR `?ws_token=` issued above. See the
// requireUser middleware for the dispatch logic.
teams.get("/:id/ws", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  const role = await getMembership(c.env, teamId, me.id);
  if (!role) return c.json({ error: "not a member" }, 404);
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("expected websocket upgrade", 426);
  }
  const stub = teamRoomStub(c.env, teamId);
  return stub.fetch(
    new Request("https://do/ws", {
      method: "GET",
      headers: withUserHeaders(c.req.raw.headers, me),
    }),
  );
});

// GET /api/teams/:id/messages?before=<msgKey>&limit=50 — history pagination.
teams.get("/:id/messages", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  const role = await getMembership(c.env, teamId, me.id);
  if (!role) return c.json({ error: "not a member" }, 404);

  const params = new URLSearchParams();
  const before = c.req.query("before");
  const limit = c.req.query("limit");
  if (before) params.set("before", before);
  if (limit) params.set("limit", limit);

  const stub = teamRoomStub(c.env, teamId);
  return stub.fetch(
    new Request(`https://do/messages?${params.toString()}`, {
      method: "GET",
      headers: withUserHeaders(c.req.raw.headers, me),
    }),
  );
});

// POST /api/teams/:id/messages { body } — REST fallback for sending.
// (Live chat uses the WebSocket; this is for scripts and tests.)
teams.post("/:id/messages", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  const role = await getMembership(c.env, teamId, me.id);
  if (!role) return c.json({ error: "not a member" }, 404);

  const stub = teamRoomStub(c.env, teamId);
  return stub.fetch(
    new Request("https://do/messages", {
      method: "POST",
      headers: withUserHeaders(c.req.raw.headers, me),
      body: c.req.raw.body,
    }),
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Attachments (Phase 4b) — mounted as a sub-router.
// POST /api/teams/:id/attachments  (multipart "file" → { attachment })
// ─────────────────────────────────────────────────────────────────────────

teams.route("/:id/attachments", teamAttachmentsRouter);

// PDF annotations sub-router.
// GET    /api/teams/:id/annotations?key=<r2-key>
// POST   /api/teams/:id/annotations
// DELETE /api/teams/:id/annotations/:annotationId
teams.route("/:id/annotations", annotationsRouter);

// silence the unused import warning until member-management routes land
void or;
void isNull;

export default teams;
