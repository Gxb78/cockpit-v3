# Orderflow V6 — DOM Panel Redesign + Dock Tab Close/Re-add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the V6 DOM panel column system around a generic `COLUMN_DEFS` registry, add a new heatmap-styled `Vol` column with a `vol,sell,buy,bid,price,ask,delta` default layout, and add a "+" re-add affordance to the dock tab bars so any closed panel (DOM, Tape, Orderbook, Info) can be restored.

**Architecture:** `075_v6_dom_panel.js` gains a `COLUMN_DEFS` registry (weight/label/render per column key) that replaces the parallel `COLUMN_WEIGHTS`/`COLUMN_LABELS`/if-else chain; `renderRow` builds one shared `ctx` object per row and calls `COLUMN_DEFS[c].render(ctx)`. Heatmap intensity for `vol`/`sell`/`buy`/`delta` is computed once per virtualized render pass (alongside the existing `maxBid`/`maxAsk` calc) and applied as inline `rgba(var(--v6-*-rgb), alpha)` backgrounds using new RGB token triplets. Settings (`079`) and the settings UI (`073`) are updated for the new default column set and migration. The dock shell (`080`/`071`) gets a generic "+" button per side that re-adds any panel present in `DEFAULT_SCHEMA` but missing from the current `layoutSchema`.

**Tech Stack:** Vanilla JS (ES5-style, IIFE modules registered on `V6OF`), hand-written CSS split files bundled via `python build.py` (terser + esbuild), Flask templates.

**Standing rules for this plan:**
- **NO COMMITS** at any point — all verification is local (build + Chrome DevTools screenshots + pytest). Do not run any `git` commands.
- Do NOT touch `services/`, `workers/`, or Go engine code.
- After each task, run `python build.py` from the repo root, then verify visually at `http://127.0.0.1:5000/orderflow` via Chrome DevTools MCP screenshots (assume the Flask dev server is already running; if not, ask the user to start it — do not start background servers yourself unless asked).

---

### Task 1: Add `--v6-*-rgb` token triplets for heatmap backgrounds

**Files:**
- Modify: `static/css/split/070_v6_orderflow.css:46`
- Modify: `static/js/split/073_v6_orderflow_layout.js:130-142`
- Modify: `templates/partials/pages/orderflow.html:24-30`

The heatmap cell backgrounds need `rgba(var(--v6-*-rgb), alpha)` triplets alongside the existing hex `--v6-accent`/`--v6-buy`/`--v6-sell` tokens. These three tokens are static (not theme-dependent), but the codebase currently emits the static palette in three places (070 CSS source-of-truth, `hydrateThemeVars()` in 073, and the inline boot script in `orderflow.html`), so the new triplets are added in the same three places for consistency.

- [ ] **Step 1: Add RGB triplets to the CSS token block (070)**

In `static/css/split/070_v6_orderflow.css`, after line 46 (`--v6-accent-glow: rgba(255, 122, 69, 0.45);`), add:

```css
  --v6-accent-rgb:  255, 122, 69;
  --v6-buy-rgb:     63, 185, 80;
  --v6-sell-rgb:    246, 70, 93;
```

- [ ] **Step 2: Add RGB triplets to `hydrateThemeVars()` (073)**

In `static/js/split/073_v6_orderflow_layout.js`, the `hydrateThemeVars(root, settings)` function sets two var maps (light at lines 117-129, dark at lines 130-142). Add the same three keys to **both** maps so the runtime-hydrated set always matches the CSS source-of-truth regardless of which branch executes.

Light map (after line 128, `'--v6-hairline-strong': 'rgba(19, 23, 34, 0.24)'`):

```js
          '--v6-hairline-strong': 'rgba(19, 23, 34, 0.24)',
          '--v6-accent-rgb': '255, 122, 69',
          '--v6-buy-rgb': '63, 185, 80',
          '--v6-sell-rgb': '246, 70, 93'
```

(note: add a trailing comma to the previous last line and remove the trailing comma from the new last line, per existing object-literal style)

Dark map (after line 141, `'--v6-hairline-strong': 'rgba(255, 255, 255, 0.12)'`):

```js
          '--v6-hairline-strong': 'rgba(255, 255, 255, 0.12)',
          '--v6-accent-rgb': '255, 122, 69',
          '--v6-buy-rgb': '63, 185, 80',
          '--v6-sell-rgb': '246, 70, 93'
```

- [ ] **Step 3: Add RGB triplets to the inline boot script (orderflow.html)**

In `templates/partials/pages/orderflow.html`, the inline boot script (lines 16-30) mirrors the same two var maps. Add the same three keys to both:

Light map (after `'--v6-hairline-strong': 'rgba(19, 23, 34, 0.24)'` on line 22):

```js
                '--v6-hairline-strong': 'rgba(19, 23, 34, 0.24)',
                '--v6-accent-rgb': '255, 122, 69', '--v6-buy-rgb': '63, 185, 80', '--v6-sell-rgb': '246, 70, 93'
```

Dark map (after `'--v6-hairline-strong': 'rgba(255, 255, 255, 0.12)'` on line 29):

```js
                '--v6-hairline-strong': 'rgba(255, 255, 255, 0.12)',
                '--v6-accent-rgb': '255, 122, 69', '--v6-buy-rgb': '63, 185, 80', '--v6-sell-rgb': '246, 70, 93'
```

- [ ] **Step 4: Build and verify**

Run: `python build.py`

Then, via Chrome DevTools MCP at `http://127.0.0.1:5000/orderflow`, evaluate:

```js
getComputedStyle(document.querySelector('.v6-orderflow-root')).getPropertyValue('--v6-buy-rgb')
```

Expected: `" 63, 185, 80"` (or equivalent, no error). The page should render unchanged visually — this step only adds unused CSS variables.

---

### Task 2: `COLUMN_DEFS` registry refactor + new `vol` column (no heatmap backgrounds yet)

