---
name: Talonr Operator System
colors:
  surface: '#fcf8fb'
  surface-dim: '#dcd9dc'
  surface-bright: '#fcf8fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f2f5'
  surface-container: '#f0edf0'
  surface-container-high: '#eae7ea'
  surface-container-highest: '#e5e1e4'
  on-surface: '#1c1b1d'
  on-surface-variant: '#554336'
  inverse-surface: '#313032'
  inverse-on-surface: '#f3f0f2'
  outline: '#887364'
  outline-variant: '#dbc2b0'
  surface-tint: '#904d00'
  primary: '#8d4b00'
  on-primary: '#ffffff'
  primary-container: '#b15f00'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb77d'
  secondary: '#5d5e66'
  on-secondary: '#ffffff'
  secondary-container: '#e3e1ec'
  on-secondary-container: '#63646c'
  tertiary: '#006096'
  on-tertiary: '#ffffff'
  tertiary-container: '#007abd'
  on-tertiary-container: '#fdfcff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdcc3'
  primary-fixed-dim: '#ffb77d'
  on-primary-fixed: '#2f1500'
  on-primary-fixed-variant: '#6e3900'
  secondary-fixed: '#e3e1ec'
  secondary-fixed-dim: '#c6c5cf'
  on-secondary-fixed: '#1a1b22'
  on-secondary-fixed-variant: '#46464e'
  tertiary-fixed: '#cee5ff'
  tertiary-fixed-dim: '#96ccff'
  on-tertiary-fixed: '#001d32'
  on-tertiary-fixed-variant: '#004a75'
  background: '#fcf8fb'
  on-background: '#1c1b1d'
  surface-variant: '#e5e1e4'
typography:
  display:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-base:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '450'
    lineHeight: 18px
  data-label:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  container-margin: 1.5rem
  gutter: 1rem
  cell-padding-x: 0.75rem
  cell-padding-y: 0.5rem
  sidebar-width: 240px
---

## Brand & Style

The design system is centered on high-efficiency data management and lead extraction. The aesthetic is "Technical Utility"—a balance between developer-focused precision and clean, executive-level data visualization. It prioritizes information density without visual noise, utilizing a "Quiet UI" approach where structural elements recede to let data (handles, status, metrics) take precedence.

The style leans into **Minimalism** with subtle **Technical / Corporate** influences. It avoids decorative gradients or excessive shadows, instead relying on strict alignment, consistent stroke weights, and a monochromatic foundation punctuated by high-intent semantic colors.

## Colors

The palette is anchored in the **Zinc and Slate** families to provide a neutral, non-distracting canvas.

- **Backgrounds:** In dark mode, use Zinc-950 for the base and Zinc-900 for elevated surfaces. In light mode, use White for the base and Zinc-50 for sidebar/header backgrounds.
- **Accents:** Use Amber-600 (#D97706) for primary call-to-actions. Keep saturation controlled to ensure it remains professional and readable against dark backgrounds.
- **Semantics:** 
    - **Active/Completed:** Muted Green (Emerald-500).
    - **Paused:** Amber-500.
    - **Failed/Banned:** Red-500.
    - **Queued:** Gray-500.
- **Implementation:** Support `prefers-color-scheme`. Surface colors should transition between Zinc-950 (Dark) and White (Light) to maintain the "Daily App" feel.

## Typography

This design system utilizes a dual-font strategy to differentiate between interface controls and technical data outputs.

- **UI Interface:** Use **Geist** for all navigational elements, headers, and standard body text. It provides a contemporary, clean look that scales well in dense layouts.
- **Data & Identifiers:** Use **JetBrains Mono** for X handles (@username), timestamps, ID strings, and numerical counts. This creates a clear visual distinction between the "App" and the "Data."
- **Hierarchy:** Maintain a tight scale. Headers should rarely exceed 24px. The primary interface should operate at 13px or 14px to maximize screen real estate for lead tables.

## Layout & Spacing

The layout uses a **Fluid Grid** with a persistent left-hand sidebar. 

- **Sidebar:** Fixed at 240px. Collapsible to 64px (icon-only) for focused scraping monitoring.
- **Main Content:** Uses a 12-column grid system but primarily relies on flexible flexbox/grid containers for data tables.
- **Density:** Use a base-4 system. For "Daily App Balanced" density, standard list items should have a height of 40px, while compact data rows may drop to 32px.
- **Breakpoints:** 
    - **Desktop (1280px+):** Full multi-pane view (Nav + List + Detail).
    - **Tablet (768px - 1279px):** Persistent Nav + List; Detail pane becomes an overlay or separate view.
    - **Mobile (<768px):** Stacked view; Nav becomes a bottom bar or drawer.

## Elevation & Depth

Visual hierarchy is established through **Tonal Layers** rather than heavy shadows.

- **Level 0 (Base):** Zinc-950 (Dark) / White (Light).
- **Level 1 (Cards/Sidebar):** Zinc-900 / Zinc-50. A 1px border (Zinc-800 in dark / Zinc-200 in light) is preferred over shadows to define boundaries.
- **Level 2 (Modals/Popovers):** Subtle ambient shadow (10% opacity, 12px blur) with a solid 1px border. 
- **Active State:** Use a 1px solid Amber-600 border to indicate focused input or selected list items.

## Shapes

The design system uses **Soft** geometry (4px / 0.25rem) to maintain a professional, slightly technical feel without the playfulness of fully rounded corners.

- **Standard Elements:** Buttons, Inputs, and Cards use a 4px radius.
- **Status Pills:** Use `rounded-full` (pill shape) to distinguish status indicators from clickable UI components.
- **Large Containers:** Dashboard panels or main content areas use 8px (`rounded-lg`) to provide a subtle frame.

## Components

- **Buttons:** Primary buttons use Amber-600 with white text. Secondary buttons use a ghost style (Zinc-800 border) with neutral text.
- **Status Pills:** Compact indicators with a low-opacity background tint (e.g., Green-500 at 10%) and a high-contrast label. Use JetBrains Mono for the text.
- **Skeletal Loaders:** Use a subtle pulse animation on Zinc-800 (Dark) or Zinc-100 (Light) blocks to represent data streams during scraping.
- **Input Fields:** Flat, 1px bordered boxes. Use a monospaced font for "Search" or "Filter" inputs if they involve technical queries (e.g., keywords or regex).
- **Data Tables:** Zebra-striping is discouraged. Use thin 1px horizontal dividers. On hover, rows should highlight with a subtle Zinc-900 (Dark) or Zinc-50 (Light) background.
- **Persistent Sidebar:** Top-aligned navigation icons with text labels. Bottom-aligned system status (API health, account status).