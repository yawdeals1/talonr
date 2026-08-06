# Talonr — Implementation Spec

Talonr is a multi-user lead scraper for X (Twitter). Each user connects and owns their own X
account(s); scrapes (search / followers / likers) run through a job queue against a saved,
authenticated X session; every scrape writes leads to Postgres completely **unfiltered**; saved
"lead lists" apply filters (bio keywords, follower range, location, verified-only) against
already-scraped data **at read time**, so one scrape serves unlimited filter iterations. Admins get
read-only cross-user visibility (users, accounts status, scrape jobs, activity feed) — never
impersonation, never raw session cookies.

Scope is X only (no LinkedIn/Telegram). This is a personal project. Automating X's non-public
interface violates X's Terms of Service — keep scrape volume conservative and configurable, never
hardcode aggressive defaults, and auto-pause an account on captcha/login-challenge/rate-limit
signals rather than retrying blindly.

**No frontend code lives in this repo yet.** The UI is generated separately with Google Stitch from
`SCREENS.md`. This backend exposes a REST API only. Stitch's generated design output (per-screen
`code.html` + `screen.png`, dark variant plus a `*_light` counterpart for each, and a consolidated
`talonr_operator_system/DESIGN.md` design system) is saved at
`C:\Users\Caleb\OneDrive\Desktop\Talonr\stitch_talonr_operator_console` — this is the source design
to build the real frontend from when that work starts.

## Tech stack

