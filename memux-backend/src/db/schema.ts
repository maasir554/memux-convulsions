/**
 * Drizzle schema for memux-backend.
 *
 * Tables:
 * - Better-Auth (user, session, account, verification) — managed by
 *   Better-Auth; column names must match its expected shape. If Better-Auth
 *   adds fields in a future minor, regenerate via `npm run auth:generate`
 *   and reconcile.
 * - Teams (team, team_member, team_invite) — our own. Phase 3.
 *
 * Messages do NOT live here. They live in Durable Object storage on the
 * TeamRoom DO (Phase 4) so per-team writes don't contend on a single SQL
 * table, and so a team can be evicted from RAM independently.
 */

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// ─────────────────────────────────────────────────────────────────────────
// Better-Auth tables
// ─────────────────────────────────────────────────────────────────────────

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ─────────────────────────────────────────────────────────────────────────
// Teams (Phase 3 — defined now so the initial migration covers them; routes
// land in a later commit)
// ─────────────────────────────────────────────────────────────────────────

export const team = sqliteTable("team", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // The user who created the team. Not the same as "current owner" — that's
  // derived from team_member.role = 'owner'.
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const teamMember = sqliteTable(
  "team_member",
  {
    teamId: text("team_id").notNull().references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
    joinedAt: integer("joined_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const teamInvite = sqliteTable("team_invite", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => team.id, { onDelete: "cascade" }),
  // Random invite code — looked up unauthenticated, so it must be unguessable.
  code: text("code").notNull().unique(),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  // Optional cap on uses. null = unlimited.
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
});