**Files:**
- Modify: `static/js/split/075_v6_dom_panel.js:227-300` (replace `COLUMN_WEIGHTS`, `COLUMN_LABELS`, `getColumnWidths`, `renderHeadersHtml`; `getDomColumns` body unchanged but default column set updated)
- Modify: `static/js/split/075_v6_dom_panel.js:530-611` (`renderRow`)

This is a structural refactor: `bid`/`price`/`ask`/`imb`/`stack`/`abs` keep their exact current rendering, `buy`/`sell`/`delta` keep their exact current rendering (heatmap backgrounds added in Task 3), and a new `vol` column is added (`buyVol + sellVol`, formatted like `buy`/`sell`). `ctx.heat` is threaded through now as an empty object (`{}`) so all `alpha` values resolve to `0` and no column shows a heatmap background yet — Task 3 populates real values.

- [ ] **Step 1: Replace `COLUMN_WEIGHTS`/`COLUMN_LABELS`/`getColumnWidths`/`renderHeadersHtml` with `COLUMN_DEFS`**

In `static/js/split/075_v6_dom_panel.js`, replace the block at lines 227-300 (from `var COLUMN_WEIGHTS = {` through the end of `renderHeadersHtml`) with:

```js
  // ── Column registry ──────────────────────────────────────────────────────────
  // Single source of truth for DOM column layout, header label and cell
  // rendering. renderRow builds one shared `ctx` per row and calls
  // cols.map(c => COLUMN_DEFS[c].render(ctx)) — no per-column if/else chain.
  //
  // ctx.heat.{vol,sell,buy,delta} are alpha values in [0, HEAT_ALPHA_MAX]
  // (0 = no background) computed once per render pass by renderVirtual.
  var COLUMN_DEFS = {
    vol: {
      weight: 10,
      label: 'VOL',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.vol + '; flex-shrink:0;';
        var alpha = ctx.heat.vol || 0;
        if (alpha > 0) style += ' background: rgba(var(--v6-accent-rgb), ' + alpha.toFixed(3) + ');';
        var raw = (Number(ctx.lv.buyVol) || 0) + (Number(ctx.lv.sellVol) || 0);
        return '<div class="v6-dom-cell v6-dom-cell-vol" style="' + style + '">' + fmtMode(raw, false, ctx.vctx) + '</div>';
      }
    },
    sell: {
      weight: 9,
      label: 'SELL',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.sell + '; flex-shrink:0;';
        var alpha = ctx.heat.sell || 0;
        if (alpha > 0) style += ' background: rgba(var(--v6-sell-rgb), ' + alpha.toFixed(3) + ');';
        return '<div class="v6-dom-cell v6-dom-cell-sell" style="' + style + '">' + fmtMode(ctx.lv.sellVol, false, ctx.vctx) + '</div>';
      }
    },
    buy: {
      weight: 9,
      label: 'BUY',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.buy + '; flex-shrink:0;';
        var alpha = ctx.heat.buy || 0;
        if (alpha > 0) style += ' background: rgba(var(--v6-buy-rgb), ' + alpha.toFixed(3) + ');';
        return '<div class="v6-dom-cell v6-dom-cell-buy" style="' + style + '">' + fmtMode(ctx.lv.buyVol, false, ctx.vctx) + '</div>';
      }
    },
    bid: {
      weight: 18,
      label: 'BIDS',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.bid + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-bid' + ctx.bidChangeClass + '" style="' + style + '" role="gridcell" tabindex="0" aria-label="' + escAttr('Bid size ' + ctx.bidText + ' at price ' + ctx.priceText) + '">' +
          '<div class="v6-dom-bar is-bid" style="width:' + ctx.bidPct + '%"></div>' +
          '<span class="v6-dom-val">' + (ctx.bidText === '0' ? '' : ctx.bidText) + '</span>' +
        '</div>';
      }
    },
    price: {
      weight: 16,
      label: 'PRICE',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.price + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-price" style="' + style + '" role="gridcell" tabindex="0" aria-label="' + escAttr(ctx.rowLabel) + '">' + ctx.marker + ctx.priceText + ctx.liveBadge + '</div>';
      }
    },
    ask: {
      weight: 18,
      label: 'ASKS',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.ask + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-ask' + ctx.askChangeClass + '" style="' + style + '" role="gridcell" tabindex="0" aria-label="' + escAttr('Ask size ' + ctx.askText + ' at price ' + ctx.priceText) + '">' +
          '<div class="v6-dom-bar is-ask" style="width:' + ctx.askPct + '%"></div>' +
          '<span class="v6-dom-val">' + (ctx.askText === '0' ? '' : ctx.askText) + '</span>' +
        '</div>';
      }
    },
    delta: {
      weight: 10,
      label: 'DELTA',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.delta + '; flex-shrink:0;';
        var alpha = ctx.heat.delta || 0;
        if (alpha > 0) {
          var rgbVar = (Number(ctx.lv.delta) || 0) >= 0 ? '--v6-buy-rgb' : '--v6-sell-rgb';
          style += ' background: rgba(var(' + rgbVar + '), ' + alpha.toFixed(3) + ');';
        }
        return '<div class="v6-dom-cell v6-dom-cell-delta" style="' + style + '">' + fmtModeSigned(ctx.lv.delta, ctx.vctx) + '</div>';
      }
    },
    imb: {
      weight: 8,
      label: 'IMB',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.imb + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-imb ' + ctx.imSide + '" style="' + style + '">' + ctx.imText + '</div>';
      }
    },
    stack: {
      weight: 5,
      label: 'STK',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.stack + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-stack ' + ctx.imSide + '" style="' + style + '">' + ctx.stackText + '</div>';
      }
    },
    abs: {
      weight: 7,
      label: 'ABS',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.abs + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-abs ' + ctx.absSide + '" style="' + style + '">' + ctx.absText + '</div>';
      }
    }
  };

  // Per-column header alignment (text-align/justify-content/padding), kept
  // separate from COLUMN_DEFS since it only applies to the header row.
  var COLUMN_HEADER_STYLE = {
    vol:   ' text-align: right; justify-content: flex-end;',
    sell:  ' text-align: right; justify-content: flex-end;',
    buy:   ' text-align: right; justify-content: flex-end;',
    bid:   ' text-align: right; justify-content: flex-end; padding-right: 5px;',
    price: ' justify-content: center;',
    ask:   ' text-align: left; justify-content: flex-start; padding-left: 5px;',
    delta: ' text-align: right; justify-content: flex-end;',
    imb:   ' text-align: right; justify-content: flex-end;',
    stack: ' text-align: center; justify-content: center;',
    abs:   ' text-align: center; justify-content: center;'
  };

  function getDomColumns(settings) {
    var cols = settings && settings.domColumns;
    if (!Array.isArray(cols) || cols.length === 0) {
      // Default: TradingView-style ladder with volume/heatmap columns.
      // Settings (079) DEFAULT_DOM_COLUMNS is the source of truth for new
      // installs; this is only a defensive fallback for raw/unvalidated
      // settings objects.
      return ['vol', 'sell', 'buy', 'bid', 'price', 'ask', 'delta'];
    }
    if (cols.indexOf('price') === -1) {
      var bidIdx = cols.indexOf('bid');
      var askIdx = cols.indexOf('ask');
      if (bidIdx !== -1 && askIdx !== -1 && askIdx > bidIdx) {
        cols = cols.slice();
        cols.splice(askIdx, 0, 'price');
      } else {
        cols = cols.concat(['price']);
      }
    }
    return cols;
  }

  function getColumnWidths(cols) {
    var sum = 0;
    cols.forEach(function (c) {
      sum += (COLUMN_DEFS[c] && COLUMN_DEFS[c].weight) || 10;
    });
    if (sum === 0) sum = 100;
    var widths = {};
    cols.forEach(function (c) {
      widths[c] = ((((COLUMN_DEFS[c] && COLUMN_DEFS[c].weight) || 10) / sum) * 100).toFixed(2) + '%';
    });
    return widths;
  }

  function renderHeadersHtml(cols, widths) {
    return cols.map(function (c) {
      var style = 'width:' + widths[c] + '; flex-shrink:0;';
      style += COLUMN_HEADER_STYLE[c] || '';
      var label = (COLUMN_DEFS[c] && COLUMN_DEFS[c].label) || c.toUpperCase();
      return '<div class="v6-dom-col v6-dom-col-' + c + ' v6-dom-draghead" style="' + style + '" data-col="' + c + '" draggable="true">' +
        label +
        '<span class="v6-dom-dragicon">&#9776;</span>' +
        '</div>';
    }).join('');
  }
```

