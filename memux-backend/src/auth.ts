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
    account: {
      // Cross-origin survival for the OAuth flow.
      //
      // Default is "database" when a DB is configured (it is), so the state
      // payload already lives in `verification`. What still trips us up is
      // the *additional* cookie check Better-Auth performs in the callback:
      // it expects the `__Secure-better-auth.state` cookie set during
      // /sign-in/social to come back on the Google → workers.dev redirect.
      //
      // For a vercel.app frontend + workers.dev backend split there is no
      // shared parent domain (and .vercel.app is on the public suffix list),
      // so browsers — Chrome's tracking-protection mode in particular —
      // routinely drop that cookie. Symptom: `state_mismatch` on first sign-in.
      //
      // skipStateCookieCheck bypasses the cookie comparison; the signed
      // state value in the callback URL is still looked up against the DB,
      // so CSRF protection still holds.
      storeStateStrategy: "database",
      skipStateCookieCheck: true,
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
