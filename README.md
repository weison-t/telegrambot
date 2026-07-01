# Telegram Keyboard Warrior

Orchestrate AI-driven conversations across up to **12 real Telegram user
accounts**. Pick a topic, style, how many accounts take part, and where they
talk (a group chat or 1-on-1 pairs). Replies are generated with OpenAI and sent
from real accounts via Telegram's MTProto API, so messages appear from real
people — never a bot. A live dashboard lets you configure and monitor everything.

> Heads up: automating Telegram **user** accounts is against Telegram's Terms of
> Service. Accounts (especially new ones) can be rate-limited or banned. This
> app adds human-like delays, typing indicators and flood-wait handling to
> reduce risk, but it cannot eliminate it. Use accounts you can afford to lose
> and start with **dry run** mode.

## Architecture

```
Next.js dashboard ──HTTP──> Worker (Node + GramJS) ──MTProto──> Telegram
       │                          │
       └──────── Supabase ────────┘  (accounts, campaigns, messages; realtime feed)
```

- **`app/`** – Next.js (App Router) + Tailwind + Shadcn dashboard and API routes.
- **`worker/`** – long-running Node process that holds the Telegram socket
  connections, runs the conversation engine, and exposes a localhost control API.
- **`lib/`** – shared Supabase clients, types, session encryption, worker client.
- **`supabase/migrations/`** – database schema (tables are prefixed `kw_`).

## Prerequisites

- Node.js 18+ (tested on 23).
- A Telegram **API ID** and **API Hash** (one set works for all accounts).
- An OpenAI API key.
- The Supabase project's **service role key**.

### 1. Get a Telegram API ID / Hash

1. Go to https://my.telegram.org and log in with your phone number.
2. Open **API development tools**.
3. Create an app (any title/short name). Platform can be "Desktop".
4. Copy the **api_id** and **api_hash** into `.env.local`.

### 2. Get your OpenAI key

Create a key at https://platform.openai.com/api-keys and put it in
`OPENAI_API_KEY`.

### 3. Supabase

The schema has already been applied to the Supabase project used here
(`aivaxrexit`). The public URL and anon key are pre-filled in `.env.local`.
You still need the **service role key**:

1. Supabase dashboard → Project Settings → API.
2. Copy the **service_role** secret into `SUPABASE_SERVICE_ROLE_KEY`.

To re-apply the schema elsewhere, run `supabase/migrations/0001_init.sql`.

## Setup

```bash
npm install
cp .env.example .env.local   # if not already present, then fill in values
```

Generate a session encryption key and paste it into `SESSION_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set a `WORKER_SECRET` to any random string (shared between the dashboard and
worker).

## Running

Run the worker and the dashboard in two terminals:

```bash
# Terminal 1 – Telegram worker + control API (port 8787)
npm run worker

# Terminal 2 – Next.js dashboard (port 3000)
npm run dev
```

Open http://localhost:3000.

## Usage

1. **Accounts** → *Add account*. Enter a label and the phone number
   (with country code, e.g. `+15551234567`). A login code is sent to that
   number's Telegram app. Enter the code (and 2FA password if the account has
   one). The encrypted session is stored so you only do this once.
2. **New campaign**:
   - Set the topic, style and optional extra instructions.
   - Choose the venue: **Group chat** (all accounts must be members of the
     target group — enter `@username` or numeric id) or **1-on-1 pairs**
     (accounts are paired consecutively; each needs a public username or to be
     in the other's contacts).
   - Select which accounts participate (2–12) and give each a persona.
   - Tune delays, total message count and the model.
   - Leave **Dry run** on to preview generated replies without sending.
3. **Monitor**: open the campaign and press **Start**. Watch messages stream in
   live, attributed to each persona. Pause, resume or stop at any time.

## Auto-reply (respond to incoming messages)

Separate from campaigns, each connected account can **listen for incoming
messages and reply automatically** with AI. Open the **Auto-reply** page and,
per account, set:

- A personality and instructions for how it should respond.
- **When to reply**: DMs only, DMs + group @mentions/replies, or all group
  messages.
- **Who to reply to**: existing contacts only (safest), a whitelist, or anyone
  (highest ban risk).
- Reply delay range and a daily reply limit.

Toggle it on and Save. The worker registers a live listener for that account;
replies appear in the live log on the same page. Built-in safety: it never
replies to your other controlled accounts (loop prevention), enforces a per-chat
cooldown and a daily budget, and uses human-like delays + typing indicators.

The account must be **online** for auto-reply to run. Enabled responders resume
automatically when the worker restarts.

## Dry run / test mode

When **Dry run** is enabled, the engine still selects speakers and generates
replies with OpenAI and logs them to the live feed, but does **not** connect to
or send anything via Telegram. Use it to validate prompts, personas and pacing
before going live.

## Safety controls

- Randomized per-message delay (`min`–`max` seconds) plus typing simulation.
- `FLOOD_WAIT` errors are caught and respected automatically.
- A hard cap on total messages per campaign.
- Telegram session strings are encrypted at rest (AES-256-GCM).

## Notes

- The worker must be running for login and live sending; the dashboard talks to
  it over `WORKER_URL`.
- This is a self-hosted, single-user tool. The browser uses a read-only anon
  key; all writes go through server routes / the worker using the service role.
```
