# Orderflow V6 Rebuild — Phase 4: DOM + Tape Module Redesigns

> **For agentic workers:** execute task-by-task; **DO NOT COMMIT** until Task 6 (build + tests) passes. Use `.venv\Scripts\python.exe` on Windows.

**Goal:** Restyle the DOM and Tape panels to the validated mockup designs (`dom-redesign.html`, `tape-polish-v3.html`) using additive page-scoped CSS in new split files. Introduce the **premium panel header** (accent tick · title · meta chip · drag handle · ⚙/✕ icon buttons revealed on hover) shared by both. Move the GROUP selector from the DOM footer to the DOM panel header. Add Σ BID / Σ ASK footer to DOM. Add side-accent bar, size bar behind SIZE, big-trade highlight, and buy/sell pressure mini-bar to Tape. No data/store/engine changes. All existing tests stay green.

**Phases context:** Phase 1 = tokens, Phase 2 = chrome, Phase 3 = chart cell. This is Phase 4 of 7.

**Tech stack:** Vanilla JS (V6OF namespace, split files), CSS custom properties, `python build.py`, pytest.

---

## Problem statement (current state)

- **DOM** (`075_v6_dom_panel.js`): Has a `v6-dom-header` with SRC/AGE/LIVE/MID/SPR/SEQ/GAP/DROP stats and a "Follow mid" button. GROUP selector is in `v6-dom-footer` alongside a goto-price form. No Σ BID/Σ ASK footer summary. Wall detection exists but renders as a colored cell, not the glow+gradient style in the mockup.
- **Tape** (`074_v6_tape_panel.js`): Renders TIME/SIDE/PRICE/QTY/EXCH/SYM columns in a simple grid. No side-accent bar (left 2px stripe), no size bar behind SIZE, no big-trade highlight row, no buy/sell pressure mini-bar sub-header.
- **No premium panel header**: Both panels use a plain `v6-panel-head` (inherited from `070`). The mockup shows: accent tick (colored left border mark) · TITLE in caps · meta chip (exchange/source) · spacer · drag handle ⠿ · ⚙ settings icon · ✕ close icon (revealed on hover, turns red).

## Target state (from validated mockups)

### DOM (`dom-redesign.html`, `tape-polish-v3.html`)
```
┌─ Premium header ───────────────────────────────────────────┐
│ ● DOM  [BINANCE]                    ⠿  ⚙  ✕              │
│ GRP [25 ▾]                                                  │
├─ Column headers ───────────────────────────────────────────┤
│         BID  │   PRICE   │  ASK                            │
├─ Ladder rows (virtualised, unchanged) ─────────────────────┤
│  7.1  ▓▓▓░░░│  61,000   │                                 │
│ 24.6  ██████│  60,975   │    ← bid wall (glow)            │
│  4.1  ▓░░░░░│  60,950   │                                 │
│             │ 61,019·0.5│    ← MID band (accent glow)     │
│             │  61,050   │  6.2  ▓▓▓░░                     │
│             │  61,100   │ 18.7  ██████  ← ask wall (glow) │
├─ Σ footer ─────────────────────────────────────────────────┤
│  Σ BID  51.3                        Σ ASK  34.0           │
└────────────────────────────────────────────────────────────┘
```

### Tape (`tape-polish-v3.html`)
```
┌─ Premium header ───────────────────────────────────────────┐
│ ● Tape  [BINANCE]                   ⠿  ⚙  ✕              │
├─ Pressure bar ─────────────────────────────────────────────┤
│  PRESSION  ████████████░░░░░  62%                          │
├─ Column headers ───────────────────────────────────────────┤
│  TIME          PRICE          SIZE                         │
├─ Trade rows ───────────────────────────────────────────────┤
│▌ 42:01.3       61,019    ░░░░░  0.42  ← buy (green stripe)│
│▌ 42:01.1       61,018  ░░░░░░░░ 1.10  ← sell (red stripe) │
│▌ 42:00.9  ●   61,020   ████████ 5.30  ← big trade         │
└────────────────────────────────────────────────────────────┘
```

---

## Architecture — additive CSS only; minimal JS changes

**CSS approach:** New split files `076_v6_dom_redesign.css` and `077_v6_tape_redesign.css` loaded after existing CSS, page-scoped, no `!important`. They override visuals only. No structural JS refactor.

**JS changes (minimal):**
1. **DOM**: Move GROUP select from `v6-dom-footer` to `v6-dom-header` slot (in `buildSkeleton`). Add Σ BID / Σ ASK footer. Add `data-v6-dom-premium-header` wrapper. Keep all `data-dom-stat="*"` hooks.
2. **Tape**: Add side-accent bar element inside each row (CSS `:before` approach — zero JS needed). Add size-bar `<span>` behind SIZE. Add pressure mini-bar sub-header. Add `is-big` class on large trades. Keep all existing hooks.
3. **Premium panel header**: Add shared CSS class `.v6-panel-premium` that can be applied to the existing `.v6-panel-head` for both DOM and Tape.

