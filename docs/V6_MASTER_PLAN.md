# Cockpit V6 - Master Plan

Date: 2026-05-29
Target: Cockpit V6 - Local Orderflow Terminal

This plan adapts the requested V6 roadmap to the actual repository architecture found in Phase 0.

## Non-Negotiable Rules

- Do not break the existing Journal.
- Do not refactor chart/orderflow globally without a specific phase reason.
- Do not commit without explicit user approval.
- Do not copy proprietary products, private APIs, paid API contracts, branding, UI assets, or reverse-engineered behavior.
- Use public market data first.
- Keep changes small, reviewable, and reversible.
- Rebuild bundles whenever split JS/CSS changes.
- Treat `static/app.js` and `static/style.css` as generated outputs.
- Preserve user work in the dirty working tree.

## Architecture Decision

The repo is Flask + vanilla JS, not React/TypeScript. Therefore the first V6 implementation should use the existing split JS/CSS build system.

React/TypeScript remains possible later, but not as the first V6 step. Introducing a new frontend toolchain before the current app is secured would add build risk without improving the core orderflow engine.

Recommended target architecture:

```text
Cockpit V6
  Flask app
    Journal, AI, screenshots, stats, settings
  Go market engine
    exchange adapters, normalized streams, calculations, local WS
  Vanilla/Canvas V6 frontend first
    isolated orderflow page, tape, DOM, CVD, VWAP, footprint, heatmap
  Wails desktop later
    packages Flask/Go/frontend or replaces Flask only when safe
```

## Data Contract First

The most important V6 boundary is a stable market data contract between Go and the UI.

Initial envelope:

```json
{
  "type": "trade",
  "seq": 1,
  "tsLocal": 1760000000000,
  "payload": {}
}
```

Initial types:

```text
Trade
  exchange: string
  symbol: string
  tradeId: string
  tsExchange: number
  tsLocal: number
  price: number
  qty: number
  side: "buy" | "sell"

OrderBookLevel
  price: number
  size: number

OrderBookSnapshot
  exchange: string
  symbol: string
  tsExchange: number
  tsLocal: number
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  bestBid: number
  bestAsk: number
  spread: number

Candle
  symbol: string
  intervalMs: number
  openTime: number
  closeTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number

DeltaBucket
  symbol: string
  intervalMs: number
  startTime: number
  endTime: number
  buyVol: number
  sellVol: number
  delta: number
  cvd: number
  closed: boolean

VWAPState
  symbol: string
  sessionId: string
  sessionStart: number
  cumPV: number
  cumVol: number
  value: number

FootprintCandle
  symbol: string
  intervalMs: number
  openTime: number
  levels: Array<{ price: number, bidVol: number, askVol: number, delta: number }>
  delta: number
  volume: number
  poc: number

HeatmapFrame
  symbol: string
  ts: number
  levels: Array<{ price: number, size: number }>
```

## Proposed File Layout

Short term, matching existing repo:

```text
templates/partials/pages/orderflow.html
static/js/split/070_v6_orderflow_contract.js
static/js/split/071_v6_orderflow_store.js
static/js/split/072_v6_orderflow_mock.js
static/js/split/073_v6_orderflow_layout.js
static/js/split/074_v6_tape_panel.js
static/js/split/075_v6_dom_panel.js
static/js/split/076_v6_cvd_panel.js
static/js/split/077_v6_canvas_chart.js
static/css/split/070_v6_orderflow.css
```

Go engine:

```text
services/market-go/
  go.mod
  cmd/marketd/main.go
  internal/exchange/binance/
  internal/marketdata/
  internal/engine/
  internal/calc/
  internal/storage/
  internal/ws/
  internal/config/
  pkg/types/
```

Desktop later:

```text
apps/desktop/
```

## MVP Order

MVP 1:

1. Isolated `/orderflow` or `data-page="orderflow"` V6 surface.
2. Binance BTCUSDT public live trades through Go.
3. Tape live.
4. CVD and delta.
5. Trade-derived session VWAP.
6. DOM simple.
7. Simple chart.
8. Minimal persisted settings.

MVP 2:

1. Heatmap SD.
2. Footprint V1.
3. Volume profile.
4. Saved layouts.

MVP 3:

1. Journal AI connected to orderflow metrics.
2. Screenshots and market context snapshots.
3. Conversation stats.
4. Risk rules.

MVP 4:

1. Wails desktop packaging.
2. Multi-symbol.
3. Multi-exchange.
4. Advanced drawings.

## Phase 1 - Secure Existing App

Goal:

- Freeze a known-safe base before V6 implementation.

Actions:

- Create branch `feat/cockpit-v6-orderflow`.
- Check the dirty working tree with the user before committing anything.
- Verify Python environments:
  - Windows: `.venv/Scripts/python.exe`
  - WSL: `.venv_linux/bin/python`
- Run:
  - `.venv_linux/bin/python build.py`
  - `.venv_linux/bin/python -m unittest discover -s tests -v`
  - Windows equivalent if the Windows server is the browser target.