- Node.js + TypeScript (ESM, `"type": "module"`), Express 4
- Drizzle ORM + drizzle-kit, Postgres (via `pg`)
- BullMQ + ioredis for the job queue
- Playwright (chromium) for scraping
- JWT (jsonwebtoken) in an httpOnly cookie for auth, bcryptjs for password hashing
- AES-256-GCM (Node's built-in `node:crypto`) for encrypting stored X session cookies and proxy
  credentials
- zod for request validation, pino for logging

Two separate runtime entrypoints — `src/server.ts` (HTTP API) and `src/worker.ts` (BullMQ worker)
— run as separate processes. Playwright workloads are heavy and shouldn't share an event loop with
the HTTP server. Run both locally (`npm run dev` / `npm run dev:worker`) and deploy both in
production.

## Project structure

```
src/
├── config/env.ts                     # zod-validated env loader — single source of truth for config
├── db/
│   ├── schema.ts                     # Drizzle tables + enums (6 tables) + FilterDefinition type
│   ├── relations.ts                  # drizzle relations() for query joins
│   ├── client.ts                     # pg Pool + drizzle() instance (`db`, `pool`)
│   └── migrate.ts                    # programmatic migration runner (npm run db:migrate)
├── modules/
│   ├── auth/          routes, controller, service, middleware, jwt.ts, password.ts
│   ├── accounts/       routes, controller, service       — X account CRUD, own-scoped
│   ├── scrapes/        routes, controller, service       — trigger/list/detail/cancel scrape jobs
│   ├── leads/           routes, controller, service       — read scraped leads + upsertLeads()
│   ├── lead-lists/     routes, controller, service, filter-query-builder.ts
│   ├── admin/           routes, controller, service       — cross-user read-only routes
│   └── activity/        activity.service.ts               — logActivity(), used by other modules
├── queue/
│   ├── connection.ts                 # ioredis connection (maxRetriesPerRequest: null, required by BullMQ)
│   ├── queues.ts                     # scrapeQueue definition + ScrapeJobData type
│   ├── rate-limit/
│   │   ├── account-semaphore.ts      # Lua-scripted per-account concurrency slot (sorted-set based)
│   │   └── daily-quota.ts            # Lua-scripted per-account daily counter
│   └── workers/scrape.worker.ts      # Worker + processor: guard logic, scrape execution, lead upsert
├── scraper/
│   ├── types.ts                      # RawLead, ScrapeSource, ScrapeSourceContext, typed health errors
│   ├── browser.ts                    # launches a Playwright context from decrypted storageState + proxy
│   ├── session-store.ts              # encrypt/decrypt storageState + proxy config (wraps lib/crypto)
│   ├── scroll-collector.ts           # shared scroll-and-collect engine (dedupe, cap, random delay)
│   ├── detectors.ts                  # checkHealth(): captcha / login-challenge / rate-limit detection
│   ├── parsers/user-cell.parser.ts   # shared DOM extractor (X reuses UserCell across all 3 views)
│   └── sources/{search,followers,likers}.source.ts   # per-source buildUrl/waitForReady
├── lib/{crypto.ts, logger.ts, errors.ts, async-handler.ts}
├── app.ts                            # express app: helmet, cors, cookie-parser, routes, error handler
├── server.ts                         # HTTP entrypoint
└── worker.ts                         # BullMQ worker entrypoint
scripts/login.ts                      # standalone headed-Playwright interactive X login capture
drizzle/migrations/                   # generated SQL migrations (npm run db:generate)
```

**Module convention**: every feature module follows `*.routes.ts` (Express Router, wires
middleware) → `*.controller.ts` (parses/validates request with zod, calls service, shapes
response) → `*.service.ts` (DB queries via Drizzle, business logic, always scoped by `userId` for
non-admin paths — never trusts a client-supplied `userId`).

## Data model (`src/db/schema.ts`)

- **users**: id (uuid), email (unique), password_hash, role (enum `user`|`admin`, default `user`), created_at
- **x_accounts**: id, user_id (FK→users, cascade), handle, encrypted_session (text, nullable —
  null until the login script runs), encrypted_proxy (text, nullable), status (enum
  `active`|`checkpointed`|`banned`, default `active`), daily_scrape_limit (int, default 150),
  max_concurrency (int, default 1), last_used_at, created_at. Unique on (user_id, handle).
- **scrape_jobs**: id, user_id (FK), x_account_id (FK), source_type (enum
  `search`|`followers`|`likers`), source_ref (text — keyword / target handle / tweet URL), status
  (enum `queued`|`running`|`completed`|`failed`|`paused`), leads_found (int), error_message
  (nullable), started_at, finished_at, created_at
- **leads**: id, user_id (FK), handle, display_name, bio, followers (nullable int — see caveat
  below), location, verified (bool), profile_image, source_type, source_ref, first_seen_at,
  last_seen_at. Unique on (user_id, handle) — scrape ingestion (`leads.service.ts#upsertLeads`)
  does a bulk `INSERT ... ON CONFLICT (user_id, handle) DO UPDATE SET ... = excluded.*` so
  re-scraping refreshes fields + `last_seen_at` without touching `first_seen_at`.
- **lead_lists**: id, user_id (FK), name, filter_definition (jsonb:
  `{bioKeywords?: string[], minFollowers?: number, maxFollowers?: number, location?: string,
  verifiedOnly?: boolean}`), created_at
- **activity_log**: id, user_id (FK), action (varchar), metadata (jsonb), created_at — powers the
  admin activity feed via `logActivity(userId, action, metadata)`

**Caveat**: X's list-view cells (search/followers/likers) don't expose follower count without
visiting the profile page, so `leads.followers` is frequently `NULL` from scraping alone.
`filter-query-builder.ts` excludes NULL-follower rows from min/max-follower filters rather than
erroring. A profile-visit enrichment pass would multiply request volume against X and is
deliberately out of scope.

## Auth (`src/modules/auth/`)

JWT (HS256, `JWT_SECRET`, 7-day expiry, claims `sub`/`email`/`role`) set as an httpOnly cookie
(`talonr_token`); also accepted via `Authorization: Bearer <token>` for non-browser clients.
`requireAuth` middleware (`auth.middleware.ts`) populates `req.user`; `requireAdmin` checks
`req.user.role === 'admin'`. Registration (`POST /api/auth/register`) always forces `role: 'user'`
— **promoting a user to admin is a manual DB action**: `UPDATE users SET role = 'admin' WHERE
email = '...'`. Passwords hashed with bcryptjs, cost factor 12.

## Session & proxy encryption (`src/lib/crypto.ts`, `src/scraper/session-store.ts`)

AES-256-GCM, key from `SESSION_ENCRYPTION_KEY` env var (32 raw bytes, base64). Envelope format:
`v1.<iv>.<authTag>.<ciphertext>` (all base64) — the `v1` prefix allows future key-version rotation.
Used for both `x_accounts.encrypted_session` (Playwright `storageState()` JSON) and
`encrypted_proxy` (`{server, username?, password?}` JSON). **Decryption only ever happens inside
the worker process** (`scrape.worker.ts` → `session-store.ts`). No API response — including admin
routes — ever serializes these fields; `accounts.service.ts#toPublic` and
`admin.service.ts#listUserAccounts` explicitly select/return only `hasSession`/`hasProxy` booleans
and status/limit fields.

## Job queue & per-account rate limiting (`src/queue/`)

One global `scrapeQueue` (BullMQ), one `Worker('scrape', processor, { concurrency:
WORKER_CONCURRENCY })` — an env-configurable ceiling on parallel Playwright instances across *all*
accounts. BullMQ OSS has no built-in per-key concurrency/rate-limit, so per-account fairness is
enforced **inside the processor** via two Redis Lua-scripted primitives:

1. **`account-semaphore.ts`** — `sem:xaccount:{id}`, a sorted set (member = random token, score =
   expiry epoch-ms). Atomic acquire: evict stale entries (`ZREMRANGEBYSCORE`), check `ZCARD <
   maxConcurrency`, `ZADD`. Release: `ZREM`. Self-expiring (15-minute slot TTL) so a crashed worker
   never permanently wedges an account.
2. **`daily-quota.ts`** — `quota:xaccount:{id}:{YYYY-MM-DD}` (UTC), atomic `INCR`+check+`EXPIRE`
   Lua script (~26h TTL). Date-scoped key name means no explicit reset job is needed.

When a job can't get a semaphore slot, the processor calls `job.moveToDelayed(Date.now() +
jitter, token)` and throws `DelayedError` — BullMQ's mechanism to reschedule without consuming a
global worker slot or incrementing `attemptsMade`. A busy account's backlog cycles through short
delays (3–8s jitter) instead of starving other accounts' jobs, since the shared global concurrency
ceiling is filled fairly by whichever accounts currently have free slots. Quota-exceeded jobs are
marked `paused` (terminal for the day, no retry storm). Real errors (network blips, unexpected
exceptions) use BullMQ's normal `attempts: 3` + exponential backoff (set in `queues.ts`'s
`defaultJobOptions`). Captcha/login-challenge/rate-limit detection during a run
(`isAccountHealthError`) sets the account to `checkpointed` and marks the job `paused` — terminal,
no retry — per the safety requirement.

## Scraper modules (`src/scraper/`)

Shared `ScrapeSource` interface (`buildUrl`, `waitForReady`, `extractVisibleItems`) implemented by
`sources/{search,followers,likers}.source.ts`, all sharing `parsers/user-cell.parser.ts` since X
reuses the same `[data-testid="UserCell"]` component across search results, followers lists, and
likers lists. `scroll-collector.ts#scrollAndCollect` drives the run: `goto` → `checkHealth` →
`waitForReady` → loop until `capLeads` reached or 4 consecutive stagnant scroll rounds → each
round: `checkHealth`, `extractVisibleItems`, dedupe into an in-memory `Map` keyed by lowercased
handle, `page.mouse.wheel` scroll, random delay from `SCROLL_DELAY_MIN_MS`/`SCROLL_DELAY_MAX_MS`.
`detectors.ts#checkHealth` checks URL patterns (login/challenge/lockdown redirects), a captcha
iframe selector, and rate-limit text on the page; `watchForRateLimitResponses` also listens for
HTTP 429s. Source `sourceRef` semantics: `search` = raw keyword/query string, `followers` = target
handle (without `@`), `likers` = full tweet URL (`/likes` is appended if missing).

