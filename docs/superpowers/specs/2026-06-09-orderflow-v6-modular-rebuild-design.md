# Orderflow V6 — modular platform rebuild ("Obsidian Pro")

**Date:** 2026-06-09
**Status:** Approved (design validated via visual companion; ready for implementation plan)
**Type:** Full presentation + layout rebuild of the Orderflow V6 page. A tiling,
multi-module workspace with pop-out windows. Modular, config-driven, loosely
coupled. Engine/data layer preserved.

## Problem

Earlier passes refined the old shell but the user finds it ugly, the responsive
breaks (elements overflow / vanish when the window isn't maximised), and the layout
isn't flexible enough. Root architectural issues:

- Visual identity spread across warring CSS files with `!important` overrides; no
  single source of truth → small edits break unrelated things.
- Fixed left/center/right shell with tabbed docks; can't freely arrange panels, no
  multi-chart grids, docks leave residual strips when "hidden".
- Indicators (CVD, etc.) are separate boxes, not time-synced sub-panes of the chart.
- Tight coupling: components reach into each other / global CSS, so changes cascade
  unpredictably.

## Goal

A modern, clean, dense **trading platform** the user is proud of, built as a
**tiling workspace**: a grid of cells where **each cell holds any module** (chart,
DOM, Tape, Orderbook, Info, …), with layout presets, cross-cell sync, and the
ability to **pop a module out into its own window**. Architecture must be
**ultra-modular and loosely coupled**: every module is self-contained and
configurable; moving a control (e.g. the DOM `GROUP` selector from header to footer)
is a trivial config change; editing one module cannot break another. Only the
orderflow page changes; all live data keeps working.

## Locked visual direction — clean "platform" (Hyperliquid/Kata reference)

Near-black, minimal, professional. Validated mockups in
`.superpowers/brainstorm/.../content/` — global look: `platform.html`; module
designs (reuse as-is): `final-design-v2.html`, `dom-redesign.html`,
`tape-polish-v3.html`.

- **Surfaces:** near-black canvas `#0a0b0d`, chrome `#0e0f12`, raised `#15171b` /
  `#1c1f24`; hairline borders `rgba(255,255,255,.06)`. Flush, edge-to-edge, dense,
  no empty gaps; 1px hairline separators (not floating cards).
- **Colour (tokenised — one place to change):** monochrome chrome (white/gray text),
  **amber/orange accent** `#ff7a45` for last-price tag, active/highlight, funding;
  **buy `#3fb950` / sell `#f0703a`** for orderflow (DOM/Tape) and candles
  (up light `#e9eaed` / down `#f0703a`, à la reference).
- **Type:** Inter for chrome, JetBrains Mono (tabular) for all numbers.
- **Chrome:** rich top bar (symbol ▾ · timeframe pills · chart-type · **layout
  picker icon** · price/Δ% · 24H Volume · Open Interest · Funding/countdown ·
  Calls/View as/Heatmap/**Indicators** · right: module tabs + **⚙** · `›_`); slim
  left tool rail (drawing tools); bottom bar (Templates · Workspace · ＋ add ·
  Chat · UTC · ⚙). No BID/ASK ticket, no "Live" pill.

## Layout model — tiling grid of module cells

- **Grid of cells.** The workspace is a resizable tiling grid. **Every cell can host
  any module**: a chart, a DOM, a Tape, an Orderbook, an Info panel, etc. Cells are
  resizable (drag dividers) and modules are draggable between cells.
- **Layout picker** (top-bar icon → popover, like the reference): **STANDARD**
  presets — single, vertical split, horizontal split, 1+2, 3, 2×2 grid — that
  arrange the cells in one click. **MONITOR**: multi-monitor grid selector.
  **SYNC**: Symbol / Interval / Crosshair toggles that link those properties across
  all chart cells.
- **Chart cell = welded chart + indicators.** Inside a chart cell, the price chart
  and its indicator sub-panes (CVD, Volume-Delta, …) are stacked and **share one
  time axis** (aligned vertical gridlines, single time-axis row, shared crosshair).
  Indicators never detach from their chart. Each chart cell has its own symbol /
  interval (unless SYNC links them).
- **Pop-out windows.** Any module (chart, DOM, Tape, …) can be **detached into its
  own window** and re-docked. Pop-out windows stay live, sharing state with the main
  window (see Architecture §7).
- **Hiding a module removes it completely** (no residual strip/arrow). Re-adding any
  module OR indicator is done through the header **"Indicators"** add-menu (two
  sections: Indicators / Panels) or the bottom-bar ＋.
- **Drawing toolbar:** anchored to the **left of the chart pane only** (chart height;
  must not overflow onto the indicator sub-panes below — they keep their aligned left
  edge). Hideable from global settings (⚙).
- **Status bar:** engine url · lag · queue/drop · buffers · time.

## Module designs (reuse the validated mockups — do NOT redo)

- **DOM** — two-sided ladder **BID | PRICE | ASK**, depth bars growing from the
  price column outward, **walls** (full bar + glow + bold), best bid/ask tint,
  accentued **MID band** (price + spread inline), **Σ BID / Σ ASK** footer. **No
  MID/SPR stat row.** `GROUP` selector lives in the panel header. Columns
  configurable (bid/price/ask/buy/sell/delta/imb…). Premium header.
- **Tape** — rows with side accent bar (buy green / sell red), colored price,
  **size bar** behind SIZE (∝ volume), **big trades highlighted** (●, brighter bar,
  bold), **buy/sell pressure mini-bar** sub-header, fade mask. Column header
  (TIME · PRICE · SIZE) styled identically to the DOM's. Premium header, no "Live".
- **Premium panel header** (shared) — accent tick · title · meta chip · drag handle
  ⠿ · icon buttons (⚙ settings, ✕ close) revealed on hover (✕ → red).
- **Chart** — candle/area, right price axis, amber last-price tag, OHLC legend,
  welded indicator sub-panes, drawing-toolbar slot.
- **Orderbook** — TOTAL / AMOUNT / PRICE with depth bars, spread row, à la reference.

## Architecture — modularity is the contract

The page is composed from small, independent **modules** wired only through the
shared store and a layout config. No module references another directly.

### 1. Module contract (every panel, indicator, chart)
```
{ id, title, kind:'panel'|'indicator'|'chart',
  defaultPlacement, configSchema,            // declarative options + defaults
  create(ctx) -> instance,                   // build DOM/canvas into ctx.mount
  render(instance, state, config),           // pure update from store slice + config
  dispose(instance) }
```
`ctx` provides: `mount`, `store` (read+subscribe), `config`, optional `bus`, design
tokens. No sibling access. Modules read **store slices** and re-render via the keyed,
rAF-coalesced `RenderScheduler` → add/remove/move touches nothing else.

### 2. Config-driven internals (the "GROUP header↔footer" requirement)
Each panel is assembled from named **slots** — `header / toolbar / body / footer`.
Controls declare their slot via config: `group:{ value:25, control:{ slot:'header' }}`.
A slot renderer places each control. Moving GROUP = change `slot:'header'`→`'footer'`;
nothing else changes. Columns, wall thresholds, value mode, depth-bar origin, etc.
are all config keys with sane defaults.

### 3. Layout engine (tiling grid; placement is data)
A single `layoutSchema` (persisted per workspace) is a tree of split nodes and leaf
**cells**, each cell referencing a module id + size. Presets (STANDARD) are just
schema templates. Drag/resize/hide/add only mutate the schema; the grid renders
strictly from it. SYNC flags (symbol/interval/crosshair) live in the schema too.

### 4. Indicator registry (time-axis bound)
Indicators are modules with `kind:'indicator'`, `paneType:'subpane'|'overlay'`,
mounted inside a chart cell and driven by that chart's single time scale (one source
of truth for X). The Indicators add-menu reflects the registry; toggling edits the
chart cell's indicator list.

### 5. One visual source of truth + isolated styles
- **Design tokens** defined once and emitted identically by CSS and the runtime
  theme hydration (past bug: runtime overrode CSS). Accent/colour = one token each.
- **Per-module CSS**, scoped to its own namespace (`v6m-dom-…`, `v6m-tape-…`,
  `v6m-chart-…`), in its own split file. No `!important` wars, no cross-module
  selectors. Editing one module's CSS can't touch another.
- Strict containment so nothing overflows the viewport at any width (Responsive).

### 6. Settings layers
- **Global** (⚙): theme/accent, density, drawing-toolbar on/off, defaults.
- **Per-module** (each panel's own ⚙): that module's `configSchema`.
- **Workspaces:** named snapshots of `layoutSchema` + all module configs
  (Templates / Workspace / Save / Reset / Export / Import).

### 7. Window manager (pop-out)
A module can be detached: the host opens a child window (`window.open`; or a native
window under the desktop/Wails build), mounts the same module there against the same
store. State is shared across windows via a cross-window channel (BroadcastChannel,
falling back to `storage` events) mirroring the relevant store slices, so a popped
DOM/Tape/Chart stays live. Closing the window re-docks the module into the grid.

## Responsive (must not break)

- Every flex/grid child `min-width:0` / `min-height:0`; shell column pinned to the
  container (`minmax(0,1fr)`) — the fix that stops the chart canvas pushing cells
  off-screen. Cells have min sizes; overflow is contained inside a module (its own
  scroll), never the page. Below a breakpoint, lowest-priority cells collapse rather
  than overflow. Verified ≥1792 down to ~1000 and a narrow/stacked mode.

## Data / preservation

- No change to store shape, engine client, WS transport, REST fallback, or data
  normalization. Modules read the same store slices the current panels read.
- Keep prior fixes: single clean engine on :8765, dollar-bucket DOM grouping, summed
  bucket aggregation, deterministic mid-centering of the ladder.

## Non-goals (YAGNI)

- No engine/data/transport changes; no new data sources.
- In-page layout is **tiling** (no overlapping floating panels inside the page);
  "floating" = the explicit pop-out into a separate OS/browser window.
- No light theme (dark only).

## Build & verification

- Author as `static/css/split/*` + `static/js/split/*`; `python build.py` bundles.
- Python tests stay green; add tests for layout schema (place/hide/re-add/move/preset),
  module config (e.g. group slot header↔footer), responsive containment, and pop-out
  state sync.
- Verify live at several widths: shell mounts, every module renders, live data flows,
  presets/drag/hide/re-add/pop-out work, no overflow, no console errors.

## Suggested phases (one plan, sequenced)

1. Design tokens + single source of truth + clean CSS reset (kills the `!important`
   war) + the global "platform" chrome (top bar, rail, bottom bar).
2. Module contract + tiling layout engine rendering from `layoutSchema` + RenderScheduler
   wiring; existing panels wrapped as modules (no behaviour change yet).
3. Chart cell: welded chart + time-synced indicator sub-panes + drawing-toolbar slot.
4. DOM + Tape + Orderbook modules to the validated designs (config-driven slots).
5. Layout picker (STANDARD presets, MONITOR, SYNC), drag between cells, hide (full
   remove), re-add via add-menu, workspaces.
6. Pop-out window manager + cross-window state sync.
7. Global + per-module settings; responsive hardening; tests.
