# Orderflow V6 — DOM panel redesign + dock tab close/re-add

**Date:** 2026-06-11
**Status:** Approved (design phase)
**No-commit rule:** This spec and all implementation work for this task are NOT committed (standing user rule). Local-only.

## Goal

Redesign the V6 DOM panel to match the reference layout (TradingView-style cockpit:
columns `Vol | Sell | Buy | Bid | Price | Ask | Delta`, with heatmap-intensity cell
backgrounds), and generalize the right/left dock tab "close" behavior to all panels
(DOM, Tape, Orderbook, Info, ...) with a way to re-add a closed panel.

This is part of the larger "carte blanche" chart/UI overhaul but scoped to: the DOM
panel's column system + dock tab close/re-add. Chart axes/interactions, the
volume-profile heatmap overlay on the chart, and the workspace/layer inspector
(other reference images) are explicitly OUT OF SCOPE for this spec.

## 1. Column registry architecture

Replace the three parallel structures in
[075_v6_dom_panel.js](../../../static/js/split/075_v6_dom_panel.js)
(`COLUMN_WEIGHTS`, `COLUMN_LABELS`, and the `cols.map(...)` if/else chain in
`renderRow`) with a single `COLUMN_DEFS` registry:

```js
var COLUMN_DEFS = {
  vol:   { weight: 10, label: 'VOL',   heatmap: 'accent', getRaw: lv => (lv.buyVol||0)+(lv.sellVol||0), render: ... },
  sell:  { weight: 9,  label: 'SELL',  heatmap: 'sell',   getRaw: lv => lv.sellVol,  render: ... },
  buy:   { weight: 9,  label: 'BUY',   heatmap: 'buy',    getRaw: lv => lv.buyVol,   render: ... },
  bid:   { weight: 18, label: 'BID',   special: 'depth-bid',  render: ... },  // unchanged depth bar
  price: { weight: 16, label: 'PRICE', special: 'price',      render: ... },  // unchanged
  ask:   { weight: 18, label: 'ASK',   special: 'depth-ask',  render: ... },  // unchanged depth bar
  delta: { weight: 10, label: 'DELTA', heatmap: 'signed', getRaw: lv => lv.delta, render: ... },
  imb:   { weight: 8,  label: 'IMB',  render: ... },  // existing, no heatmap
  stack: { weight: 5,  label: 'STK',  render: ... },  // existing, no heatmap
  abs:   { weight: 7,  label: 'ABS',  render: ... }   // existing, no heatmap
};
var COLUMN_ORDER_ALL = ['vol','sell','buy','bid','price','ask','delta','imb','stack','abs'];
```

- `getColumnWidths(cols)` → `cols.map(c => COLUMN_DEFS[c].weight)`-based (same percentage logic as today).
- `renderHeadersHtml(cols, widths)` reads `COLUMN_DEFS[c].label`.
- `renderRow(...)` becomes `cols.map(c => COLUMN_DEFS[c].render(lv, ctx)).join('')` — one call per column, no if/else chain.
- `bid`/`price`/`ask`/`imb`/`stack`/`abs` keep their exact current rendering and CSS classes — this is a structural refactor only, no visual change for those columns.
- Each `render(lv, ctx)` internally uses the existing `fmtMode`/`fmtModeSigned`/`fmtPrice` helpers (value-mode aware: coin/notional/contracts/ticks) — no separate generic `format` field, since plain formatters can't carry `vctx`.
- Static per-column CSS classes (`v6-dom-cell-{c}`, `v6-dom-col-{c}`) are derived from the key `c` directly — no `className` config field needed; alignment/borders stay CSS-driven in `082_v6_dom_clean.css`.
- Column visibility/selection stays orthogonal (handled by `getDomColumns(settings)` / `VALID_DOM_KEYS` / settings UI) — no `visible` flag in `COLUMN_DEFS`.

## 2. New `vol` column + heatmap colors

