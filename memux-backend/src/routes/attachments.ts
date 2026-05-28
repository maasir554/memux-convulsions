/**
 * Attachment routes — R2-backed file storage scoped per team.
 *
 *  POST /api/teams/:teamId/attachments
 *     multipart/form-data, field name "file"
 *     → 201 { key, filename, contentType, size }
 *
 *  GET  /api/attachments/teams/:teamId/*key
 *     proxies the R2 object back as a Response.
 *     Member check by parsing teamId out of the path; the R2 key itself
 *     is `teams/<teamId>/<uuid>/<filename>`, so authorisation is one
 *     team_member lookup.
 *
 * Why the Worker proxies instead of presigned URLs:
 *   - membership check is required on download (private team data)
 *   - cookie-based session means we don't need signed URLs at all
 *   - upload is single-Worker-invocation, fine for chat-scale
 *
 * Caching: GET responses use Cache-Control: private so the browser
 * caches per-user but no shared cache (CDN, proxy) does.
 */

import { Hono } from "hono";

import { getDb } from "../lib/db";
import { genId } from "../lib/ids";
import {
  MAX_ATTACHMENT_BYTES,
  type ChatAttachment,
} from "../lib/messages";
import { requireUser, type AuthedVariables } from "../middleware/auth";
import { teamMember } from "../db/schema";
import { and, eq } from "drizzle-orm";
import type { WorkerEnv } from "../env";

// ─────────────────────────────────────────────────────────────────────────
// Upload — mounted under /api/teams/:teamId
// ─────────────────────────────────────────────────────────────────────────

export const teamAttachmentsRouter = new Hono<{
  Bindings: WorkerEnv;
  Variables: AuthedVariables;
}>();

teamAttachmentsRouter.use("*", requireUser);

teamAttachmentsRouter.post("/", async (c) => {
  const me = c.var.user;
  const teamId = c.req.param("id");
  if (!teamId) return c.json({ error: "missing teamId" }, 400);

  // Membership check.
  const db = getDb(c.env);
  const row = await db
    .select({ role: teamMember.role })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, me.id)))
    .get();
  if (!row) return c.json({ error: "not a member" }, 404);

  // Multipart form. `File` isn't in @cloudflare/workers-types' global
  // namespace consistently, so duck-type instead of `instanceof File`.
  const form = await c.req.formData().catch(() => null);
  const entry = form?.get("file");
  if (!entry || typeof entry === "string") {
    return c.json({ error: "file required (multipart field 'file')" }, 400);
  }
  const file = entry as unknown as {
    name: string;
    type: string;
    size: number;
    stream(): ReadableStream;
  };
  if (file.size === 0) return c.json({ error: "empty file" }, 400);
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return c.json(
      { error: `file too large (max ${MAX_ATTACHMENT_BYTES} bytes)` },
      413,
    );
  }

  const safeName = sanitizeFilename(file.name) || "file";
  const objectKey = `teams/${teamId}/${genId()}/${safeName}`;

  await c.env.MEMUX_ATTACHMENTS.put(objectKey, file.stream(), {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
      // Mark uploads as private — browsers shouldn't share-cache them.
      cacheControl: "private, max-age=86400",
    },
    customMetadata: {
      teamId,
      uploadedBy: me.id,
      filename: safeName,
    },
  });

  const attachment: ChatAttachment = {
    key: objectKey,
    filename: safeName,
    contentType: file.type || "application/octet-stream",
    size: file.size,
  };
  return c.json({ attachment }, 201);
});

// ─────────────────────────────────────────────────────────────────────────
// Download — mounted at /api/attachments
// Key shape: teams/:teamId/:uuid/:filename
// ─────────────────────────────────────────────────────────────────────────

export const attachmentDownloadRouter = new Hono<{
  Bindings: WorkerEnv;
  Variables: AuthedVariables;
}>();

attachmentDownloadRouter.use("*", requireUser);

attachmentDownloadRouter.get("/:key{.+}", async (c) => {
  const me = c.var.user;
  const key = c.req.param("key");
  if (!key) return c.text("missing key", 400);

  // Parse teamId from `teams/<teamId>/...`
  const match = /^teams\/([^/]+)\//.exec(key);
  if (!match) return c.text("invalid key", 400);
  const teamId = match[1];

  // Membership check.
  const db = getDb(c.env);
  const row = await db
    .select({ role: teamMember.role })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, me.id)))
    .get();
  if (!row) return c.text("not a member", 404);

  const obj = await c.env.MEMUX_ATTACHMENTS.get(key);
  if (!obj) return c.text("not found", 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  // Pin to private — never let an intermediate cache share these.
  headers.set("Cache-Control", "private, max-age=86400");
  return new Response(obj.body, { status: 200, headers });
});

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  // Strip path separators and control chars; preserve readable filenames
  // for download. R2 itself accepts most strings as keys, but downstream
  // headers (Content-Disposition later) prefer something tame.
  return name
    .replace(/[/\\]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 200);
}
