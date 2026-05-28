import { defineConfig } from "drizzle-kit";

// Drizzle Kit only emits SQL migrations here; the Worker runs queries via
// the D1 binding, not via drizzle-kit at runtime. We point at the local D1
// SQLite file under .wrangler/state when generating diffs.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  casing: "snake_case",
});
