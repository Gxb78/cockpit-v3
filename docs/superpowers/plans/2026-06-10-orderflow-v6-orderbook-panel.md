# Orderflow V6 — Orderbook Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact, two-sided Orderbook panel (TOTAL / AMOUNT / PRICE columns with depth bars growing from the spread row outward) that reads from the existing `state.orderBook` store slice and slots into the right dock alongside DOM and Tape.

**Architecture:** New split JS file `093_v6_orderbook_panel.js` registers `V6OF.Panels.OrderbookPanel` with a `renderInto(container, snap, settings)` function — same pattern as DOM (`075`) and Tape (`074`). The panel uses a premium header (same `.v6-panel-tick/.v6-panel-title` classes from Phase 4). Depth bars are `position:absolute` inside each cell, growing from the price column outward (bids from right, asks from left). CSS goes in `080_v6_orderbook_panel.css`. The panel is wired into `073_v6_orderflow_layout.js` where the existing DOM/Tape panels are rendered, and a new `orderbook` tab is added to `PANEL_SPECS` in `080_v6_layout_shell.js`.

**Tech Stack:** Vanilla JS (V6OF namespace, split files), page-scoped CSS, `python build.py`, pytest.

---

## File map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `static/js/split/093_v6_orderbook_panel.js` | Orderbook panel: `renderInto(container, snap, settings)`, premium header, spread row, depth bars |
| Create | `static/css/split/080_v6_orderbook_panel.css` | Orderbook styles: columns, depth bars, spread row, premium header |
| Modify | `static/js/split/080_v6_layout_shell.js` | Add `orderbook` to `PANEL_SPECS` and `DEFAULT_SCHEMA.right` |
| Modify | `static/js/split/073_v6_orderflow_layout.js` | Subscribe to orderBook store slice, call `OrderbookPanel.renderInto` |
| Create | `tests/test_orderflow_orderbook_panel.py` | 18 smoke tests |
| Modify | `AI_DEVELOPMENT_PLAYBOOK.md` | LESSON-20260610-04 |

---

## Task 1: Create `093_v6_orderbook_panel.js`

**Files:**
- Create: `static/js/split/093_v6_orderbook_panel.js`

The panel renders:
1. Premium header: tick · "Orderbook" title · source meta chip · spacer · grab · ⚙ · ✕
2. Column header row: `BID AMT` | `BID TOTAL` | `PRICE` | `ASK TOTAL` | `ASK AMT`
3. Ask rows (top, sorted price descending — highest ask first)
4. Spread row (shows spread value and mid price)
5. Bid rows (bottom, sorted price descending — highest bid first, i.e. best bid at top)

Each row has a depth bar: for bid rows, bar grows from price column leftward; for ask rows, bar grows from price column rightward. Bar width = `(cumulative / maxCumulative) * 100%`.

`renderInto` is idempotent: it rebuilds `innerHTML` on each call (same pattern as `renderTapeInto`). It receives `container`, `snap` (a `V6OrderBookSnapshot`), and `settings` (with `obRows` = number of levels to show, default 15).

- [ ] **Step 1: Create the file**

