/**
 * Better-Auth config, factory-style so it can take the per-request D1
 * binding. Better-Auth itself is stateless across requests — the DB adapter
 * holds the binding for the lifetime of the call.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./db/schema";
import type { WorkerEnv } from "./env";

export function createAuth(env: WorkerEnv) {
  const db = drizzle(env.DB, { schema, casing: "snake_case" });

  // Cookie behaviour differs by environment. Local dev runs same-site
  // (localhost:3000 ↔ localhost:8787) so Lax is fine. Production runs
  // cross-origin (galexy on Vercel ↔ Worker on workers.dev or a custom
  // domain), which requires SameSite=None; Secure.
  const isProd = !env.BETTER_AUTH_URL.startsWith("http://localhost");

  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: env.TRUSTED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: isProd ? "none" : "lax",
        secure: isProd,
        httpOnly: true,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
