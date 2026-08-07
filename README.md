# Talonr

Talonr is a multi-user lead scraper for X (Twitter). Each user connects their own X account(s) and
runs scrapes (search / followers / likers) through a job queue; every scrape writes leads to the
database completely unfiltered, and saved "lead lists" apply bio/follower/location/verified filters
against already-scraped data at read time. Admins get read-only visibility across all users'
accounts, scrape jobs, and an activity feed — no impersonation.

This is a personal project. Automating X's non-public interface is a violation of X's Terms of
Service — use your own accounts, keep scrape volume conservative, and respect the per-account
limits described below.

## Stack

Node.js + TypeScript, Express, Deploro Studio DB (REST-only Postgres API, no ORM/direct
connection), Deploro Auth-as-a-Service (identity/credentials), BullMQ + Redis, Playwright.

## Setup

1. **Install dependencies**
   ```
   npm install
   npx playwright install chromium
   ```

2. **Configure environment** — copy `.env.example` to `.env` and fill in:
   - `REDIS_URL` — your Redis connection string, used by BullMQ.
   - `DEPLORO_AUTH_BASE_URL` / `DEPLORO_PROJECT_SLUG` — Deploro's platform Worker hosting the
     Auth-as-a-Service routes, and this project's slug.
   - `DEPLORO_STUDIO_API_URL` / `DEPLORO_STUDIO_API_TOKEN` — Talonr's Studio DB REST base and a
     project-scoped PAT (`deploro token create <name> --project talonr`).
   - `SESSION_ENCRYPTION_KEY` — 32 random bytes, base64-encoded. Generate with:
     ```
     openssl rand -base64 32
     ```
   - The rest have sane defaults (worker concurrency, per-account limits, scroll delay range).
   - No `DATABASE_URL` — there is no direct Postgres connection anywhere in this app.

3. **Apply the schema** — not an npm script. Schema changes go through the `deploro` CLI directly
   against the Studio DB:
   ```
   deploro migrate create <name> --up-file <path> --down-file <path>
   deploro migrate apply <name>
   ```

## Running it

Talonr runs as two separate processes — the HTTP API and the BullMQ worker — since Playwright's
browser automation is heavy and shouldn't share an event loop with the API server.

```
npm run dev          # HTTP API on $PORT (default 3000)
npm run dev:worker    # BullMQ scrape worker (needs Redis running)
```

Both need the Studio DB (`DEPLORO_STUDIO_API_URL`/`DEPLORO_STUDIO_API_TOKEN`) and `REDIS_URL`
reachable. Build the API/worker for production with
`npm run build:api`, then run `npm start` / `npm run start:worker`. (`npm run build` at the repo
root builds the `frontend/` static site instead — used by the Cloudflare Worker/Pages deploy — the
Docker image builds the API with `build:api`.)

## Connecting an X account (the login flow)

X login can't be automated headlessly (2FA, captchas), so session capture is a local, interactive
script — not an API call. It's a standalone file (`scripts/login.ts`): no import from the rest of
this repo, no `.env`, no `DEPLORO_STUDIO_API_TOKEN` or `SESSION_ENCRYPTION_KEY`. That matters
because most Talonr users are *not* the operator running this repo — they're someone who signed up
on the deployed frontend and has none of those secrets, possibly not even a clone of this repo.

The normal path is entirely through the web app: add an account, then the "Finish connecting"
dialog gives you a **Download talonr-login.ts** link and a ready-to-run command with a short-lived
(15 min), single-account connect token baked in:

```
npm install playwright   # once
npx tsx talonr-login.ts --endpoint <url> --token <connect-token> --handle <x-handle> \
  [--proxy http://user:pass@host:port]
```

This opens a real (headed) Chromium window. Log in manually, complete any 2FA/captcha, and once you
land on `x.com/home` the script captures the session (cookies + storage) and POSTs it to `POST
/api/accounts/session`, authenticated by the connect token rather than a login session. The server
encrypts it with `SESSION_ENCRYPTION_KEY` and updates the `x_accounts` row the token was scoped to
— the script itself never touches that key. If you're the operator working locally, `npm run
login:x -- --endpoint <url> --token <connect-token> --handle <x-handle>` runs the same file as a
convenience wrapper.

The encrypted session is only ever decrypted inside the worker process, right before launching a
scrape; no API response (including admin routes) ever returns it.

## Running a scrape

1. Register/login to get a session token (returned in the response body and also set as an httpOnly
   cookie) — registration goes through Deploro Auth and requires clicking an emailed confirmation
   link before the account can log in.
2. Confirm the account has a captured session: `GET /api/accounts` → `hasSession: true`.
3. Trigger a scrape:
   ```
   POST /api/scrapes
   { "xAccountId": "...", "sourceType": "search", "sourceRef": "some keyword", "capLeads": 50 }
   ```
   `sourceType` is one of `search` (keyword), `followers` (target handle), or `likers` (full tweet
   URL, `sourceRef` = the tweet's URL).
4. Poll `GET /api/scrapes/:id` until `status` is `completed` (or `failed`/`paused`).
5. Leads land unfiltered in `GET /api/leads`. Save a reusable filter with
   `POST /api/lead-lists` (`filterDefinition`: `bioKeywords`, `minFollowers`, `maxFollowers`,
   `location`, `verifiedOnly`) and read filtered results via `GET /api/lead-lists/:id/leads` —
   re-running the filter never re-scrapes.

### Per-account limits and safety

Each `x_accounts` row has its own `dailyScrapeLimit` and `maxConcurrency` (editable via
`PATCH /api/accounts/:id`), enforced independently per account inside the worker via Redis —
one account's backlog or limits never affect another user's account. If a scrape run hits a
captcha, login challenge, or rate-limit signal mid-run, the account is automatically set to
`checkpointed` and the job is marked `paused` rather than being blindly retried. A `checkpointed`
or `banned` account can't be used to trigger new scrapes until manually set back to `active`.

## Admin routes

Promoting a user to admin is a manual DB action (no self-serve admin signup). There's no raw SQL
access (Studio DB is REST-only) — do it via the `deploro` CLI:

```
deploro db rows users                          # find the user's id
deploro db update users <id> --data '{"role":"admin"}'
```

Admins keep their own personal scope (own accounts/scrapes/leads) plus read-only cross-user routes:

- `GET /api/admin/users`
- `GET /api/admin/users/:id/accounts` — status/limits only, never session data
- `GET /api/admin/scrape-jobs`
- `GET /api/admin/activity`

There is no impersonation or session-switching for admins.

## Project layout

See `CLAUDE.md` / `AGENTS.md` for the full architecture spec (data model, module layout, queue
design, REST endpoint table) intended as persistent context for AI coding agents working in this
repo.