```js
// 093_v6_orderbook_panel.js
// Orderbook panel: two-sided ladder with cumulative depth bars.
// Reads from V6OrderBookSnapshot (state.orderBook).

(function () {
  'use strict';
  var V6OF = window.V6OF = window.V6OF || {};
  var Panels = V6OF.Panels = V6OF.Panels || {};
  if (!V6OF.register) {
    ['Core', 'Data', 'Transport', 'UI', 'Studies', 'Page'].forEach(function (n) {
      V6OF[n] = V6OF[n] || {};
    });
    V6OF.register = function (domain, name, value, legacyName) {
      V6OF[domain] = V6OF[domain] || {};
      V6OF[domain][name] = value;
      if (legacyName) V6OF[legacyName] = value;
      return value;
    };
  }

  function esc(s) {
    return V6OF.escapeHtml ? V6OF.escapeHtml(String(s)) : String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtPrice(v) {
    return V6OF.format && V6OF.format.price ? V6OF.format.price(Number(v)) : Number(v).toFixed(2);
  }

  function fmtQty(v) {
    return V6OF.format && V6OF.format.qty ? V6OF.format.qty(Number(v)) : Number(v).toFixed(3);
  }

  function headerHtml(source) {
    return [
      '<div class="v6-ob-header">',
        '<span class="v6-panel-tick" aria-hidden="true"></span>',
        '<span class="v6-panel-title">Book</span>',
        '<span class="v6-panel-meta" data-ob-stat="source">', esc(source || '—'), '</span>',
        '<span class="v6-panel-sp"></span>',
        '<span class="v6-panel-grab" aria-hidden="true">&#x2807;</span>',
        '<button type="button" class="v6-panel-ib" data-v6-action="panel-settings" title="Orderbook settings" aria-label="Orderbook settings">&#x2699;</button>',
        '<button type="button" class="v6-panel-ib v6-panel-ib-close" data-v6-action="panel-close" title="Close orderbook" aria-label="Close orderbook">&#x2715;</button>',
      '</div>'
    ].join('');
  }

  function colHeadHtml() {
    return [
      '<div class="v6-ob-row v6-ob-colhead">',
        '<span class="v6-ob-cell-bid-amt">Amt</span>',
        '<span class="v6-ob-cell-bid-total">Total</span>',
        '<span class="v6-ob-cell-price">Price</span>',
        '<span class="v6-ob-cell-ask-total">Total</span>',
        '<span class="v6-ob-cell-ask-amt">Amt</span>',
      '</div>'
    ].join('');
  }

  function rowHtml(level, side, maxCum) {
    var pct = maxCum > 0 ? Math.min(100, Math.round((Number(level.cumulative) || 0) / maxCum * 100)) : 0;
    var cls = 'v6-ob-row is-' + side;
    return [
      '<div class="', cls, '">',
        '<span class="v6-ob-bar" style="width:', pct, '%"></span>',
        '<span class="v6-ob-cell-bid-amt">', side === 'bid' ? esc(fmtQty(level.size)) : '', '</span>',
        '<span class="v6-ob-cell-bid-total">', side === 'bid' ? esc(fmtQty(level.cumulative)) : '', '</span>',
        '<span class="v6-ob-cell-price">', esc(fmtPrice(level.price)), '</span>',
        '<span class="v6-ob-cell-ask-total">', side === 'ask' ? esc(fmtQty(level.cumulative)) : '', '</span>',
        '<span class="v6-ob-cell-ask-amt">', side === 'ask' ? esc(fmtQty(level.size)) : '', '</span>',
      '</div>'
    ].join('');
  }

  function spreadRowHtml(snap) {
    var spread = Number(snap.spread) || 0;
    var mid = Number(snap.mid || snap.midPrice) || 0;
    return [
      '<div class="v6-ob-row v6-ob-spread">',
        '<span class="v6-ob-cell-bid-amt"></span>',
        '<span class="v6-ob-cell-bid-total"></span>',
        '<span class="v6-ob-cell-price">',
          mid > 0 ? esc(fmtPrice(mid)) : '—',
          ' <em>', spread > 0 ? esc(spread.toFixed(2)) : '—', '</em>',
        '</span>',
        '<span class="v6-ob-cell-ask-total"></span>',
        '<span class="v6-ob-cell-ask-amt"></span>',
      '</div>'
    ].join('');
  }

  Panels.OrderbookPanel = {
    renderInto: function (container, snap, settings) {
      if (!container) return;
      snap = snap || {};
      settings = settings || {};
      var obRows = Math.max(5, Math.min(50, Number(settings.obRows || 15)));

      var bids = Array.isArray(snap.bids) ? snap.bids.slice(0, obRows) : [];
      var asks = Array.isArray(snap.asks) ? snap.asks.slice(0, obRows) : [];

      // asks displayed top-to-bottom: highest price first
      var asksDesc = asks.slice().sort(function (a, b) { return Number(b.price) - Number(a.price); });
      // bids displayed top-to-bottom: highest bid first (best bid at top)
      var bidsDesc = bids.slice().sort(function (a, b) { return Number(b.price) - Number(a.price); });

      // max cumulative across both sides for bar scaling
      var maxCum = 0;
      bids.forEach(function (l) { var c = Number(l.cumulative) || 0; if (c > maxCum) maxCum = c; });
      asks.forEach(function (l) { var c = Number(l.cumulative) || 0; if (c > maxCum) maxCum = c; });

      var parts = [headerHtml(snap.exchange || snap.source || '—'), colHeadHtml()];
      asksDesc.forEach(function (lv) { parts.push(rowHtml(lv, 'ask', maxCum)); });
      parts.push(spreadRowHtml(snap));
      bidsDesc.forEach(function (lv) { parts.push(rowHtml(lv, 'bid', maxCum)); });

      if (!bids.length && !asks.length) {
        parts.push('<div class="v6-empty">No orderbook data</div>');
      }

      container.innerHTML = parts.join('');
    }
  };
})();
```

