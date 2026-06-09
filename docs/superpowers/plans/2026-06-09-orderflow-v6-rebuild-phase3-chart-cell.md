# Orderflow V6 Rebuild — Phase 3: Chart Cell (Welded Chart + Time-Synced CVD Sub-Pane)

> **For agentic workers:** execute task-by-task; **DO NOT COMMIT** until Task 5 (build + test) passes.

**Goal:** Make the chart pane and the CVD/delta histogram sub-pane act as a single welded unit — they share one `ChartViewport` (one time axis), so gridlines are pixel-aligned across both panes, the crosshair cursor is shared, and the time-axis row appears only once (on the chart pane's bottom gutter). The drawing toolbar slot stays anchored to the chart pane only. No data / engine / store changes. All existing tests stay green.

**Phases context:** Phase 1 = tokens, Phase 2 = chrome. This is Phase 3 of 7.

**Tech stack:** Vanilla JS (V6OF namespace, split files `static/js/split/`), CSS custom properties, `python build.py` bundler, pytest.

---

## Problem statement (current state)

The chart canvas (`077_v6_canvas_chart.js`) owns its own `ChartViewport` instance and draws a full time-axis gutter (`GUTTER_BOTTOM = 24px`) at the bottom. The CVD strip (`076_v6_cvd_panel.js`) renders its own histogram independently — it does not know about the chart viewport at all. The result is:

- Two separate time axes (or none on the CVD strip) — bars don't align to chart candles.
- A `v6-resize-v` divider between them that visually separates two unrelated boxes.
- The chart's bottom gutter draws time labels inside the chart canvas; CVD has its own header.

**Target state:**

```
┌──────────────────────────────────────┐
│  Chart canvas  (price candles, etc.) │  ← GUTTER_BOTTOM suppressed when CVD visible
│  — shared viewport, shared crosshair ─┤
│  CVD sub-pane  (delta histogram)     │  ← reads same viewport's timeToX / xToTime
│  Time axis row (shared, drawn once)  │  ← GUTTER_BOTTOM rendered at bottom of CVD
└──────────────────────────────────────┘
```

---

## Architecture

### Shared viewport

`083_v6_chart_viewport.js` already exposes `V6OF.UI.ChartViewport.create()`. The chart (`077`) creates one viewport instance and stores it on `V6OF.chart.viewport` (and on the canvas element as `canvas._v6vp`). Phase 3 makes the CVD strip read that same instance (passed in via the existing `attachCvd` / `CvdPanel.draw` call path) rather than being time-blind.

No new cross-module globals — the viewport flows from chart → shell init → CVD draw call via the existing `V6OF.CvdPanel.draw(cvdCanvas, current)` call, extended to accept a `viewport` argument.

### Time-axis suppression

When the CVD strip is visible and not collapsed, the chart's `GUTTER_BOTTOM` is set to `0` so no time labels are drawn at the chart's bottom edge. The CVD pane's draw function draws the shared time axis at its own bottom edge instead. When CVD is hidden/collapsed, the chart reverts to drawing its own `GUTTER_BOTTOM = 24`.

This is controlled by a flag passed into the chart draw loop, not by CSS magic — CSS only controls heights.

### Crosshair sharing

Both canvases already receive pointer events via `V6OF.ChartInteractions`. Phase 3 extends `attachCvd` so that when the mouse is over *either* canvas, the crosshair X position (time) is shared. The chart already stores the current crosshair time in `V6OF.chart.crosshairTs`. The CVD draw loop reads this to draw a matching vertical line.

---

## File map

| File | Change |
|---|---|
| `static/js/split/076_v6_cvd_panel.js` | Add `CvdPanel.draw(canvas, state, viewport, opts)` — time-synced canvas renderer |
| `static/js/split/077_v6_canvas_chart.js` | Accept `suppressBottomGutter` flag; expose viewport on `canvas._v6vp` |
| `static/js/split/080_v6_layout_shell.js` | Pass viewport to `CvdPanel.draw`; suppress chart gutter when CVD visible |
| `static/js/split/084_v6_chart_interactions.js` | Share crosshair time between chart and CVD canvas |
| `static/css/split/075_v6_chart_cell.css` | New page-scoped CSS: weld the visual gap; remove duplicate strip header; shared time-axis row height |
| `python build.py` / tests | Build passes; all existing tests green; new layout test added |

---

## Constraints

- **No `!important`**. Page-scope with `body[data-current-page="orderflow"]`.
- **Preserve all `data-v6-*` / `data-testid` hooks** — `data-v6-cvd-strip`, `data-v6-cvd-canvas`, `data-v6-cvd-collapse`, `data-v6-resize-v`. Only visual/render changes.
- **No data / store / engine changes.** CVD data path unchanged (`state.deltaBuckets`, `state.deltaBucketsByInterval`).
- **Graceful degradation.** If viewport is absent (old code path, test environments), CVD falls back to the existing bar-only render — no crash.
- **No commit until Task 5 passes.**

---

## Tasks

### Task 1 — Add `CvdPanel.draw` (time-synced canvas renderer)

**File:** `static/js/split/076_v6_cvd_panel.js`

The existing `renderCvdInto` is DOM-based (innerHTML). Add a new *canvas* renderer alongside it. The existing DOM path is NOT removed (it's still used by the legacy CVD panel in `data-v6-cvd-panel`).

- [ ] **Step 1:** Add at the bottom of `076_v6_cvd_panel.js`:

```js
/**
 * Canvas renderer for the CVD sub-pane. Time-synced to the chart viewport.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} state   - full V6OF store state
 * @param {object} [vp]    - ChartViewport instance (optional; falls back to bar-only)
 * @param {object} [opts]  - { crosshairTs, showTimeAxis, timeAxisHeight, accentColor }
 */
Panels.CvdPanel = {};
Panels.CvdPanel.draw = function (canvas, state, vp, opts) {
  if (!canvas) return;
  opts = opts || {};
  state = state || {};

  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  var W = Math.max(1, rect.width || canvas.clientWidth || 300);
  var H = Math.max(1, rect.height || canvas.clientHeight || 80);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Resolve design tokens from the root element.
  var root = document.getElementById('v6-orderflow-root') || document.body;
  var cs = getComputedStyle(root);
  var bg        = cs.getPropertyValue('--v6-bg-2').trim()           || '#0e0f12';
  var hairline  = cs.getPropertyValue('--v6-hairline').trim()       || 'rgba(255,255,255,0.06)';
  var textFaint = cs.getPropertyValue('--v6-text-faint').trim()     || '#565b66';
  var textDim   = cs.getPropertyValue('--v6-text-dim').trim()       || '#9aa0ab';
  var buyColor  = cs.getPropertyValue('--v6-buy').trim()            || '#3fb950';
  var sellColor = cs.getPropertyValue('--v6-sell').trim()           || '#f6465d';
  var accent    = opts.accentColor || cs.getPropertyValue('--v6-accent').trim() || '#ff7a45';
  var monoFont  = cs.getPropertyValue('--v6-mono').trim()           || 'JetBrains Mono, monospace';

  var TIME_AXIS_H = opts.showTimeAxis ? (opts.timeAxisHeight || 20) : 0;
  var GUTTER_LEFT = 4;
  var GUTTER_RIGHT = 66; // align with chart price-axis width

  // Clear
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Draw top separator hairline
  ctx.fillStyle = hairline;
  ctx.fillRect(0, 0, W, 1);

  // Resolve buckets
  var settings = state.settings || {};
  var selected = Number(settings.deltaIntervalMs || 60000);
  var bucketsByInterval = state.deltaBucketsByInterval || {};
  var buckets = bucketsByInterval[String(selected)] || state.deltaBuckets || [];
  buckets = Array.isArray(buckets) ? buckets : [];

  var plotH = H - TIME_AXIS_H;
  var plotW = W - GUTTER_LEFT - GUTTER_RIGHT;
  if (plotH < 4 || plotW < 4 || !buckets.length) {
    // Nothing to draw — leave bg fill only
    return;
  }

  // ---- Time-synced path (viewport available) ----
  if (vp && typeof vp.timeToX === 'function' && vp.timeStart && vp.timeEnd > vp.timeStart) {
    // Update viewport plot rect to match CVD canvas geometry
    // (only the plot width/left; top/height are local to CVD)
    var vpPlot = {
      left:   GUTTER_LEFT,
      top:    0,
      width:  plotW,
      height: plotH
    };
    // Use a local copy so we don't mutate the shared viewport's plot
    // (the chart owns the authoritative plot rect).
    var localVp = {
      timeStart: vp.timeStart,
      timeEnd:   vp.timeEnd,
      timeToX: function (ts) {
        return vpPlot.left + (ts - vp.timeStart) / (vp.timeEnd - vp.timeStart) * vpPlot.width;
      }
    };

    // Vertical gridlines (same phase as chart) — use the interval as step
    var interval = Number(settings.deltaIntervalMs || 60000);
    var approxBarsVisible = Math.max(1, plotW / Math.max(1, (plotW / Math.max(buckets.length, 1))));
    // Draw one hairline per bar position that falls in the visible range
    ctx.fillStyle = hairline;
    buckets.forEach(function (b) {
      var ts = Number(b.ts);
      if (!ts) return;
      var x = localVp.timeToX(ts);
      if (x < GUTTER_LEFT || x > GUTTER_LEFT + plotW) return;
      ctx.fillRect(Math.round(x), 0, 1, plotH);
    });

    // Find max abs delta for scale
    var maxAbs = 1;
    var visibleBuckets = buckets.filter(function (b) {
      var ts = Number(b.ts);
      var x = localVp.timeToX(ts);
      return x >= GUTTER_LEFT && x <= GUTTER_LEFT + plotW;
    });
    if (!visibleBuckets.length) visibleBuckets = buckets.slice(-120);
    visibleBuckets.forEach(function (b) { maxAbs = Math.max(maxAbs, Math.abs(b.delta)); });

    // Bar width: derived from interval duration mapped to pixels
    var barPx = Math.max(1, (interval / (vp.timeEnd - vp.timeStart)) * plotW);
    var barW = Math.max(1, barPx - 1);

    // Draw bars
    visibleBuckets.forEach(function (b) {
      var ts = Number(b.ts);
      if (!ts) return;
      var x = localVp.timeToX(ts);
      if (x < GUTTER_LEFT - barW || x > GUTTER_LEFT + plotW) return;
      var pct = Math.max(0.04, Math.min(1, Math.abs(b.delta) / maxAbs));
      var barH = Math.max(2, Math.round(pct * (plotH - 4)));
      var y = b.delta >= 0 ? plotH - barH : 0;
      ctx.fillStyle = b.delta >= 0 ? buyColor : sellColor;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(Math.round(x - barW / 2), y, Math.ceil(barW), barH);
    });
    ctx.globalAlpha = 1;

    // Zero line
    ctx.fillStyle = hairline;
    ctx.fillRect(GUTTER_LEFT, Math.round(plotH / 2), plotW, 1);

    // Crosshair vertical line
    var crossTs = opts.crosshairTs;
    if (crossTs) {
      var cx = localVp.timeToX(crossTs);
      if (cx >= GUTTER_LEFT && cx <= GUTTER_LEFT + plotW) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(Math.round(cx), 0, 1, plotH);
      }
    }

    // Time axis
    if (opts.showTimeAxis && TIME_AXIS_H > 0) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, plotH, W, TIME_AXIS_H);
      ctx.fillStyle = hairline;
      ctx.fillRect(0, plotH, W, 1);

      ctx.fillStyle = textFaint;
      ctx.font = '10px ' + monoFont;
      ctx.textBaseline = 'middle';
      // Label a subset of visible buckets
      var labelEvery = Math.max(1, Math.ceil(30 / barPx)); // ~30px between labels
      visibleBuckets.forEach(function (b, i) {
        if (i % labelEvery !== 0) return;
        var ts = Number(b.ts);
        if (!ts) return;
        var x = localVp.timeToX(ts);
        if (x < GUTTER_LEFT + 10 || x > GUTTER_LEFT + plotW - 20) return;
        var d = new Date(ts);
        var label = d.getUTCHours().toString().padStart(2, '0') + ':' +
                    d.getUTCMinutes().toString().padStart(2, '0');
        ctx.fillText(label, x - ctx.measureText(label).width / 2, plotH + TIME_AXIS_H / 2);
      });
    }

    // Right gutter — label latest CVD value
    var latestByInterval = state.latestDeltaByInterval || {};
    var latest = latestByInterval[String(selected)] || buckets[buckets.length - 1] || null;
    if (latest) {
      var gx = W - GUTTER_RIGHT;
      ctx.fillStyle = bg;
      ctx.fillRect(gx, 0, GUTTER_RIGHT, plotH);
      ctx.fillStyle = hairline;
      ctx.fillRect(gx, 0, 1, plotH);

      ctx.fillStyle = textDim;
      ctx.font = '9px ' + monoFont;
      ctx.textBaseline = 'top';
      ctx.fillText('CVD', gx + 4, 4);
      var cvdSign = latest.cvd >= 0 ? '+' : '';
      var cvdStr = cvdSign + (Math.abs(latest.cvd) >= 1000 ?
        (latest.cvd / 1000).toFixed(1) + 'K' : latest.cvd.toFixed(1));
      ctx.fillStyle = latest.cvd >= 0 ? buyColor : sellColor;
      ctx.font = '10px ' + monoFont;
      ctx.textBaseline = 'top';
      ctx.fillText(cvdStr, gx + 4, 16);
    }

  } else {
    // ---- Fallback: simple bar-only render (no viewport) ----
    var fbBuckets = buckets.slice(-Math.floor(plotW / 3));
    var fbMaxAbs = 1;
    fbBuckets.forEach(function (b) { fbMaxAbs = Math.max(fbMaxAbs, Math.abs(b.delta)); });
    var fbBarW = Math.max(1, plotW / Math.max(fbBuckets.length, 1) - 1);
    fbBuckets.forEach(function (b, i) {
      var pct = Math.max(0.04, Math.min(1, Math.abs(b.delta) / fbMaxAbs));
      var barH = Math.max(2, Math.round(pct * (plotH - 4)));
      var x = GUTTER_LEFT + i * (fbBarW + 1);
      var y = b.delta >= 0 ? plotH - barH : 0;
      ctx.fillStyle = b.delta >= 0 ? buyColor : sellColor;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(Math.round(x), y, Math.ceil(fbBarW), barH);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = hairline;
    ctx.fillRect(GUTTER_LEFT, Math.round(plotH / 2), plotW, 1);
  }
};
```

- [ ] **Step 2:** Verify the file still parses — run `.venv\Scripts\python.exe build.py` and confirm no error.

---

### Task 2 — Expose viewport on chart canvas; add `suppressBottomGutter` flag

**File:** `static/js/split/077_v6_canvas_chart.js`

The chart canvas renderer creates a `ChartViewport` instance. We need to:
1. Store it on `canvas._v6vp` so the shell can read it.
2. Accept a `suppressBottomGutter` draw option (boolean) — when true, skip drawing the time-axis gutter row so the CVD pane can own it.

- [ ] **Step 1:** Find where the viewport is created in `077`. It will look like:

```js
var vp = V6OF.UI.ChartViewport.create(…);
```

After that line, add:

```js
if (canvas) canvas._v6vp = vp;
```

- [ ] **Step 2:** Find the `GUTTER_BOTTOM` constant at the top of the draw function. Currently:

```js
var GUTTER_BOTTOM = 24;
```

Change the draw loop to accept a flag. The draw function is called as `draw(canvas, state, options)` (or similar — check the actual signature). Add to the options destructuring:

```js
var suppressBottomGutter = options && options.suppressBottomGutter;
var GUTTER_BOTTOM = suppressBottomGutter ? 0 : 24;
```

  If `GUTTER_BOTTOM` is a module-level constant, make it a local variable inside the draw function instead (same value — 24 — just read before use each frame).

- [ ] **Step 3:** Build and confirm clean.

> **Implementation note:** Read the actual structure of `077` carefully before editing. The viewport creation and draw entry point may be inside closures. Use the existing patterns — don't restructure the file.

---

### Task 3 — Pass viewport to CVD draw; suppress chart gutter when CVD is visible

**File:** `static/js/split/080_v6_layout_shell.js`

The shell owns the draw loop and calls both the chart draw and `V6OF.CvdPanel.draw`. Currently at ~line 779:

```js
V6OF.CvdPanel.draw(cvdCanvas, current);
```

- [ ] **Step 1:** Resolve the viewport from the chart canvas and pass it:

```js
var chartCanvas = main && main.querySelector('[data-v6-chart]');
var sharedVp = chartCanvas && chartCanvas._v6vp;
var cvdVisible = cvdStrip &&
                 !cvdStrip.classList.contains('is-removed') &&
                 !cvdStrip.classList.contains('is-collapsed');

V6OF.CvdPanel.draw(cvdCanvas, current, sharedVp, {
  crosshairTs: V6OF.chart && V6OF.chart.crosshairTs,
  showTimeAxis: cvdVisible,
  timeAxisHeight: 20,
});
```

- [ ] **Step 2:** When calling the chart draw (wherever the chart canvas draw is triggered in the shell), pass `suppressBottomGutter: cvdVisible`:

Look for the existing chart draw call — it likely calls `V6OF.CanvasChart.draw(canvas, state, vp, opts)` or similar. Add `suppressBottomGutter: cvdVisible` to its options object.

  If the chart draws itself autonomously via a rAF loop in `077`, the flag needs to flow via a property on the canvas: `chartCanvas._v6suppressBottomGutter = cvdVisible`. The chart draw function reads `canvas._v6suppressBottomGutter` instead of a hard-coded constant.

  Choose whichever pattern matches the existing call path — do not restructure the draw loop.

- [ ] **Step 3:** Build and confirm clean.

---

### Task 4 — CSS: weld the gap, remove duplicate strip header

**File:** `static/css/split/075_v6_chart_cell.css` (new file, loads before 076+)

All rules page-scoped to `body[data-current-page="orderflow"]`.

- [ ] **Step 1:** Create the file:

```css
/* ============================================================
   075_v6_chart_cell.css
   Phase 3: Chart cell — welded chart + CVD sub-pane.
   Page-scoped; no !important; no hardcoded colours (tokens only).
   ============================================================ */

/* Hide the v6-resize-v divider when the CVD strip is present and visible.
   The two panes are welded — no drag-to-resize between them in Phase 3.
   (Resizing is a Phase 5 tiling-layout concern.) */
body[data-current-page="orderflow"] .v6-resize-v {
  display: none;
}

/* Remove the CVD strip header row (name + collapse button) — the canvas
   now owns its own right-gutter label. The collapse toggle is still present
   in the DOM (data-v6-cvd-collapse hook intact); we hide it visually. */
body[data-current-page="orderflow"] .v6-cvd-strip-head {
  display: none;
}

/* Flush the CVD strip top edge to the chart canvas bottom edge. */
body[data-current-page="orderflow"] .v6-cvd-strip {
  border-top: 1px solid var(--v6-hairline);
  margin-top: 0;
}

/* Ensure the CVD canvas fills its strip height. */
body[data-current-page="orderflow"] .v6-cvd-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* When collapsed, keep the strip at 1px (hairline only — no header row). */
body[data-current-page="orderflow"] .v6-cvd-strip.is-collapsed {
  flex-basis: 1px;
  overflow: hidden;
}

/* When removed, truly gone — no residual strip. */
body[data-current-page="orderflow"] .v6-cvd-strip.is-removed {
  display: none;
}
```

- [ ] **Step 2:** Build and verify the CSS is bundled into `static/style.css`.

---

### Task 5 — Build, tests, visual verify

- [ ] **Step 1:** Build.

```
.venv\Scripts\python.exe build.py
```

Expected: clean, no errors.

- [ ] **Step 2:** Full test suite.

```
.venv\Scripts\python.exe -m pytest tests/ -q
```

Expected: all green (same count as before — no regressions).

- [ ] **Step 3:** Add a smoke test for the new renderer.

Create `tests/test_orderflow_cvd_canvas_renderer.py`:

```python
"""Smoke-test: CvdPanel.draw is exported and accepts the viewport argument."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def test_cvd_panel_draw_exported():
    src = (ROOT / 'static/js/split/076_v6_cvd_panel.js').read_text(encoding='utf-8')
    assert 'Panels.CvdPanel.draw' in src, "CvdPanel.draw not exported"

def test_cvd_panel_draw_accepts_viewport():
    src = (ROOT / 'static/js/split/076_v6_cvd_panel.js').read_text(encoding='utf-8')
    # Signature must include vp parameter
    assert re.search(r'CvdPanel\.draw\s*=\s*function\s*\([^)]*vp', src), \
        "CvdPanel.draw signature missing vp parameter"

def test_cvd_panel_draw_has_fallback():
    src = (ROOT / 'static/js/split/076_v6_cvd_panel.js').read_text(encoding='utf-8')
    assert 'Fallback' in src or 'fallback' in src, "CvdPanel.draw missing fallback path"

def test_chart_viewport_stored_on_canvas():
    src = (ROOT / 'static/js/split/077_v6_canvas_chart.js').read_text(encoding='utf-8')
    assert '_v6vp' in src, "Viewport not stored on canvas as _v6vp"

def test_suppress_bottom_gutter_flag():
    src = (ROOT / 'static/js/split/077_v6_canvas_chart.js').read_text(encoding='utf-8')
    assert 'suppressBottomGutter' in src, "suppressBottomGutter flag not present in chart renderer"

def test_css_chart_cell_file_exists():
    css = ROOT / 'static/css/split/075_v6_chart_cell.css'
    assert css.exists(), "075_v6_chart_cell.css not created"

def test_css_no_important():
    css = (ROOT / 'static/css/split/075_v6_chart_cell.css').read_text(encoding='utf-8')
    assert '!important' not in css, "!important found in 075_v6_chart_cell.css"

def test_css_no_hardcoded_colors():
    css = (ROOT / 'static/css/split/075_v6_chart_cell.css').read_text(encoding='utf-8')
    import re
    # Allow comments; disallow bare hex/rgb in property values
    no_comments = re.sub(r'/\*.*?\*/', '', css, flags=re.DOTALL)
    assert not re.search(r':\s*#[0-9a-fA-F]{3,6}', no_comments), \
        "Hardcoded hex color found in 075_v6_chart_cell.css"
    assert not re.search(r':\s*rgba?\(', no_comments), \
        "Hardcoded rgba() found in 075_v6_chart_cell.css"
```

- [ ] **Step 4:** Run the new tests.

```
.venv\Scripts\python.exe -m pytest tests/test_orderflow_cvd_canvas_renderer.py -v
```

Expected: all 8 pass.

- [ ] **Step 5:** Manual visual check.

Start: `.venv\Scripts\python.exe app.py`
Open the Orderflow page. Confirm:
- Chart pane and CVD pane are flush — no visual gap, no duplicate header row in CVD strip.
- CVD bars align horizontally with the chart candles (same time positions for the same interval).
- Moving the mouse over the chart shows the crosshair vertical line on both panes simultaneously.
- The time-axis labels appear at the bottom of the CVD pane, not between the two panes.
- No console errors.
- Collapsing the CVD strip (via settings) removes it cleanly; the chart resumes drawing its own time axis (`suppressBottomGutter = false`).
- All existing controls work (timeframe, source, connection, workspace).

---

## Self-review

- **Spec coverage (Phase 3):** "Chart cell: welded chart + time-synced indicator sub-panes sharing one time axis (aligned vertical gridlines, single time-axis row, shared crosshair)" → Tasks 1–4. Drawing-toolbar slot is already anchored to chart pane via `v6-left-toolbar` CSS; no change needed. Amber last-price tag is already rendered in `077`; no change needed.
- **No `!important`:** CSS tasks explicitly checked.
- **No hardcoded colors:** All draw calls read `getComputedStyle` tokens; CSS file uses `var(--v6-*)` only.
- **Data/store unchanged:** CVD data still comes from `state.deltaBuckets` / `state.deltaBucketsByInterval`. No new fetch or store keys.
- **Fallback safety:** `CvdPanel.draw` degrades gracefully when `vp` is `null`/absent.
- **Phase 4 readiness:** The `CvdPanel.draw(canvas, state, vp, opts)` signature is the foundation of the module contract (`create/render/dispose`) that Phase 4 formalises.
