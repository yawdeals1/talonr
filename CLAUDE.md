# Talonr — Implementation Spec

Talonr is a multi-user lead scraper for X (Twitter). Each user connects and owns their own X
account(s); scrapes (search / followers / engagers — repliers or retweeters of a tweet) run
through a job queue against a saved,
authenticated X session; every scrape writes leads to Postgres completely **unfiltered**; saved
"lead lists" apply filters (bio keywords, follower range, location, verified-only) against
already-scraped data **at read time**, so one scrape serves unlimited filter iterations. Admins get
read-only cross-user visibility (users, accounts status, scrape jobs, activity feed) — never
impersonation, never raw session cookies.

Scope is X only (no LinkedIn/Telegram). This is a personal project. Automating X's non-public
interface violates X's Terms of Service — keep scrape volume conservative and configurable, never
hardcode aggressive defaults, and auto-pause an account on captcha/login-challenge/rate-limit
signals rather than retrying blindly.

A React + Vite frontend lives in `frontend/` (built from the Google Stitch design output —
per-screen `code.html` + `screen.png`, dark variant plus a `*_light` counterpart for each, and a
consolidated `talonr_operator_system/DESIGN.md` design system — saved at
`C:\Users\Caleb\OneDrive\Desktop\Talonr\stitch_talonr_operator_console`). It talks to this backend
over the REST API only, authenticating via the httpOnly `talonr_token` cookie the API sets on
login (`credentials: "include"` on every request, `frontend/src/api/client.ts`) — no token is ever
held in JS-readable storage. `npm run build` builds the frontend and copies its `dist/` into the
root `dist/`, served by the same Worker deploy.

## Tech stack

- Node.js + TypeScript (ESM, `"type": "module"`), Express 4
- Deploro's Studio DB — a REST-only, per-table Postgres API (`src/db/studio-client.ts`) — for all
  persistence. Not a direct Postgres connection: no ORM, no raw SQL from the app, no `pg`. Schema
  changes go through `deploro migrate create/apply` against the Studio DB, not a generated
  migration file in this repo. See "Data model" below for the real constraints this implies.
- BullMQ + ioredis for the job queue
- Playwright (chromium) for scraping
- Deploro Auth-as-a-Service (email+password provider) for identity/credentials; Talonr's own
  `users` table only holds local role + a pointer to the Deploro account, and never stores a
  password itself
