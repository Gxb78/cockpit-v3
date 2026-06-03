# Cockpit V6 - Phase 0 Audit

Date: 2026-05-29
Scope: repository audit only. No functional code change.

## Executive Summary

The current project is not a React/TypeScript app. It is a local Flask application with Jinja templates, SQLite storage, and a vanilla JavaScript/CSS frontend built from split files into `static/app.js` and `static/style.css`.

There is already meaningful orderflow work in the repo:

- A standalone custom Canvas 2D orderflow page at `templates/partials/pages/orderflow.html` and `static/js/split/066_orderflow_engine.js`.
- A chart page using Lightweight Charts at `static/js/split/062_chart_page.js`.
- Shared chart view logic in `static/js/split/054_chart_view_core.js`.
- Shared VWAP logic in `static/js/split/055_indicator_vwap_core.js`.
- Canvas drawings in `static/js/split/064_chart_drawings.js`.
- Volume profile and Hyperliquid footprint/heatmap overlays in `static/js/split/065_volume_profile.js` and `static/js/split/063a_hyperliquid_workspace.js`.
- Binance REST proxy routes and Hyperliquid read-only routes in `app_parts/23_routes_market.py`, `app_parts/25_routes_hyperliquid.py`, and `app_parts/27_routes_hyperliquid_analytics.py`.
- A Hyperliquid collector worker writing Parquet/DuckDB-compatible market data under `workers/hyperliquid_market_worker.py`.

The safest V6 path is not a big React rewrite first. The safest path is:

1. Freeze and verify the current Flask + vanilla stack.
2. Add an isolated V6 orderflow surface inside the existing app shell.
3. Build a separate Go market engine that streams normalized local data to the frontend.
4. Migrate high-frequency orderflow calculation out of browser JavaScript and into the Go engine.
5. Move to Wails/desktop only after the local market engine contract is stable.

## Git And Working Tree State

Current branch:

- `main`
- Tracking `origin/main`

Local tree is dirty before V6 work starts. Existing modified/untracked files include chart, VWAP, orderflow, Hyperliquid, requirements, generated bundles, docs, tests, and `workers/`.

Important: these are treated as user changes. V6 work must not revert them.

The requested commit `7a45a83` is not present in the local Git object database or visible branches. Commands against it fail with `unknown revision`. Relevant local commits inspected instead:

- `8fedfdb` - VWAP 1D UTC day + 365D, Hyperliquid aliases, tests.
- `78a5b28` - chart and orderflow interactions.
- `91b2dce` - canonical VWAP stable by result cache and fixed source.
- `5f1f018` - VWAP autoscale isolation and live Y reactivity.

## Current Stack

Backend:

- Flask 3.
- Modular loader in `app.py` and `app_parts/__init__.py`.
- All `app_parts/*.py` files are executed into a shared namespace.
- SQLite database at `data/journal.db`.
- WAL mode enabled.
- Python deps in `requirements.txt`.

Frontend:

- Vanilla JavaScript.
- Jinja templates under `templates/partials/`.
- Split JS under `static/js/split/*.js`.
- Split CSS under `static/css/split/*.css`.
- `build.py` concatenates split files alphabetically into:
  - `static/app.js`
  - `static/style.css`
- No `package.json`, no Vite, no TypeScript, no React project currently.
- Lightweight Charts is vendored at `static/vendor/lightweight-charts.standalone.production.js`.

Desktop:

- No Wails/Electron/Tauri desktop app currently.
- `start.bat` and Flask launcher are the current local run story.

Market data:

- Binance REST proxy for klines and aggTrades.
- Browser-side Binance WebSocket usage in BTC widget/chart/orderflow.
- Hyperliquid REST/read-only routes.
- Hyperliquid browser WebSocket overlay in chart workspace.
- Hyperliquid standalone worker for Parquet market capture.

## Repository Map

Main entrypoints:

