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

Node.js + TypeScript, Express, Drizzle ORM (Postgres), BullMQ + Redis, Playwright.

## Setup

1. **Install dependencies**
   ```
   npm install
   npx playwright install chromium
   ```

2. **Configure environment** — copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — your Postgres connection string (a Deploro-hosted instance, or any Postgres).
   - `REDIS_URL` — your Redis connection string, used by BullMQ.
   - `JWT_SECRET` — a long random string.
   - `SESSION_ENCRYPTION_KEY` — 32 random bytes, base64-encoded. Generate with:
     ```
     openssl rand -base64 32
     ```
   - The rest have sane defaults (worker concurrency, per-account limits, scroll delay range).

3. **Run migrations**
   ```
   npm run db:generate   # only needed after changing src/db/schema.ts
   npm run db:migrate
   ```

## Running it

Talonr runs as two separate processes — the HTTP API and the BullMQ worker — since Playwright's
browser automation is heavy and shouldn't share an event loop with the API server.

```
npm run dev          # HTTP API on $PORT (default 3000)
npm run dev:worker    # BullMQ scrape worker (needs Redis running)
```

Both need `DATABASE_URL` and `REDIS_URL` reachable. Build the API/worker for production with
`npm run build:api`, then run `npm start` / `npm run start:worker`. (`npm run build` at the repo
root builds the `frontend/` static site instead — used by the Cloudflare Worker/Pages deploy — the
Docker image builds the API with `build:api`.)

## Connecting an X account (the login flow)

X login can't be automated headlessly (2FA, captchas), so session capture is a local, interactive
script — not an API call:

```
npm run login:x -- --userId <your-user-uuid> --handle <x-handle> [--proxy http://user:pass@host:port]
```

This opens a real (headed) Chromium window. Log in manually, complete any 2FA/captcha, and once
you land on `x.com/home` the script captures the session (cookies + storage), encrypts it with
`SESSION_ENCRYPTION_KEY`, and upserts an `x_accounts` row for that user/handle — creating the row
if it doesn't exist yet, or refreshing its session if it does. Get your user UUID from
`POST /api/auth/register` or `GET /api/auth/me`.

The encrypted session is only ever decrypted inside the worker process, right before launching a
scrape; no API response (including admin routes) ever returns it.

## Running a scrape

1. Register/login to get a JWT (returned in the response body and also set as an httpOnly cookie).
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

Promoting a user to admin is a manual DB action (no self-serve admin signup):

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
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
