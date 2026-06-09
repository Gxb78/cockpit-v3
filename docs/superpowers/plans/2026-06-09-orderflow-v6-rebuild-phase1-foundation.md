# Orderflow V6 Platform Rebuild — Phase 1: Token Foundation & Single Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one canonical design-token system for the Orderflow V6 page (the "platform" near-black palette), emitted identically by CSS and by the runtime so they can never drift, guarded by a test.

**Architecture:** The orderflow page already renders (post round-1/2 fixes). Tokens live in the `@layer components` block of `static/css/split/070_v6_orderflow.css`. Two runtime emitters mirror the surface/text/hairline subset onto `#v6-orderflow-root`: the inline boot script in `templates/partials/pages/orderflow.html` and `hydrateThemeVars()` in `static/js/split/073_v6_orderflow_layout.js`. Phase 1 sets all three to ONE platform palette and adds a Python test that fails if they diverge. Purely additive/value changes — no structural or behavioural change; the page keeps working.

**Tech Stack:** Vanilla JS (V6OF namespace, split files bundled by `python build.py` via terser/esbuild), Flask templates, CSS custom properties, pytest.

---

## Context the engineer needs (read first)

- This is **Phase 1 of 7** of the rebuild specced in `docs/superpowers/specs/2026-06-09-orderflow-v6-modular-rebuild-design.md`. Read that spec's "Locked visual direction" and "Architecture §5 (one visual source of truth)".
- The page mounts `#v6-orderflow-root`; styles are scoped to `.v6-orderflow-root` and page-scoped with `body[data-current-page="orderflow"]`.
- **Build after editing splits:** `python build.py` (regenerates `static/app.js` + `static/style.css`). On Windows use `.venv\Scripts\python.exe build.py`.
- **Never reintroduce `!important` wars** — tokens only; components reference `var(--v6-…)`.
- The dev server runs via `.venv\Scripts\python.exe app.py` (Flask :5000 + WS engine :8765). Only **one** `market_ws_server.py` must run or live data stalls.

## Canonical platform palette (the single source of truth for this phase)

Dark theme (`dark-tv`) — surfaces/text/hairline are the subset the runtime mirrors:

| Token | Value |
|---|---|
| `--v6-bg` | `#0a0b0d` |
| `--v6-bg-2` | `#0e0f12` |
| `--v6-surface` | `#15171b` |
| `--v6-surface-2` | `#1c1f24` |
| `--v6-surface-3` | `#23262c` |
| `--v6-text` | `#d7d9de` |
| `--v6-text-dim` | `#9aa0ab` |
| `--v6-text-mute` | `#7c818c` |
| `--v6-text-faint` | `#565b66` |
| `--v6-hairline` | `rgba(255, 255, 255, 0.06)` |
| `--v6-hairline-strong` | `rgba(255, 255, 255, 0.12)` |

Accent + semantic (CSS-only, defined in 070 token block):

| Token | Value |
|---|---|
| `--v6-accent` | `#ff7a45` (amber) |
| `--v6-accent-2` | `#e8643c` |
| `--v6-accent-soft` | `rgba(255, 122, 69, 0.14)` |
| `--v6-accent-line` | `rgba(255, 122, 69, 0.32)` |
| `--v6-accent-glow` | `rgba(255, 122, 69, 0.45)` |
| `--v6-buy` | `#3fb950` |
| `--v6-buy-soft` | `rgba(63, 185, 80, 0.13)` |
| `--v6-sell` | `#f6465d` |
| `--v6-sell-soft` | `rgba(246, 70, 93, 0.13)` |
| `--v6-up` | `#e9eaed` (candle up) |
| `--v6-down` | `#f0703a` (candle down) |
| `--v6-gold` | `#f5b73c` |

Geometry/motion/type stay as currently in 070 (`--v6-r-*`, `--v6-ease`, `--v6-fast/med/slow`, `--v6-font` Inter, `--v6-mono` JetBrains Mono).

---

## File Structure (Phase 1)