- [ ] **Step 2: Rewrite `renderRow` to build a shared `ctx` and use `COLUMN_DEFS`**

In `static/js/split/075_v6_dom_panel.js`, the `renderRow` function (lines 530-611) keeps its signature plus a new trailing `heat` parameter, keeps everything through the `rowLabel` computation (lines 530-567) unchanged, and replaces the `cols.map(...)` block (lines 568-604) and the final return (lines 606-611).

Replace the function signature on line 530:

```js
  function renderRow(lv, y, maxBid, maxAsk, liveTick, midTick, bestBidTick, bestAskTick, live, vctx, sizeThreshold, analytics, cols, widths) {
```

with:

```js
  function renderRow(lv, y, maxBid, maxAsk, liveTick, midTick, bestBidTick, bestAskTick, live, vctx, sizeThreshold, analytics, cols, widths, heat) {
```

Then replace lines 568-611 (the `cols.map(...)` block through the end of the function) with:

```js
    var ctx = {
      lv: lv, widths: widths, vctx: vctx, heat: heat || {},
      bidChangeClass: bidChangeClass, askChangeClass: askChangeClass,
      bidPct: bidPct, askPct: askPct, bidText: bidText, askText: askText,
      priceText: priceText, marker: marker, liveBadge: liveBadge, rowLabel: rowLabel,
      imSide: imSide, imText: imText, stackText: stackText, absSide: absSide, absText: absText
    };

    var cellsHtml = cols.map(function (c) {
      var def = COLUMN_DEFS[c];
      return def ? def.render(ctx) : '';
    }).join('');

    return '<div class="' + cls + '"' +
      ' style="position:absolute;top:' + y + 'px;left:0;right:0;height:' + DOM_ROW_HEIGHT + 'px"' +
      ' data-price-key="' + lv.priceKey + '" role="row" aria-label="' + escAttr(rowLabel) + '">' +
      cellsHtml +
      '</div>';
  }
```

- [ ] **Step 3: Build and verify no visual change for existing columns**

Run: `python build.py`

Via Chrome DevTools MCP at `http://127.0.0.1:5000/orderflow`, take a screenshot of the DOM panel. Since `settings.domColumns` is still whatever was persisted from before this change (validated against the *old* `VALID_DOM_KEYS`/`DEFAULT_DOM_COLUMNS`, which Task 4 hasn't touched yet), the panel should render exactly as before — `BID | PRICE | ASK` (or the user's customized set), with bid/ask depth bars and price-cell live highlight unchanged. No `vol`/`sell`/`buy`/`delta` heatmap backgrounds should appear yet (heat is `{}`).

