---
name: Talonr
description: Operator console for X lead scraping — quiet, data-dense, unshowy.
colors:
  zinc-950: "#09090b"
  zinc-900: "#18181b"
  zinc-800: "#27272a"
  zinc-200: "#e4e4e7"
  zinc-100: "#f4f4f5"
  zinc-50: "#fafafa"
  white: "#ffffff"
  accent: "#b45309"
  accent-emphasis: "#d97706"
  accent-text-light: "#b45309"
  accent-text-dark: "#f59e0b"
  status-success-light: "#047857"
  status-success-dark: "#10b981"
  status-warning-light: "#b45309"
  status-warning-dark: "#f59e0b"
  status-danger-light: "#b91c1c"
  status-danger-dark: "#ef4444"
  status-neutral-light: "#4b5563"
  status-neutral-dark: "#9ca3af"
  status-info-light: "#1d4ed8"
  status-info-dark: "#3b82f6"
typography:
  ui:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 400
  ui-heading:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 600
  data:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Code, monospace"
    fontWeight: 400
rounded:
  DEFAULT: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  full: "9999px"
spacing:
  sidebar: "240px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  status-pill:
    rounded: "{rounded.full}"
    typography: "{typography.data}"
    padding: "2px 8px"
---

# Design System: Talonr

## 1. Overview

**Creative North Star: "The Quiet Console"**

Talonr is a single-operator tool for scraping and triaging X leads, not a product being sold to anyone. The interface should read like a well-built internal tool an engineer built for themselves: no persuasion, no onboarding flourish, no hero moment. Every screen is a workflow screen — connect an account, trigger a scrape, watch a job, scan a table of leads — so structure recedes and data leads.

The system explicitly rejects the SaaS-dashboard reflex: no hero metric tiles with gradient accents, no identical icon-card grids, no AI-purple or neon, no glassmorphism, no gradient text. Dark and light are equally first-class — both derive from the same Zinc neutral base and the same single accent, never a different hue between modes.

**Key Characteristics:**
- Data-first: numbers, handles, timestamps, IDs in monospace; interface chrome in sans.
- One accent (amber), used sparingly for primary actions and active states only.
- Flat, bordered surfaces — tonal layering over shadows.
- Status is always a colored pill with a text label, never color alone.

## 2. Colors

Restrained strategy: tinted Zinc neutrals plus one accent, used deliberately rather than decoratively.

### Primary
- **Amber Accent** (`#b45309`, amber-700): primary buttons, borders, focus rings. Used on a small minority of any given screen. Deliberately darker than a typical "amber-600" brand swatch — measured at 5.02:1 white-text contrast versus amber-600's 3.19:1, an AA fail. Same hex in both themes since it's a fixed foreground/background pair independent of page theme.
- **Accent-as-text** is theme-aware, unlike the accent fill: `#b45309` (amber-700) in light mode, `#f59e0b` (amber-500) in dark mode. Plain amber-700 text fails 4.5:1 against a near-black page background (3.96:1); amber-500 fixes that while amber-700 stays correct against white.

### Neutral
- **Zinc 950** (`#09090b`): dark-mode base background.
- **Zinc 900** (`#18181b`): dark-mode elevated surfaces (sidebar, hover states).
- **Zinc 800** (`#27272a`): dark-mode borders and dividers.
- **Zinc 200** (`#e4e4e7`): light-mode borders and dividers.
- **Zinc 100** (`#f4f4f5`): light-mode elevated surfaces (sidebar, hover states).
- **Zinc 50 / White**: light-mode base background.

### Named Rules
**The One Accent Rule.** Amber is the only saturated color used for interface actions. It never competes with itself — no secondary accent, no second hue for "positive" actions.

**The Status Quartet Rule.** Exactly four semantic status colors exist, each with a fixed meaning that never changes across screens: Emerald = active/completed, Amber = paused/checkpointed/warning, Red = failed/banned/danger, Gray = queued/neutral. Blue is a fifth, narrower exception reserved only for "running", so it never gets confused with the warning amber.

**The Theme-Aware Text Rule.** Every status/accent color used AS TEXT (not as a fill) takes a different shade per theme — a 700-shade in light mode, a 500-shade (400 for gray) in dark mode. Measured: the naive single-shade approach fails WCAG AA in at least one theme for every one of these five hues (e.g. amber-500 on white is 2.15:1; gray-500 on zinc-950 is 4.12:1). The `-bg` pill-tint tokens stay a single flat mid-shade in both themes since background tone isn't contrast-critical the way foreground text is — only the text sitting on top of it needs the swap.

