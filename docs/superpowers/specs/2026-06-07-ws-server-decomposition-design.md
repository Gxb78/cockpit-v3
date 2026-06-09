# ws.Server decomposition — design

**Date:** 2026-06-07
**Status:** Approved (sections A/B/C validated)
**Type:** Pure refactor, behavior-preserving, incremental.

## Problem

`services/market-go/internal/ws/server.go` is a 2000-line god object. A single
`Server` struct concentrates seven unrelated responsibilities: HTTP/WebSocket
stream front, exchange lifecycle/switching, replay, kline backfill, trade
storage, footprint persistence/rebuild, and the CVD-per-symbol map. State and
methods for all of these share one type, making the file hard to reason about,
test, and change safely.

## Goal & constraints

- **Behavior-preserving.** No functional change. Existing tests (Go:
  `calc/ws/engine/config`, incl. `persist_footprint_test.go`, `cors_test.go`;
  Python orderflow/template/settings suite) stay green throughout.
- **Incremental.** One component extracted per step; `go build ./... &&
  go vet ./... && go test ./...` + Python suite green between every step.
- **Same package.** Each responsibility becomes a focused type in its own file
  under `internal/ws` (no new sub-packages → no import cycles). `Server` becomes
  a thin orchestrator that constructs and wires the components.

## A. Component set (dedicated types in `ws`)

| Component (file) | Absorbs | Owned state |
|---|---|---|
| **Server** (`server.go`, slimmed) — HTTP/stream front + orchestrator | `Handler`, `resolveAllowedOrigin`, `handleStream`, `handleHealth/Metrics`, `readUntilClose`, `handleClientMessage`, `mockLoop`, `Run` (wiring) | `hub`, history cache (`historyRaw/Mu`), refs to components |
| **exchangeManager** (`exchange_manager.go`) | `startExchange`, `switchExchange`, `startHyperliquid/Binance`, `throttledBookHandler` | `exchangeCancel/Mu`, `rootCtx` |
| **replayController** (`replay_controller.go`) | `replayEmit`, `replayStatus`, `handleReplay` | `player` |
| **klineBackfiller** (`kline_backfiller.go`) | `runBackfill`, `runBinanceBackfill`, `backfillIntervalWithCache`, `deriveFromOneMin`, `trimKlinesByAge` | `klineCache` |
| **tradeStore** (`trade_store.go`) | `recordTrade`(→`Record`), `fetch{Binance,Hyperliquid}RecentTrades`, `backfillTrades`, `loadPersistedTrades`, `periodicPurge` | `trades/Mu`, `tradeCache`, `sqlDB` (trades) |
| **footprintStore** (`footprint_store.go`) | `persistFootprintCandle`, `RebuildFootprint1m`, `AggregateFootprintTF` | `sqlDB` (footprints) |
| **cvdTracker** (`cvd_tracker.go`) | `tryBroadcastCvdInit`, `computeSizeCvdHistory`, `Accumulate/Get` | `cvdBySymbol/Mu` |

The public `Server` API is preserved: `NewServer`, `Run`, `Handler`,
`RebuildFootprint1m`, `AggregateFootprintTF` (the last two delegate to
`footprintStore`). `footprint_api.go` HTTP handlers stay as-is, reading through
the footprint store / sqlDB.

## B. Interfaces & shared state

- **Broadcast:** inject a `broadcaster` interface (`Broadcast([]byte)`),
  satisfied by `*Hub`, into every component that emits envelopes.
- **recordTrade:** `tradeStore.Record(trade)` — called by exchangeManager,
  replayController, and `backfillTrades`.
- **CVD ownership:** `cvdTracker` owns the map. `footprintStore` calls
  `cvdTracker.Accumulate(symbol, delta)` (currently inlined in
  `persistFootprintCandle`). `cvdTracker.computeSizeCvdHistory` reads recent
  trades via `tradeStore` + `sqlDB`. (`recordTrade` does NOT touch CVD — verified.)
- **Wiring:** `NewServer`/`Run` builds `sqlDB` + caches, then constructs the
  components with explicit dependency injection. No cycles (one package).

## C. Extraction order (one step each; build + tests green between)

1. `cvdTracker` (owns the map; footprint persist calls it)
2. `tradeStore` (trades + persistence + recent-trade fetch + purge)
3. `footprintStore` (persist/rebuild/aggregate; depends on cvdTracker)
4. `klineBackfiller`
5. `replayController`
6. `exchangeManager` (depends on tradeStore/klineBackfiller/cvdTracker)
7. `Server` slimmed to orchestrator + stream front

**Test gate per step:** `go build ./... && go vet ./... && go test ./...` plus
the Python suite (`-k "orderflow or template or settings or routes or cors or
transport"`). A step is complete only when all are green.

## Non-goals (YAGNI)

- No behavioral fixes (goroutine leaks, lock changes, error handling) — pure
  structural move only.
- No new sub-packages.
- No change to `footprint_api.go`, `aggregate.go`, `hub.go`, `kline_cache.go`,
  `trade_cache.go` public shapes beyond what wiring requires.
- No change to the wire protocol or any emitted envelope.
