/**
 * `requireUser` — Hono middleware that gates a route on a valid Better-Auth
 * session. On success, stashes the user on `c.var.user`. On failure,
 * returns 401 without ever invoking the handler.
 *
 * Use on /api/teams/* and any future authenticated surface. /api/auth/*
 * and /api/me handle their own session logic and should NOT be wrapped.
 */

import type { MiddlewareHandler } from "hono";

import { createAuth } from "../auth";
import type { WorkerEnv } from "../env";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
};

export type AuthedVariables = {
  user: SessionUser;
};

export const requireUser: MiddlewareHandler<{
  Bindings: WorkerEnv;
  Variables: AuthedVariables;
}> = async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  c.set("user", {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
  });
  await next();
};
