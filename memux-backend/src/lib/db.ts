/**
 * Drizzle instance scoped to a single Worker request.
 *
 * Workers spin up fresh per-request (or per-iso warmup), so there's no
 * benefit to a long-lived global — and a request-scoped instance keeps
 * the binding handle in lockstep with the env that owns it.
 */

import { drizzle } from "drizzle-orm/d1";

import * as schema from "../db/schema";
import type { WorkerEnv } from "../env";

export function getDb(env: WorkerEnv) {
  return drizzle(env.DB, { schema, casing: "snake_case" });
}

export type DB = ReturnType<typeof getDb>;
