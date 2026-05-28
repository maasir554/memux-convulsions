/**
 * Worker environment bindings. Matches wrangler.jsonc + .dev.vars.
 * Secrets are typed as `string` (Worker secrets are always strings);
 * presence is enforced by Better-Auth blowing up at request time if
 * any are missing.
 */

export interface WorkerEnv {
  // D1
  DB: D1Database;

  // Durable Objects (Phase 4)
  TEAM_ROOM: DurableObjectNamespace;

  // Vars (wrangler.jsonc → vars)
  BETTER_AUTH_URL: string;
  TRUSTED_ORIGINS: string;

  // Secrets (.dev.vars locally, `wrangler secret put` in prod)
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}