**No module contract yet** — the full `create/render/dispose` abstraction is deferred to Phase 5 (tiling layout engine), where it's needed to slot modules into cells. Phase 4 is purely visual/UX.

---

## File map

| File | Change |
|---|---|
| `static/css/split/076_v6_dom_redesign.css` | New: DOM premium header, GROUP in header, two-sided ladder glows, wall styles, MID band, Σ footer |
| `static/css/split/077_v6_tape_redesign.css` | New: Tape premium header, side-accent bar, size bar, big-trade highlight, pressure mini-bar |
| `static/js/split/075_v6_dom_panel.js` | Move GROUP select to header; add Σ BID/ASK footer; add premium header markup |
| `static/js/split/074_v6_tape_panel.js` | Add pressure bar sub-header; add `szbar` span inside SIZE; add `is-big` class on large trades |
| `tests/test_orderflow_phase4_dom_tape.py` | New smoke tests: markup hooks present, no !important, no hardcoded colors |

---

## Constraints

- **No `!important`**. Page-scope with `body[data-current-page="orderflow"]`.
- **Preserve all `data-v6-*` / `data-testid` / `data-dom-stat` hooks**. CSS overrides visuals only.
- **No data / store / engine changes.** DOM and Tape data paths unchanged.
- **Graceful degradation**: if GROUP select is absent, DOM still renders. If pressure data is absent, mini-bar is hidden via CSS (`:empty`).
- **No commit until Task 6 passes.**
- **Accent color in mockup is cyan (`#5b8cff`)** — map to `var(--v6-accent)` (amber in this project). Do not use cyan. All token references use `var(--v6-*)` from `070`.

---

## Tasks

### Task 1 — DOM JS: premium header + GROUP in header + Σ footer

**File:** `static/js/split/075_v6_dom_panel.js`

The `buildSkeleton` function (around line 285) generates the DOM HTML structure. Currently it outputs `v6-dom-header` with stats, then `v6-dom-cols`, then `v6-dom-body`, then `v6-dom-footer` (with goto-price form + GROUP select + value-mode select).

- [ ] **Step 1:** Read `buildSkeleton` fully (lines 285–340) to understand the exact current structure.

- [ ] **Step 2:** Replace the `v6-dom-header` opening with a premium header. The premium header has:
  - Accent tick: `<span class="v6-panel-tick" aria-hidden="true"></span>`
  - Title: `<span class="v6-panel-title">DOM</span>`
  - Meta chip: `<span class="v6-panel-meta" data-dom-stat="source">—</span>` (reuses existing `data-dom-stat="source"` hook)
  - GROUP select moved here: `<label class="v6-panel-grp">GRP <select class="v6-dom-grouping">…</select></label>`
  - Spacer: `<span class="v6-panel-sp"></span>`
  - Drag handle: `<span class="v6-panel-grab" aria-hidden="true">⠿</span>`
  - Settings button: `<button type="button" class="v6-panel-ib" data-v6-action="panel-settings" title="Settings" aria-label="Panel settings">⚙</button>`
  - Close button: `<button type="button" class="v6-panel-ib v6-panel-ib-close" data-v6-action="panel-close" title="Close" aria-label="Close panel">✕</button>`

  Keep the existing stats (`data-dom-stat="age"`, `data-dom-stat="live"`, etc.) hidden via CSS (`display:none` in `076_v6_dom_redesign.css`) rather than removing them — preserve all hooks.

- [ ] **Step 3:** Add Σ footer. After `v6-dom-body` and before `v6-dom-stale-overlay`, add:

```html
<div class="v6-dom-sigma-footer" data-v6-dom-sigma>
  <span class="v6-dom-sigma-bid"><em>Σ BID</em> <strong data-dom-sigma="bid">—</strong></span>
  <span class="v6-dom-sigma-ask"><em>Σ ASK</em> <strong data-dom-sigma="ask">—</strong></span>
</div>
```

- [ ] **Step 4:** Update `renderStats` (around line 157) to also populate the Σ footer:

Find where `bestBid` / `bestAsk` totals are computed (scan for `sumBid`/`sumAsk` or compute from `snap.bids`/`snap.asks`) and write to `data-dom-sigma="bid"` and `data-dom-sigma="ask"`. Use the existing `fmt()` helper.

  If sumBid/sumAsk are not yet computed, compute them:
  ```js
  var sigmaFoot = container.querySelector('[data-v6-dom-sigma]');
  if (sigmaFoot && snap) {
    var bids = Array.isArray(snap.bids) ? snap.bids : [];
    var asks = Array.isArray(snap.asks) ? snap.asks : [];
    var sumBid = bids.reduce(function (s, l) { return s + (Number(l.qty) || 0); }, 0);
    var sumAsk = asks.reduce(function (s, l) { return s + (Number(l.qty) || 0); }, 0);
    var mid = snap.mid || snap.price || 0;
    var bidEl = sigmaFoot.querySelector('[data-dom-sigma="bid"]');
    var askEl = sigmaFoot.querySelector('[data-dom-sigma="ask"]');
    if (bidEl) bidEl.textContent = fmt(sumBid, true, mid);
    if (askEl) askEl.textContent = fmt(sumAsk, true, mid);
  }
  ```

