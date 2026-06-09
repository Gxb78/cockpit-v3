# Orderflow V6 — full presentation redesign ("Obsidian Pro")

**Date:** 2026-06-09
**Status:** Implemented & verified 2026-06-09 (carte blanche granted by user; 189 tests green, verified live in browser)
**Type:** Frontend redesign — presentation layer of the Orderflow V6 page only.

## Problem

The Orderflow V6 page looks broken / inconsistent. Root causes:

1. **Three CSS files fight each other.** `070_v6_orderflow.css` (base, in `@layer
   components`), `071_v6_layout_shell.css` (shell), `072_v6_orderflow_refactor.css`
   (page-scoped `!important` overrides). They redefine the same tokens and selectors
   with different values, so the result is incoherent.
2. **The live palette is not in the CSS.** `hydrateThemeVars()` (073) always forces a
   TradingView-gray `#131722` theme, and the inline boot script in
   `templates/partials/pages/orderflow.html` sets tokens too. CSS token values
   (`#05060a` obsidian) are dead at runtime.
3. No cohesive type / spacing / elevation / motion scale; chrome and panels don't
   read as one product.

## Goal

A modern, fluid, polished, customizable trading terminal on par with
TradingView / Bookmap / ATAS. User must be "shocked" by the new design. **Only the
orderflow page** changes. All live functionality must keep working.

## Hard constraints

- Preserve every `data-v6-*` / `data-orderflow-slot` / `data-testid` hook and all
  class names the JS renderers depend on (DOM ladder, tape, CVD canvas, chart canvas,
  settings inputs, engine bar, status bar, inspector, indicators, replay).
- Presentation-layer only: no change to the store, engine client, WS transport, REST
  fallback, or data normalization.
- Existing Python test suite stays green. Rebuild bundles with `python build.py`.

## Design direction — "Obsidian Pro"

- **Surfaces:** deep near-black graphite (`#0a0d12` canvas, layered `#10141c` /
  `#151a24` surfaces), hairlines at low-alpha cool white.
- **Accent:** one electric cyan (`#37b6ff`-ish) used sparingly for active/live state.
- **Semantic:** buy `#0bbf86` green, sell `#fb3b54` red, gold `#f5b73c` for VWAP/POC.
- **Type:** system sans for chrome, JetBrains-mono for all numbers (tabular). Tight
  scale: 8/9/10/11/12/13 with deliberate weights.
- **Depth & motion:** subtle elevation shadows, 120–220ms cubic-bezier transitions,
  reduced-motion respected. No flashy glows except meaningful live/wall states.
- **Single source of truth:** all token values defined once; boot script +
  `hydrateThemeVars` emit the same palette as the CSS expects.

## Architecture / files touched

- `templates/partials/pages/orderflow.html` — boot-script token values → new palette.
- `static/js/split/073_v6_orderflow_layout.js` — `hydrateThemeVars()` palette → match.
- `static/css/split/070_v6_orderflow.css` — token block becomes the canonical scale
  (palette, spacing, radius, type, elevation, motion). Component styles refined.
- `static/css/split/071_v6_layout_shell.css` — shell structure kept; visuals refined
  to the new system.
- `static/css/split/072_v6_orderflow_refactor.css` — becomes the cohesive override
  layer: chrome (header/rail/dock/status), panels (DOM/tape/CVD/inspector/settings),
  layout interactions (resizers, dock collapse), skeleton. Remove contradictory rules.
- `static/js/split/080_v6_layout_shell.js` — chrome markup polish + layout-feel
  improvements (smooth resize redraw, presets) where needed. Keep schema engine.

## Layout system (customizable)

Keep the existing schema engine (left/right docks, draggable tabs, collapsible docks,
resizable panels, workspace presets in `089`). Improvements:
- Smooth column/row resize with live chart+CVD redraw (already partly wired).
- Animated dock collapse/expand.
- Cleaner drag-to-dock affordance (drop-zone highlight).
- Workspace presets surfaced in chrome.

## Panels (each polished to the system)

- **Chart frame** — borderless immersive canvas, floating price-zoom + view tools.
- **DOM ladder** — the hero. Dense rows, depth bars, glowing major/soft walls,
  mid/live row highlight, smooth update flash, clean header/footer.
- **Tape** — virtualized rows, buy/sell tinting, mono numerals, fade mask.
- **CVD strip** — integrated indicator sub-pane under the chart (TV-style), hover
  toolbar.
- **Info inspector** — candle/flow inspector cards.
- **Settings** — grouped sections, modern toggles/inputs.
- **Status bar** — compact health/engine/buffer readout.

## Non-goals (YAGNI)

- No engine / data / transport changes.
- No new panels or indicators.
- No light theme work (dark only; the toggle stays but dark is the product).
- No change to render-scheduler / slice-diff logic from the 2026-06-07 spec.

## Verification

- Run the app, load the orderflow page, screenshot before/after at a desktop width.
- Confirm: shell mounts, all panels render, live/REST data flows, resizing/docking
  work, no console errors.
- `python build.py` succeeds; Python tests stay green.