If the user has `vol` nowhere in their persisted `domColumns` (expected, since `VALID_DOM_KEYS` doesn't have `vol` yet), the new `vol` column won't render — that's expected at this point; Task 4 wires it into settings.

---

### Task 3: Heatmap intensity computation + CSS for `vol`/`sell`/`buy`/`delta` cells

**Files:**
- Modify: `static/js/split/075_v6_dom_panel.js` (add `heatAlpha` helper before `renderVirtual`; extend the `maxBid`/`maxAsk` computation and the row loop inside `renderVirtual`)
- Modify: `static/css/split/082_v6_dom_clean.css`

- [ ] **Step 1: Add `heatAlpha` helper and constants**

In `static/js/split/075_v6_dom_panel.js`, immediately before the `function renderVirtual(body, snap, live, settings, cols, widths) {` declaration (around line 623), add:

```js
  // Heatmap intensity → background alpha. 0 = no background (ratio <= 0);
  // otherwise mapped into [HEAT_ALPHA_MIN, HEAT_ALPHA_MAX] so the cell tint
  // never approaches the solid is-live price-cell fill.
  var HEAT_ALPHA_MIN = 0.05;
  var HEAT_ALPHA_MAX = 0.35;

  function heatAlpha(ratio) {
    if (!(ratio > 0)) return 0;
    var clamped = Math.min(1, ratio);
    return HEAT_ALPHA_MIN + clamped * (HEAT_ALPHA_MAX - HEAT_ALPHA_MIN);
  }

```

- [ ] **Step 2: Extend the per-pass max computation**

In `renderVirtual`, replace the block (around lines 725-730):

```js
    var maxBid = 1, maxAsk = 1;
    book.forEach(function (lv) {
      if (lv.tick < scaleMinTick || lv.tick > scaleMaxTick) return;
      if (lv.bidSize > maxBid) maxBid = lv.bidSize;
      if (lv.askSize > maxAsk) maxAsk = lv.askSize;
    });
```

with:

```js
    var maxBid = 1, maxAsk = 1, maxVol = 1, maxSell = 1, maxBuy = 1, maxAbsDelta = 1;
    book.forEach(function (lv) {
      if (lv.tick < scaleMinTick || lv.tick > scaleMaxTick) return;
      if (lv.bidSize > maxBid) maxBid = lv.bidSize;
      if (lv.askSize > maxAsk) maxAsk = lv.askSize;
      var bv = Number(lv.buyVol) || 0;
      var sv = Number(lv.sellVol) || 0;
      var vol = bv + sv;
      if (vol > maxVol) maxVol = vol;
      if (sv > maxSell) maxSell = sv;
      if (bv > maxBuy) maxBuy = bv;
      var ad = Math.abs(Number(lv.delta) || 0);
      if (ad > maxAbsDelta) maxAbsDelta = ad;
    });
```

(`maxVol`/`maxSell`/`maxBuy`/`maxAbsDelta` start at `1`, matching the existing `maxBid`/`maxAsk` pattern — this is the div-by-zero clamp from the spec.)

- [ ] **Step 3: Compute per-row `heat` and pass it to `renderRow`**

In `renderVirtual`, replace the row-loop body (around lines 758-766):

```js
      var lv       = book.get(pk);
      if (!lv) {
        lv = {
          priceKey: pk, tick: tick, price: tick * tickSize,
          bidSize: 0, askSize: 0, buyVol: 0, sellVol: 0, delta: 0,
          wallScore: 0, bidWallScore: 0, askWallScore: 0
        };
      }
      html += renderRow(lv, y, maxBid, maxAsk, liveTick, midTick, bestBidTick, bestAskTick, live, vctx, sizeThreshold, analyticsByTick[tick], cols, widths);
```

with:

```js
      var lv       = book.get(pk);
      if (!lv) {
        lv = {
          priceKey: pk, tick: tick, price: tick * tickSize,
          bidSize: 0, askSize: 0, buyVol: 0, sellVol: 0, delta: 0,
          wallScore: 0, bidWallScore: 0, askWallScore: 0
        };
      }
      var heat = {
        vol: heatAlpha(((Number(lv.buyVol) || 0) + (Number(lv.sellVol) || 0)) / maxVol),
        sell: heatAlpha((Number(lv.sellVol) || 0) / maxSell),
        buy: heatAlpha((Number(lv.buyVol) || 0) / maxBuy),
        delta: heatAlpha(Math.abs(Number(lv.delta) || 0) / maxAbsDelta)
      };
      html += renderRow(lv, y, maxBid, maxAsk, liveTick, midTick, bestBidTick, bestAskTick, live, vctx, sizeThreshold, analyticsByTick[tick], cols, widths, heat);
```

- [ ] **Step 4: Add CSS for the new column header colors and cell alignment**

In `static/css/split/082_v6_dom_clean.css`, after the `.v6-dom-col-ask` rule (lines 65-69):

```css
body[data-current-page="orderflow"] .v6-dom-col-ask {
  justify-content: flex-start;
  padding-left: 10px;
  color: var(--v6-sell);
}
```

add:

```css

body[data-current-page="orderflow"] .v6-dom-col-vol {
  color: var(--v6-accent);
}

body[data-current-page="orderflow"] .v6-dom-col-sell {
  color: var(--v6-sell);
}

body[data-current-page="orderflow"] .v6-dom-col-buy {
  color: var(--v6-buy);
}
```

Then, after the `.v6-dom-cell-price` rule (lines 124-131):

```css
body[data-current-page="orderflow"] .v6-dom-cell-price {
  justify-content: center;
  border-left: 1px solid var(--v6-edge);
  border-right: 1px solid var(--v6-edge);
  background: var(--v6-surface);
  color: var(--v6-text);
  font-weight: 700;
}
```

add:

```css

body[data-current-page="orderflow"] .v6-dom-cell-vol,
body[data-current-page="orderflow"] .v6-dom-cell-sell,
body[data-current-page="orderflow"] .v6-dom-cell-buy,
body[data-current-page="orderflow"] .v6-dom-cell-delta {
  justify-content: flex-end;
  padding-right: 8px;
  font-weight: 700;
  color: var(--v6-text-dim);
}
```

- [ ] **Step 5: Build and verify heatmap is wired (no visible columns yet without Task 4)**

Run: `python build.py`

At this point `vol`/`sell`/`buy`/`delta` still won't appear unless the user's persisted `domColumns` already includes them (e.g. from a prior "Full"/"Delta" preset). If they do, take a screenshot and confirm: cells with larger size/volume show a visibly stronger tinted background (cyan for `vol`, rose for `sell`, emerald for `buy`, green/red for `delta` by sign), and the tint stays subtle enough that the numeric text remains readable. Task 4/5 make these columns part of the default so this is fully verifiable after those land.

---

### Task 4: Settings — `VALID_DOM_KEYS`, `DEFAULT_DOM_COLUMNS`, legacy migration

**Files:**
- Modify: `static/js/split/079_v6_orderflow_settings.js:23-32`

- [ ] **Step 1: Update the column-set constants**

In `static/js/split/079_v6_orderflow_settings.js`, replace lines 23-32:

```js
  // Clean two-sided ladder default (BID | PRICE | ASK). Older builds shipped
  // wider 6/9-column defaults; LEGACY_DEFAULT_DOM_COLUMN_SETS below lets us
  // recognize a persisted value that is just one of those old baked-in
  // defaults (never customized by the user) and migrate it forward.
  var DEFAULT_DOM_COLUMNS = ['bid', 'price', 'ask'];
  var LEGACY_DEFAULT_DOM_COLUMN_SETS = [
    ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs'],
    ['bid', 'price', 'ask', 'buy', 'sell', 'delta']
  ];
  var VALID_DOM_KEYS = { sell: 1, buy: 1, bid: 1, price: 1, ask: 1, delta: 1, imb: 1, stack: 1, abs: 1 };
```

with:

```js
  // TradingView-style ladder default: VOL | SELL | BUY | BID | PRICE | ASK | DELTA,
  // with heatmap-intensity backgrounds on vol/sell/buy/delta. Older builds
  // shipped narrower defaults (two-sided ladder, 6/9-column "full" set);
  // LEGACY_DEFAULT_DOM_COLUMN_SETS below lets us recognize a persisted value
  // that is just one of those old baked-in defaults (never customized by the
  // user) and migrate it forward.
  var DEFAULT_DOM_COLUMNS = ['vol', 'sell', 'buy', 'bid', 'price', 'ask', 'delta'];
  var LEGACY_DEFAULT_DOM_COLUMN_SETS = [
    ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs'],
    ['bid', 'price', 'ask', 'buy', 'sell', 'delta'],
    ['bid', 'price', 'ask']
  ];
  var VALID_DOM_KEYS = { vol: 1, sell: 1, buy: 1, bid: 1, price: 1, ask: 1, delta: 1, imb: 1, stack: 1, abs: 1 };
```

This makes the new `vol` key pass `validateSettings()`'s filter (lines 173-178), and migrates anyone whose persisted `domColumns` exactly matches the old `['bid','price','ask']` default (the previous `DEFAULT_DOM_COLUMNS`) to the new 7-column default — while leaving any hand-customized column set (that doesn't match a legacy default exactly) untouched, per `isLegacyDefaultDomColumns()` (lines 34-43, unchanged).

