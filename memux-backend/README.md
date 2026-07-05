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
# 1. Liveness
curl http://localhost:8787/healthz                # { ok: true }

# 2. No session yet
curl -i http://localhost:8787/api/me              # 401 — { user: null }

# 3. Kick off Google OAuth.
#
#    DO NOT use curl + open. Better-Auth sets a `state` cookie on the
#    POST response which the OAuth callback verifies — and that cookie
#    must live in the BROWSER, not in a curl cookie jar. If you split
#    the flow (curl POST + browser redirect), you'll get
#    `state_mismatch` on the callback.
#
#    Instead, open http://localhost:8787/healthz (or any same-origin
#    page) and paste this into DevTools → Console:
#
#      const r = await fetch('/api/auth/sign-in/social', {
#        method: 'POST',
#        headers: { 'Content-Type': 'application/json' },
#        credentials: 'include',
#        body: JSON.stringify({ provider: 'google', callbackURL: '/api/me' }),
#      });
#      window.location = (await r.json()).url;
#
#    The fetch sets the state cookie in your browser, then redirects
#    you to Google → callback → session created → callbackURL.

# 4. In the same browser, visit http://localhost:8787/api/me to confirm
#    the session cookie persists across reloads.
```

Better-Auth endpoints (all under `/api/auth/`):
- `POST /sign-in/social`     start an OAuth flow → returns `{ url }`
- `GET  /callback/google`    Google redirects here with `?code=…`
- `POST /sign-out`           clear session cookie
- `GET  /get-session`        same data as our `/api/me` proxy

## Cross-origin from memux-frontend

memux-frontend (Next dev on `localhost:3000`) calls memux-backend with
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
| 2 | next | memux-frontend /login route + useSession + Account UI |
| 3 | | Hono routes for teams CRUD (D1) |
| 4 | | TeamRoom Durable Object (WebSocket Hibernation, message storage) |
| 5 | | Teams UI in memux-frontend (list + room) |
| 6 | | Polish: avatars, presence, mentions, invite expiry |