- Modify: `static/css/split/070_v6_orderflow.css` — token block values → platform palette.
- Modify: `templates/partials/pages/orderflow.html` — boot-script `dark-tv` vars → platform surfaces/text/hairline.
- Modify: `static/js/split/073_v6_orderflow_layout.js` — `hydrateThemeVars()` `dark-tv` vars → same.
- Create: `tests/test_orderflow_token_source_of_truth.py` — asserts the 3 emitters agree.

---

### Task 1: Failing test — palette single source of truth

**Files:**
- Test: `tests/test_orderflow_token_source_of_truth.py`

- [ ] **Step 1: Write the failing test**

```python
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The canonical dark-theme surface/text/hairline subset both runtime emitters
# must mirror, and which must match the 070 CSS token block.
EXPECTED = {
    "--v6-bg": "#0a0b0d",
    "--v6-bg-2": "#0e0f12",
    "--v6-surface": "#15171b",
    "--v6-surface-2": "#1c1f24",
    "--v6-surface-3": "#23262c",
    "--v6-text": "#d7d9de",
    "--v6-text-dim": "#9aa0ab",
    "--v6-text-mute": "#7c818c",
    "--v6-text-faint": "#565b66",
    "--v6-hairline": "rgba(255, 255, 255, 0.06)",
    "--v6-hairline-strong": "rgba(255, 255, 255, 0.12)",
}

def _norm(v):
    return re.sub(r"\s+", "", v.strip().lower()).rstrip(";")

def _pairs_from_js_object(text, start_marker):
    """Extract '--v6-x': '#yyy' pairs from the dark-tv object after start_marker."""
    i = text.index(start_marker)
    chunk = text[i:i + 1200]
    out = {}
    for key, val in re.findall(r"'(--v6-[a-z0-9-]+)'\s*:\s*'([^']+)'", chunk):
        out[key] = val
    return out

class TokenSourceOfTruthTests(unittest.TestCase):
    def test_boot_script_matches_canonical(self):
        html = (ROOT / "templates/partials/pages/orderflow.html").read_text(encoding="utf-8")
        got = _pairs_from_js_object(html, "'--v6-bg': '#0a0b0d'")
        for k, v in EXPECTED.items():
            self.assertIn(k, got, f"boot script missing {k}")
            self.assertEqual(_norm(got[k]), _norm(v), f"boot {k}")

    def test_hydrate_matches_canonical(self):
        js = (ROOT / "static/js/split/073_v6_orderflow_layout.js").read_text(encoding="utf-8")
        got = _pairs_from_js_object(js, "'--v6-bg': '#0a0b0d'")
        for k, v in EXPECTED.items():
            self.assertIn(k, got, f"hydrateThemeVars missing {k}")
            self.assertEqual(_norm(got[k]), _norm(v), f"hydrate {k}")

    def test_css_token_block_matches_canonical(self):
        css = (ROOT / "static/css/split/070_v6_orderflow.css").read_text(encoding="utf-8")
        block = css[css.index(".v6-orderflow-root {"):css.index(".v6-orderflow-root {") + 2500]
        for k, v in EXPECTED.items():
            m = re.search(re.escape(k) + r"\s*:\s*([^;]+);", block)
            self.assertIsNotNone(m, f"070 token block missing {k}")
            self.assertEqual(_norm(m.group(1)), _norm(v), f"css {k}")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_orderflow_token_source_of_truth.py -q`
Expected: FAIL — current values are the round-1 palette (`#0a0e15`, etc.), and `.index("'--v6-bg': '#0a0b0d'")` raises `ValueError`/assertions fail.

- [ ] **Step 3: Commit the test**

```bash
git add tests/test_orderflow_token_source_of_truth.py
git commit -m "test(orderflow): guard design-token single source of truth"
```

---

### Task 2: Set the CSS token block (070) to the platform palette

**Files:**
- Modify: `static/css/split/070_v6_orderflow.css` (the `.v6-orderflow-root { … }` token block)