- **`vol`**: `getRaw = lv => (lv.buyVol||0) + (lv.sellVol||0)`, formatted via `fmtMode` (same as buy/sell). Heatmap color = **cyan accent** (`--v6-accent`), intensity = `vol / maxVisibleVol`. Distinct from buy/sell colors, consistent with the "Obsidian Tape" single-accent language.
- **`sell`**: heatmap = **rose/red** (`--v6-sell`), intensity = `sellVol / maxVisibleSell`.
- **`buy`**: heatmap = **emerald/green** (`--v6-buy`), intensity = `buyVol / maxVisibleBuy`.
- **`delta`**: heatmap = green if `delta > 0` else red (`--v6-buy`/`--v6-sell`), intensity = `|delta| / maxVisible|delta|`.
- Each `max*` is computed once per render pass over the currently-rendered (virtualized) rows — same scope as the existing `maxBid`/`maxAsk` calc.
- Edge case: clamp `maxVisibleDelta = Math.max(maxVisibleDelta, 1)` (and similarly for vol/sell/buy maxes) to avoid div-by-zero / a flattened heatmap when the visible window is all-zero. A percentile-based soft cap for outlier rows (e.g. liquidations) is a documented future tweak, not built now.
- Intensity → opacity: `Math.min(1, raw/max)` mapped to a background alpha in the **0.05–0.35** range (low enough that text stays readable and never approaches the solid `is-live` price-cell fill), via `rgba(var(--v6-*-rgb), alpha)` or `color-mix()`. Requires adding `--v6-*-rgb` triplets alongside the existing hex tokens for `--v6-accent`, `--v6-buy`, `--v6-sell` (in the same three places the palette is currently emitted: inline boot script in `templates/partials/pages/orderflow.html`, `hydrateThemeVars()` in `073_v6_orderflow_layout.js`, and `070_v6_orderflow.css`).
- `bid`/`ask` keep their current depth-bar style (resting size, anchored bar) — not heatmap.

## 3. Settings, defaults, migration

In [079_v6_orderflow_settings.js](../../../static/js/split/079_v6_orderflow_settings.js):

- `VALID_DOM_KEYS`: add `vol: 1`.
- `DEFAULT_DOM_COLUMNS`: change from `['bid','price','ask']` to `['vol','sell','buy','bid','price','ask','delta']`.
- `LEGACY_DEFAULT_DOM_COLUMN_SETS`: add the current default (`['bid','price','ask']`) plus an audit of all existing entries (including any reordered/partial historical variants) so users on any prior default get migrated to the new default on next load. `validateSettings()`'s filter-against-`VALID_DOM_KEYS` and force-include-`price` logic is unchanged.
- Users with a hand-customized `domColumns` (not matching any legacy default set) are left untouched — migration only applies to recognized legacy *defaults*.

In [073_v6_orderflow_layout.js](../../../static/js/split/073_v6_orderflow_layout.js) (~line 690-783):

- `allColKeys`: add `'vol'`.
- `colLabels`: add `vol: 'Vol'`.
- Add a new preset matching the image-1 default (`vol,sell,buy,bid,price,ask,delta`); `imb`/`stack`/`abs` remain reachable via manual checkbox toggles. Preset ordering/labels reviewed for consistency when added.

## 4. Dock tab close (permanent) + re-add affordance

- **Close** (existing in [080_v6_layout_shell.js](../../../static/js/split/080_v6_layout_shell.js), verified correct, no change needed): `panel-close` removes the panel id from `layoutSchema.left`/`right`, persists via `store.updateSettings`, reassigns the active tab, and `applySchema` already hides the dock column entirely (`.is-hidden` on `leftCol`/`rightCol`) when its panel list becomes empty — chart area grows via existing CSS flex rules.
- **Re-add** (new): add a small `+` button in the right/left dock tab bar (`rtabsContainer`/`ltabsContainer`). Clicking it opens a small popover listing panels present in `DEFAULT_SCHEMA` but currently absent from `schema.left`/`schema.right` (e.g. DOM, Tape, Orderbook, Info...). Selecting one appends it back to `schema.right` (or `left`) and makes it the active tab. Hide the `+` button when there's nothing to re-add.
- This generalizes to all dock panels (not just dom/tape/cvd, which have separate `show*` settings) and reuses existing `layoutSchema` persistence — no new settings keys.

## Out of scope

- Chart axes/interactions/overall "carte blanche" redesign (separate future spec).
- Volume-profile heatmap overlay on the chart canvas (reference image 3).
- Workspace/layer inspector panel (reference image 4).
- Per-cell independent symbol/interval in the chart grid (094_v6_layout_grid.js) — unrelated to this task.
- `services/`, `workers/`, or Go engine code — untouched per standing project rule.

## Verification plan

- `python build.py` to rebuild `static/app.js`/`static/style.css` after each meaningful step.
- Live visual verification via Chrome DevTools MCP screenshots at `http://127.0.0.1:5000/orderflow`:
  - New 7-column DOM layout matches reference image 1 (order, labels, heatmap coloring).
  - Heatmap intensity visibly scales with size across visible rows.
  - Closing a dock tab (e.g. DOM) hides the dock and grows the chart; re-add `+` button restores it.
  - Settings column-config UI shows the new `Vol` checkbox/preset and persists correctly across reload.
- `.venv/Scripts/python.exe -m pytest tests/ -q` — full suite must stay green (no DOM grouping/test regressions).
- No commits (standing rule).