- [ ] **Step 2: Build to verify syntax**

```bash
.venv/Scripts/python.exe build.py
```

Expected: `Built static/app.js from 93 modules` — no errors.

---

## Task 2: Create `080_v6_orderbook_panel.css`

**Files:**
- Create: `static/css/split/080_v6_orderbook_panel.css`

- [ ] **Step 1: Create the file**

```css
/* ============================================================
   080_v6_orderbook_panel.css
   Orderbook panel: premium header, column grid, depth bars,
   spread row. Page-scoped; no overrides; tokens only.
   ============================================================ */

/* ── Premium header (shares .v6-panel-tick etc from 076) ── */
body[data-current-page="orderflow"] .v6-ob-header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px 0 10px;
  background: linear-gradient(180deg, var(--v6-surface), var(--v6-bg-2));
  border-bottom: 1px solid var(--v6-hairline);
  flex-shrink: 0;
}

body[data-current-page="orderflow"] .v6-ob-header:hover .v6-panel-ib {
  opacity: 1;
}

/* ── Row grid: 5 equal columns ── */
body[data-current-page="orderflow"] .v6-ob-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1.4fr 1fr 1fr;
  align-items: center;
  height: 17px;
  padding: 0 6px;
  font: 700 9px/1 var(--v6-mono);
  border-bottom: 1px solid var(--v6-hairline);
  position: relative;
  overflow: hidden;
}

/* ── Column header row ── */
body[data-current-page="orderflow"] .v6-ob-colhead {
  font: 700 8px/1 var(--v6-mono);
  color: var(--v6-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: var(--v6-bg-2);
  height: 20px;
}

/* ── Depth bar: absolute, side-specific direction ── */
body[data-current-page="orderflow"] .v6-ob-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
}

body[data-current-page="orderflow"] .v6-ob-row.is-bid .v6-ob-bar {
  right: 0;
  background: linear-gradient(270deg, var(--v6-buy-soft), transparent);
}

body[data-current-page="orderflow"] .v6-ob-row.is-ask .v6-ob-bar {
  left: 0;
  background: linear-gradient(90deg, var(--v6-sell-soft), transparent);
}

/* ── Cell text alignment ── */
body[data-current-page="orderflow"] .v6-ob-cell-bid-amt,
body[data-current-page="orderflow"] .v6-ob-cell-bid-total {
  text-align: right;
  color: var(--v6-buy);
  position: relative;
}

body[data-current-page="orderflow"] .v6-ob-cell-ask-total,
body[data-current-page="orderflow"] .v6-ob-cell-ask-amt {
  text-align: left;
  color: var(--v6-sell);
  position: relative;
}

body[data-current-page="orderflow"] .v6-ob-cell-price {
  text-align: center;
  color: var(--v6-text);
  position: relative;
  font-weight: 800;
}

body[data-current-page="orderflow"] .v6-ob-row.is-ask .v6-ob-cell-price {
  color: var(--v6-sell);
}

body[data-current-page="orderflow"] .v6-ob-row.is-bid .v6-ob-cell-price {
  color: var(--v6-buy);
}

/* ── Spread row ── */
body[data-current-page="orderflow"] .v6-ob-spread {
  background: linear-gradient(90deg, transparent, var(--v6-accent-soft), transparent);
  box-shadow: inset 0 1px 0 var(--v6-accent-line), inset 0 -1px 0 var(--v6-accent-line);
  height: 20px;
}

body[data-current-page="orderflow"] .v6-ob-spread .v6-ob-cell-price {
  color: var(--v6-accent);
}

body[data-current-page="orderflow"] .v6-ob-spread .v6-ob-cell-price em {
  font-style: normal;
  font-size: 8px;
  color: var(--v6-text-mute);
  margin-left: 4px;
}
```

