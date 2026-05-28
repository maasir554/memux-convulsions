/**
 * memux-backend — Cloudflare Worker entry.
 *
 * Phase 1 surface:
 *   POST/GET /api/auth/*  — Better-Auth (Google OAuth + sessions)
 *   GET      /api/me      — current session (or 401)
 *   GET      /healthz     — liveness
 *
 * Teams routes (Phase 3) and the TeamRoom DO (Phase 4) come later.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import { createAuth } from "./auth";
import type { WorkerEnv } from "./env";
import teamsRouter from "./routes/teams";

// Durable Object class must be exported from the Worker entry so wrangler
// can wire it to its binding.
export { TeamRoom } from "./do/team-room";

type Bindings = WorkerEnv;
type Variables = {
  user: { id: string; email: string; name: string; image: string | null };
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CORS — must include credentials so the session cookie flows on cross-origin
// fetches from galexy (Vercel) → memux-backend (Workers). Origins come from
// TRUSTED_ORIGINS so we don't hard-code per environment.
app.use("*", async (c, next) => {
  const allowed = c.env.TRUSTED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  const middleware = cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  });
  return middleware(c, next);
});

app.get("/healthz", (c) => c.json({ ok: true }));

// Better-Auth owns its own paths under /api/auth/*. We forward the raw
// Request so its internal router can match the sub-routes.
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// Quick session probe — frontends call this after login to confirm the
// cookie is set and to fetch the user record.
app.get("/api/me", async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ user: null }, 401);
  return c.json({ user: session.user });
});

// Teams CRUD (Phase 3). All routes inside teamsRouter require a session
// via the requireUser middleware — see src/middleware/auth.ts.
app.route("/api/teams", teamsRouter);

export default app;
