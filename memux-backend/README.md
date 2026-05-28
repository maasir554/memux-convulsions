# memux-backend

Cloudflare Worker for memux: auth (Better-Auth + Google OAuth) today, Teams
(D1 + Durable Objects) over the next phases.

## Stack

- Hono on Workers
- Better-Auth (Google OAuth provider)
- D1 + Drizzle ORM
- Durable Objects (Phase 4, not yet wired) for live team rooms

## First-time setup

```bash
cd memux-backend
npm install
```

### 1. Create the D1 database

```bash
npx wrangler d1 create memux
```

Copy the `database_id` from the output into `wrangler.jsonc` (replace
`REPLACE_WITH_D1_ID`).

### 2. Generate + apply initial migration

```bash
npm run db:generate              # drizzle-kit emits SQL into src/db/migrations
npm run db:migrate:local         # apply to local D1 (.wrangler/state)
```

### 3. Create a Google OAuth client

1. <https://console.cloud.google.com/apis/credentials> → **Create credentials → OAuth client ID**
2. Application type: **Web application**
3. Authorised redirect URIs:
   - `http://localhost:8787/api/auth/callback/google` (dev)
   - Production URI later, when you deploy
4. Copy **Client ID** and **Client secret**.

### 4. Fill in `.dev.vars`

```bash
cp .dev.vars.example .dev.vars
# then edit .dev.vars and paste:
#   BETTER_AUTH_SECRET=$(openssl rand -base64 32)
#   GOOGLE_CLIENT_ID=...
#   GOOGLE_CLIENT_SECRET=...
```

### 5. Run

```bash
npm run dev    # http://localhost:8787
```

Quick smoke test:

```bash
curl http://localhost:8787/healthz                # { ok: true }
curl -i http://localhost:8787/api/me              # 401 — no session
open  http://localhost:8787/api/auth/sign-in/social?provider=google
                                                   # → Google consent → callback → cookie set
curl --cookie-jar cookies.txt http://localhost:8787/api/me
                                                   # → user record
```

## Cross-origin from galexy

Galexy (Next dev on `localhost:3000`) calls memux-backend with
`credentials: 'include'`. CORS allows origins listed in
`TRUSTED_ORIGINS` (wrangler.jsonc → vars). Locally that's `localhost:3000`
and cookies are `SameSite=Lax` (same-site between ports). In production
the same code switches to `SameSite=None; Secure` because
`BETTER_AUTH_URL` won't start with `http://localhost`.

## What lives where

```
src/
├── index.ts        Hono app + CORS + route mounting
├── auth.ts         Better-Auth factory (Google provider, D1 adapter)
├── env.ts          WorkerEnv binding types
├── db/
│   ├── schema.ts   Drizzle tables: Better-Auth + teams scaffold
│   └── migrations/ Generated SQL (drizzle-kit)
└── do/             [Phase 4] TeamRoom Durable Object
```

## Phase plan (tracked in repo)

| Phase | Status | What |
|---|---|---|
| 1 | scaffolded | Worker boots, Better-Auth mounted, /api/me works |
| 2 | next | Galexy /login route + useSession + Account UI |
| 3 | | Hono routes for teams CRUD (D1) |
| 4 | | TeamRoom Durable Object (WebSocket Hibernation, message storage) |
| 5 | | Teams UI in galexy (list + room) |
| 6 | | Polish: avatars, presence, mentions, invite expiry |