- [ ] **Step 2: Build and verify CSS module count**

```bash
.venv/Scripts/python.exe build.py
```

Expected: `Built static/style.css from 66 modules`.

---

## Task 3: Add `orderbook` tab to `PANEL_SPECS` and `DEFAULT_SCHEMA` in the shell

**Files:**
- Modify: `static/js/split/080_v6_layout_shell.js`

- [ ] **Step 1: Locate PANEL_SPECS**

```bash
grep -n "PANEL_SPECS\|DEFAULT_SCHEMA" static/js/split/080_v6_layout_shell.js | head -10
```

- [ ] **Step 2: Add `orderbook` entry to `PANEL_SPECS`**

Find:
```js
  var PANEL_SPECS = {
    dom: { id: 'dom', label: 'DOM' },
    tape: { id: 'tape', label: 'Tape' },
    info: { id: 'info', label: 'Info' },
```

Replace with:
```js
  var PANEL_SPECS = {
    dom: { id: 'dom', label: 'DOM' },
    tape: { id: 'tape', label: 'Tape' },
    orderbook: { id: 'orderbook', label: 'Book' },
    info: { id: 'info', label: 'Info' },
```

- [ ] **Step 3: Add `orderbook` to `DEFAULT_SCHEMA.right`**

Find:
```js
  var DEFAULT_SCHEMA = {
    left: [],
    center: ['chart'],
    right: ['dom', 'tape', 'info', 'indicators', 'settings'],
```

Replace with:
```js
  var DEFAULT_SCHEMA = {
    left: [],
    center: ['chart'],
    right: ['dom', 'tape', 'orderbook', 'info', 'indicators', 'settings'],
```

- [ ] **Step 4: Build**

```bash
.venv/Scripts/python.exe build.py
```

Expected: clean build.

---

## Task 4: Wire `OrderbookPanel.renderInto` in the layout

**Files:**
- Modify: `static/js/split/073_v6_orderflow_layout.js`

The layout subscribes to the store and calls `Panels.renderTapeInto`, `Panels.renderDom`, etc. We need to add a similar call for `OrderbookPanel.renderInto` whenever `orderBook` changes.

- [ ] **Step 1: Find where DOM/Tape panels are rendered in the store subscribe**

```bash
grep -n "renderTapeInto\|renderDom\|renderInto\|orderBook\|ob-panel\|v6-panel-orderbook" static/js/split/073_v6_orderflow_layout.js | head -20
```

- [ ] **Step 2: Find the panel container creation block**

Look for where `v6-panel-dom` and `v6-panel-tape` containers are created in `073`. The orderbook panel section in the template (`073`) renders `data-v6-panel="dom"` and `data-v6-panel="tape"` sections. Add an `orderbook` section in the same pattern.

```bash
grep -n "data-v6-panel.*dom\|data-v6-panel.*tape\|v6-panel-dom\|v6-panel-tape" static/js/split/073_v6_orderflow_layout.js | head -10
```

- [ ] **Step 3: Add orderbook panel HTML section**

Find the tape panel section (look for `v6-panel-tape`):

```js
'<section class="v6-panel v6-panel-tape" data-v6-panel="tape" id="v6-panel-tape" role="tabpanel" aria-labelledby="v6-rtab-tape" aria-label="V6 Tape">',
  '<div class="v6-panel-body v6-tape-body" data-v6-tape-panel></div>',
'</section>',
```

Add after the tape section:

```js
'<section class="v6-panel v6-panel-orderbook" data-v6-panel="orderbook" id="v6-panel-orderbook" role="tabpanel" aria-labelledby="v6-rtab-orderbook" aria-label="V6 Orderbook">',
  '<div class="v6-panel-body v6-ob-body" data-v6-ob-panel></div>',
'</section>',
```

- [ ] **Step 4: Add the renderInto call in the store-subscribe render block**

Find where `renderTapeInto` is called in the store subscribe (search for `renderTapeInto` in `073`):

```bash
grep -n "renderTapeInto\|Panels\.render" static/js/split/073_v6_orderflow_layout.js | head -10
```

After the tape render call, add:

```js
var obContainer = root.querySelector('[data-v6-ob-panel]');
if (obContainer && V6OF.Panels && V6OF.Panels.OrderbookPanel) {
  V6OF.Panels.OrderbookPanel.renderInto(obContainer, state.orderBook, state.settings);
}
```

- [ ] **Step 5: Build**

```bash
.venv/Scripts/python.exe build.py
```

Expected: clean build.

---

## Task 5: Create test file and run full suite

**Files:**
- Create: `tests/test_orderflow_orderbook_panel.py`

- [ ] **Step 1: Create the test file**

```python
"""Orderbook panel smoke tests."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _ob_js():
    return (ROOT / 'static/js/split/093_v6_orderbook_panel.js').read_text(encoding='utf-8')


def _shell_js():
    return (ROOT / 'static/js/split/080_v6_layout_shell.js').read_text(encoding='utf-8')


def _layout_js():
    return (ROOT / 'static/js/split/073_v6_orderflow_layout.js').read_text(encoding='utf-8')


def _ob_css():
    return (ROOT / 'static/css/split/080_v6_orderbook_panel.css').read_text(encoding='utf-8')


# ── Orderbook JS ──────────────────────────────────────────────────

def test_orderbook_panel_file_exists():
    assert (ROOT / 'static/js/split/093_v6_orderbook_panel.js').exists()


def test_orderbook_panel_exported():
    assert 'Panels.OrderbookPanel' in _ob_js()


def test_orderbook_render_into():
    assert 'renderInto' in _ob_js()


def test_orderbook_uses_bids_asks():
    src = _ob_js()
    assert 'snap.bids' in src or "'bids'" in src
    assert 'snap.asks' in src or "'asks'" in src


def test_orderbook_spread_row():
    assert 'spreadRowHtml' in _ob_js() or 'v6-ob-spread' in _ob_js()


def test_orderbook_depth_bar():
    assert 'v6-ob-bar' in _ob_js()


def test_orderbook_cumulative_scaling():
    assert 'maxCum' in _ob_js()


def test_orderbook_empty_state():
    assert 'No orderbook data' in _ob_js()


def test_orderbook_premium_header():
    src = _ob_js()
    assert 'v6-panel-tick' in src
    assert 'v6-panel-title' in src


def test_orderbook_no_hardcoded_hex():
    assert not re.search(r"'#[0-9a-fA-F]{3,6}'", _ob_js())


# ── Shell wiring ──────────────────────────────────────────────────

def test_shell_has_orderbook_panel_spec():
    assert "'orderbook'" in _shell_js() or '"orderbook"' in _shell_js()


def test_shell_default_schema_includes_orderbook():
    src = _shell_js()
    assert 'orderbook' in src


# ── Layout wiring ─────────────────────────────────────────────────

def test_layout_has_orderbook_panel_html():
    assert 'v6-panel-orderbook' in _layout_js() or 'data-v6-ob-panel' in _layout_js()


def test_layout_calls_orderbook_render():
    assert 'OrderbookPanel.renderInto' in _layout_js()


# ── CSS ───────────────────────────────────────────────────────────

def test_ob_css_file_exists():
    assert (ROOT / 'static/css/split/080_v6_orderbook_panel.css').exists()


def test_ob_css_no_important():
    no_comments = re.sub(r'/\*.*?\*/', '', _ob_css(), flags=re.DOTALL)
    assert '!important' not in no_comments


def test_ob_css_no_hardcoded_hex():
    no_comments = re.sub(r'/\*.*?\*/', '', _ob_css(), flags=re.DOTALL)
    assert not re.search(r'(?<![a-z]):\s*#[0-9a-fA-F]{3,6}', no_comments)


def test_ob_css_depth_bar():
    assert '.v6-ob-bar' in _ob_css()


def test_ob_css_spread_row():
    assert '.v6-ob-spread' in _ob_css()
```