## 3. Typography

**UI Font:** Geist (with `ui-sans-serif, system-ui, sans-serif` fallback)
**Data Font:** JetBrains Mono (with `ui-monospace, Cascadia Code, monospace` fallback)

**Character:** A quiet, contemporary grotesque for interface chrome, paired with a technical monospace reserved strictly for data — handles, IDs, counts, timestamps. The pairing exists to make "app" and "data" visually distinguishable at a glance, not for decorative contrast.

### Hierarchy
- **Page heading** (600 weight, `text-lg`/18px): one per screen, top-left.
- **Section heading** (600 weight, `text-sm`/14px): groups tables/cards within a screen.
- **Body** (400 weight, `text-sm`/14px): labels, descriptions, form copy.
- **Data/mono** (400–500 weight, `text-xs`–`text-sm`, JetBrains Mono): handles, IDs, counts, timestamps, status pill text.
- **Caption** (400 weight, `text-xs`/12px, Zinc-500): helper text, empty-state descriptions, table column headers (uppercase-free, sentence case).

### Named Rules
**The Mono-for-Data Rule.** Any value that is a number, a handle, a timestamp, or an identifier renders in JetBrains Mono. Any value that is a sentence, a label, or a description renders in Geist. No exceptions.

## 4. Elevation

Flat by default. Depth is conveyed through a single 1px border and background-tint layering (base → Zinc-50/Zinc-900 sidebar → white/Zinc-900/40 hover), never through box-shadow. Modals are the one exception: a `bg-black/40` scrim behind a bordered, flat white/Zinc-900 panel — still no shadow.

### Named Rules
**The No-Shadow Rule.** `box-shadow` does not appear anywhere in the system. Every surface boundary is a 1px border (`Zinc-200` light / `Zinc-800` dark).

## 5. Components

### Buttons
- **Shape:** 6px radius (`rounded-md`).
- **Primary:** Amber-700 (`#b45309`) background, white text, 8px/16px padding, `hover:opacity-90`. Not amber-600 — see Colors.
- **Secondary/Ghost:** 1px border, transparent background, `hover:bg-zinc-50` / `hover:bg-zinc-800`.
- **Danger:** transparent background, `status-danger` text and border, `hover:bg-status-danger-bg`.

### Status Pills
- **Shape:** fully rounded (`rounded-full`).
- **Style:** 12%-opacity tint of the status color as background, full-opacity status color as text, JetBrains Mono, 11px, uppercase, letter-spacing.

### Cards
- **Corner style:** 8px radius (`rounded-lg`).
- **Background:** transparent, 1px border only.
- **Shadow strategy:** none (see Elevation).
- **Internal padding:** 16px (`p-4`).

### Inputs / Fields
- **Style:** 1px border, transparent background, 6px radius, 8px/12px padding.
- **Focus:** border color shifts to accent (`focus:border-accent`), no glow/ring.

### Tables
- **Header:** Zinc-50/Zinc-900-40% background, 12px uppercase-free caption text, 1px bottom border.
- **Rows:** 1px bottom border between rows, no zebra striping, `hover:bg-zinc-50`/`hover:bg-zinc-900/40`.

### Navigation (Sidebar)
- **Width:** 240px, fixed, Zinc-50/Zinc-900-40% background, 1px right border.
- **Active item:** Zinc-100/Zinc-900 background, no accent-colored text (active state is background, not color, to avoid competing with status pill colors elsewhere on screen).

## 6. Do's and Don'ts

### Do:
- **Do** use JetBrains Mono for every handle, ID, count, and timestamp.
- **Do** pair every status color with a text label; never signal status by color alone.
- **Do** use the amber accent sparingly — primary actions and active states only.
- **Do** shade status/accent text differently per theme (700 light / 500 dark) so it clears WCAG AA in both — see the Theme-Aware Text Rule.
- **Do** use a composed empty state (title + description + action button) for every empty table or list.
- **Do** keep both themes derived from the same Zinc base and the same single accent.

### Don't:
- **Don't** use AI-purple or neon accents.
- **Don't** use gradient text (`background-clip: text` with a gradient).
- **Don't** use glassmorphism or decorative blur.
- **Don't** use box-shadow anywhere; depth is border + tint only.
- **Don't** build a hero-metric template (big number + gradient accent + supporting stats row).
- **Don't** repeat identical icon-card grids.
- **Don't** use `Inter` or any serif typeface.
- **Don't** reach for a modal before exhausting inline alternatives.
- **Don't** use a colored `border-left`/`border-right` as a status stripe on cards or rows.