- `app.py` - imports `app_parts` and launches Flask.
- `app_parts/__init__.py` - ordered loader for all backend modules.
- `build.py` - frontend bundle builder.
- `templates/index.html` - includes every page partial and overlay.

Backend modules:

- `app_parts/00_paths_constants.py` - paths, constants, schema version, config load.
- `app_parts/01_flask_app.py` - Flask app, cache headers, API CORS, error handlers.
- `app_parts/02_database.py` - SQLite tables and migrations through schema v10.
- `app_parts/06a_trade_service.py`, `06b_day_service.py` - service layer for trades/days.
- `app_parts/09_routes_days.py`, `10_routes_trades.py`, `11_routes_screenshots.py` - journal APIs.
- `app_parts/19_ai_chat.py` - DeepSeek chat integration and tool calling over journal data.
- `app_parts/21_midnight_engine.py` - Midnight model market context.
- `app_parts/22_routes_settings.py` - persisted user settings.
- `app_parts/23_routes_market.py` - Binance public REST proxy.
- `app_parts/24_market_history_cache.py` - SQLite market klines history cache.
- `app_parts/25_routes_hyperliquid.py` - Hyperliquid read-only market proxy.
- `app_parts/26_routes_hyperliquid_wallets.py` - Hyperliquid wallet tracker.
- `app_parts/27_routes_hyperliquid_analytics.py` - Hyperliquid analytics for candles, profile, footprint, heatmap.

Frontend modules:

- `static/js/split/008_boot.js` - app boot and global bindings.
- `static/js/split/009_navigation.js` - SPA page switching by `data-page`.
- `static/js/split/054_chart_view_core.js` - shared X/Y chart framing.
- `static/js/split/055_indicator_vwap_core.js` - canonical VWAP source/cache/draw helpers.
- `static/js/split/056_indicator_midnight_core.js` - shared Midnight levels.
- `static/js/split/060_btc_chart_widget.js` - dashboard BTC chart widget.
- `static/js/split/062_chart_page.js` - main chart page.
- `static/js/split/063a_hyperliquid_workspace.js` - chart overlay for Hyperliquid footprint/heatmap.
- `static/js/split/064_chart_drawings.js` - Canvas drawing engine.
- `static/js/split/065_volume_profile.js` - volume profile overlay.
- `static/js/split/066_orderflow_engine.js` - standalone Canvas 2D orderflow page.
- `static/js/split/066a_orderflow_viewport.js` - orderflow viewport controller.
- `static/js/split/066b_orderflow_data.js` - orderflow data model helper.

Templates:

- `templates/partials/pages/chart.html` - main chart page.
- `templates/partials/pages/orderflow.html` - current orderflow page.
- `templates/partials/pages/journal.html` plus subpartials - journal UI.
- `templates/partials/pages/today/widgets/011_btc_chart.html` - dashboard chart widget.
- `templates/partials/layout/rail.html` - navigation, including Orderflow button.

Workers/data:

- `workers/hyperliquid_market_worker.py` - public Hyperliquid collector, writes Parquet partitions and `data/market/control.sqlite`.
- `data/journal.db` - main journal SQLite DB.
- `data/market/control.sqlite` - Hyperliquid analytics control DB.

Docs/tests:

- `docs/API_ROUTES.md` - route inventory.
- `docs/LATENCY_RECAP.md` - drawing overlay latency analysis.
- `tests/` - unittest suite for backend, bundles, templates, market routes, Hyperliquid, Midnight, encoding.
- `.github/workflows/ci.yml` - build bundle, node syntax check, unittest, encoding scan.

## Current Backend Architecture

The backend is a flat modular Flask app. `app_parts/__init__.py` loads files in a fixed order and executes them into a shared namespace. This preserves the existing cross-file global reference pattern but makes load order important.

Strengths:

- Fast to extend.
- Existing tests import `app` and monkeypatch paths.
- SQLite WAL and busy timeout are already configured.
- Routes are local-first and avoid exposing secrets.

