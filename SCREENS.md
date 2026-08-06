# Talonr — Screens Brief for Google Stitch

This is a functional/content brief for every screen the Talonr UI needs, plus a short visual
direction. Talonr is a personal-project SaaS dashboard for scraping and browsing X (Twitter)
leads — not a marketing site — so screens are data-dense, utilitarian, and built for someone
running scrapes and triaging leads daily, not for outside visitors.

The backend is a REST API (see `CLAUDE.md` for the full endpoint table) — every screen below maps
to specific `/api/*` calls.

## Generation Instructions

Generate the entire app in one pass, not one screen at a time: all 10 screens below, the
navigation shell, and the light/dark theme system as a single, cohesive design generated together.
Every screen should share the same components, spacing, color tokens, and navigation shell from
the start, rather than being designed in isolation and reconciled afterward.

The product has no command-line, terminal, or developer-tool surface anywhere in its UI — it is a
fully self-contained web app. Every action a user takes (connecting an account, running a scrape,
managing filters, admin review) happens entirely through the screens described below. The only
place a CLI is involved at all is Deploro, used separately and outside this app to provision the
database and wire the frontend to the backend — that is infrastructure setup, not a feature of the
product itself, and should not appear in any screen, copy, or flow.

## Visual Direction

- **Light mode / dark mode**: Every screen must be fully designed in both a light and a dark
  palette — not a dark-only design with light as an afterthought. On landing, the app must detect
  and apply the user's OS-level color scheme preference automatically (`prefers-color-scheme`),
  with no flash of the wrong theme and no separate light/dark login step — whichever mode their
  system is set to is what they see immediately. If the underlying framework supports it, the
  theme should keep adapting live if the user changes their system setting while the app is open,
  not just at initial load.
- **Atmosphere**: "Daily App Balanced" density (not airy, not a cockpit) — a clean operator
  console. Confident, quiet, utilitarian; feels like a well-built internal tool, not a landing
  page. Designed for long sessions monitoring scrapes in either theme.
- **Color**: Zinc/slate neutral base in both themes — dark mode uses a Zinc-950 background (never
  pure black) with Zinc-100 text; light mode uses a Zinc-50/white background with Zinc-900 text.
  Same single accent color and same semantic status colors in both themes, adjusted only in
  lightness/contrast as needed to stay accessible on each background — never a different hue
  between modes. One accent color for primary actions/active states/status-positive (a controlled
  green or amber, saturation under 80% — avoid AI-purple/neon). Status colors beyond the single
  accent are semantic only: a muted green for `active`/`completed`, amber for
  `paused`/`checkpointed`, red for `failed`/`banned`, gray for `queued`.
  - `active` / `completed` → success (green)
  - `queued` / `running` → neutral/in-progress (blue or the accent)
  - `paused` / `checkpointed` → warning (amber)
  - `failed` / `banned` → danger (red)
- **Typography**: Sans-serif only (`Geist` or `Satoshi` for UI text; `Geist Mono` or `JetBrains
  Mono` for numbers, handles, timestamps, and IDs — this is a numbers-and-status-heavy app, so
  monospace for tabular data is important). No serif anywhere. No `Inter`.
- **Layout**: Persistent left sidebar navigation + top bar, standard SaaS dashboard shell.
  Content-first, no hero sections, no marketing chrome. Tables and cards over illustration.
- **Components**: Status badges/pills (colored per status above) used throughout. Skeletal
  loaders for tables/cards while data loads — no generic spinners. Composed empty states with a
  clear next action (e.g., "No leads yet — trigger your first scrape" with a button), not just
  blank space.

## Navigation Shell (applies to every authenticated screen)