- [ ] **Step 2: Build and verify the new default applies on a clean profile**

Run: `python build.py`

Via Chrome DevTools MCP at `http://127.0.0.1:5000/orderflow`:
1. Evaluate `localStorage.removeItem('cockpitV6.orderflow.settings')` then reload the page.
2. Screenshot the DOM panel — it should now show 7 columns in order `VOL | SELL | BUY | BID | PRICE | ASK | DELTA`, with `vol`/`sell`/`buy`/`delta` showing heatmap backgrounds that scale with size across visible rows.
3. Without clearing storage, reload again on a profile whose `domColumns` was the old `['bid','price','ask']` two-sided default — it should also migrate to the new 7-column default (since `['bid','price','ask']` is now in `LEGACY_DEFAULT_DOM_COLUMN_SETS`).

---

### Task 5: Settings UI — `Vol` checkbox, label, and new preset

**Files:**
- Modify: `static/js/split/073_v6_orderflow_layout.js:720` (`allColKeys`)
- Modify: `static/js/split/073_v6_orderflow_layout.js:731-741` (`colLabels`)
- Modify: `static/js/split/073_v6_orderflow_layout.js:471-475` (preset buttons HTML)
- Modify: `static/js/split/073_v6_orderflow_layout.js:772-782` (preset active-state detection)
- Modify: `static/js/split/073_v6_orderflow_layout.js:1378-1395` (preset click handler)

- [ ] **Step 1: Add `vol` to `allColKeys` and `colLabels`**

In `static/js/split/073_v6_orderflow_layout.js`, replace line 720:

```js
      var allColKeys = ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs'];
```

with:

```js
      var allColKeys = ['vol', 'sell', 'buy', 'bid', 'price', 'ask', 'delta', 'imb', 'stack', 'abs'];
```

Replace lines 731-741:

```js
      var colLabels = {
        bid: 'BIDS',
        price: 'PRICE (required)',
        ask: 'ASKS',
        buy: 'BUYS',
        sell: 'SELLS',
        delta: 'DELTA',
        imb: 'IMB',
        stack: 'STK',
        abs: 'ABS'
      };
```

with:

```js
      var colLabels = {
        vol: 'VOL',
        bid: 'BIDS',
        price: 'PRICE (required)',
        ask: 'ASKS',
        buy: 'BUYS',
        sell: 'SELLS',
        delta: 'DELTA',
        imb: 'IMB',
        stack: 'STK',
        abs: 'ABS'
      };
```

- [ ] **Step 2: Add a "Pro" preset button matching the new default**

In `static/js/split/073_v6_orderflow_layout.js`, replace lines 471-475:

```js
                '<div class="v6-dom-column-presets" style="display:flex; gap:6px; margin-bottom:8px;">',
                  '<button type="button" class="v6-btn v6-btn-sm" data-v6-dom-preset="minimal" style="flex:1; padding:2px 0; font-size:9px;">Minimal</button>',
                  '<button type="button" class="v6-btn v6-btn-sm" data-v6-dom-preset="delta" style="flex:1; padding:2px 0; font-size:9px;">Delta</button>',
                  '<button type="button" class="v6-btn v6-btn-sm" data-v6-dom-preset="full" style="flex:1; padding:2px 0; font-size:9px;">Full</button>',
                '</div>',
```

with:

```js
                '<div class="v6-dom-column-presets" style="display:flex; gap:6px; margin-bottom:8px;">',
                  '<button type="button" class="v6-btn v6-btn-sm" data-v6-dom-preset="pro" style="flex:1; padding:2px 0; font-size:9px;">Pro</button>',
                  '<button type="button" class="v6-btn v6-btn-sm" data-v6-dom-preset="minimal" style="flex:1; padding:2px 0; font-size:9px;">Minimal</button>',
                  '<button type="button" class="v6-btn v6-btn-sm" data-v6-dom-preset="delta" style="flex:1; padding:2px 0; font-size:9px;">Delta</button>',
                  '<button type="button" class="v6-btn v6-btn-sm" data-v6-dom-preset="full" style="flex:1; padding:2px 0; font-size:9px;">Full</button>',
                '</div>',
```

- [ ] **Step 3: Add active-state detection for the "Pro" preset**

In `static/js/split/073_v6_orderflow_layout.js`, replace lines 772-782:

```js
    var activeColsList = settings.domColumns || ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs'];
    var isMin = arraysEqual(activeColsList, ['bid', 'price', 'ask']);
    var isDlt = arraysEqual(activeColsList, ['price', 'buy', 'sell', 'delta']);
    var isFl = arraysEqual(activeColsList, ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs']);
    
    var minBtn = root.querySelector('[data-v6-dom-preset="minimal"]');
    if (minBtn) minBtn.classList.toggle('is-active', isMin);
    var dltBtn = root.querySelector('[data-v6-dom-preset="delta"]');
    if (dltBtn) dltBtn.classList.toggle('is-active', isDlt);
    var flBtn = root.querySelector('[data-v6-dom-preset="full"]');
    if (flBtn) flBtn.classList.toggle('is-active', isFl);
```

with:

```js
    var activeColsList = settings.domColumns || ['vol', 'sell', 'buy', 'bid', 'price', 'ask', 'delta'];
    var isPro = arraysEqual(activeColsList, ['vol', 'sell', 'buy', 'bid', 'price', 'ask', 'delta']);
    var isMin = arraysEqual(activeColsList, ['bid', 'price', 'ask']);
    var isDlt = arraysEqual(activeColsList, ['price', 'buy', 'sell', 'delta']);
    var isFl = arraysEqual(activeColsList, ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs']);

    var proBtn = root.querySelector('[data-v6-dom-preset="pro"]');
    if (proBtn) proBtn.classList.toggle('is-active', isPro);
    var minBtn = root.querySelector('[data-v6-dom-preset="minimal"]');
    if (minBtn) minBtn.classList.toggle('is-active', isMin);
    var dltBtn = root.querySelector('[data-v6-dom-preset="delta"]');
    if (dltBtn) dltBtn.classList.toggle('is-active', isDlt);
    var flBtn = root.querySelector('[data-v6-dom-preset="full"]');
    if (flBtn) flBtn.classList.toggle('is-active', isFl);
```

- [ ] **Step 4: Handle the "Pro" preset click**

In `static/js/split/073_v6_orderflow_layout.js`, replace lines 1382-1390:

```js
        var preset = presetBtn.getAttribute('data-v6-dom-preset');
        var newCols = [];
        if (preset === 'minimal') {
          newCols = ['bid', 'price', 'ask'];
        } else if (preset === 'delta') {
          newCols = ['price', 'buy', 'sell', 'delta'];
        } else if (preset === 'full') {
          newCols = ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs'];
        }
```

with:

```js
        var preset = presetBtn.getAttribute('data-v6-dom-preset');
        var newCols = [];
        if (preset === 'pro') {
          newCols = ['vol', 'sell', 'buy', 'bid', 'price', 'ask', 'delta'];
        } else if (preset === 'minimal') {
          newCols = ['bid', 'price', 'ask'];
        } else if (preset === 'delta') {
          newCols = ['price', 'buy', 'sell', 'delta'];
        } else if (preset === 'full') {
          newCols = ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs'];
        }
```

- [ ] **Step 5: Build and verify the settings UI**

Run: `python build.py`

Via Chrome DevTools MCP at `http://127.0.0.1:5000/orderflow`:
1. Open the Settings panel (right dock, gear icon) and scroll to "DOM Columns".
2. Confirm a "Pro" preset button appears first, and (on a fresh/migrated profile from Task 4) it shows as active.
3. Confirm the column list shows a "VOL" row with a checkbox and up/down reorder buttons, positioned per the active `domColumns` order.
4. Click "Minimal", "Delta", "Full" and back to "Pro" — confirm the DOM panel columns and the active preset highlight update correctly each time, and that toggling the VOL checkbox on/off adds/removes the column live.
5. Reload the page — confirm the chosen column set persists.

---

### Task 6: Dock tab "+" re-add affordance

**Files:**
- Modify: `static/js/split/080_v6_layout_shell.js:131-149` (`tabsHtml`)
- Modify: `static/js/split/080_v6_layout_shell.js:377-472` (`applySchema`)
- Modify: `static/js/split/080_v6_layout_shell.js` (new click-delegation handler near the existing `panel-close` handler at lines 938-967)
- Modify: `static/css/split/071_v6_layout_shell.css` (new rules near `.v6-rtabs`/`.v6-rtab` at lines 383-411, and the left-dock equivalents)

The existing `panel-close` handler (lines 938-959) already removes a panel id from `layoutSchema.left`/`right` and `applySchema` already hides the dock column when its panel list becomes empty — both verified correct, no change needed. This task adds a "+" button to each dock's tab bar that lists panels present in `DEFAULT_SCHEMA` but absent from the current schema, and re-adds the chosen one.

- [ ] **Step 1: Compute `missingPanels` in `applySchema` and pass it to `tabsHtml`**

In `static/js/split/080_v6_layout_shell.js`, inside `applySchema` (around line 423, right after `rightPanels` is computed and before `showLeft`/`showRight`), add:

```js
        var inSchema = (schema.left || []).concat(schema.right || []);
        var missingPanels = Object.keys(PANEL_SPECS).filter(function (id) {
          return inSchema.indexOf(id) === -1 && !PANEL_SPECS[id].icon;
        });
```

(`!PANEL_SPECS[id].icon` excludes `indicators`/`settings`, which have no close button and therefore can never be "missing".)

