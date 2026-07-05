# Runbook — Local + Cloud

Single source of truth for getting memux-convulsions running, whether on
your laptop or live on the internet. Supersedes the older `DEPLOYMENT.md`,
which was cloud-only and predates the same-origin proxy refactor.

## Architecture in one paragraph

The frontend (`memux-frontend/`) is a **Next.js 16** app deployed to **Vercel
Hobby**. The backend (`memux-backend/`) is a single **Cloudflare Worker**
(Hono + Better-Auth + Drizzle) with three bindings: **D1** for users,
sessions, teams and invites; **R2** for chat attachments; and a
**Durable Object** (`TeamRoom`) for the realtime chat WebSocket. In
production, Vercel proxies `/api/auth/*`, `/api/me`, `/api/teams/*`
and `/api/attachments/*` to the Worker via `next.config.ts` rewrites —
that's what keeps the Better-Auth session cookie first-party to the
Vercel origin. The WebSocket connects directly to the Worker using a
short-lived HMAC token (`?ws_token=`) minted from a same-origin HTTP
endpoint.

```
                          browser
                            │
            ┌───────────────┼───────────────┐
            │HTTP (same-origin)             │WebSocket (direct, ws_token)
            ▼                               ▼
   vercel.app (Next.js)        memux-backend.<acct>.workers.dev
            │ rewrites
            ▼
  memux-backend.<acct>.workers.dev
   (Better-Auth, D1, R2, TeamRoom DO)
```

---

## Prerequisites

- **Node.js 20+** and **npm** (or pnpm).
- **Cloudflare account** — free tier covers everything; sign in to
  `wrangler` once with `npx wrangler login`.
- **Vercel account** — Hobby plan, non-commercial. Connect to GitHub so
  Vercel can deploy from `main`.
- **Google Cloud Console** — an OAuth 2.0 Client ID (type: Web
  application). You'll add the dev + prod redirect URIs as we go.

---

## Local development

### 1. Clone and install

```bash
git clone <this-repo>
cd convulsions
(cd memux-frontend && npm install)
(cd memux-backend && npm install)
```

### 2. Backend env: `memux-backend/.dev.vars`

Secrets only — non-secret vars live in `wrangler.jsonc` under the
top-level `vars` block (already pointing at localhost).

```bash
cd memux-backend
cp .dev.vars.example .dev.vars
$EDITOR .dev.vars
```

Fill in:

```env
# 32+ char random. Generate with: openssl rand -base64 32
BETTER_AUTH_SECRET=...

# From console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

In Google Cloud Console, add an **Authorised redirect URI**:

```
http://localhost:8787/api/auth/callback/google
```

(In dev, `BETTER_AUTH_URL=http://localhost:8787`, so the Worker tells
Google to redirect there directly — Next isn't in the loop for the OAuth
callback locally.)

### 3. Frontend env: `memux-frontend/.env.local`

```bash
cd ../memux-frontend
cp .env.local.example .env.local
$EDITOR .env.local
```

The only line that has to be right for the chat:

```env
NEXT_PUBLIC_MEMUX_API_URL=http://localhost:8787
```

(Same value is used by `next.config.ts` for rewrites and by the WS
client for the direct connection.)

### 4. D1 — apply migrations locally

```bash
cd ../memux-backend
npx wrangler d1 migrations apply memux --local
```

Wrangler stores the local D1 database under `.wrangler/state/`. To wipe
it, `rm -rf .wrangler` and reapply.

### 5. Run both processes

Two terminals.

**Terminal A — backend:**
```bash
cd memux-backend
npx wrangler dev
```

Wait for `Ready on http://localhost:8787`. If you change `auth.ts`,
`middleware/auth.ts`, or anything under `src/`, wrangler hot-reloads
automatically — but a hard restart (`Ctrl-C` + rerun) is cheap and
guarantees no stale state if you're chasing a weird symptom.

**Terminal B — frontend:**
```bash
cd memux-frontend
npm run dev
```