- [ ] **Step 5:** Remove the GROUP select from `v6-dom-footer` (it now lives in the header). Keep the goto-price form and value-mode select in the footer. Keep the footer element itself — just remove the `v6-dom-glbl` GROUP label.

- [ ] **Step 6:** Build and confirm clean: `.venv\Scripts\python.exe build.py`

---

### Task 2 — DOM CSS: premium header + ladder glows + Σ footer

**File:** `static/css/split/076_v6_dom_redesign.css` (new)

Page-scoped; no `!important`; no hardcoded colors — use `var(--v6-*)` tokens.

- [ ] **Step 1:** Create the file with these rule groups:

```css
/* ============================================================
   076_v6_dom_redesign.css
   Phase 4: DOM panel — premium header, two-sided ladder,
   wall glows, MID band, Σ footer.
   Page-scoped; no overrides; tokens only.
   ============================================================ */

/* ── Premium panel header (shared by DOM + Tape) ── */
body[data-current-page="orderflow"] .v6-dom-header,
body[data-current-page="orderflow"] .v6-tape-header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px 0 10px;
  background: linear-gradient(180deg, var(--v6-surface), var(--v6-bg-2));
  border-bottom: 1px solid var(--v6-hairline);
  flex-shrink: 0;
}

body[data-current-page="orderflow"] .v6-panel-tick {
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--v6-gold);
  box-shadow: 0 0 8px var(--v6-gold-soft);
  flex-shrink: 0;
}

body[data-current-page="orderflow"] .v6-tape-header .v6-panel-tick {
  background: var(--v6-accent);
  box-shadow: 0 0 8px var(--v6-accent-soft);
}

body[data-current-page="orderflow"] .v6-panel-title {
  font-weight: 800;
  font-size: 10px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--v6-text);
  flex-shrink: 0;
}

body[data-current-page="orderflow"] .v6-panel-meta {
  font: 700 8px/1 var(--v6-mono);
  color: var(--v6-text-mute);
  background: var(--v6-surface-2);
  border: 1px solid var(--v6-hairline);
  border-radius: 5px;
  padding: 3px 6px;
  flex-shrink: 0;
}

body[data-current-page="orderflow"] .v6-panel-grp {
  display: flex;
  align-items: center;
  gap: 4px;
  font: 700 8px/1 var(--v6-mono);
  color: var(--v6-text-mute);
  background: var(--v6-surface-2);
  border: 1px solid var(--v6-hairline);
  border-radius: 6px;
  padding: 3px 7px;
  flex-shrink: 0;
}

body[data-current-page="orderflow"] .v6-panel-grp select {
  background: transparent;
  border: none;
  color: var(--v6-text);
  font: 700 8px/1 var(--v6-mono);
  cursor: pointer;
  outline: none;
}

body[data-current-page="orderflow"] .v6-panel-sp {
  flex: 1;
}

body[data-current-page="orderflow"] .v6-panel-grab {
  color: var(--v6-text-faint);
  letter-spacing: -2px;
  font-size: 12px;
  cursor: grab;
  opacity: 0.5;
  flex-shrink: 0;
}

body[data-current-page="orderflow"] .v6-panel-ib {
  width: 23px;
  height: 23px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--v6-text-mute);
  font-size: 12px;
  cursor: pointer;
  background: transparent;
  border: none;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

body[data-current-page="orderflow"] .v6-dom-header:hover .v6-panel-ib,
body[data-current-page="orderflow"] .v6-tape-header:hover .v6-panel-ib {
  opacity: 1;
}

body[data-current-page="orderflow"] .v6-panel-ib:hover {
  background: var(--v6-surface-3);
  color: var(--v6-text);
}

body[data-current-page="orderflow"] .v6-panel-ib-close:hover {
  background: rgba(246, 70, 93, 0.16);
  color: var(--v6-sell);
}

/* Hide the legacy stats row — hooks preserved in DOM */
body[data-current-page="orderflow"] .v6-dom-hleft,
body[data-current-page="orderflow"] .v6-dom-hright {
  display: none;
}

/* ── DOM ladder ── */

/* Column header row */
body[data-current-page="orderflow"] .v6-dom-cols {
  display: grid;
  grid-template-columns: 1fr 62px 1fr;
  height: 18px;
  align-items: center;
  border-bottom: 1px solid var(--v6-hairline);
  font: 800 7px/1 var(--v6-mono);
  letter-spacing: 0.08em;
  color: var(--v6-text-faint);
  text-transform: uppercase;
}

/* Bid side right-aligned, price centered, ask left-aligned */
body[data-current-page="orderflow"] .v6-dom-col-bid { text-align: right; padding-right: 8px; }
body[data-current-page="orderflow"] .v6-dom-col-price { text-align: center; }
body[data-current-page="orderflow"] .v6-dom-col-ask { text-align: left; padding-left: 8px; }

/* Individual ladder rows */
body[data-current-page="orderflow"] .v6-dom-row {
  display: grid;
  grid-template-columns: 1fr 62px 1fr;
  align-items: center;
  font: 600 10px/1 var(--v6-mono);
  font-variant-numeric: tabular-nums;
  position: relative;
}

/* Bid cell: right-aligned, overflow hidden for depth bar */
body[data-current-page="orderflow"] .v6-dom-cell-bid {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 8px;
  overflow: hidden;
  color: var(--v6-buy);
}

/* Ask cell: left-aligned */
body[data-current-page="orderflow"] .v6-dom-cell-ask {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding-left: 8px;
  overflow: hidden;
  color: var(--v6-sell);
}

/* Depth bar fills inside bid/ask cells */
body[data-current-page="orderflow"] .v6-dom-bar {
  position: absolute;
  top: 2px;
  bottom: 2px;
  z-index: 0;
  border-radius: 0;
}

body[data-current-page="orderflow"] .v6-dom-cell-bid .v6-dom-bar {
  right: 0;
  background: linear-gradient(270deg, var(--v6-buy-soft), transparent);
}

body[data-current-page="orderflow"] .v6-dom-cell-ask .v6-dom-bar {
  left: 0;
  background: linear-gradient(90deg, var(--v6-sell-soft), transparent);
}

/* Value label above bar */
body[data-current-page="orderflow"] .v6-dom-cell-bid .v6-dom-qty,
body[data-current-page="orderflow"] .v6-dom-cell-ask .v6-dom-qty {
  position: relative;
  z-index: 1;
}

/* Price column */
body[data-current-page="orderflow"] .v6-dom-cell-price {
  text-align: center;
  color: var(--v6-text-dim);
  font-weight: 700;
  background: rgba(255, 255, 255, 0.015);
  border-left: 1px solid var(--v6-hairline);
  border-right: 1px solid var(--v6-hairline);
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Wall rows: bid wall */
body[data-current-page="orderflow"] .v6-dom-row.is-bid-wall .v6-dom-cell-bid .v6-dom-bar {
  background: linear-gradient(270deg, var(--v6-buy), rgba(63, 185, 80, 0.1));
  box-shadow: inset 0 0 12px var(--v6-buy-soft);
}
body[data-current-page="orderflow"] .v6-dom-row.is-bid-wall .v6-dom-qty { color: var(--v6-buy); font-weight: 800; }

/* Wall rows: ask wall */
body[data-current-page="orderflow"] .v6-dom-row.is-ask-wall .v6-dom-cell-ask .v6-dom-bar {
  background: linear-gradient(90deg, var(--v6-sell), rgba(246, 70, 93, 0.1));
  box-shadow: inset 0 0 12px var(--v6-sell-soft);
}
body[data-current-page="orderflow"] .v6-dom-row.is-ask-wall .v6-dom-cell-ask .v6-dom-qty { color: var(--v6-sell); font-weight: 800; }

/* MID band row */
body[data-current-page="orderflow"] .v6-dom-row.is-mid {
  background: linear-gradient(90deg, transparent, var(--v6-accent-soft), transparent);
  box-shadow: inset 0 1px 0 var(--v6-accent-line), inset 0 -1px 0 var(--v6-accent-line);
}
body[data-current-page="orderflow"] .v6-dom-row.is-mid .v6-dom-cell-price {
  color: var(--v6-accent);
  font-weight: 800;
  background: transparent;
  border: none;
  text-shadow: 0 0 10px var(--v6-accent-glow);
}

/* Best bid/ask price color */
body[data-current-page="orderflow"] .v6-dom-row.is-best-bid .v6-dom-cell-price { color: var(--v6-buy); }
body[data-current-page="orderflow"] .v6-dom-row.is-best-ask .v6-dom-cell-price { color: var(--v6-sell); }

/* ── Σ BID / Σ ASK footer ── */
body[data-current-page="orderflow"] .v6-dom-sigma-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 22px;
  padding: 0 10px;
  border-top: 1px solid var(--v6-hairline);
  font: 700 8px/1 var(--v6-mono);
  color: var(--v6-text-mute);
  flex-shrink: 0;
}

body[data-current-page="orderflow"] .v6-dom-sigma-bid strong { color: var(--v6-buy); }
body[data-current-page="orderflow"] .v6-dom-sigma-ask strong { color: var(--v6-sell); }

/* Hide the old group/footer controls that moved to header */
body[data-current-page="orderflow"] .v6-dom-glbl { display: none; }
```

