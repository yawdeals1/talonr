# Product

## Register

product

## Users

A single operator (personal project, not multi-tenant SaaS in spirit despite the multi-user backend) running X lead-scraping campaigns and triaging results daily. They connect X accounts, trigger scrapes, monitor job status, and browse/filter scraped leads. Admin users additionally need read-only cross-user visibility (their own alt accounts or trusted collaborators). Sessions are long — monitoring scrapes in progress, scanning tables of leads — not quick check-ins.

## Product Purpose

Talonr scrapes X (Twitter) for leads (search results, followers, likers) and lets the operator browse and filter the results without re-scraping. Success looks like: fast triage of who's worth reaching out to, clear visibility into scrape job health (queued/running/failed/paused), and zero ambiguity about account status (active/checkpointed/banned) since a banned or checkpointed account silently failing scrapes is the worst failure mode.

## Brand Personality

Confident, quiet, utilitarian. Feels like a well-built internal tool, not a landing page or a consumer app. Three words: technical, precise, unshowy. No hero sections, no marketing chrome, no illustration — tables and cards over decoration.

## Anti-references

- No AI-purple/neon accents, no gradient text, no glassmorphism.
- No `Inter`, no serif anywhere.
- Not a "SaaS dashboard cliché" (big hero metric + gradient accent + identical icon-card grids).
- Not dark-mode-only — light and dark are equally first-class, both derived from the same Zinc neutral base and single accent, never a different hue between modes.

## Design Principles

- **Data over decoration.** Numbers, handles, timestamps, and IDs in monospace; interface chrome in sans. The distinction between "the app" and "the data" should be legible at a glance.
- **Status is never ambiguous.** Every account/job status is a colored pill AND a text label, in both themes, using a fixed semantic mapping (never color-only signaling).
- **Composed empty states, not blank space.** Every empty table/list state names the next action.
- **Quiet UI.** Structural chrome (borders, background tints) recedes; content leads. Tonal layers over shadows.
- **No CLI leakage in copy, except where operationally honest.** The product has no terminal surface, with one deliberate exception (X session capture, which is genuinely a local-only step) — that exception is disclosed plainly, not hidden.

## Accessibility & Inclusion

Standard WCAG AA. Status is communicated via text label + color together (never color alone). Both themes must hit AA contrast for body text and status pills against their respective backgrounds.