Risks:

- Name collision is possible. The loader logs public names overwritten, but modules still share global state.
- Adding a large Go/Wails bridge directly into this namespace would increase risk.
- Backend route files rely on earlier globals such as `app`, `get_db`, helpers, and constants.
- Generated docs mention 49 routes, but current code has more because Hyperliquid analytics and wallets were added.

V6 implication:

- Keep Flask for the journal and AI in the short term.
- Add Go market engine as a separate local process/service first.
- Only add thin Flask proxy or health routes if needed.

## Current Frontend Architecture

The app is a single rendered HTML page with multiple sections. Navigation toggles `.page.active` by `data-page`; it does not currently provide true frontend routes such as `/orderflow`.

The frontend build is alphabetical concatenation of split files. This means:

- File numbering controls dependency order.
- New V6 files should use a number after existing modules and avoid changing old module order.
- `static/app.js` and `static/style.css` are generated artifacts but currently tracked and modified.

V6 implication:

- Do not introduce React/TypeScript in Phase 2 unless Phase 1 explicitly creates and verifies a new build pipeline.
- The first isolated V6 UI should follow the existing split-file pattern.
- React/TypeScript can be introduced later as a separate island or during desktop/Wails work, not as the first migration step.

## Chart Principal

Primary chart files:

- Template: `templates/partials/pages/chart.html`
- Runtime: `static/js/split/062_chart_page.js`
- Shared view: `static/js/split/054_chart_view_core.js`
- VWAP: `static/js/split/055_indicator_vwap_core.js`
- Drawings: `static/js/split/064_chart_drawings.js`
- Volume profile: `static/js/split/065_volume_profile.js`
- Hyperliquid workspace: `static/js/split/063a_hyperliquid_workspace.js`

The chart page uses Lightweight Charts. It now fetches Hyperliquid klines in the inspected working tree, while the BTC dashboard widget uses Binance klines and Binance kline WebSocket.

Fragile areas:

- It mixes Lightweight Charts native rendering with Canvas overlays.
- It has many async paths: fetch, WS, VWAP drawing, volume profile, Hyperliquid workspace.
- It uses token/timeframe guards in several places.
- It depends on `setData()`, `series.update()`, price scale APIs, and manual range refs.

V6 implication:

- Do not put new V6 high-frequency rendering inside `062_chart_page.js`.
- Keep the existing chart page stable.
- Build V6 chart/orderflow separately, then only share data contracts after the Go engine is stable.

## Canvas Overlays

Current overlays:

- `064_chart_drawings.js` creates an absolute Canvas overlay over Lightweight Charts.
- `065_volume_profile.js` creates a Canvas overlay and uses `series.priceToCoordinate`.
- `063a_hyperliquid_workspace.js` creates a chart overlay for footprint/heatmap.
- `066_orderflow_engine.js` owns a standalone Canvas full-page renderer independent from Lightweight Charts.

`docs/LATENCY_RECAP.md` correctly identifies the core issue: Lightweight Charts does not expose enough price-scale events, so canvas overlays can lag by one frame during Y-axis interaction. The recommended workaround is a short rAF render loop during interaction.

Current drawing engine already contains a continuous/double-rAF loop during interaction, visible range subscriptions, and resize handling.

V6 implication:

- For V6 orderflow, prefer standalone Canvas coordinates owned by the V6 chart engine.
- Avoid depending on Lightweight Charts for footprint/heatmap alignment.
- Treat LWC overlays as legacy chart functionality, not the foundation for V6.

## Current VWAP Logic

`static/js/split/055_indicator_vwap_core.js` is the canonical VWAP module shared by widget and chart page.

Current behavior:

