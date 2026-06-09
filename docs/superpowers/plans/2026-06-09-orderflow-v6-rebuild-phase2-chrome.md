# Orderflow V6 Rebuild — Phase 2: Platform Chrome — Implementation Plan

> **For agentic workers:** execute task-by-task; **DO NOT COMMIT** (user directive). Steps use `- [ ]`.

**Goal:** Restyle the top bar and bottom/status bar of the Orderflow V6 page to the clean near-black "platform" look (Hyperliquid/Kata reference), reading existing data hooks only, with all behaviour preserved.

**Architecture:** Additive page-scoped CSS in a new split file `static/css/split/074_v6_platform_chrome.css` (loads after the existing v6 CSS so it wins cleanly, no `!important`). Markup tweaks only where needed in `static/js/split/073_v6_orderflow_layout.js` (header `shellHtml`) and `static/js/split/080_v6_layout_shell.js` (status bar in `mainAreaHtml`). Tokens already exist (Phase 1). No data/engine changes; show existing values or a neutral `—` placeholder for stats that have no live source yet.

**Tech Stack:** vanilla JS (V6OF), CSS custom props, Flask templates, `python build.py` (use `.venv\Scripts\python.exe`), pytest.

---

## Constraints
- **No commits.** Build + run tests, then stop.
- Preserve every `data-v6-*` / `data-testid` hook and existing classes (the header `data-v6-action="timeframe|layer|source|toggle-connection|symbol-select"`, `data-v6-symbol`, `data-v6-badge`, `data-v6-interval`, `data-v6-workspace-container`, status-bar `data-v6-status-*`). Restyle, don't remove behaviour.
- No `!important`. Page-scope with `body[data-current-page="orderflow"]`.
- Keep it dense, flush, near-black; accent amber; mono numbers.

## Tasks

### Task 1 — Create the platform-chrome CSS
- [ ] Create `static/css/split/074_v6_platform_chrome.css`. Page-scoped rules for:
  - `.v6-header`: height ~40px, `var(--v6-bg-2)` bg, 1px `var(--v6-hairline)` bottom, slim padding, groups separated by hairlines (`border-right`).
  - Symbol cluster: brand mark + `.v6-symbol-ticker` (800/14px) + `.v6-symbol-meta` (PERP/source, mute).
  - Timeframe pills `.v6-tf-btn`: compact, active = white text on `var(--v6-surface-3)` (TradingView pill feel).
  - Chart-type segment `.v6-seg`/`.v6-seg-btn`: active = amber fill `var(--v6-accent)` text `#06121f`.
  - Source `.v6-source-btn`, connection `.v6-conn`/`.v6-engine-dot` (dot uses `--v6-buy`/`--v6-gold`/`--v6-sell` per state with soft ring).
  - Status/footer bar `.v6-status-bar` + `.v6-sb-*`: 22–24px, `var(--v6-bg-2)`, mono 8px, labels `--v6-text-faint`, values `--v6-text-dim`, last segment pushed right.
  - Left rail `.v6-left-toolbar`/`.v6-tool`: confirm slim icon rail (≈44px), active = amber-soft.
  - A `.v6-header-actions` cluster on the right containing the existing connection control + a settings gear button (see Task 3).
- [ ] Ensure scrollbars/containment unaffected. No layout structure change, only chrome visuals.

### Task 2 — Header markup: align to platform, drop noise
- [ ] In `073_v6_orderflow_layout.js` `shellHtml()` header: keep timeframe pills, chart-type segment, workspace holder, source toggle, build meta, connection. Confirm the live BID/ASK ticket and "Live" disclosure are NOT shown in the compact header (hide via CSS if markup remains, to avoid breaking JS that targets them). Keep all `data-v6-*` hooks intact.

### Task 3 — Add global settings gear (⚙)
- [ ] Add a `⚙` button to the header right cluster: `<button type="button" class="v6-gear" data-v6-action="global-settings" title="Settings" aria-label="Global settings">⚙</button>`. Wire a no-op-safe click in the existing header action handler that toggles the Settings panel/tab if present (reuse existing settings panel; do not build a new settings system in this phase). Style `.v6-gear` in 074.

### Task 4 — Build, test, verify
- [ ] `.venv\Scripts\python.exe build.py` → succeeds.
- [ ] `.venv\Scripts\python.exe -m pytest tests/ -q` → all green (fix any template/bundle test that asserts removed markup by keeping hooks present-but-hidden).
- [ ] Manual: load Orderflow page, confirm clean near-black top bar + bottom bar, amber accents, all controls work (timeframe/source/connection/workspace), no console errors, nothing overflows at narrow widths.
- [ ] **No commit.**

## Self-review
- Spec coverage: spec "Chrome" bullet (top bar + bottom bar + gear, no ticket/Live) → Tasks 1–3. Tokens already from Phase 1. Layout-picker icon functionality deferred to Phase 5 (only a visual entry point may be added).
- No placeholders beyond the intentional `—` for stats without a live source.