- [ ] **Step 2:** Build and verify bundled into `static/style.css`.

---

### Task 3 — Tape JS: pressure bar + size bar + big-trade class

**File:** `static/js/split/074_v6_tape_panel.js`

- [ ] **Step 1:** Add a premium header (`v6-tape-header`) to `ensureTapeShell`. Replace the current shell HTML with:

```js
container.innerHTML = [
  '<div class="v6-tape-header">',
    '<span class="v6-panel-tick" aria-hidden="true"></span>',
    '<span class="v6-panel-title">Tape</span>',
    '<span class="v6-panel-meta" data-v6-tape-source>—</span>',
    '<span class="v6-panel-sp"></span>',
    '<span class="v6-panel-grab" aria-hidden="true">⠿</span>',
    '<button type="button" class="v6-panel-ib" data-v6-action="panel-settings" title="Settings" aria-label="Panel settings">⚙</button>',
    '<button type="button" class="v6-panel-ib v6-panel-ib-close" data-v6-action="panel-close" title="Close" aria-label="Close panel">✕</button>',
  '</div>',
  '<div class="v6-tape-pressure" data-v6-tape-pressure>',
    '<span class="v6-tape-pressure-lbl">PRESSION</span>',
    '<span class="v6-tape-pbar"><span class="v6-tape-pbar-buy" data-v6-tape-pbar-buy></span><span class="v6-tape-pbar-sell" data-v6-tape-pbar-sell></span></span>',
    '<span class="v6-tape-pressure-val" data-v6-tape-pressure-val>—</span>',
  '</div>',
  '<div class="v6-tape-cols">',
    '<span>TIME</span><span>PRICE</span><span class="v6-tape-col-r">SIZE</span>',
  '</div>',
  '<div class="v6-tape-virtual-body" data-v6-tape-virtual></div>',
].join('');
container._v6TapeShell = {
  header: container.querySelector('.v6-tape-header'),
  pressure: container.querySelector('[data-v6-tape-pressure]'),
  pbarBuy: container.querySelector('[data-v6-tape-pbar-buy]'),
  pbarSell: container.querySelector('[data-v6-tape-pbar-sell]'),
  pressureVal: container.querySelector('[data-v6-tape-pressure-val]'),
  body: container.querySelector('[data-v6-tape-virtual]')
};
```