- VWAP is computed from canonical candle sources, not from currently visible chart candles.
- 1D uses UTC day with 15m candles.
- 7D uses 15m candles.
- 30D uses 1h candles.
- 90D uses 4h candles.
- 365D uses 12h candles.
- Cache stores VWAP result, not raw klines.
- VWAP series apply `autoscaleInfoProvider: function () { return null; }`.
- Active periods are stored in `localStorage` as `chartVwapPeriods`.

Important distinction:

- This is better than visible-range VWAP, but it is still candle-derived VWAP.
- Cockpit V6 session VWAP should be trade-derived in the Go engine:
  - `CumPV += price * qty`
  - `CumVol += qty`
  - `Value = CumPV / CumVol`
  - reset by configured session.

Suspected 3m/5m chart focus issue:

- The specific commit `7a45a83` was not available locally.
- Current code tries to isolate VWAP from autoscale, so VWAP alone should not directly expand price scale through LWC autoscale.
- The issue still needs DevTools measurement if it is reproducible. Likely candidates are manual price range state, `ChartViewCore` visible/future bar settings, async `applyBestView`, or another overlay/update path rather than only the VWAP line.

V6 implication:

- Do not reuse `055_indicator_vwap_core.js` as the final V6 VWAP source.
- Reuse its lessons: fixed source, stable session bounds, abort guards, result cache.
- Implement V6 VWAP in Go from normalized trades.

## Current WebSocket Logic

Chart/widget:

- `060_btc_chart_widget.js` has generational Binance kline WS logic.
- `062_chart_page.js` has similar generational WS logic, though current fetch path is Hyperliquid klines.
- Both use token/generation guards and intentional handler neutralization before close.

Orderflow page:

- `066_orderflow_engine.js` uses direct browser Binance `aggTrade` WebSocket.
- It has reconnect/backoff and token-like `_streamToken` handling.
- It buffers live trades and flushes every 150ms.

Hyperliquid workspace:

- `063a_hyperliquid_workspace.js` connects browser-side to `wss://api.hyperliquid.xyz/ws`.
- It subscribes to `trades` and `l2Book`.
- It keeps live trades/books in bounded arrays.

V6 implication:

- Browser-side exchange WebSockets are acceptable prototypes but not the target architecture.
- V6 should move exchange connections to Go.
- Frontend should consume one local normalized stream, not many exchange-specific browser streams.

## Current Orderflow State

There are two orderflow-related systems:

1. Standalone orderflow page:
   - `templates/partials/pages/orderflow.html`
   - `static/js/split/066_orderflow_engine.js`
   - `static/js/split/066a_orderflow_viewport.js`
   - `static/js/split/066b_orderflow_data.js`
   - `static/css/split/066_orderflow.css`

2. Hyperliquid chart workspace:
   - `static/js/split/063a_hyperliquid_workspace.js`
   - `app_parts/27_routes_hyperliquid_analytics.py`
   - `workers/hyperliquid_market_worker.py`

Existing features:

- Custom Canvas footprint renderer.
- Custom time/price scales.
- Pan/zoom/fit/reset logic.
- Per-candle delta.
- Side volume profile in orderflow renderer.
- Binance aggTrades historical fetch through Flask.
- Direct Binance aggTrade live stream in browser.
- Hyperliquid footprint, heatmap, volume profile, CVD label, L2 context.

Missing or incomplete for V6:

- No true tape panel.
- No Binance DOM/order book engine.
- No generic CVD panel.
- No Go market engine.
- No local normalized stream contract.
- No durable V6 settings/layout tables.
- No session VWAP from trade stream.
- No route-level `/orderflow` URL; current page is SPA state only.
- Current orderflow template appears to lack the topbar controls expected by `066_orderflow_engine.js` and styled by `066_orderflow.css`.
- `static/js/orderflow_viewport_guard.js` exists outside `static/js/split/` and is not referenced by current templates or bundle.

Potential orderflow correctness risks:

- `066_orderflow_engine.js` currently names fields `bid` and `ask`, but assigns `t.side === 'buy'` into `bid` and `sell` into `ask`. The renderer labels may therefore be semantically inverted depending on intended convention.
- Incremental `applyTradesToFootprintMap()` mutates maps that may already have `levels` as arrays, which can make live footprint updates fragile.
- Orderflow state and settings are not yet persisted through backend settings.
- High-frequency updates still hit a large monolithic JS file.

V6 implication:

- Keep this prototype as a reference and possible temporary UI.
- Do not build V6 engine logic deeper into the monolithic 112 KB file.
- Extract/replace in small steps behind an isolated V6 data contract.

## Journal And AI

Journal storage:

- `days`
- `trades`
- `trade_screenshots`
- `knowledge_cards`
- `user_settings`
- `market_day_contexts`
- `market_events`
- `trade_market_contexts`
- `hyperliquid_wallets`
- `market_klines` is created on demand by the history cache.

Trade routes:

- CRUD under `/api/days`, `/api/trades`, `/api/screenshots`.
- PnL/RR and plan evaluation are computed server-side.

AI chat:

- `app_parts/19_ai_chat.py` uses DeepSeek chat completions with tool/function calling.
- It can read days/trades/stats and create/update/delete journal data.
- It already requires confirmation for destructive deletes in the prompt.
- It handles image upload tokens and pending image cleanup.

V6 implication:

- The existing AI layer is a useful base for MVP 3.
- Do not connect AI to orderflow metrics until metrics snapshots have stable storage.
- Future AI actions should cite exact local records and require confirmation for destructive changes.

## Data And Storage

Main DB:

- `data/journal.db`
- Schema version constant is `SCHEMA_VERSION = 10`.
- WAL and foreign keys enabled.

Market storage:

- `market_klines` table in journal DB for Binance klines history.
- `data/market/control.sqlite` for Hyperliquid analytics control state.
- Parquet partitions under `data/market/...` for Hyperliquid worker output.

Current `user_settings` route only accepts:

- `profile`
- `custom_strategies`
- `custom_tags`
- `preferences`

V6 implication:

- Add V6 settings/layout keys carefully, or create dedicated tables.
- Do not overload existing `preferences` with high-frequency or large state.
- Use SQLite for V6 settings/layouts, not `localStorage`, once the first mock page is stable.
- Use DuckDB/Parquet later for heavy historical orderflow.

## Tests And Build

Current verification assets:

- `python build.py` rebuilds bundles.
- `python -m unittest discover -s tests -v` runs backend and bundle tests.
- CI runs Node syntax check on `static/app.js`.
- Tests include bundle integrity, template render, market aggTrades, Hyperliquid routes, Hyperliquid analytics, Midnight engine, encoding guardrails.

Local observation:

- `.venv/Scripts/python.exe` failed to run in this Windows session with an access error pointing at Python 3.14.
- Phase 1 should verify both Windows `.venv` and WSL `.venv_linux` exactly as documented in `AGENTS.md`.

## Existing Documentation

`docs/LATENCY_RECAP.md`:

- Correctly explains LWC price-scale event limitations.
- Recommends rAF rendering during interaction for Canvas overlay sync.
- This is directly relevant to V6: avoid LWC-dependent overlays for core orderflow.

`docs/API_ROUTES.md`:

- Existing route inventory.
- Recently modified in the working tree.
- Should be updated only after new V6 APIs are actually added.

`AI_DEVELOPMENT_PLAYBOOK.md`:

- Large project memory/playbook.
- Modified in the working tree.
- Do not touch during Phase 0 unless explicitly requested.

## Strengths

- Local-first journal already works around SQLite.
- Good separation of route files by domain.
- Existing API tests and bundle checks reduce regression risk.
- Chart/WebSocket code already learned hard lessons: generation tokens, aborts, stale guards, REST fallback, cache, countdown anchors.
- Standalone orderflow canvas exists and is not dependent on Lightweight Charts.
- Hyperliquid analytics already contains useful volume profile, footprint, heatmap, and CVD concepts.
- Public market data is already the established direction.