- [ ] **Step 1: Edit the surface/text/hairline tokens** to exactly:

```css
  --v6-bg:        #0a0b0d;
  --v6-bg-2:      #0e0f12;
  --v6-surface:   #15171b;
  --v6-surface-2: #1c1f24;
  --v6-surface-3: #23262c;
  --v6-surface-4: #2c313a;
  --v6-hairline:        rgba(255, 255, 255, 0.06);
  --v6-hairline-strong: rgba(255, 255, 255, 0.12);
  --v6-edge:      rgba(255, 255, 255, 0.04);
  --v6-text:       #d7d9de;
  --v6-text-dim:   #9aa0ab;
  --v6-text-mute:  #7c818c;
  --v6-text-faint: #565b66;
```

- [ ] **Step 2: Edit the accent + semantic tokens** to exactly:

```css
  --v6-accent:      #ff7a45;
  --v6-accent-2:    #e8643c;
  --v6-accent-soft: rgba(255, 122, 69, 0.14);
  --v6-accent-line: rgba(255, 122, 69, 0.32);
  --v6-accent-glow: rgba(255, 122, 69, 0.45);
  --v6-buy:       #3fb950;
  --v6-buy-soft:  rgba(63, 185, 80, 0.13);
  --v6-sell:      #f6465d;
  --v6-sell-soft: rgba(246, 70, 93, 0.13);
  --v6-up:        #e9eaed;
  --v6-down:      #f0703a;
  --v6-gold:      #f5b73c;
  --v6-gold-soft: rgba(245, 183, 60, 0.12);
```

- [ ] **Step 3: Run the CSS part of the test**

Run: `.venv\Scripts\python.exe -m pytest tests/test_orderflow_token_source_of_truth.py::TokenSourceOfTruthTests::test_css_token_block_matches_canonical -q`
Expected: PASS

---

### Task 3: Mirror the palette in the boot script (orderflow.html)

**Files:**
- Modify: `templates/partials/pages/orderflow.html` (inline boot script `dark-tv` object)

- [ ] **Step 1: Replace the `dark-tv` vars** with exactly:

```js
            ? {
                '--v6-bg': '#0a0b0d', '--v6-bg-2': '#0e0f12', '--v6-surface': '#15171b',
                '--v6-surface-2': '#1c1f24', '--v6-surface-3': '#23262c',
                '--v6-text': '#d7d9de', '--v6-text-dim': '#9aa0ab', '--v6-text-mute': '#7c818c',
                '--v6-text-faint': '#565b66', '--v6-hairline': 'rgba(255, 255, 255, 0.06)',
                '--v6-hairline-strong': 'rgba(255, 255, 255, 0.12)'
              }
```

- [ ] **Step 2: Run that test**

Run: `.venv\Scripts\python.exe -m pytest tests/test_orderflow_token_source_of_truth.py::TokenSourceOfTruthTests::test_boot_script_matches_canonical -q`
Expected: PASS

---

### Task 4: Mirror the palette in hydrateThemeVars (073)

**Files:**
- Modify: `static/js/split/073_v6_orderflow_layout.js` (`hydrateThemeVars()` `dark-tv` object, ~line 116)

- [ ] **Step 1: Replace the `dark-tv` vars** with exactly:

```js
      ? {
          '--v6-bg': '#0a0b0d',
          '--v6-bg-2': '#0e0f12',
          '--v6-surface': '#15171b',
          '--v6-surface-2': '#1c1f24',
          '--v6-surface-3': '#23262c',
          '--v6-text': '#d7d9de',
          '--v6-text-dim': '#9aa0ab',
          '--v6-text-mute': '#7c818c',
          '--v6-text-faint': '#565b66',
          '--v6-hairline': 'rgba(255, 255, 255, 0.06)',
          '--v6-hairline-strong': 'rgba(255, 255, 255, 0.12)'
        }
```

- [ ] **Step 2: Run that test**

