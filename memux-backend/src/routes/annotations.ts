/**
 * Chat PDF annotations — team-scoped shared comments on attachment pages.
 *
 *   GET    /api/teams/:id/annotations?key=<r2-key>      list for an attachment
 *   POST   /api/teams/:id/annotations                   create (members)
 *   DELETE /api/teams/:id/annotations/:annotationId     delete (author only)
 *
 * Authorisation:
 *   - All routes require a session (mounted under teams.use("*", requireUser)).
 *   - Membership: caller must be a team_member to read or write.
 *   - The attachment key must start with `teams/<routeTeamId>/` — that's
 *     belt-and-braces on top of the membership check, so a member of team A
 *     can't write annotations on team B's keys even if they guess one.
 *
 * Coordinate model:
 *   x/y/w/h normalised to [0..1] against the page bounding box, so saved
 *   rectangles render correctly at any scale (incl. fit-to-width) and on
 *   different viewport widths between users.
 */

import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";

import { chatPdfAnnotation, teamMember, user } from "../db/schema";
import { getDb } from "../lib/db";
import { genId } from "../lib/ids";
import type { AuthedVariables } from "../middleware/auth";
import type { WorkerEnv } from "../env";

const annotations = new Hono<{
  Bindings: WorkerEnv;
  Variables: AuthedVariables;
}>();

// Membership check, factored out. Returns the role on success.
async function requireMember(env: WorkerEnv, teamId: string, userId: string) {
  const db = getDb(env);
  const row = await db
    .select({ role: teamMember.role })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .get();
  return row?.role ?? null;
}

// Sanity-check the R2 key shape and verify it's scoped to this team.
function keyMatchesTeam(key: string, teamId: string): boolean {
  return key.startsWith(`teams/${teamId}/`);
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/teams/:id/annotations?key=<r2-key>
// ─────────────────────────────────────────────────────────────────────────

annotations.get("/", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  if (!teamId) return c.json({ error: "missing teamId" }, 400);

  if (!(await requireMember(c.env, teamId, me.id))) {
    return c.json({ error: "not a member" }, 404);
  }

  const key = c.req.query("key");
  if (!key) return c.json({ error: "key query param required" }, 400);
  if (!keyMatchesTeam(key, teamId)) {
    return c.json({ error: "key not in this team" }, 403);
  }

  const db = getDb(c.env);
  const rows = await db
    .select({
      id: chatPdfAnnotation.id,
      page: chatPdfAnnotation.page,
      x: chatPdfAnnotation.x,
      y: chatPdfAnnotation.y,
      w: chatPdfAnnotation.w,
      h: chatPdfAnnotation.h,
      body: chatPdfAnnotation.body,
      userId: chatPdfAnnotation.userId,
      userName: user.name,
      userImage: user.image,
      createdAt: chatPdfAnnotation.createdAt,
    })
    .from(chatPdfAnnotation)
    .innerJoin(user, eq(user.id, chatPdfAnnotation.userId))
    .where(
      and(
        eq(chatPdfAnnotation.teamId, teamId),
        eq(chatPdfAnnotation.attachmentKey, key),
      ),
    )
    .orderBy(desc(chatPdfAnnotation.createdAt))
    .all();

  return c.json({
    annotations: rows.map((r) => ({
      id: r.id,
      page: r.page,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      body: r.body,
      userId: r.userId,
      userName: r.userName,
      userImage: r.userImage,
      createdAt: new Date(Number(r.createdAt) * 1000).toISOString(),
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/teams/:id/annotations
//   body: { key, page, x, y, w, h, body }
// ─────────────────────────────────────────────────────────────────────────

annotations.post("/", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  if (!teamId) return c.json({ error: "missing teamId" }, 400);

  if (!(await requireMember(c.env, teamId, me.id))) {
    return c.json({ error: "not a member" }, 404);
  }

  const payload = (await c.req.json().catch(() => null)) as
    | {
        key?: string;
        page?: number;
        x?: number;
        y?: number;
        w?: number;
        h?: number;
        body?: string;
      }
    | null;
  if (!payload) return c.json({ error: "json body required" }, 400);

  const { key, page, x, y, w, h } = payload;
  const body = payload.body?.trim();

  // Defensive validation — saves us debugging weird UI bugs downstream.
  if (typeof key !== "string" || !keyMatchesTeam(key, teamId)) {
    return c.json({ error: "valid key required" }, 400);
  }
  if (typeof page !== "number" || page < 1 || !Number.isInteger(page)) {
    return c.json({ error: "page must be a positive integer" }, 400);
  }
  if (
    typeof x !== "number" || x < 0 || x > 1 ||
    typeof y !== "number" || y < 0 || y > 1 ||
    typeof w !== "number" || w <= 0 || w > 1 ||
    typeof h !== "number" || h <= 0 || h > 1
  ) {
    return c.json({ error: "coords must be normalised 0..1" }, 400);
  }
  if (!body || body.length > 1000) {
    return c.json({ error: "body required, max 1000 chars" }, 400);
  }

  const id = genId();
  const db = getDb(c.env);
  await db.insert(chatPdfAnnotation).values({
    id,
    teamId,
    attachmentKey: key,
    page,
    x,
    y,
    w,
    h,
    body,
    userId: me.id,
  });

  return c.json(
    {
      annotation: {
        id,
        page,
        x,
        y,
        w,
        h,
        body,
        userId: me.id,
        userName: me.name,
        userImage: me.image,
        createdAt: new Date().toISOString(),
      },
    },
    201,
  );
});

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/teams/:id/annotations/:annotationId — author-only
// ─────────────────────────────────────────────────────────────────────────

annotations.delete("/:annotationId", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  const annotationId = c.req.param("annotationId");
  if (!teamId || !annotationId) return c.json({ error: "missing param" }, 400);

  if (!(await requireMember(c.env, teamId, me.id))) {
    return c.json({ error: "not a member" }, 404);
  }

  const db = getDb(c.env);
  const row = await db
    .select({ userId: chatPdfAnnotation.userId })
    .from(chatPdfAnnotation)
    .where(
      and(
        eq(chatPdfAnnotation.id, annotationId),
        eq(chatPdfAnnotation.teamId, teamId),
      ),
    )
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.userId !== me.id) return c.json({ error: "author only" }, 403);

  await db
    .delete(chatPdfAnnotation)
    .where(eq(chatPdfAnnotation.id, annotationId));

  return c.body(null, 204);
});

export default annotations;