## REST API

All routes prefixed `/api`, JSON body/response. Auth column: `public`, `auth` (`requireAuth`), or
`admin` (`requireAuth` + `requireAdmin`).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /health | public | DB + Redis liveness check |
| POST | /auth/register | public | Create user (role forced to `user`), sets JWT cookie |
| POST | /auth/login | public | Verify credentials, sets JWT cookie |
| POST | /auth/logout | auth | Clears cookie |
| GET | /auth/me | auth | Current user profile |
| GET | /accounts | auth | List own x_accounts (status/limits only, never session data) |
| POST | /accounts | auth | Create an x_account row (handle + optional limits) — session is captured separately via `npm run login:x` |
| GET | /accounts/:id | auth | Own account detail |
| PATCH | /accounts/:id | auth | Update dailyScrapeLimit / maxConcurrency / status |
| DELETE | /accounts/:id | auth | Delete own account (cascades scrape_jobs) |
| POST | /scrapes | auth | Create a scrape_jobs row + enqueue BullMQ job (`xAccountId`, `sourceType`, `sourceRef`, `capLeads?`) |
| GET | /scrapes | auth | List own jobs, filterable by `status`/`xAccountId` |
| GET | /scrapes/:id | auth | Job detail/status |
| POST | /scrapes/:id/cancel | auth | Removes from queue if still waiting/delayed; best-effort if already running |
| GET | /leads | auth | Paginated own leads, filterable by `handle`/`sourceType` |
| GET | /leads/:id | auth | Lead detail |
| GET | /lead-lists | auth | List own saved filters |
| POST | /lead-lists | auth | Create `{name, filterDefinition}` |
| GET | /lead-lists/:id | auth | Get filter definition |
| PATCH | /lead-lists/:id | auth | Update name/filterDefinition |
| DELETE | /lead-lists/:id | auth | Delete |
| GET | /lead-lists/:id/leads | auth | Evaluate the filter against `leads` at read time, paginated |
| GET | /admin/users | admin | All users (id, email, role, createdAt — never password_hash) |
| GET | /admin/users/:id/accounts | admin | That user's x_accounts, status/limits only |
| GET | /admin/scrape-jobs | admin | Cross-user scrape jobs, filterable by `userId`/`status` |
| GET | /admin/activity | admin | Cross-user activity_log, paginated, filterable by `userId`/`action` |