Then update the two `tabsHtml` calls (lines 434 and 438):

```js
        ltabsContainer.innerHTML = showLeft ? tabsHtml('left', leftPanels, activeLeft) : '';
```
```js
        rtabsContainer.innerHTML = showRight ? tabsHtml('right', rightPanels, activeRight) : '';
```

to:

```js
        ltabsContainer.innerHTML = showLeft ? tabsHtml('left', leftPanels, activeLeft, missingPanels) : '';
```
```js
        rtabsContainer.innerHTML = showRight ? tabsHtml('right', rightPanels, activeRight, missingPanels) : '';
```

Note: when `showLeft`/`showRight` is `false` (no panels on that side), the `+` button for that side won't render even if `missingPanels` is non-empty — re-adding the first panel to an empty side isn't reachable via this UI. This matches the current dock-collapse behavior (an empty side's tab bar is removed entirely) and is an acceptable limitation since `DEFAULT_SCHEMA.left` is empty (no panels start on the left), so in practice all re-addable panels live on the right, which is only empty if the user has closed every right-dock panel — an edge case left for a future iteration.

- [ ] **Step 2: Render the "+" button and popover in `tabsHtml`**

In `static/js/split/080_v6_layout_shell.js`, replace `tabsHtml` (lines 131-149):

```js
  function tabsHtml(side, panelIds, activeId) {
    var sc = side === 'left' ? 'l' : 'r';
    var parts = ['<div class="v6-' + sc + 'tabs" data-v6-' + sc + 'tabs role="tablist" aria-label="Orderflow ' + side + ' tabs">'];
    panelIds.forEach(function (id) {
      var spec = PANEL_SPECS[id];
      if (spec && !spec.icon) parts.push(tabHtml(spec, id === activeId, side));
    });
    if (side === 'right') {
      parts.push('<button type="button" class="v6-rtab v6-rtab-icon" data-v6-dock-toggle title="Collapse dock" aria-label="Collapse dock">&#10094;</button>');
    } else {
      parts.push('<button type="button" class="v6-ltab v6-ltab-icon" data-v6-left-dock-toggle title="Collapse left dock" aria-label="Collapse left dock">&#10095;</button>');
    }
    panelIds.forEach(function (id) {
      var spec = PANEL_SPECS[id];
      if (spec && spec.icon) parts.push(tabHtml(spec, id === activeId, side));
    });
    parts.push('</div>');
    return parts.join('');
  }
```

with:

```js
  function tabsHtml(side, panelIds, activeId, missingPanels) {
    var sc = side === 'left' ? 'l' : 'r';
    var parts = ['<div class="v6-' + sc + 'tabs" data-v6-' + sc + 'tabs role="tablist" aria-label="Orderflow ' + side + ' tabs">'];
    panelIds.forEach(function (id) {
      var spec = PANEL_SPECS[id];
      if (spec && !spec.icon) parts.push(tabHtml(spec, id === activeId, side));
    });
    if (missingPanels && missingPanels.length) {
      parts.push('<div class="v6-' + sc + 'tab-add-wrap">');
      parts.push('<button type="button" class="v6-' + sc + 'tab v6-' + sc + 'tab-icon v6-' + sc + 'tab-add" data-v6-panel-add-toggle="' + side + '" title="Add panel" aria-label="Add panel" aria-haspopup="true" aria-expanded="false">+</button>');
      parts.push('<div class="v6-tab-add-popover" data-v6-panel-add-popover="' + side + '" hidden>');
      missingPanels.forEach(function (id) {
        var spec = PANEL_SPECS[id];
        parts.push('<button type="button" class="v6-tab-add-item" data-v6-panel-add="' + id + '" data-v6-panel-add-side="' + side + '">' + spec.label + '</button>');
      });
      parts.push('</div>');
      parts.push('</div>');
    }
    if (side === 'right') {
      parts.push('<button type="button" class="v6-rtab v6-rtab-icon" data-v6-dock-toggle title="Collapse dock" aria-label="Collapse dock">&#10094;</button>');
    } else {
      parts.push('<button type="button" class="v6-ltab v6-ltab-icon" data-v6-left-dock-toggle title="Collapse left dock" aria-label="Collapse left dock">&#10095;</button>');
    }
    panelIds.forEach(function (id) {
      var spec = PANEL_SPECS[id];
      if (spec && spec.icon) parts.push(tabHtml(spec, id === activeId, side));
    });
    parts.push('</div>');
    return parts.join('');
  }
```

- [ ] **Step 3: Add the click-delegation handler for toggling the popover and re-adding a panel**

In `static/js/split/080_v6_layout_shell.js`, the existing `panel-close`/`panel-settings` delegation handler (lines 938-967) is registered via `root.addEventListener('click', function (e) { ... })`. Add a **new, separate** `root.addEventListener('click', ...)` block immediately after that one (after the closing `});` on line 967):

```js

      // "+" panel-add popover: toggle open/closed, and re-add a panel from
      // DEFAULT_SCHEMA that is missing from the current layoutSchema.
      root.addEventListener('click', function (e) {
        var addToggle = e.target.closest('[data-v6-panel-add-toggle]');
        if (addToggle) {
          var side = addToggle.getAttribute('data-v6-panel-add-toggle');
          var popover = root.querySelector('[data-v6-panel-add-popover="' + side + '"]');
          if (popover) {
            var willOpen = popover.hasAttribute('hidden');
            // Close any other open popover first.
            root.querySelectorAll('[data-v6-panel-add-popover]').forEach(function (p) {
              p.setAttribute('hidden', '');
            });
            root.querySelectorAll('[data-v6-panel-add-toggle]').forEach(function (b) {
              b.setAttribute('aria-expanded', 'false');
            });
            if (willOpen) {
              popover.removeAttribute('hidden');
              addToggle.setAttribute('aria-expanded', 'true');
            }
          }
          return;
        }

        var addItem = e.target.closest('[data-v6-panel-add]');
        if (addItem) {
          var panelId = addItem.getAttribute('data-v6-panel-add');
          var addSide = addItem.getAttribute('data-v6-panel-add-side');
          if (panelId && addSide && store) {
            var curSchema = (store.getState().settings || {}).layoutSchema || DEFAULT_SCHEMA;
            var nextSchema = Object.assign({}, curSchema, {
              left: (curSchema.left || []).slice(),
              right: (curSchema.right || []).slice()
            });
            var target = addSide === 'left' ? nextSchema.left : nextSchema.right;
            if (target.indexOf(panelId) === -1) target.push(panelId);
            if (addSide === 'left') nextSchema.activeLeftTab = panelId;
            else nextSchema.activeRightTab = panelId;
            store.updateSettings({ layoutSchema: nextSchema });
          }
          return;
        }

        // Click outside any popover/toggle: close all open popovers.
        if (!e.target.closest('[data-v6-panel-add-popover]')) {
          root.querySelectorAll('[data-v6-panel-add-popover]').forEach(function (p) {
            p.setAttribute('hidden', '');
          });
          root.querySelectorAll('[data-v6-panel-add-toggle]').forEach(function (b) {
            b.setAttribute('aria-expanded', 'false');
          });
        }
      });
```

- [ ] **Step 4: Add CSS for the "+" button and popover**

In `static/css/split/071_v6_layout_shell.css`, after the `.v6-rbody` rule (line 412):

```css
.v6-rbody { flex: 1 1 auto; min-height: 0; position: relative; display: flex; }
```

add:

```css

.v6-rtab-add-wrap,
.v6-ltab-add-wrap {
  position: relative;
  flex: 0 0 auto;
}
.v6-rtab-add,
.v6-ltab-add {
  flex: 0 0 28px;
  font-size: 16px;
  font-weight: 800;
  color: var(--v6-text-mute);
}
.v6-rtab-add:hover,
.v6-ltab-add:hover,
.v6-rtab-add.is-active,
.v6-ltab-add.is-active {
  color: var(--v6-accent);
  background: var(--v6-accent-soft);
}
.v6-tab-add-popover {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 120px;
  padding: 4px;
  background: var(--v6-surface-2);
  border: 1px solid var(--v6-hairline-strong);
  border-radius: var(--v6-r-sm);
  box-shadow: var(--v6-shadow);
}
.v6-ltab-add-wrap .v6-tab-add-popover {
  right: auto;
  left: 0;
}
.v6-tab-add-item {
  appearance: none;
  border: none;
  border-radius: var(--v6-r-xs);
  background: transparent;
  color: var(--v6-text-dim);
  font: 700 10px/1 var(--v6-font);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-align: left;
  padding: 6px 8px;
  cursor: pointer;
  transition: color var(--v6-fast) var(--v6-ease), background var(--v6-fast) var(--v6-ease);
}
.v6-tab-add-item:hover {
  color: var(--v6-text);
  background: rgba(255, 255, 255, 0.04);
}
```

- [ ] **Step 5: Build and verify close + re-add**

Run: `python build.py`

Via Chrome DevTools MCP at `http://127.0.0.1:5000/orderflow`:
1. Take a baseline screenshot of the right dock tab bar (DOM, Tape, Book, Info tabs + collapse icon + indicators/settings icons).
2. Close the "DOM" tab via its panel header close (✕) button. Confirm the DOM tab disappears from the tab bar and a "+" button now appears.
3. Click the "+" button — confirm a popover appears listing "DOM" (and any other closed panels).
4. Click "DOM" in the popover — confirm the DOM tab reappears in the tab bar, becomes the active tab, and the DOM panel content is shown again.
5. Repeat for "Tape", "Book" ("orderbook"), and "Info" to confirm the behavior generalizes to all non-icon right-dock panels.
6. Click outside an open popover — confirm it closes.
7. Close every right-dock panel one by one — confirm the right dock column hides entirely and the chart area grows (existing `applySchema` behavior, lines 429-431), and that re-adding via "+" is no longer reachable in this state (documented limitation from Step 1) — if the dock is fully hidden, leave at least one panel open during this test.

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Rebuild**

Run: `python build.py`

Expected: build completes without errors, `static/app.js` and `static/style.css` (plus `.map` files) are regenerated.

- [ ] **Step 2: Run the Python test suite**

Run: `.venv/Scripts/python.exe -m pytest tests/ -q`

Expected: all tests pass (matching or exceeding the pre-change baseline of 283 passed, 28 subtests passed). This task does not touch `services/`, `workers/`, or any Python code, so a regression here would indicate an unexpected interaction (e.g. a template-rendering test that snapshots `orderflow.html`) — investigate and fix if so.

- [ ] **Step 3: Final visual pass against the reference image**

Via Chrome DevTools MCP at `http://127.0.0.1:5000/orderflow` (fresh `localStorage.removeItem('cockpitV6.orderflow.settings')` + reload for a clean default):

1. Screenshot the full orderflow page. Confirm the DOM panel shows `VOL | SELL | BUY | BID | PRICE | ASK | DELTA` matching the reference image's column order and labels.
2. Confirm heatmap intensity visibly scales with size/volume across visible rows for `VOL`/`SELL`/`BUY`/`DELTA`, and that `DELTA` heatmap color flips between green (positive) and red (negative).
3. Confirm `BID`/`ASK` still show their depth bars (unchanged from before this plan).
4. Confirm the dock tab close → "+" re-add flow (Task 6) still works after a full rebuild.
5. Confirm Settings → DOM Columns shows the "Pro" preset active by default, with "VOL" in the column list.

- [ ] **Step 4: No commits**

Per the standing rule for this task, do not run `git add`/`git commit`/`git push` at any point. Leave the working tree as-is for the user to review.

---

## Out of scope (unchanged from spec)

- Chart axes/interactions/overall "carte blanche" redesign (separate future spec).
- Volume-profile heatmap overlay on the chart canvas.
- Workspace/layer inspector panel.
- Per-cell independent symbol/interval in the chart grid (`094_v6_layout_grid.js`).
- `services/`, `workers/`, or Go engine code.