Open <http://localhost:3000>.

### 6. Verify locally

- `curl http://localhost:8787/healthz` → `{"ok":true}`
- Open <http://localhost:3000/login>, sign in with Google → bounces to
  Google → returns to <http://localhost:3000/>. The cookie set by the
  Worker on `localhost:8787` is shared with `localhost:3000` because
  cookies are scoped per-host (ignoring port) — so cross-origin works
  in dev without rewrites being on the critical path.
- Hit `/teams`, create a team, send a message, drop an image, verify
  it previews in the attachment modal.

### Common local issues

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in spinner never resolves | `wrangler dev` isn't running | start it |
| `redirect_uri_mismatch` from Google | localhost callback URI not in GCP | add `http://localhost:8787/api/auth/callback/google` |
| `Network error` on first fetch | `.env.local` missing or wrong port in `NEXT_PUBLIC_MEMUX_API_URL` | should be `http://localhost:8787` |
| WS shows "Connection error" | `wrangler dev` reloading on an edit during the WS handshake | retry once it settles |
| D1 errors complaining about tables | local DB not migrated | `npx wrangler d1 migrations apply memux --local` |

---

## Cloud deployment

Total monthly cost for a 3–5 user demo: **$0**. The DO is SQLite-backed
(`new_sqlite_classes` in `wrangler.jsonc`) so the Workers Free plan
covers it; Vercel Hobby covers the Next app; D1 + R2 sit comfortably in
their free tiers.

### Order matters

1. Backend → Cloudflare. Get the workers.dev URL.
2. Frontend → Vercel. Set `NEXT_PUBLIC_MEMUX_API_URL` to the workers.dev
   URL. Get the vercel.app URL.
3. Backfill the vercel.app URL into `wrangler.jsonc → env.production.vars`,
   redeploy the backend.
4. Add the vercel.app callback to Google Cloud Console.
5. Sign in to verify.

There's a chicken-and-egg on the first iteration — the placeholder URLs
in the template don't match reality until you've done both deploys at
least once. Expected.

### 1. Backend — Cloudflare Workers

```bash
cd memux-backend

# One-time auth
npx wrangler login

# Create the D1 database (one-time). The id printed here goes into
# wrangler.jsonc → d1_databases[0].database_id and env.production
# .d1_databases[0].database_id. Both should point at the same DB for
# a single-environment hackathon setup.
npx wrangler d1 create memux

# Create the R2 bucket (one-time).
npx wrangler r2 bucket create memux-attachments

# Apply migrations to the remote D1.
npx wrangler d1 migrations apply memux --remote

# Push secrets to the PRODUCTION env. --env production is critical —
# secrets are scoped per wrangler environment.
npx wrangler secret put BETTER_AUTH_SECRET    --env production
npx wrangler secret put GOOGLE_CLIENT_ID      --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET  --env production

# First deploy. Vars in env.production.vars still have placeholder
# URLs at this point — that's fine, we backfill in step 3.
npx wrangler deploy --env production
```

Wrangler prints something like:

```
Published memux-backend
  https://memux-backend.<your-subdomain>.workers.dev
```

Note this URL — that's `BACKEND_URL` for everything below.

### 2. Frontend — Vercel

In the Vercel dashboard:

1. **New Project** → import the GitHub repo.
2. **Root Directory** = `memux-frontend`.
3. **Framework** = Next.js (autodetected).
4. **Environment Variables** — add one:
   - `NEXT_PUBLIC_MEMUX_API_URL` = `<BACKEND_URL>`
5. **Deploy.** The build runs `npm run build`; takes ~2 min the first
   time.

You get `https://<project>.vercel.app`. That's `FRONTEND_URL`.

(CLI alternative: `cd memux-frontend && npx vercel --prod`, then set the env
var in the dashboard and trigger a redeploy.)

### 3. Wire the two together

Edit `memux-backend/wrangler.jsonc` → `env.production.vars`:

```jsonc
"vars": {
  "BETTER_AUTH_URL": "<FRONTEND_URL>",
  "TRUSTED_ORIGINS": "<FRONTEND_URL>"
}
```

Both values are the same: the Vercel URL. The Worker's Better-Auth uses
`BETTER_AUTH_URL` to construct the `redirect_uri` it sends to Google —
pointing at Vercel rather than workers.dev is what makes the Next
rewrite path serve the OAuth callback. `TRUSTED_ORIGINS` is the
allow-list for the same origin.

Redeploy:

```bash
cd memux-backend
npx wrangler deploy --env production
```

### 4. Google OAuth callback

In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials),
open your OAuth 2.0 Client ID and add **Authorised redirect URIs**:

```
<FRONTEND_URL>/api/auth/callback/google
```

Keep the localhost one alongside so dev still works.

### 5. Verify production

- `curl <BACKEND_URL>/healthz` → `{"ok":true}`
- `curl <BACKEND_URL>/api/teams/x/ws-token` → `401` (proves the new
  ws-token route is deployed; not 404)
- Open `<FRONTEND_URL>/login`, sign in with Google → home → `/teams` →
  create + chat + drop an image → preview opens in-app modal.

### Common cloud issues

| Symptom | Cause | Fix |
|---|---|---|
| `state_mismatch` after Google picks account | OAuth callback URI on GCP isn't `<FRONTEND_URL>/api/auth/callback/google` | add it; redeploy not needed |
| Sign-in completes but stays on `/login`, refresh = same | Session cookie can't reach `/api/me` — usually means `BETTER_AUTH_URL` still points at workers.dev | swap to `<FRONTEND_URL>`, redeploy backend |
| CORS error in the console | `TRUSTED_ORIGINS` doesn't exactly match the Vercel origin | match scheme + host, redeploy backend |
| Build fails with "Missing Suspense boundary with useSearchParams" | A new route added a `useSearchParams` caller without a `<Suspense>` parent | wrap the caller; see `app/(app)/login/page.tsx` for the pattern |
| ENOENT during build under `/index/index.segments` | A folder literally named `index` collides with Next's internal segment name | rename it (we hit this with `(app)/index` → `(app)/indexer`) |
| WS stuck on "Connecting…" | `NEXT_PUBLIC_MEMUX_API_URL` missing/wrong on Vercel | set it to `<BACKEND_URL>`, redeploy frontend |
| Attachment images broken | `/api/attachments/:path*` rewrite missing or stale | check `next.config.ts`; force-rebuild on Vercel |
| DO requests fail with paid-plan error | Class switched off SQLite backend somehow | confirm `new_sqlite_classes` in `wrangler.jsonc` |

---

## Promoting changes (day-to-day)

Vercel auto-deploys from `main`. Workers don't — wrangler is manual.

```bash
# Frontend-only change
git push origin main          # Vercel rebuilds automatically

# Backend change (anything under memux-backend/)
git push origin main
cd memux-backend
npx wrangler deploy --env production
```

The backend deploy is idempotent — safe to rerun if you're not sure.

---

## Pricing recap (verified May 2026)

| Layer | Free tier | This app's 3–5 user demand | Cost |
|---|---|---|---|
| Vercel Hobby | 1M function invocations + 100 GB-Hrs/mo | Trivial | $0 |
| CF Workers Free | 100k req/day, 10ms CPU/req | Hundreds | $0 |
| D1 Free | 5 GB, 5M reads/day, 100k writes/day | Trivial | $0 |
| R2 Free | 10 GB storage + free egress | A few image uploads | $0 |
| DO SQLite Free | 5 GB storage, 5M reads/day, 100k writes/day | Chat history fits comfortably | $0 |
| Google OAuth | Unlimited sign-ins | — | $0 |
| **Total** | | | **$0 / month** |

Vercel Hobby is **non-commercial only**. Hackathons and portfolio demos
qualify. Once the app is monetised, move to Pro at $20/mo.

Sources:
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