- Add docs:
  - `docs/DEV_SAFE_RULES.md`
  - `docs/CHANGELOG_V6.md`
- Do not change chart behavior unless a build/test blocker proves it necessary.

Verification command:

```bash
.venv_linux/bin/python build.py
.venv_linux/bin/python -m unittest discover -s tests -v
```

Risks:

- Current working tree is already dirty.
- Windows `.venv` may be broken or blocked locally.
- Existing encoding guardrails may flag pre-existing mojibake.

## Phase 2 - V6 Orderflow Surface, Mock Only

Goal:

- Add an isolated V6 terminal layout without touching the legacy chart behavior.

Recommended adaptation:

- Use the existing `data-page="orderflow"` navigation first.
- If a true `/orderflow` URL is needed, add a small Flask route that renders `index.html` and sets initial page state later.
- Keep old `066_orderflow_engine.js` intact unless explicitly replacing it.

UI:

- Chart area.
- Tape panel.
- DOM panel.
- Bottom CVD panel.
- Right settings panel.

Data:

- Mock only.
- No exchange connection.
- No Go engine yet.

Verification:

```bash
.venv_linux/bin/python build.py
.venv_linux/bin/python -m unittest tests.test_template_render -v
.venv_linux/bin/python -m unittest tests.test_js_bundle -v
```

Risks:

- Current `orderflow.html` and `066_orderflow_engine.js` already exist; avoid overlapping IDs.
- Existing app uses global variables and alphabetical module order.

## Phase 3 - Go Market Engine Foundation

Goal:

- Create a separate local Go process before desktop packaging.

Why before Wails:

- The repo has no Node/React desktop pipeline today.
- The main missing piece is reliable normalized market data.
- Wails integration is easier after the Go engine API is stable.

Actions:

- Create `services/market-go`.
- Implement `marketd`.
- Add config for symbols, starting with `BTCUSDT`.
- Add local WebSocket endpoint, for example `ws://127.0.0.1:8765/stream`.
- Add health endpoint if useful.
- Log cleanly.

Initial Binance data:

- Futures `aggTrade`.
- Depth later in the same engine.

Verification:

```bash
cd services/market-go
go test ./...
go run ./cmd/marketd
```

Risks:

- Network access to Binance can fail locally.
- Futures vs spot endpoint must be explicit.
- Keep API public and read-only.

## Phase 4 - Tape Live

Goal:

- First useful V6 tool: Time and Sales.

Backend:

- Normalize trades.
- Maintain ring buffer.
- Stream live trades.
- Snapshot latest trades endpoint or WS request/response.

Frontend:

- Tape panel.
- Pause/resume.
- Clear.
- `minQty`.
- `maxRows`.
- Optional aggregation window.
- Keep only bounded rows in UI memory.

Verification:

- Run Go engine.
- Open orderflow page.
- Confirm BTCUSDT live trades append without freezing.

Risks:

- React-style rerender loops do not apply because current frontend is vanilla, but DOM row churn is still a risk.
- Use batched DOM updates or Canvas/virtual list once row volume is high.

## Phase 5 - Delta And CVD

Goal:

- Move basic orderflow calculations into Go.

Backend:

- Build buckets for 1s, 5s, 1m, 5m.
- Calculate buyVol, sellVol, delta, cvd.
- Stream bucket updates.
- Support explicit reset session.

Frontend:

- CVD panel.
- Delta histogram.
- No coupling to legacy chart.

Verification:

```bash
cd services/market-go
go test ./...
```

Risks:

- Side semantics must be documented and tested.
- Existing JS orderflow code may have bid/ask naming ambiguity; do not copy it blindly.

## Phase 6 - Session VWAP

Goal:

- Trade-derived VWAP that does not depend on chart timeframe or visible candles.

Backend:

- `VWAPState` in Go.
- Daily UTC session first.
- Later daily local timezone and custom reset.
- Stream current VWAP and snapshots.

Frontend:

- Draw VWAP on V6 chart only.
- Add session settings later.

Verification:

- Same VWAP value across V6 timeframes.
- Manual reset produces expected new session state.

Risks:

- Existing `055_indicator_vwap_core.js` is candle-derived and should not be treated as final V6 VWAP.

## Phase 7 - DOM V1

Goal:

- Build a coherent Binance Futures local order book.

Backend:

- REST snapshot.
- Depth stream.
- Sequence/update ID validation.
- Resync on gap.
- Throttled snapshots, default 100ms or 250ms.

Frontend:

- DOM panel with bids, asks, cumulative size, spread.
- Size bars.

Verification:

- Best bid < best ask.
- Spread stable.
- Resync logged and recovered after forced disconnect.

Risks:

- Depth streams are more fragile than trades.
- Do not send every raw book update to the UI.

## Phase 8 - V6 Chart Foundation

Goal:

- Build chart rendering for orderflow without relying on Lightweight Charts overlays.

Approach:

- Canvas 2D custom chart first.
- Own time and price scales.
- Use existing `066a_orderflow_viewport.js` lessons but do not keep expanding the monolith.
- Keep renderer modules separated.

Renderers:

```text
CanvasRenderer
PriceScale
TimeScale
CVDRenderer
VWAPRenderer
FootprintRenderer
HeatmapRenderer
```

Verification:

- No conflict with `062_chart_page.js`.
- Pan/zoom and data updates remain smooth.

Risks:

- The current orderflow renderer is large; extraction should be incremental.

## Phase 9 - Heatmap SD

Goal:

- Simple depth heatmap from throttled order book snapshots.

Backend:

- Emit `HeatmapFrame`.
- Keep bounded in-memory window.
- Batch frames to UI.

Frontend:

- Canvas 2D renderer.
- Time on X, price on Y, size intensity.

Verification:

- Several minutes of BTCUSDT heatmap without UI freeze.

Risks:

- Too many rectangles.
- Needs aggressive culling by visible time/price.

## Phase 10 - Footprint V1

Goal:

- Footprint candles from normalized trades.

Backend:

- Bucket trades by candle interval.
- Bucket by tick size.
- Calculate bidVol, askVol, delta, totalVol, POC, imbalance.

Frontend:

- Canvas 2D levels inside candles.
- Settings for tick grouping, min volume, imbalance threshold.

Verification:

- Footprint totals match tape/trade buckets.

Risks:

- Side naming must be consistent:
  - aggressor buy volume vs ask-side volume
  - aggressor sell volume vs bid-side volume
- Pick names once and document them.

## Phase 11 - Volume Profile

Goal:

- Session profile useful for daily trading.

Backend:

- Volume by price.
- POC.
- VAH/VAL at 70 percent.

Frontend:

- Right-side profile.
- POC/VAH/VAL labels.

Verification:

- Profile total matches session volume bucket totals.

## Phase 12 - Drawings V6

Goal:

- Serious drawings for the V6 chart, independent from Lightweight Charts.

Actions:

- New DrawingEngine for V6.
- SQLite persistence.
- Horizontal line, ray, trendline, rectangle first.
- Anchored VWAP later.

Verification:

- Drawings reload correctly.
- No visible coordinate drift while zooming/panning.

Risks:

- Do not reuse the current LWC overlay coordinate model as the final V6 drawing model.

## Phase 13 - Journal AI Orderflow Context

Goal:

- Connect trades to market context snapshots.

Storage additions:

```text
metrics_snapshots
ai_actions
rules
orderflow_sessions
v6_layouts
```

AI rules:

- Cite local data used.
- Ask confirmation before destructive edits.
- User provides their own AI key.
- Store actions/audit trail.

Verification:

- AI can answer from actual trades and saved metrics snapshots.
- Sensitive changes require confirmation.

Risks:

- Do not let AI depend on transient UI-only state.
- Store snapshot IDs and source ranges.

## Phase 14 - Desktop Packaging

Goal:

- Local desktop app without manual server startup.

Recommended timing:

- After Go market engine and V6 frontend contract are stable.

Likely approach:

- Wails app in `apps/desktop`.
- Reuse Go market engine package.
- Launch/embed existing frontend.
- Keep SQLite user data in OS-specific user data dir.

Verification:

- Windows local build launches UI.
- Go bridge method `GetAppInfo()` works.
- Data path is not inside source repo by default for packaged app.

Risks:

- Packaging too early will multiply debugging surfaces.

## Phase 15 - Multi-Exchange

Exchange adapter interface:

```text
ConnectTrades(symbol)
ConnectOrderBook(symbol)
GetSnapshot(symbol)
NormalizeSymbol(symbol)
Close()
```

Order:

1. Binance Futures.
2. Bybit Futures.
3. OKX.
4. Hyperliquid.

Rule:

- All adapters produce the same internal types.

## Phase 16 - Performance Pass

Measure:

- UI FPS.
- Go CPU/RAM.
- Browser RAM.
- Messages per second.
- Exchange to engine latency.
- Engine to UI latency.
- Render time.
- Dropped frames.

Actions:

- Add metrics endpoint in Go.
- Add debug overlay in V6 UI.
- Use ring buffers.
- Batch UI updates.
- Avoid massive DOM updates.
- Use Canvas refs/state outside high-frequency UI rerender paths.

## Phase 17 - Release/Packaging

Goal:

- Free local app distribution.

Actions:

- Windows build.
- Local installer later.
- Export/import config.
- SQLite backup.
- Install docs.

## Verification Matrix

Current app:

```bash
.venv_linux/bin/python build.py
.venv_linux/bin/python -m unittest discover -s tests -v
```

Frontend bundle:

```bash
node --check static/app.js
```

Go engine:

```bash
cd services/market-go
go test ./...
go run ./cmd/marketd
```

Manual browser checks:

- Dashboard still loads.
- Journal CRUD still works.
- Chart page still loads.
- Orderflow page loads.
- No console errors on page switch.

## Immediate Next Step

Start Phase 1 only after user approval:

1. Create branch `feat/cockpit-v6-orderflow`.
2. Resolve/confirm current dirty tree ownership.
3. Verify build/tests.
4. Add `docs/DEV_SAFE_RULES.md`.
5. Add `docs/CHANGELOG_V6.md`.