- **Left sidebar**: Dashboard, X Accounts, Scrapes, Leads, Lead Lists — and, only when the
  logged-in user's role is `admin`, a separate "Admin" section with Users, Activity, and a
  cross-user Accounts/Jobs view. Sidebar sections are never shown to non-admin users (no
  disabled/greyed items — they simply don't exist for a regular user).
  - Regular user shows their `role` as `user`; if `role: admin`, an "Admin" badge appears near
  their name/avatar in the top bar as a quiet indicator they have elevated read access.
- **Top bar**: current user's email, role badge, logout action.

---

## 1. Login / Register

**Purpose**: Entry point. A single auth screen with a Login / Register tab or toggle (not two
separate pages) — email + password only.

- Fields: email, password (min 8 chars, helper text stating that).
- Primary action: "Log in" or "Create account" depending on active tab.
- Inline error text below the form on failure (e.g., "Invalid email or password", "An account
  with this email already exists") — matches the API's 401/409 responses.
- No social login, no "forgot password" (out of scope for this build).
- On success: redirect to Dashboard.

## 2. Dashboard

**Purpose**: At-a-glance home screen after login — "what's the state of my scraping operation
right now."

- Summary stat tiles (monospace numbers): total connected accounts (with a breakdown of
  active/checkpointed/banned counts), total leads scraped, scrapes run today, leads found today.
- "Recent scrape jobs" — a compact list/table of the last 5–10 jobs (source type, account handle,
  status pill, leads found, started time), each row linking to that job's detail on the Scrapes
  screen.
- "Connected accounts" — a compact status list of the user's X accounts with their status pill,
  linking to X Accounts.
- Empty state (brand-new user, no accounts yet): a single clear call to action pointing at
  connecting a first X account.

## 3. X Accounts

**Purpose**: Manage the user's own connected X accounts (own-scoped, one-to-many).

- **List view**: table/card grid of accounts — handle, status pill (`active` / `checkpointed` /
  `banned`), daily scrape limit, max concurrency, last used timestamp, has-session indicator (a
  connected account shows a session is captured; if not, show "Not connected yet").
- **Connect new account** action: a "Connect Account" button opens a modal/panel where the user
  enters the account's handle and optional daily limit / max concurrency / proxy, then confirms.
  The new account appears in the list in a "Connecting…" / "Awaiting connection" state until its
  session is established, then flips to `active`. This is purely an in-app flow — no terminal,
  command line, or external tooling is ever surfaced to the user anywhere in the product.
- **Account detail / edit**: edit daily scrape limit, max concurrency, and status (e.g., manually
  set back to `active` after reviewing a `checkpointed` account). Delete action (with a
  confirmation — deleting cascades that account's scrape jobs).
- Status pill colors per the Visual Direction section above; a `checkpointed` account should show
  a short explanatory note (captured from its most recent failed/paused job's error message) so
  the user understands why it was paused.

## 4. Trigger Scrape

**Purpose**: Start a new scrape job.

- Form fields: X account (select, only `active` accounts selectable — others shown disabled with
  their status noted), source type (`search` / `followers` / `likers` — a segmented control, each
  with a one-line description of what `sourceRef` should be), source ref (text input whose
  label/placeholder changes with source type: "Search keyword", "Target handle (without @)", or
  "Tweet URL"), optional cap on leads (numeric, defaults to the account/system default, capped at
  1000).
- Primary action: "Start scrape" → on success, redirect to that job's detail on the Scrapes
  screen so the user immediately sees it progress.
- Inline validation errors (e.g., account not active, missing source ref).

## 5. Scrape Jobs

**Purpose**: Monitor and manage scrape jobs (queued/running/completed/failed/paused).

- **List view**: table filterable by status and by account — columns: source type icon/label,
  source ref (truncated), account handle, status pill, leads found, started/finished timestamps.
  Auto-refresh or a manual refresh action while jobs are in `queued`/`running` state.
- **Job detail**: full source ref, status pill with timestamps, leads-found count, and — if
  `failed` or `paused` — the error/pause reason shown prominently (e.g., "Account checkpointed:
  captcha challenge detected"). A "Cancel" action is available only while the job is still
  `queued` (best-effort; note in the UI that an already-running job can't be hard-cancelled).
- Empty state: "No scrapes yet" with a button to Trigger Scrape.

## 6. Leads Browser

**Purpose**: Browse all raw, unfiltered leads scraped so far (this is the "scrape raw" side of
the raw/filter split).

- Searchable/sortable/paginated table: avatar, handle (monospace, linking to x.com/handle),
  display name, bio (truncated with a tooltip/expand for full text), followers (monospace,
  showing "—" when null, since list-view scraping frequently can't populate it), location,
  verified badge, source type + source ref (small/secondary), last seen timestamp.
- Filter/search bar: handle search, source type filter. (This is a lightweight live search — the
  saved, reusable filters live on the Lead Lists screen.)
- Row click → lead detail panel/drawer showing all fields plus first-seen/last-seen timestamps.
- Empty state: "No leads yet" pointing at Trigger Scrape.

## 7. Lead Lists

**Purpose**: Create and manage saved filter definitions (bio keywords, follower range, location,
verified-only), evaluated against already-scraped leads at read time — the core "filter after"
feature.

- **List view**: saved lead lists as cards, each showing its name and a compact summary of its
  filter (e.g., "bio: founder, CEO · 1k–50k followers · verified only"), with a result count.
- **Create/edit form**: name field, then filter builder — bio keywords (tag/chip input, OR-
  matched), min/max followers (two numeric inputs), location (text, substring match), verified-
  only (toggle). Clear helper text: "Leads with no follower count on file are excluded from
  follower-range filters" (surfacing the known nullable-followers caveat).
- **Evaluated results view**: selecting a lead list shows its filtered, paginated leads using the
  same table layout as the Leads Browser screen (reuse that component).
- Empty state on the list-view screen: "No saved filters yet" pointing at creating one.

## 8. Admin — Users

**Purpose** (admin-only): read-only list of every platform user.

- Table: email, role badge (`user`/`admin`), created date. No edit/delete actions (role changes
  are a manual DB action per the backend design, intentionally not exposed here).
- Row click (optional) → jumps into that user's accounts via the Admin Accounts/Jobs view below.

## 9. Admin — Cross-User Accounts & Jobs

**Purpose** (admin-only): read-only visibility into every user's X accounts and scrape jobs —
status only, never session data.

- Filterable by user. Accounts table: same status/limit columns as the regular X Accounts screen
  but read-only, with an owning-user column added, and no session-capture/edit/delete actions.
- Scrape jobs table: same columns as the regular Scrape Jobs screen, filterable by user and
  status, read-only (no cancel action — admins don't manage other users' jobs, only observe).

## 10. Admin — Activity Feed

**Purpose** (admin-only): a chronological, filterable feed of `activity_log` entries across all
users — the audit trail (registrations, logins, scrape completions, account checkpoints).

- Filterable by user and by action type.
- Feed/table rows: timestamp, user email, action (human-readable label, e.g., "Scrape completed",
  "Account checkpointed", "User registered"), and a compact rendering of the metadata JSON
  relevant to that action (e.g., leads found, checkpoint reason).
- Paginated (this can grow large over time).