## Technical Debt

- No TypeScript types or compile-time frontend checks.
- Large global JS modules with implicit ordering.
- Generated bundles are tracked and often dirty.
- Flask loader shared namespace is powerful but brittle.
- Market engine logic is split between Flask REST, browser WebSockets, and worker scripts.
- Orderflow code is monolithic and should not absorb more core logic.
- Settings are split between SQLite and `localStorage`.
- Current orderflow page controls appear inconsistent with its template.
- Encoding/mojibake appears in several existing files when read in this environment; new docs should stay ASCII.

## High-Risk Areas To Avoid Breaking

- `app_parts/__init__.py` load order.
- `app_parts/02_database.py` migrations and schema version.
- `static/js/split/054_chart_view_core.js`, `055_indicator_vwap_core.js`, `060_btc_chart_widget.js`, `062_chart_page.js`.
- `static/js/split/064_chart_drawings.js` rAF overlay alignment.
- `static/js/split/066_orderflow_engine.js` and `066a/066b` current orderflow prototype.
- `build.py`, `templates/partials/overlays/scripts.html`, `templates/partials/layout/head_assets_css.html`.
- `static/app.js` and `static/style.css` generated bundles.
- `data/journal.db` and screenshot files.

## Where To Integrate The Go Engine

Recommended initial location:

```text
services/market-go/
  cmd/
    marketd/
      main.go
  internal/
    exchange/
      binance/
    marketdata/
    engine/
    calc/
    storage/
    ws/
    config/
  pkg/
    types/
```

Initial integration model:

- Run Go engine as separate local process.
- It connects to public Binance Futures streams.
- It exposes local WebSocket on `127.0.0.1`.
- Frontend V6 page consumes only the local stream.
- Flask remains the journal/API app.

Why separate first:

- No disruption to Flask loader.
- No Wails complexity before data contracts are known.
- Easier to test reconnect, buffering, and calculations independently.
- Later Wails can embed or launch the same engine.

## Where To Integrate The V6 Orderflow Page

Current page exists:

- `templates/partials/pages/orderflow.html`
- `data-page="orderflow"`
- nav button in `templates/partials/layout/rail.html`
- shortcut `O` in `static/js/split/028_global_keys.js`

Recommended Phase 2 approach:

- Keep the existing shell page but create an isolated V6 sub-root inside it.
- Add new files with later numeric prefixes, for example:
  - `static/js/split/070_v6_orderflow_types.js`
  - `static/js/split/071_v6_orderflow_store.js`
  - `static/js/split/072_v6_orderflow_mock.js`
  - `static/js/split/073_v6_orderflow_ui.js`
  - `static/css/split/070_v6_orderflow.css`
- Avoid touching `062_chart_page.js` or BTC widget during Phase 2.
- Keep old `066_orderflow_engine.js` available until the V6 surface replaces it deliberately.

If React/TypeScript is still desired:

- Treat it as a separate build-system phase after current build is secured.
- Do not introduce npm/Vite/React while the existing app is dirty and unverified.

## Progressive Migration Strategy

Phase order adapted to this repo:

1. Secure current repo and build/test commands.
2. Add V6 page/UI mock in the existing vanilla architecture.
3. Create Go market engine as separate local service.
4. Stream normalized trades from Go to V6 tape.
5. Move CVD/delta/VWAP session calculations into Go.
6. Add Binance order book/DOM in Go.
7. Add V6 chart/Canvas renderers consuming local state.
8. Add heatmap/footprint/profile incrementally.
9. Connect journal/AI to stored metrics snapshots.
10. Package desktop with Wails when the engine contract is stable.

Rule of thumb:

- Journal remains Flask/SQLite.
- Market engine becomes Go.
- V6 rendering owns its own Canvas coordinates.
- Lightweight Charts remains legacy chart infrastructure until deliberately replaced.