## npm scripts

```
dev / dev:worker        # tsx watch — local API / worker
build / start / start:worker   # tsc build then run compiled dist/
db:generate              # drizzle-kit generate — after changing src/db/schema.ts
db:migrate                # runs drizzle/migrations/ against DATABASE_URL
db:studio                  # drizzle-kit studio
login:x                    # scripts/login.ts — interactive X session capture
typecheck / lint          # tsc --noEmit / eslint .
```

## Env vars (see `.env.example`)

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SESSION_ENCRYPTION_KEY` (32 bytes, base64 — `openssl
rand -base64 32`), `PORT`, `NODE_ENV`, `COOKIE_SECURE`, `ALLOWED_ORIGIN`, `WORKER_CONCURRENCY`,
`DEFAULT_DAILY_SCRAPE_LIMIT`, `DEFAULT_MAX_CONCURRENCY_PER_ACCOUNT`, `SCRAPE_CAP_LEADS_DEFAULT`,
`SCROLL_DELAY_MIN_MS`, `SCROLL_DELAY_MAX_MS`. All validated at boot by `src/config/env.ts` (zod) —
the process throws immediately on an invalid/missing var rather than failing later.

## Login flow

X login can't be automated headlessly (2FA/captchas). `scripts/login.ts` launches a **headed**
Playwright browser locally, waits for manual login, captures `context.storageState()`, encrypts it
(plus any `--proxy` credentials) via `session-store.ts`, and upserts directly into `x_accounts`
using the same `db` client and `lib/crypto.ts` as the app — no HTTP round trip. See README for the
exact command.

## Known limitations / non-goals

- No follower-count enrichment pass (would multiply scrape volume against X) — `leads.followers`
  is frequently null from list-view scraping.
- No admin impersonation/session-switching — admin routes are strictly read-only cross-user views.
- No refresh-token rotation — 7-day JWT expiry, re-login after that.
- `POST /scrapes/:id/cancel` can't hard-kill an in-flight Playwright run; it only removes
  not-yet-started (waiting/delayed) jobs from the queue.
