# Deploying the worker

The **Next.js dashboard** runs on Vercel. The **Telegram worker** must run on a
platform that keeps a long-lived Node process alive (Railway, Render, or Fly.io).

```
Vercel dashboard  ──HTTPS──>  Worker (this deploy)  ──MTProto──>  Telegram
        │                              │
        └──────── Supabase ────────────┘
```

## Required environment variables

Set these on the worker host **and** keep matching values on Vercel where noted.

| Variable | Worker | Vercel | Notes |
|----------|--------|--------|-------|
| `TELEGRAM_API_ID` | yes | no | From https://my.telegram.org |
| `TELEGRAM_API_HASH` | yes | no | |
| `OPENAI_API_KEY` | yes | optional | Worker generates replies |
| `OPENAI_MODEL` | yes | optional | Default `gpt-4o-mini` |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | yes | Same Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | yes | **Must match** |
| `SESSION_ENCRYPTION_KEY` | yes | yes | **Must match** (64 hex chars) |
| `WORKER_SECRET` | yes | yes | **Must match** — random string |
| `WORKER_URL` | no | yes | Worker's public HTTPS URL |
| `WORKER_HOST` | yes | no | Set to `0.0.0.0` (Dockerfile sets this) |
| `WORKER_PORT` | optional | no | Platforms set `PORT` automatically |

Generate a session key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Generate a worker secret:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

## After the worker is live

1. Open `https://<worker-host>/health` — should return `{"ok":true}`.
2. In Vercel → Project → Settings → Environment Variables:
   - `WORKER_URL` = `https://<worker-host>` (no trailing slash)
   - `WORKER_SECRET` = same value as on the worker
3. Redeploy Vercel.
4. In the dashboard, try **Accounts → login** or **Auto-reply** — actions should
   no longer show "Cannot reach the worker."

---

## Option A: Railway (recommended)

1. Push this repo to GitHub.
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → select repo.
3. Railway detects `railway.toml` and builds the Dockerfile.
4. **Variables** tab — add all required env vars from the table above.
5. **Settings** → **Networking** → **Generate domain**.
6. Copy the URL into Vercel as `WORKER_URL`.

Railway sets `PORT` automatically; the worker binds `0.0.0.0`.

---

## Option B: Render

1. Render Dashboard → **New** → **Blueprint**.
2. Connect the GitHub repo (uses `render.yaml`).
3. Enter secret values when prompted (`sync: false` vars).
4. After deploy, copy the service URL (e.g. `https://keyboardwarrior-worker.onrender.com`).
5. Set `WORKER_URL` on Vercel and redeploy.

**Note:** Render free tier spins down after inactivity. Telegram listeners need an
always-on plan (`starter` in `render.yaml`) or accounts will go offline when idle.

---

## Option C: Fly.io

```bash
# Install: https://fly.io/docs/hands-on/install-flyctl/
fly auth login
fly launch --no-deploy   # pick a unique app name; updates fly.toml
fly secrets set \
  TELEGRAM_API_ID=... \
  TELEGRAM_API_HASH=... \
  OPENAI_API_KEY=... \
  NEXT_PUBLIC_SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  SESSION_ENCRYPTION_KEY=... \
  WORKER_SECRET=...
fly deploy
```

Worker URL: `https://<app-name>.fly.dev`

---

## Option D: Docker (VPS / any host)

```bash
docker build -t keyboardwarrior-worker .
docker run -d --name kw-worker -p 8787:8787 \
  -e WORKER_HOST=0.0.0.0 \
  -e TELEGRAM_API_ID=... \
  -e TELEGRAM_API_HASH=... \
  -e OPENAI_API_KEY=... \
  -e NEXT_PUBLIC_SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e SESSION_ENCRYPTION_KEY=... \
  -e WORKER_SECRET=... \
  keyboardwarrior-worker
```

Put nginx/Caddy in front for HTTPS, or use a tunnel (Cloudflare Tunnel, ngrok)
for testing only.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Vercel shows data but actions fail with "Cannot reach the worker" | Set `WORKER_URL` + `WORKER_SECRET` on Vercel and redeploy |
| Worker starts but Vercel gets 401 | `WORKER_SECRET` mismatch between Vercel and worker |
| Login/decrypt errors | `SESSION_ENCRYPTION_KEY` must be identical on worker and Vercel |
| Health check fails | Ensure `WORKER_HOST=0.0.0.0`; platform must route to `PORT` |
| Accounts show offline after idle | Use always-on hosting (not Render free tier) |
