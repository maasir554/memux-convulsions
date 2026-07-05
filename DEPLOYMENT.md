# Deployment

memux-frontend (Next.js) → **Vercel Hobby** (free).
memux-backend (Worker + D1 + R2 + Durable Object) → **Cloudflare Workers Free**.

Total monthly cost for a 3–5 user hackathon demo: **$0**. The DO is already
SQLite-backed (`wrangler.jsonc` → `new_sqlite_classes`), so the Workers Free
plan covers it.

---

## Order matters

You deploy the backend first, then the frontend. The frontend needs to know
the backend's URL at build time; the backend needs to know the frontend's
URL so CORS lets it through.

1. **Backend → Cloudflare** (`memux-backend/`)
2. Note the workers.dev URL it prints
3. **Frontend → Vercel** (`memux-frontend/`) using that URL as `NEXT_PUBLIC_MEMUX_API_URL`
4. Note the vercel.app URL Vercel prints
5. **Edit `wrangler.jsonc`** under `env.production.vars` with both URLs
6. **Redeploy backend** so CORS + cookie config picks up the real Vercel URL
7. **Add Google OAuth callback** to Google Cloud Console

There's a chicken-and-egg on the first deploy — your backend deploys with
`REPLACE-ME` placeholders before the Vercel URL exists. CORS will reject
the frontend until step 6. That's expected.

---

## 1. Backend — Cloudflare Workers

```bash
cd memux-backend

# One-time: log into your Cloudflare account
npx wrangler login

# The dev D1 + R2 in wrangler.jsonc already exist; we reuse them for prod
# (single environment, single dataset — fine for a hackathon demo).
#
# If you want separate prod resources, create them and paste new
# database_id / bucket_name into env.production.d1_databases /
# env.production.r2_buckets inside wrangler.jsonc.

# Apply D1 migrations to the remote database
npx wrangler d1 migrations apply memux --remote

# Push secrets to production. Each prompts for the value.
# Use the same BETTER_AUTH_SECRET as .dev.vars (or regenerate with
# `openssl rand -base64 32` — sessions reset if you change it).
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put GOOGLE_CLIENT_ID --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET --env production

# First deploy — vars still have REPLACE-ME placeholders; that's OK.
npx wrangler deploy --env production
```

Wrangler prints something like:

```
Published memux-backend
  https://memux-backend.<your-subdomain>.workers.dev
```

**Copy that URL.** That's your `BACKEND_URL` for everything below.

---

## 2. Frontend — Vercel

Push the repo to GitHub first (Vercel deploys from a git remote).

In the Vercel dashboard:

1. **New Project** → import the repo.
2. **Root Directory** → `memux-frontend`.
3. **Framework** → Next.js (detected automatically).
4. **Environment Variables** — add one:
   - `NEXT_PUBLIC_MEMUX_API_URL` = `https://memux-backend.<your-subdomain>.workers.dev`
5. **Deploy.**

You'll get something like `https://<project-name>.vercel.app`. Copy it —
that's your `FRONTEND_URL`.

(CLI alternative: `cd memux-frontend && npx vercel --prod`, then set the env var
in the dashboard and redeploy.)

---

## 3. Wire the two together

Edit `memux-backend/wrangler.jsonc` → `env.production.vars`:

```jsonc
"vars": {
  "BETTER_AUTH_URL": "https://memux-backend.<your-subdomain>.workers.dev",
  "TRUSTED_ORIGINS": "https://<project-name>.vercel.app"
}
```

`TRUSTED_ORIGINS` is comma-separated if you have multiple frontends (e.g.
preview deploys): `"https://<project>.vercel.app,https://<project>-<branch>.vercel.app"`.

Redeploy:

```bash
cd memux-backend
npx wrangler deploy --env production
```

---

## 4. Google OAuth callback

In [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials),
open your OAuth 2.0 Client ID and add to **Authorised redirect URIs**:

```
https://memux-backend.<your-subdomain>.workers.dev/api/auth/callback/google
```

Keep the localhost one so dev still works.

---

## 5. Verify

Open `https://<project-name>.vercel.app/login`, click **Sign in with
Google**. You should bounce through Google and land back on the app
logged in. Then `/teams`, create a team, send a message — chat should
work over WebSocket the same as in dev.

Common failures and fixes:

| Symptom | Cause | Fix |
|---|---|---|
| `CORS` error in console | `TRUSTED_ORIGINS` doesn't match the Vercel origin exactly | Add the exact origin (scheme + host, no path) and redeploy backend |
| Login succeeds but `/api/me` returns 401 | Cookie not set — usually `SameSite` | Verify `BETTER_AUTH_URL` doesn't start with `http://localhost` in prod (triggers Lax+insecure) |
| `redirect_uri_mismatch` on Google sign-in | Callback URL not in GCP | Add the prod callback URI in GCP credentials |
| WebSocket immediately closes | `Upgrade` header stripped by CORS preflight | Already handled by Hono's CORS; if you see it, check the worker URL is reachable directly |
| DO requests fail with paid-plan error | Worker class accidentally switched to non-SQLite | Check `wrangler.jsonc` still has `new_sqlite_classes` |

---

## Pricing recap (verified May 2026)

| Layer | Free tier | This app's 3–5 user demand | Cost |
|---|---|---|---|
| Vercel Hobby | 1M function invocations + 100 GB-Hrs/mo | Trivial | $0 |
| CF Workers Free | 100k req/day | Hundreds | $0 |
| D1 Free | 5 GB, 5M reads/day, 100k writes/day | Trivial | $0 |
| R2 Free | 10 GB + free egress | A few image uploads | $0 |
| DO SQLite Free | 5 GB storage, 5M reads/day, 100k writes/day | Chat history fits comfortably | $0 |
| Google OAuth | Unlimited sign-ins | — | $0 |
| **Total** | | | **$0/mo** |

Vercel Hobby is **non-commercial only**. Hackathons and portfolio demos
qualify. The moment it's monetised, switch to Pro ($20/mo).