- AES-256-GCM (Node's built-in `node:crypto`) for encrypting stored X session cookies and proxy
  credentials
- zod for request validation, pino for logging
- vitest for unit tests — service-layer ownership-isolation checks (accounts/scrapes/leads/
  lead-lists each mock `studio-client.ts` and assert a user requesting another user's row gets
  `NotFoundError` before any read/write/delete call), plus `rate-limit.ts`/`connect-token.ts`/
  `disposable-email.ts` coverage. `vitest.config.ts` stubs `config/env.ts`'s required vars so
  service modules import without real credentials.

Two separate runtime entrypoints — `src/server.ts` (HTTP API) and `src/worker.ts` (BullMQ worker)
— run as separate processes. Playwright workloads are heavy and shouldn't share an event loop with
the HTTP server. Run both locally (`npm run dev` / `npm run dev:worker`) and deploy both in
production.

## Project structure

```
src/
├── config/env.ts                     # zod-validated env loader — single source of truth for config
├── db/
│   ├── schema.ts                     # plain TS row interfaces (6 tables) + FilterDefinition — types only,
│   │                                    no ORM object; the real schema lives in a `deploro migrate` migration
│   └── studio-client.ts              # generic REST client for Deploro's Studio DB (list/get/insert/update/
│                                        delete), camelCase<->snake_case conversion, studioListSorted() for
│                                        client-side ordering (the Studio API has no ORDER BY)
├── modules/
│   ├── auth/          routes, controller, service, middleware, deploro-auth.client.ts
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
│   ├── profile-enricher.ts           # sequential profile visits for bio/followers/location/avatar
│   ├── detectors.ts                  # checkHealth(): captcha / login-challenge / rate-limit detection
│   ├── parsers/user-cell.parser.ts   # shared DOM extractor (X reuses UserCell across all 3 views)
│   └── sources/{search,followers,repliers,retweeters}.source.ts   # per-source buildUrl/waitForReady;
│                                        "likers" retired (X made "who liked" private platform-wide,
│                                        June 2024) — repliers/retweeters are the two strategies under
│                                        the "engagers" sourceType that replaced it
├── lib/{crypto.ts, logger.ts, errors.ts, async-handler.ts, rate-limit.ts, connect-token.ts,
│        disposable-email.ts}
├── app.ts                            # express app: helmet, cors, cookie-parser, routes, error handler
├── server.ts                         # HTTP entrypoint
└── worker.ts                         # BullMQ worker entrypoint
scripts/login.ts                      # standalone headed-Playwright interactive X login capture
```

**Module convention**: every feature module follows `*.routes.ts` (Express Router, wires
middleware) → `*.controller.ts` (parses/validates request with zod, calls service, shapes
response) → `*.service.ts` (Studio DB queries via `studio-client.ts`, business logic, always scoped
by `userId` for non-admin paths — never trusts a client-supplied `userId`).

## Data model (`src/db/schema.ts` types; real schema applied via `deploro migrate`)

**The Studio DB is a REST-only, per-table API — equality filters only, no ORDER BY, no bulk
upsert, no joins.** This shapes several service functions in ways worth knowing before touching
them:

- No `ORDER BY` support at all → every list function sorts client-side via
  `studioListSorted()` (pages through results up to a cap, then sorts in Node). **Every comparator
  passed to it must define a _total_ order — tie-break on `id`** (see
  `leads.service.ts#compareLeadsForDisplay`). Because the server has no ORDER BY, `studioListSorted`
  pages LIMIT/OFFSET over an unordered relation, and every lead written by one scrape shares
  essentially the same `lastSeenAt`; a comparator that leaves those ties unresolved returns a
  different order per request, so paging silently skipped some rows and repeated others.
- No bulk/upsert endpoint → `leads.service.ts#upsertLeads` does a bounded-concurrency (8) loop of
  one GET (existence check by the `user_id`+`handle` unique key) + one POST-or-PATCH per lead,
  instead of a single `INSERT ... ON CONFLICT`.
- No range/ILIKE filters → `filter-query-builder.ts#buildFilterPredicate` evaluates bio-keyword,
  follower-range, and location matching in-process against a capped, fetched set (equality filters
  like `verifiedOnly`/`sourceType` still push down to shrink what's fetched first). Same for
  `leads.service.ts#listLeads`'s handle substring search.
- No ownership-aware `WHERE id = X AND user_id = Y` on a by-id lookup → every "fetch a row I own"
  path is "fetch by id, then check `row.userId === userId` in code, else `NotFoundError`."

Accepted trade-off for this project's scrape-volume-capped, personal scale — would not hold up
against a large multi-tenant dataset.

- **users**: id (uuid), email (unique), deploro_account_id (text, unique — the Deploro
  Auth-as-a-Service account this row was auto-provisioned from), role (enum `user`|`admin`,
  default `user`), created_at
- **x_accounts**: id, user_id (FK→users, cascade), handle, encrypted_session (text, nullable —
  null until the login script runs), encrypted_proxy (text, nullable), status (enum
  `active`|`checkpointed`|`banned`, default `active`), daily_scrape_limit (int, default 150),
  max_concurrency (int, default 1), last_used_at, created_at. Unique on (user_id, handle).
- **scrape_jobs**: id, user_id (FK), x_account_id (FK), source_type (enum
  `search`|`followers`|`likers`|`engagers` — `likers` is legacy-only: X made "who liked a post"
  private platform-wide in June 2024 with no workaround, so `scrapes.controller.ts#createSchema`
  no longer accepts it for new jobs, kept solely so historical rows still typecheck), source_ref
  (text — keyword / target handle / tweet URL), engagement_types (jsonb array of
  `repliers`|`retweeters`, nullable — only set/meaningful when source_type is `engagers`, selects
  which of the two engagement-scraping strategies to run), status (enum
  `queued`|`running`|`completed`|`failed`|`paused`), leads_found (int), error_message
  (nullable), started_at, finished_at, created_at
- **leads**: id, user_id (FK), handle, display_name, bio, followers (nullable int — see caveat
  below), location, verified (bool), profile_image, source_type, source_ref, first_seen_at,
  last_seen_at. Unique on (user_id, handle) — scrape ingestion (`leads.service.ts#upsertLeads`)
  does a bounded-concurrency get-then-insert-or-update loop per lead (see "Data model" intro above)
  so re-scraping refreshes fields + `last_seen_at` without touching `first_seen_at`.
- **lead_lists**: id, user_id (FK), name, filter_definition (jsonb:
  `{bioKeywords?: string[], minFollowers?: number, maxFollowers?: number, location?: string,
  verifiedOnly?: boolean, maxLeads?: number}` — `maxLeads` caps the total matched leads a list
  evaluation returns across all pages, not a per-page size), created_at
- **activity_log**: id, user_id (FK), action (varchar), metadata (jsonb), created_at — powers the
  admin activity feed via `logActivity(userId, action, metadata)`

**Profile data**: X's list-view cells don't expose follower count or location, so every scrape now
visits each deduplicated lead's public profile sequentially before upsert and merges bio, follower
count, location, verification, and avatar into the same job. The profile delay is conservative and
configurable. `followers`/`location` remain nullable because profiles can omit them or be unavailable;
`filter-query-builder.ts` excludes NULL-follower rows from min/max-follower filters. Enrichment is
best-effort, so `leads.service.ts#upsertLeads` merges rather than overwrites on re-scrape — a run
whose enrichment failed must not null out a follower count/location already on file, or the lead
silently drops out of every range filter. Follower counts come from `pickFollowerCount`, which
prefers the stats link's exact `aria-label`/`title` ("6,412,338 Followers") over its rounded text
("6.4M"): reading the rounded value made an account with 999 followers store as 1000 and pass a
`minFollowers: 1000` filter it should have failed.

## Auth (`src/modules/auth/`)

Identity and credentials live in **Deploro Auth-as-a-Service** (email+password provider), not in
Talonr's own database — Talonr's Express API is a thin backend proxy in front of it
(`deploro-auth.client.ts` calls Deploro's platform Worker at
`{DEPLORO_AUTH_BASE_URL}/auth/{DEPLORO_PROJECT_SLUG}/*` server-to-server; those endpoints have a
CORS allowlist that only permits Deploro's own dashboard origins, so a browser can't call them
directly from Talonr's deployed frontend).

- `POST /api/auth/register` → calls Deploro's `email-password/signup`, returns `202 { message }`.
  Deploro requires the user to click an emailed confirmation link before they can log in — there is
  no instant-registration path, by Deploro's design. `registerSchema`
  (`auth.controller.ts`) also rejects disposable/temporary email domains before the request ever
  reaches Deploro, via `isDisposableEmail` (`src/lib/disposable-email.ts`). Seeded from the bundled
  `disposable-email-domains` npm package (offline/cold-start fallback only — services like
  10minutemail.net rotate through freshly-registered front-end domains faster than any pinned
  package version tracks; a real one, `laoia.com`, got through the bundled-only version of this
  check the same day it shipped), then kept current by fetching the actively-maintained
  `disposable-email-domains/disposable-email-domains` GitHub blocklist:
  `refreshDisposableEmailBlocklist()` runs once at server boot (`server.ts`, awaited, ~5s-bounded,
  best-effort) and `startDisposableEmailBlocklistRefresh()` re-runs it every 24h in the background
  (`setInterval(...).unref()`, never blocks a request). `isDisposableEmail` itself stays pure/
  synchronous — no I/O on the request path, no network dependency in tests. Still
  fundamentally a blocklist, so it only catches domains someone has already reported — a genuinely
  brand-new rotating domain (`careney.com`) got through even this live-refreshed version, checked
  against six independent sources, none of which had ever seen it. Scoped to registration only,
  not login/reset, so accounts that predate this check keep working.
  `register` also requires and verifies a Cloudflare Turnstile token
  (`turnstileToken` in the request body, `src/lib/turnstile.ts#verifyTurnstileToken`, canonical
  server-side `siteverify` call against `TURNSTILE_SECRET`) before either the disposable-email
  check or the Deploro signup call runs — this doesn't detect disposable domains itself, it raises
  the cost of *automated/scripted* mass signups, which is the realistic threat a domain-blocklist
  alone can't stop. Sitekey `0x4AAAAAAEK07r3BDXghCSWt` (widget name `talonr-register` in the
  Cloudflare dashboard, registered for `localhost`/`127.0.0.1`/`talonr.deploro.app`) is public and
  lives in `frontend/src/lib/config.ts`; the secret is server-only, `TURNSTILE_SECRET` env var,
  never sent to the frontend. Widget renders only on the Register tab of the shared
  `frontend/src/pages/LoginRegister.tsx` login/register form
  (`frontend/src/components/TurnstileWidget.tsx`, explicit JS-API render since the form is a
  controlled React submit, not a native form post) — login stays ungated since it doesn't create
  anything. Tokens are single-use, so a failed submit (validation error or a rejected `siteverify`)
  resets the widget for a fresh challenge before the next attempt.
- `POST /api/auth/login` → calls Deploro's `email-password/login`, gets back a Deploro session
  token, sets it as the httpOnly `talonr_token` cookie, and also returns it in the response body as
  `{ user, token }` for non-browser API consumers (also accepted via `Authorization: Bearer
  <token>` — `requireAuth` checks the cookie first, falling back to the header). The deployed
  frontend uses the cookie exclusively (`credentials: "include"` on every request,
  `frontend/src/api/client.ts`) and never persists the token itself.
- `requireAuth` (`auth.middleware.ts`) validates that token against Deploro's `GET
  /auth/{slug}/session` on every request (`auth.service.ts#validateAndSyncUser`), auto-provisioning
  a local `users` row on first sight of a given `deploro_account_id` — that local row is the FK
  anchor everywhere else (`x_accounts`, `scrape_jobs`, `leads`, `lead_lists`, `activity_log`) and
  the only place `role` lives. A short in-memory TTL cache (~10s, in `auth.middleware.ts`) sits in
  front of that Deploro round trip so it isn't on the hot path for every request — short enough
  that a revoked session or role change (e.g. banning a user) takes effect quickly rather than up
  to a minute later. `requireAdmin` checks `req.user.role === 'admin'` exactly as before —
  **promoting a user to admin is still a manual DB action**: `UPDATE users SET role = 'admin'
  WHERE email = '...'`.
- `POST /api/auth/logout` → best-effort revokes the Deploro session
  (`deploro-auth.client.ts#revokeSession`) before clearing the local cookie.
- Every auth route is Redis rate-limited (`src/lib/rate-limit.ts`, same atomic INCR+EXPIRE Lua
  pattern as `daily-quota.ts`): IP-based on all four, plus email-keyed limiting on login/reset —
  Talonr forwards every attempt to Deploro Auth, so without a limiter here credential
  stuffing/brute force costs real outbound requests regardless of Deploro's own protection.
  `POST /scrapes` has a separate user-keyed limiter for the same reason (nothing otherwise stops
  flooding `scrape_jobs` inserts that all instantly no-op past the per-account daily-quota check).
- `app.ts` also applies a default-deny gate ahead of the individual routers: every path under
  `/api/` requires auth unless it's explicitly listed as public (`/api/health`,
  `/api/auth/register|login|request-password-reset|reset-password`, plus `/api/accounts/session`
  and `/api/accounts/login-script` — see "Login flow" below for why those two are listed despite
  not actually being open). Each router still calls `requireAuth` itself too — the gate is a
  backstop against a future router forgetting to, not a replacement for the per-router check.

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
no retry — per the safety requirement. A `checkpointed`/`banned` account can't be flipped straight
back to `active` through `PATCH /accounts/:id` (`accounts.service.ts#updateAccount`) — that would
let a user silently bypass the safety trip; resuming requires re-running the login script.

## Scraper modules (`src/scraper/`)

Shared `ScrapeSource` interface (`buildUrl`, `waitForReady`, `extractVisibleItems`) implemented by
`sources/{search,followers,repliers,retweeters}.source.ts`, all sharing
`parsers/user-cell.parser.ts` since X reuses the same `[data-testid="UserCell"]` component across
search results, followers lists, and a tweet's reply/retweet lists.

**Extraction must stay scoped to `[data-testid="primaryColumn"]` and skip X's recommendation
modules** (`user-cell.parser.ts`, `tweet-author.parser.ts`). X builds the right-rail "Who to
follow" panel, in-timeline "You might like" carousels, and the "Discover more" block below a
thread out of the *same* `UserCell`/`article[data-testid="tweet"]` markup as the real list, so a
document-wide query mixed suggested accounts into every scrape — a followers scrape came back
containing accounts that don't follow the target at all, re-collected on each scroll round because
the sidebar never scrolls away. Suggestion blocks are detected conservatively (a `sidebarColumn`
ancestor, a recommendation `aria-label`, or document order after a recommendation heading): a miss
just keeps the cell, whereas an over-match would silently discard real leads. Sources also pass
`excludeHandles` for the page's own subject — an account never follows itself, and a tweet's
author isn't one of its engagers.

`repliers`/`retweeters` together are the `engagers` sourceType (`scrape_jobs.engagement_types` picks which run) — they
replaced `likers` after X made "who liked a post" private platform-wide in June 2024 with no
workaround; `likers` stays a legal `SourceType`/enum value only so historical `scrape_jobs`/`leads`
rows still typecheck, and is rejected at job-creation time for new jobs
(`scrapes.controller.ts#createSchema`). `scroll-collector.ts#scrollAndCollect` drives the run:
`goto` → `checkHealth` → `waitForReady` → loop until `capLeads` reached or 4 consecutive stagnant
scroll rounds → each round: `checkHealth`, `extractVisibleItems`, dedupe into an in-memory `Map`
keyed by lowercased handle, `page.mouse.wheel` scroll, random delay from
`SCROLL_DELAY_MIN_MS`/`SCROLL_DELAY_MAX_MS`. After collection, `profile-enricher.ts` visits every
unique profile sequentially using `PROFILE_DELAY_MIN_MS`/`PROFILE_DELAY_MAX_MS`, merges bio,
followers, location, verification, and avatar, then the worker upserts the complete leads.
`detectors.ts#checkHealth` checks URL patterns
(login/challenge/lockdown redirects), a captcha iframe selector, and X's own status text;
`watchForRateLimitResponses` listens for HTTP 429s and is wired into **both** the collection phase
(`scroll-collector.ts`) and profile enrichment — it's the authoritative throttling signal, since it
can't be faked by page content.

**Page-text detection must stay scoped and narrowly classified**, because a rate-limit match
checkpoints the X account and `accounts.service.ts#updateAccount` refuses to flip a checkpointed
account back to `active` — recovering from a false positive costs a full interactive re-login.
`collectSignalSnippets` (runs in-page; self-contained, no imports/closures, passed to
`page.evaluate`) walks individual text nodes, skipping user-generated content
(`UserCell`/`UserDescription`/`tweetText`/`User-Name`/`sidebarColumn`/`article`) and anything not
actually rendered; `classifyPageSignals` then splits the result two ways. Both halves replaced a
single document-wide `page.getByText(/rate limit|something went wrong.*reload|try again later/i)`
that matched hidden nodes and lead bios alike: it checkpointed a healthy account on a followers
scrape that had collected nothing yet.
- **`RateLimitedError`** (terminal, checkpoints the account) — only X's actual throttling wording.
- **`TransientPageError`** (retryable, *not* an `isAccountHealthError`) — X's generic "Something
  went wrong. Try reloading." boundary, which fires for any one-off failed request and is routinely
  on screen while the SPA hydrates, exactly when the first `checkHealth` runs. `openListPage`
  reloads up to 3 times on it; mid-scroll it just skips the round (reloading would reset to the top
  of the list) and counts a stagnant round. Exhausting the retries throws a plain `Error` so
  BullMQ's normal attempts/backoff apply instead of a checkpoint.

A run cut short still keeps its work: `scrollAndCollect` attaches whatever it collected to the
thrown error (`attachPartialLeads`/`getPartialLeads` in `scraper/types.ts`; `engagers` passes one
shared `into` map across both strategies so the first one's leads survive a failure in the second),
and the worker upserts those partials — skipping enrichment, which is the last thing to do while X
is pushing back — before checkpointing, so a throttled run reports the leads it got instead of `0`.

Source `sourceRef` semantics: `search` =
raw keyword/query string, `followers` = target handle (without `@`), `engagers` = full tweet URL.
`sourceRef` is validated against an X handle/tweet-URL shape (`scraper/types.ts`'s
`X_HANDLE_PATTERN`/`X_TWEET_URL_PATTERN`) both at job-creation time and again inside
`followers.source.ts`/`repliers.source.ts`/`retweeters.source.ts` — `buildUrl` feeds
`page.goto()` directly inside the worker's authenticated Playwright session, so an unvalidated
value there would let a user point the browser at an arbitrary URL (SSRF).

## REST API

All routes prefixed `/api`, JSON body/response. Auth column: `public`, `auth` (`requireAuth`), or
`admin` (`requireAuth` + `requireAdmin`).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /health | public | DB + Redis liveness check |
| POST | /auth/register | public | Create user via Deploro Auth (`turnstileToken` required + verified, disposable-email domains rejected, email confirmation required before login) |
| POST | /auth/login | public | Verify credentials via Deploro Auth, sets httpOnly cookie + returns Bearer token |
| POST | /auth/request-password-reset | public | Email a Deploro Auth password-reset link (anti-enumeration: always the same response) |
| POST | /auth/reset-password | public | Consume a reset token, set a new password via Deploro Auth |
| POST | /auth/logout | auth | Clears cookie |
| GET | /auth/me | auth | Current user profile |
| GET | /accounts | auth | List own x_accounts (status/limits only, never session data) |
| POST | /accounts | auth | Create an x_account row (handle + optional limits) — session is captured separately via `scripts/login.ts` |
| GET | /accounts/:id | auth | Own account detail |
| GET | /accounts/:id/connect-token | auth | Mint a short-lived (15 min), account-scoped connect token for `scripts/login.ts` |
| GET | /accounts/login-script | public | `scripts/login.ts`'s raw source, plain text — no secrets in it, and fetched by a terminal command with no browser session, so it can't require auth |
| POST | /accounts/session | connect token | `scripts/login.ts` posts a captured `storageState`/proxy back here, authenticated by the connect token instead of a Deploro session — listed in `app.ts`'s `PUBLIC_API_PATHS` for that reason, not because it's actually open |
| PATCH | /accounts/:id | auth | Update dailyScrapeLimit / maxConcurrency / status |
| DELETE | /accounts/:id | auth | Delete own account (cascades scrape_jobs) |
| POST | /scrapes | auth | Create a scrape_jobs row + enqueue BullMQ job (`xAccountId`, `sourceType`: `search`\|`followers`\|`engagers`, `sourceRef`, `engagementTypes?` required for `engagers`, `capLeads?`) — rate-limited per user |
| GET | /scrapes | auth | List own jobs, filterable by `status`/`xAccountId` |
| GET | /scrapes/:id | auth | Job detail/status |
| POST | /scrapes/:id/cancel | auth | Removes from queue if still waiting/delayed; best-effort if already running |
| DELETE | /scrapes/:id | auth | Deletes a non-running scrape record/queue entry; collected leads remain saved |
| GET | /leads | auth | Paginated own leads, filterable by `handle`/`sourceType`/`sourceRef`/`minFollowers`/`maxFollowers`/`location`; returns the full matched `total` alongside the page |
| GET | /leads/:id | auth | Lead detail |
| DELETE | /leads/:id | auth | Permanently delete one owned lead; saved lead-list results update automatically |
| GET | /lead-lists | auth | List own saved filters |
| POST | /lead-lists | auth | Create `{name, filterDefinition}` |
| GET | /lead-lists/:id | auth | Get filter definition |
| PATCH | /lead-lists/:id | auth | Update name/filterDefinition |
| DELETE | /lead-lists/:id | auth | Delete |
| GET | /lead-lists/:id/leads | auth | Evaluate the filter against `leads` at read time, paginated; returns the full matched `total` alongside the page |
| GET | /admin/users | admin | All users (id, email, role, createdAt — never deploro_account_id) |
| GET | /admin/users/:id/accounts | admin | That user's x_accounts, status/limits only |
| GET | /admin/scrape-jobs | admin | Cross-user scrape jobs, filterable by `userId`/`status` |
| GET | /admin/activity | admin | Cross-user activity_log, paginated, filterable by `userId`/`action` |

## npm scripts

```
dev / dev:worker        # tsx watch — local API / worker
build / start / start:worker   # tsc build then run compiled dist/
login:x                    # scripts/login.ts — interactive X session capture (operator convenience wrapper;
                              # the script itself is a standalone file any account owner can run — see "Login flow")
typecheck / lint          # tsc --noEmit / eslint .
test                        # vitest run — service-layer ownership isolation + lib unit tests
```

Schema changes are **not** an npm script — they're `deploro migrate create --up-file ... --down-file
...` followed by `deploro migrate apply`, run against Talonr's Studio DB directly via the `deploro`
CLI, not tracked as generated files in this repo.

## Env vars (see `.env.example`)

`REDIS_URL`, `REDIS_URL_INTERNAL` (optional — internal Docker-network Redis connection string,
preferred over `REDIS_URL` when the VPS's compute stack and its Redis container share a network,
avoiding a same-host NAT hairpin round trip), `SESSION_ENCRYPTION_KEY` (32 bytes, base64 —
`openssl rand -base64 32`), `TURNSTILE_SECRET` (Cloudflare Turnstile secret for the
`talonr-register` widget — registration only, see "Auth" above),
`DEPLORO_AUTH_BASE_URL` (Deploro's platform Worker, hosting the Auth-as-a-Service routes),
`DEPLORO_PROJECT_SLUG` (default `talonr`), `DEPLORO_STUDIO_API_URL` (Talonr's Studio DB REST base,
`{DEPLORO_AUTH_BASE_URL}/api/projects/{id}/studio`), `DEPLORO_STUDIO_API_TOKEN` (a project-scoped
Deploro PAT — `deploro token create <name> --project talonr`), `PORT`, `NODE_ENV`, `COOKIE_SECURE`,
`ALLOWED_ORIGIN`, `WORKER_CONCURRENCY`, `DEFAULT_DAILY_SCRAPE_LIMIT`,
`DEFAULT_MAX_CONCURRENCY_PER_ACCOUNT`, `SCRAPE_CAP_LEADS_DEFAULT`, `SCROLL_DELAY_MIN_MS`,
`SCROLL_DELAY_MAX_MS`, `PROFILE_DELAY_MIN_MS`, `PROFILE_DELAY_MAX_MS`. All validated at boot by
`src/config/env.ts` (zod) — the process throws
immediately on an invalid/missing var rather than failing later. No `DATABASE_URL` — there is no
direct Postgres connection anywhere in this app.

## Login flow

X login can't be automated headlessly (2FA/captchas), so it has to run on whatever machine the
account owner is at — which, for any user besides the operator, means a machine with no checkout
of this repo and no access to `DEPLORO_STUDIO_API_TOKEN` or `SESSION_ENCRYPTION_KEY`.
`scripts/login.ts` is written to that constraint: it has **zero internal imports** — no
`studio-client.ts`, no `lib/crypto.ts`, no `session-store.ts` — only `playwright` and the network.
It launches a **headed** Playwright browser (`channel: "chrome"` — real installed Chrome, not
Playwright's bundled Chromium build), waits for manual login, captures `context.storageState()`,
and POSTs it (plus any `--proxy` credentials) as JSON to `POST /api/accounts/session`,
authenticated with a connect token instead of a Deploro session.

X's own bot/fraud detection (Arkose Labs, Socure — both visible in X's CSP allowlist) can block
that automated login outright regardless of the Chrome binary underneath, since it detects the
CDP-automated session itself — confirmed live, not hypothetical. This tool deliberately does not
try to spoof or evade that detection. The fallback is `--import-cookies`
(`captureViaCookieImport` in `login.ts`), which skips driving a login entirely: it prompts for
`auth_token`/`ct0` (required) and `twid`/`guest_id` (optional), copied out of DevTools on a
regular, already-authenticated browser, and builds a minimal `storageState` from just those. Uses
the readline async-iterator form (`rl[Symbol.asyncIterator]()`), not repeated `rl.question()`
calls — the latter silently hangs after the first prompt when stdin isn't a real TTY, a real bug
caught by testing this against piped/redirected stdin before shipping it.

The web app's "Finish connecting" screen (`frontend/src/pages/XAccounts.tsx`) is the actual
distribution path: it calls `GET /accounts/:id/connect-token` to mint a token scoped to that one
account (`lib/connect-token.ts` — HMAC-signed, 15-minute TTL, verified server-side in
`accounts.controller.ts#saveSession`, never persisted), and builds one OS-specific,
copy-pasteable shell command (`buildLoginCommand` in `XAccounts.tsx`) that fetches
`scripts/login.ts`'s source from `GET /accounts/login-script` into a fixed folder
(`~/talonr-login`) and runs it from there in the same command — not a separate "download it, then
remember where your browser put it" step, which is exactly what broke in practice: the browser's
Downloads folder and wherever the terminal happens to be aren't the same place. Both
`/accounts/session` and `/accounts/login-script` are listed in `app.ts`'s `PUBLIC_API_PATHS` —
not because they're actually open, but because a terminal command has no browser session cookie to
send; `/session` authenticates via the connect token instead, and `/login-script` needs no auth at
all since the file itself holds no secrets (it's the same source already public in the repo).
Encryption still only ever happens server-side in `accounts.service.ts#saveAccountSession` (via
`session-store.ts`) — the script never sees `SESSION_ENCRYPTION_KEY` and the raw `storageState`
only exists in transit over that one POST. `npm run login:x` still works locally as a convenience
wrapper around the same file.

## Known limitations / non-goals

- No admin impersonation/session-switching — admin routes are strictly read-only cross-user views.
- No refresh-token rotation — Deploro session tokens expire after 7 days, re-login after that.
- `POST /scrapes/:id/cancel` can't hard-kill an in-flight Playwright run; it only removes
  not-yet-started (waiting/delayed) jobs from the queue.
- Studio DB constraints (see "Data model" above) mean lead-list filtering and the leads
  handle-search run in-process over a capped fetch rather than in SQL, and `upsertLeads` is N
  bounded-concurrency REST calls instead of one bulk statement — both fine at this project's scale,
  neither would scale to a large multi-tenant dataset. Same reason there's no database-level
  tenant isolation (no RLS-equivalent on the Studio DB) — every ownership check ("fetch a row I
  own") is enforced only in the Express service layer (`findOwnedOrThrow`-style patterns), with no
  DB-level backstop. The compensating control is test coverage, not a code fix: each of
  accounts/scrapes/leads/lead-lists has a vitest suite mocking `studio-client.ts` and asserting a
  cross-user fetch/update/delete gets `NotFoundError` before the underlying call ever runs, so a
  regression in one of those checks fails CI instead of shipping silently.
- The VPS Postgres container this app used before the Studio DB migration is still provisioned and
  running, unused, on the shared VPS — the `deploro` CLI has no delete/teardown route for VPS
  Postgres or Redis specifically, only `vps deploy` for the compute stack as a whole.
- The deployed frontend's Cloudflare Worker (`worker.js`, proxies `/backend/*` to the VPS-hosted
  API — see its own comments for the `/api`-reservation and raw-IP-literal workarounds this needed)
  forwards to the VPS over plain `http://`, not `https://` — the VPS is shared across multiple
  Deploro projects and its ports 80/443 already belong to the platform's own nginx, so a
  per-project TLS-terminating reverse proxy (e.g. Caddy) can't bind the ports ACME validation
  needs. A prior attempt at this (2026-08-07) failed with "address already in use" on :80 and
  briefly broke the public route to the API until reverted. Every request this Worker forwards,
  including login/register bodies and Bearer tokens, crosses the public internet unencrypted until
  this gets a real fix: either an owned domain with a DNS-01 challenge (no inbound port required),
  or a routing rule on the platform's shared nginx forwarding ACME HTTP-01 challenges through to
  this project's container — neither is achievable from this repo alone.
