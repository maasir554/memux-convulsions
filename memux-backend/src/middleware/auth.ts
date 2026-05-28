/**
 * `requireUser` — Hono middleware that gates a route on a valid Better-Auth
 * session. On success, stashes the user on `c.var.user`. On failure,
 * returns 401 without ever invoking the handler.
 *
 * Two auth paths are accepted, in this order:
 *
 *  1. A `ws_token` query parameter on a WebSocket upgrade request. Used by
 *     the team-room WS connection from origins where the session cookie
 *     can't reach the Worker (frontend on vercel.app, backend on workers.dev,
 *     third-party cookie restrictions). The token is short-lived and bound
 *     to a teamId, signed with BETTER_AUTH_SECRET. We only honour it on
 *     actual WS upgrades — that prevents using a token to call other HTTP
 *     endpoints (e.g. /ws-token) for session extension.
 *
 *  2. The standard Better-Auth session cookie. Used by every HTTP call.
 *
 * Use on /api/teams/* and any future authenticated surface. /api/auth/*
 * and /api/me handle their own session logic and should NOT be wrapped.
 */

import type { MiddlewareHandler } from "hono";

import { createAuth } from "../auth";
import type { WorkerEnv } from "../env";
import { verifyWsToken } from "../lib/ws-token";

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
  // (1) WS token, only on real WebSocket upgrades.
  const wsToken = c.req.query("ws_token");
  if (wsToken && c.req.header("Upgrade") === "websocket") {
    const payload = await verifyWsToken(c.env.BETTER_AUTH_SECRET, wsToken);
    if (payload) {
      // Belt-and-braces: the token's teamId must match the route's :id.
      const routeTeamId = c.req.param("id");
      if (routeTeamId && routeTeamId !== payload.teamId) {
        return c.json({ error: "token/team mismatch" }, 403);
      }
      c.set("user", {
        id: payload.userId,
        // email isn't part of the WS token payload — handlers that need
        // it must use cookie auth instead. None on the WS path do.
        email: "",
        name: payload.userName,
        image: payload.userImage,
      });
      await next();
      return;
    }
    // Invalid/expired token falls through to the cookie path below, which
    // will 401 if the session is also absent. That keeps the contract
    // simple: bad token + no cookie = unauthenticated.
  }

  // (2) Better-Auth session cookie.
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