- [ ] **Step 2:** Update `renderTapeRow` to use the new design:
  - Column layout: TIME · PRICE · SIZE (3 columns, remove SIDE/EXCH/SYM from visible columns — keep data in the DOM as hidden `data-*` attributes for future use).
  - Add `is-buy`/`is-sell` class on the row.
  - Add `is-big` class when `trade.qty` exceeds a threshold (configurable via `settings.bigTradeThreshold`, default = top 10% of visible trades or a sensible absolute; for now use `settings.bigTradeQty || 5`).
  - Add size bar `<span>` inside the SIZE cell. Width = `(qty / maxQty * 100).toFixed(1) + '%'`. Pass `maxQty` as a parameter.

```js
function renderTapeRow(trade, opts) {
  opts = opts || {};
  trade = trade || {};
  var side = trade.side === 'buy' ? 'buy' : 'sell';
  var isBig = opts.maxQty && Number(trade.qty) >= opts.bigThreshold;
  var szPct = opts.maxQty ? Math.min(100, Number(trade.qty) / opts.maxQty * 100).toFixed(1) : '0';
  var cls = 'v6-tape-row' +
    (side === 'buy' ? ' is-buy' : ' is-sell') +
    (isBig ? ' is-big' : '');
  return [
    '<div class="', cls, '">',
      '<span class="v6-tape-time">', V6OF.escapeHtml(V6OF.format.time(tradeTime(trade))), '</span>',
      '<span class="v6-tape-price">', V6OF.escapeHtml(V6OF.format.price(Number(trade.price))), '</span>',
      '<span class="v6-tape-size">',
        '<span class="v6-tape-szbar" style="width:', szPct, '%"></span>',
        V6OF.escapeHtml(V6OF.format.qty(Number(trade.qty))),
      '</span>',
    '</div>'
  ].join('');
}
```

- [ ] **Step 3:** Compute `maxQty` and `bigThreshold` before rendering and pass via `opts` in `renderTapeInto`:

```js
var maxQty = 1;
rows.forEach(function (t) { maxQty = Math.max(maxQty, Number(t.qty) || 0); });
var bigThreshold = Number(settings.bigTradeQty || (maxQty * 0.7));
```

Pass `{ maxQty: maxQty, bigThreshold: bigThreshold }` as `opts` to `VirtualList.render`'s `renderRow` via a closure.

- [ ] **Step 4:** Update the pressure bar in `renderTapeInto`. Compute buy/sell totals from `rows`:

```js
var buyVol = 0, sellVol = 0;
rows.forEach(function (t) {
  if (t.side === 'buy') buyVol += Number(t.qty) || 0;
  else sellVol += Number(t.qty) || 0;
});
var total = buyVol + sellVol || 1;
var buyPct = (buyVol / total * 100).toFixed(0);
var shell = container._v6TapeShell;
if (shell && shell.pbarBuy) {
  shell.pbarBuy.style.width = buyPct + '%';
  shell.pbarSell.style.width = (100 - Number(buyPct)) + '%';
  shell.pressureVal.textContent = buyPct + '%';
  shell.pressureVal.style.color = buyVol >= sellVol ? '' : ''; // CSS handles color via parent class
  shell.pressure.classList.toggle('is-buy-pressure', buyVol >= sellVol);
  shell.pressure.classList.toggle('is-sell-pressure', buyVol < sellVol);
}
```

- [ ] **Step 5:** Build and confirm clean.

---

### Task 4 — Tape CSS

**File:** `static/css/split/077_v6_tape_redesign.css` (new)

- [ ] **Step 1:** Create the file:

```css
/* ============================================================
   077_v6_tape_redesign.css
   Phase 4: Tape panel — premium header, side-accent bar,
   size bar, big-trade highlight, pressure mini-bar.
   Page-scoped; no overrides; tokens only.
   ============================================================ */

/* ── Tape header: reuses .v6-tape-header + shared .v6-panel-* from 076 ── */
body[data-current-page="orderflow"] .v6-tape-header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px 0 10px;
  background: linear-gradient(180deg, var(--v6-surface), var(--v6-bg-2));
  border-bottom: 1px solid var(--v6-hairline);
  flex-shrink: 0;
}

/* ── Pressure bar sub-header ── */
body[data-current-page="orderflow"] .v6-tape-pressure {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 24px;
  padding: 0 11px;
  border-bottom: 1px solid var(--v6-hairline);
  font: 700 8px/1 var(--v6-mono);
  color: var(--v6-text-faint);
  flex-shrink: 0;
}

body[data-current-page="orderflow"] .v6-tape-pbar {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  background: var(--v6-surface-2);
}

body[data-current-page="orderflow"] .v6-tape-pbar-buy { background: var(--v6-buy); }
body[data-current-page="orderflow"] .v6-tape-pbar-sell { background: var(--v6-sell); }

body[data-current-page="orderflow"] .v6-tape-pressure-val { color: var(--v6-text-mute); }
body[data-current-page="orderflow"] .v6-tape-pressure.is-buy-pressure .v6-tape-pressure-val { color: var(--v6-buy); }
body[data-current-page="orderflow"] .v6-tape-pressure.is-sell-pressure .v6-tape-pressure-val { color: var(--v6-sell); }

/* ── Column headers ── */
body[data-current-page="orderflow"] .v6-tape-cols {
  display: grid;
  grid-template-columns: 56px 1fr 1fr;
  height: 17px;
  align-items: center;
  padding: 0 12px;
  font: 800 7px/1 var(--v6-mono);
  letter-spacing: 0.06em;
  color: var(--v6-text-faint);
  text-transform: uppercase;
  border-bottom: 1px solid var(--v6-hairline);
  flex-shrink: 0;
}

body[data-current-page="orderflow"] .v6-tape-col-r { text-align: right; }

/* ── Trade rows ── */
body[data-current-page="orderflow"] .v6-tape-row {
  position: relative;
  display: grid;
  grid-template-columns: 56px 1fr 1fr;
  align-items: center;
  padding: 0 12px;
  font: 600 11px/1 var(--v6-mono);
  font-variant-numeric: tabular-nums;
  min-height: 20px;
}

/* Side accent bar (left 2px stripe) */
body[data-current-page="orderflow"] .v6-tape-row::before {
  content: "";
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 2px;
}

body[data-current-page="orderflow"] .v6-tape-row.is-buy::before { background: var(--v6-buy); }
body[data-current-page="orderflow"] .v6-tape-row.is-sell::before { background: var(--v6-sell); }

/* Time column */
body[data-current-page="orderflow"] .v6-tape-time {
  color: var(--v6-text-faint);
  font-size: 9px;
}

/* Price column */
body[data-current-page="orderflow"] .v6-tape-price { font-weight: 700; }
body[data-current-page="orderflow"] .v6-tape-row.is-buy .v6-tape-price { color: var(--v6-buy); }
body[data-current-page="orderflow"] .v6-tape-row.is-sell .v6-tape-price { color: var(--v6-sell); }

/* Size column: relative container for size bar */
body[data-current-page="orderflow"] .v6-tape-size {
  position: relative;
  text-align: right;
  color: var(--v6-text-dim);
  z-index: 1;
}

body[data-current-page="orderflow"] .v6-tape-szbar {
  position: absolute;
  right: 0;
  top: 4px;
  bottom: 4px;
  z-index: 0;
  border-radius: 3px 0 0 3px;
}

body[data-current-page="orderflow"] .v6-tape-row.is-buy .v6-tape-szbar {
  background: linear-gradient(90deg, transparent, var(--v6-buy-soft));
}

body[data-current-page="orderflow"] .v6-tape-row.is-sell .v6-tape-szbar {
  background: linear-gradient(90deg, transparent, var(--v6-sell-soft));
}

/* Size value above bar */
body[data-current-page="orderflow"] .v6-tape-size > :not(.v6-tape-szbar) {
  position: relative;
  z-index: 1;
}

/* Row hover */
body[data-current-page="orderflow"] .v6-tape-row:hover {
  background: rgba(255, 255, 255, 0.025);
}

/* Big trade highlight */
body[data-current-page="orderflow"] .v6-tape-row.is-big {
  background: var(--v6-accent-soft);
}

body[data-current-page="orderflow"] .v6-tape-row.is-big .v6-tape-size {
  font-weight: 800;
  color: var(--v6-text);
  font-size: 12px;
}

body[data-current-page="orderflow"] .v6-tape-row.is-big.is-buy .v6-tape-szbar {
  background: linear-gradient(90deg, var(--v6-buy-soft), rgba(63, 185, 80, 0.6));
  box-shadow: inset 0 0 12px var(--v6-buy-soft);
}

body[data-current-page="orderflow"] .v6-tape-row.is-big.is-sell .v6-tape-szbar {
  background: linear-gradient(90deg, var(--v6-sell-soft), rgba(246, 70, 93, 0.6));
  box-shadow: inset 0 0 12px var(--v6-sell-soft);
}

/* Big trade indicator dot */
body[data-current-page="orderflow"] .v6-tape-row.is-big::after {
  content: "●";
  position: absolute;
  left: 5px;
  font-size: 7px;
}

body[data-current-page="orderflow"] .v6-tape-row.is-big.is-buy::after { color: var(--v6-buy); }
body[data-current-page="orderflow"] .v6-tape-row.is-big.is-sell::after { color: var(--v6-sell); }

/* Fade mask at bottom */
body[data-current-page="orderflow"] .v6-tape-virtual-body {
  -webkit-mask-image: linear-gradient(180deg, #000 88%, transparent);
  mask-image: linear-gradient(180deg, #000 88%, transparent);
}
```