Run: `.venv\Scripts\python.exe -m pytest tests/test_orderflow_token_source_of_truth.py::TokenSourceOfTruthTests::test_hydrate_matches_canonical -q`
Expected: PASS

---

### Task 5: Build, full suite, visual check, commit

- [ ] **Step 1: Rebuild bundles**

Run: `.venv\Scripts\python.exe build.py`
Expected: "Built static/app.js …" / "Built static/style.css …" with no error.

- [ ] **Step 2: Run the full test suite**

Run: `.venv\Scripts\python.exe -m pytest tests/ -q`
Expected: PASS (all green, including the 3 new token tests).

- [ ] **Step 3: Visual sanity (manual)**

Start the app (`.venv\Scripts\python.exe app.py`, ensure only one `market_ws_server.py`), open the Orderflow page. Confirm: background is the near-black `#0a0b0d` family, accents are amber, buy/sell still green/red, nothing unreadable, no console errors. (No layout change is expected in Phase 1 — only colours.)

- [ ] **Step 4: Commit**

```bash
git add static/css/split/070_v6_orderflow.css templates/partials/pages/orderflow.html static/js/split/073_v6_orderflow_layout.js static/app.js static/app.js.map static/style.css static/style.css.map
git commit -m "feat(orderflow): platform palette as single source of truth (phase 1)"
```

---

## Phases 2–7 (roadmap — each becomes its own detailed plan)

Each phase keeps the page working and ends green + committed.

- **Phase 2 — Platform chrome.** Rebuild the top bar (symbol · timeframe pills · chart-type · layout-picker icon · price/Δ% · 24H Vol · Open Interest · Funding · Calls/View as/Heatmap/Indicators · ⚙ · `›_`), slim left tool rail, and bottom bar (Templates · Workspace · ＋ add · Chat · UTC · ⚙), styled to the platform look. New `static/css/split/074_v6_platform_chrome.css`; markup in `080_v6_layout_shell.js`. Supersede/retire the legacy decorative rules in `071`/`072`/`073_pro` cleanly (no `!important`).
- **Phase 3 — Chart cell (welded chart + indicators).** Chart pane + time-synced indicator sub-panes (CVD, Volume-Delta) sharing one time scale; drawing-toolbar slot anchored to the chart pane only; amber last-price tag. Refactor `077_v6_canvas_chart.js` / `083_v6_chart_viewport.js` so indicator panes read the chart's single X scale.
- **Phase 4 — DOM / Tape / Orderbook modules.** Implement the validated designs (two-sided DOM ladder w/ walls + Σ footer + GROUP-in-header + configurable columns via slots; Tape with size bars + side accents + big-trade highlight + pressure bar + premium header; Orderbook). Define the **module contract** + **slot renderer** (`header/toolbar/body/footer`) here so the GROUP-control slot move is config.
- **Phase 5 — Tiling layout engine.** `layoutSchema` (split-tree of cells, each referencing a module id), the STANDARD/MONITOR/SYNC layout picker, drag-between-cells, hide-removes-completely, re-add via Indicators/＋ menu, workspaces (Save/Reset/Export/Import). Replace the fixed dock shell.
- **Phase 6 — Pop-out window manager.** Detach any module into its own window; cross-window store-slice sync via BroadcastChannel (fallback `storage`); re-dock on close.
- **Phase 7 — Settings + responsive hardening.** Global ⚙ panel + per-module ⚙; drawing-toolbar toggle; containment audit at all widths; tests for schema ops, slot moves, responsive, pop-out sync.

---

## Self-Review

- **Spec coverage (Phase 1 only):** Spec Architecture §5 "one visual source of truth" → Tasks 1–5. Locked visual direction palette → Tasks 2–4. Remaining spec sections → mapped to Phases 2–7 above. No Phase-1 gap.
- **Placeholder scan:** none — every step has exact paths, exact values, exact commands.
- **Type/value consistency:** the `EXPECTED` dict (Task 1) and the values written in Tasks 2–4 are identical token-by-token; the test enforces it.