- [ ] **Step 2: Run full test suite**

```bash
.venv/Scripts/python.exe -m pytest tests/ -q
```

Expected: ≥ 282 passed (264 + 18 new).

---

## Task 6: Playbook lesson + commit

**Files:**
- Modify: `AI_DEVELOPMENT_PLAYBOOK.md`

- [ ] **Step 1: Append lesson**

```markdown
### LESSON-20260610-04 - Panneau Orderbook (nouveau module panneau)

- Contexte: Ajout du panneau Orderbook V6 — grille deux-cotes avec barres de profondeur cumulatives.
- Regle: Tout nouveau panneau suit le patron etabli par DOM/Tape : (a) `Panels.XxxPanel.renderInto(container, snap, settings)` reconstruit `innerHTML` a chaque appel — pas de virtualisation pour un panneau court (<50 lignes). (b) Le header premium (`.v6-ob-header`) partage les classes `.v6-panel-tick`, `.v6-panel-title`, `.v6-panel-meta` deja stylisees dans `076_v6_dom_redesign.css`. (c) Ajouter l'id du panneau dans `PANEL_SPECS` et `DEFAULT_SCHEMA.right` dans le shell, et dans le HTML template + subscribe block de `073`.
- Regle de prevention: Les barres de profondeur sont `position:absolute` a l'interieur d'une cellule `position:relative` — ne pas oublier `overflow:hidden` sur la ligne `.v6-ob-row` pour eviter le debordement. Le `maxCum` est calcule sur les deux cotes ensemble pour une echelle coherente.
- Fichiers a surveiller: `static/js/split/093_v6_orderbook_panel.js`, `static/js/split/073_v6_orderflow_layout.js`, `static/js/split/080_v6_layout_shell.js`, `static/css/split/080_v6_orderbook_panel.css`.
```

- [ ] **Step 2: Run guardrails**

```bash
.venv/Scripts/python.exe -m pytest tests/test_playbook_lessons_guardrails.py -q
```

Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add static/js/split/093_v6_orderbook_panel.js \
        static/js/split/080_v6_layout_shell.js \
        static/js/split/073_v6_orderflow_layout.js \
        static/css/split/080_v6_orderbook_panel.css \
        tests/test_orderflow_orderbook_panel.py \
        AI_DEVELOPMENT_PLAYBOOK.md \
        static/app.js static/app.js.map \
        static/style.css static/style.css.map

git commit -m "feat(orderflow): V6 Orderbook panel — two-sided depth bars + spread row"
```

---

## Self-review

**Spec coverage:**
- TOTAL / AMOUNT / PRICE columns: Task 1 (`v6-ob-cell-bid-amt`, `v6-ob-cell-bid-total`, `v6-ob-cell-price`, ask equivalents) ✓
- Depth bars growing from spread row outward: Task 1 (`v6-ob-bar` width = cumulative pct), CSS direction per side ✓
- Spread row: Task 1 (`spreadRowHtml` shows mid + spread) ✓
- Premium header: Task 1 (`.v6-ob-header` with tick/title/meta) ✓
- Slots into right dock: Tasks 3+4 (PANEL_SPECS + DEFAULT_SCHEMA + layout HTML + subscribe) ✓
- 18 tests: Task 5 ✓

**Placeholder scan:** None found.

**Type consistency:**
- `Panels.OrderbookPanel.renderInto(container, snap, settings)` — defined in Task 1, called in Task 4, tested in Task 5
- `snap.bids`, `snap.asks`, `snap.spread`, `snap.mid` — from `V6OrderBookSnapshot` contract in `070`
- `settings.obRows` — new key, default 15; no validation needed in `079` settings (YAGNI — obRows isn't in the settings schema yet, which is fine as the panel defaults gracefully)