- [ ] **Step 2:** Build and verify bundled.

---

### Task 5 — Verify existing DOM wall/mid classes are emitted

The DOM JS (`075`) already has wall detection logic. Verify it emits `is-bid-wall`, `is-ask-wall`, `is-mid`, `is-best-bid`, `is-best-ask` classes on rows (or the equivalent existing class names). The CSS in Task 2 targets these class names — confirm they match.

- [ ] **Step 1:** Grep `075_v6_dom_panel.js` for existing class names on wall/mid rows:

```
grep -n "is-bid-wall\|is-ask-wall\|is-mid\|wb\|wa\|wall\|mid\|best.bid\|best.ask" static/js/split/075_v6_dom_panel.js
```

- [ ] **Step 2:** If existing classes differ (e.g. `wb`/`wa` instead of `is-bid-wall`/`is-ask-wall`), update the CSS selectors in `076_v6_dom_redesign.css` to match — do NOT rename the JS classes (would break tests).

- [ ] **Step 3:** Confirm `v6-dom-bar` elements (the depth bar `<u>` or equivalent) exist in the current `renderRow` output. If the current implementation uses `<u>` tags (not `.v6-dom-bar` class), update the CSS to target `u` inside the cell, or add `.v6-dom-bar` class in `renderRow`. Prefer adding the class to the existing element over restructuring.

---

### Task 6 — Build, tests, smoke tests

- [ ] **Step 1:** Build.

```
.venv\Scripts\python.exe build.py
```

Expected: clean.

- [ ] **Step 2:** Full test suite.

```
.venv\Scripts\python.exe -m pytest tests/ -q
```

Expected: same pass count + new tests (1 pre-existing playbook timestamp failure is known).

- [ ] **Step 3:** Create `tests/test_orderflow_phase4_dom_tape.py`:

```python
"""Smoke tests for Phase 4: DOM + Tape panel redesigns."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _no_important(css_text):
    no_comments = re.sub(r'/\*.*?\*/', '', css_text, flags=re.DOTALL)
    return '!important' not in no_comments


def _no_hardcoded_colors(css_text):
    no_comments = re.sub(r'/\*.*?\*/', '', css_text, flags=re.DOTALL)
    return (not re.search(r':\s*#[0-9a-fA-F]{3,6}', no_comments) and
            not re.search(r':\s*rgba?\(', no_comments))


# ── CSS file checks ──

def test_dom_css_file_exists():
    assert (ROOT / 'static/css/split/076_v6_dom_redesign.css').exists()


def test_tape_css_file_exists():
    assert (ROOT / 'static/css/split/077_v6_tape_redesign.css').exists()


def test_dom_css_no_important():
    css = (ROOT / 'static/css/split/076_v6_dom_redesign.css').read_text(encoding='utf-8')
    assert _no_important(css), "!important found in DOM CSS"


def test_tape_css_no_important():
    css = (ROOT / 'static/css/split/077_v6_tape_redesign.css').read_text(encoding='utf-8')
    assert _no_important(css), "!important found in Tape CSS"


def test_dom_css_no_hardcoded_colors():
    css = (ROOT / 'static/css/split/076_v6_dom_redesign.css').read_text(encoding='utf-8')
    assert _no_hardcoded_colors(css), "Hardcoded color in DOM CSS"


def test_tape_css_no_hardcoded_colors():
    css = (ROOT / 'static/css/split/077_v6_tape_redesign.css').read_text(encoding='utf-8')
    assert _no_hardcoded_colors(css), "Hardcoded color in Tape CSS"


# ── DOM JS checks ──

def test_dom_sigma_footer_hook():
    src = (ROOT / 'static/js/split/075_v6_dom_panel.js').read_text(encoding='utf-8')
    assert 'data-v6-dom-sigma' in src, "DOM Σ footer hook missing"


def test_dom_sigma_bid_ask_hooks():
    src = (ROOT / 'static/js/split/075_v6_dom_panel.js').read_text(encoding='utf-8')
    assert 'data-dom-sigma="bid"' in src, "DOM Σ BID hook missing"
    assert 'data-dom-sigma="ask"' in src, "DOM Σ ASK hook missing"


def test_dom_premium_header_tick():
    src = (ROOT / 'static/js/split/075_v6_dom_panel.js').read_text(encoding='utf-8')
    assert 'v6-panel-tick' in src, "DOM premium header tick missing"


def test_dom_panel_title():
    src = (ROOT / 'static/js/split/075_v6_dom_panel.js').read_text(encoding='utf-8')
    assert 'v6-panel-title' in src, "DOM premium header title missing"


# ── Tape JS checks ──

def test_tape_pressure_bar_hook():
    src = (ROOT / 'static/js/split/074_v6_tape_panel.js').read_text(encoding='utf-8')
    assert 'data-v6-tape-pressure' in src, "Tape pressure bar hook missing"


def test_tape_szbar_present():
    src = (ROOT / 'static/js/split/074_v6_tape_panel.js').read_text(encoding='utf-8')
    assert 'v6-tape-szbar' in src, "Tape size bar class missing"


def test_tape_big_trade_class():
    src = (ROOT / 'static/js/split/074_v6_tape_panel.js').read_text(encoding='utf-8')
    assert 'is-big' in src, "Tape big-trade is-big class missing"


def test_tape_premium_header():
    src = (ROOT / 'static/js/split/074_v6_tape_panel.js').read_text(encoding='utf-8')
    assert 'v6-tape-header' in src, "Tape premium header missing"
```

- [ ] **Step 4:** Run the new tests.

```
.venv\Scripts\python.exe -m pytest tests/test_orderflow_phase4_dom_tape.py -v
```

Expected: all 16 pass.

- [ ] **Step 5:** Manual visual check.

Start: `.venv\Scripts\python.exe app.py`
Open the Orderflow page. Confirm:
- DOM panel: premium header visible (accent tick, DOM title, exchange chip, GROUP selector, ⚙/✕ on hover); ladder rows show depth bars growing from price column outward; wall rows glow; MID band shows accent glow; Σ BID / Σ ASK footer updates with live data.
- Tape panel: premium header visible; pressure bar sub-header with buy/sell ratio; trade rows have left side-accent bar (green buy / red sell); size bar behind SIZE column; big trades highlighted with brighter bar + dot + bold size.
- No console errors. All existing controls still work (timeframe, source, etc.).

---

## Self-review

- **Spec coverage (Phase 4):** "DOM + Tape + Orderbook modules to the validated designs (two-sided DOM ladder w/ walls + Σ footer + GROUP-in-header; Tape with size bars + side accents + big-trade highlight + pressure bar + premium header)" → Tasks 1–5. Orderbook is a separate panel not currently in the codebase — deferred (YAGNI for now, can be added as a follow-on).
- **Module contract deferred:** `create/render/dispose` abstraction and slot renderer (`header/toolbar/body/footer`) are Phase 5 concerns. Phase 4 is purely visual.
- **No `!important`:** CSS tasks explicitly checked via tests.
- **No hardcoded colors:** All CSS uses `var(--v6-*)`. JS draw paths use `fmt()` helpers, no color values.
- **Accent color:** Mockup uses cyan `#5b8cff`. This project uses amber `var(--v6-accent)`. CSS maps mockup's accent use to `var(--v6-accent)` / `var(--v6-gold)` per context (DOM tick = gold, Tape tick = accent).
- **Existing tests unaffected:** No store/engine changes. Hook names preserved. CLASS names on existing DOM rows not renamed.
