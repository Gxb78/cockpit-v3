# Cockpit V6 Go Market Engine

Phase 3 added a local Go service foundation under `services/market-go`.
Phase 4 adds the first live adapter: Hyperliquid public read-only trades.
Phase 5 adds trade-derived Delta/CVD buckets inside the Go engine.
Phase 6 adds trade-derived session VWAP inside the Go engine.

The service is independent from Flask and the existing browser chart. It does not import the Journal backend and does not modify Flask routes. The V6 Orderflow UI auto-connects to the local engine when the shell mounts.

## Structure

```text
services/market-go/
  go.mod
  cmd/marketd/main.go
  cmd/streamcheck/main.go
  internal/config/config.go
  internal/logx/logx.go
  internal/ws/server.go
  internal/ws/hub.go
  internal/engine/engine.go
  internal/calc/delta.go
  internal/calc/delta_test.go
  internal/calc/session.go
  internal/calc/session_test.go
  internal/calc/vwap.go
  internal/calc/vwap_test.go
  internal/exchange/exchange.go
  internal/exchange/binance/placeholder.go
  internal/exchange/hyperliquid/client.go
  internal/exchange/hyperliquid/types.go
  internal/exchange/hyperliquid/normalize.go
  internal/marketdata/types.go
  pkg/protocol/envelope.go
```

## Commands

From `services/market-go`:

```powershell
go mod tidy
gofmt -w .
go test ./...
go run ./cmd/marketd
```

Default server:

```text
http://127.0.0.1:8765
```

Environment config:

```text
MARKET_GO_HOST=127.0.0.1
MARKET_GO_PORT=8765
MARKET_GO_SYMBOLS=BTCUSDT,ETHUSDT
MARKET_GO_MOCK_MODE=true
MARKET_GO_VERSION=0.4.5-phase4.5
MARKET_GO_EXCHANGE=mock
MARKET_GO_HL_WS_URL=wss://api.hyperliquid.xyz/ws
MARKET_GO_DELTA_INTERVALS=1000,5000,60000
MARKET_GO_SESSION_RESET=utc_day
MARKET_GO_VWAP_ENABLED=true
MARKET_GO_VWAP_SESSION=utc_day
MARKET_GO_VWAP_EMIT_MS=250
```

Hyperliquid live trades:

```powershell
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
go run ./cmd/marketd
```

Default Hyperliquid symbols are coin names such as `BTC`, `ETH`, and `SOL`, not Binance-style pairs like `BTCUSDT`.

## Endpoints

### `GET /health`

Returns JSON:

```json
{
  "ok": true,
  "service": "cockpit-v6-market-go",
  "version": "0.4.5-phase4.5",
  "time": "2026-05-29T16:00:00Z"
}
```

### `GET /metrics`

Returns runtime metrics for the local engine and stream fanout:

```json
{
  "service": "cockpit-v6-market-go",
  "exchange": "hyperliquid",
  "symbols": ["BTC"],
  "mockMode": false,
  "connected": true,
  "uptimeSeconds": 600,
  "totalMessagesIn": 1200,
  "totalTradesOut": 950,
  "totalDeltaBucketsOut": 400,
  "totalVWAPOut": 100,
  "totalStreamClients": 1,
  "activeDeltaIntervals": [1000, 5000, 60000],
  "currentSessionId": "utc_day:2026-05-29",
  "currentSessionStart": 1780012800000,
  "vwapEnabled": true,
  "vwapSession": "utc_day",
  "lastTradeTsExchange": 1760000000000,
  "lastTradeTsLocal": 1760000000001,
  "lastDeltaTsLocal": 1760000000001,
  "lastVWAPTsLocal": 1760000000001,
  "lastError": "",
  "reconnectCount": 0,
  "cvdBySymbol": {"BTC": 12.58},
  "vwapBySymbol": {"BTC": 73405.5},
  "vwapCoverageStartBySymbol": {"BTC": 1760001234567},
  "vwapIsWarmBySymbol": {"BTC": false}
}
```

### `GET /stream`

Local WebSocket endpoint.

In Phase 3, mock mode sends internal messages only:

- `heartbeat`
- `trade_mock`

In mock mode, no Binance, Hyperliquid, Bybit, OKX, or browser UI stream is connected.

In Phase 4, when `MARKET_GO_MOCK_MODE=false` and `MARKET_GO_EXCHANGE=hyperliquid`, `/stream` emits normalized `trade` envelopes from Hyperliquid public trades:

```json
{
  "type": "trade",
  "seq": 234,
  "tsLocal": 1780080091213,
  "payload": {
    "id": "1780080091036:BTC:118892860642748",
    "tradeId": "1780080091036:BTC:118892860642748",
    "exchange": "hyperliquid",
    "symbol": "BTC",
    "tsExchange": 1780080091036,
    "tsLocal": 1780080091213,
    "price": 73783,
    "qty": 0.0007,
    "side": "buy",
    "notional": 51.6481
  }
}
```

In Phase 5, each normalized trade also updates Go-side Delta/CVD buckets. `/stream` continues emitting raw `trade` envelopes and additionally emits `delta_bucket` envelopes:

```json
{
  "type": "delta_bucket",
  "seq": 123,
  "tsLocal": 1760000000000,
  "payload": {
    "exchange": "hyperliquid",
    "symbol": "BTC",
    "intervalMs": 1000,
    "startTime": 1760000000000,
    "endTime": 1760000001000,
    "buyVol": 1.23,
    "sellVol": 0.82,
    "delta": 0.41,
    "cvd": 12.58,
    "closed": false
  }
}
```

Live bucket updates are throttled to avoid excessive stream fanout. Closed buckets are emitted when a trade rolls into a new bucket.

In Phase 6, each normalized trade also updates Go-side session VWAP. `/stream` continues emitting raw `trade` and `delta_bucket` envelopes and additionally emits throttled `vwap` envelopes:

```json
{
  "type": "vwap",
  "seq": 123,
  "tsLocal": 1760000000000,
  "payload": {
    "exchange": "hyperliquid",
    "symbol": "BTC",
    "sessionId": "utc_day:2026-05-29",
    "sessionStart": 1760000000000,
    "coverageStart": 1760001234567,
    "lastUpdateTs": 1760002345678,
    "cumPV": 123456.78,
    "cumVol": 12.34,
    "value": 73405.5,
    "source": "live",
    "isWarm": false
  }
}
```

`sessionStart` is the theoretical session start, currently `00:00 UTC` for `utc_day`. `coverageStart` is the first trade actually observed by the running engine. Until historical backfill is added, `source` is `"live"` and `isWarm` is `false`; the engine must not be treated as a complete VWAP from midnight if it started later.

Manual stdlib-only upgrade check used in Phase 3.5:

```powershell
$client = [Net.Sockets.TcpClient]::new()
$client.Connect('127.0.0.1', 8765)
$stream = $client.GetStream()
$key = 'dGhlIHNhbXBsZSBub25jZQ=='
$req = "GET /stream HTTP/1.1`r`nHost: 127.0.0.1:8765`r`nUpgrade: websocket`r`nConnection: Upgrade`r`nSec-WebSocket-Key: $key`r`nSec-WebSocket-Version: 13`r`n`r`n"
$bytes = [Text.Encoding]::ASCII.GetBytes($req)
$stream.Write($bytes, 0, $bytes.Length)
$reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
$headers = @()
while (($line = $reader.ReadLine()) -ne $null) {
  if ($line -eq '') { break }
  $headers += $line
}
$client.Close()
$headers -join "`n"
```

Expected response:

```text
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

Preferred stream check after Phase 5:

```powershell
go run ./cmd/streamcheck -trades 20 -timeout 60s
```

Expected output shape:

```text
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=32 trades=20 deltaBuckets=9 vwaps=2 elapsed=2.066s lastTrade=hyperliquid BTC 0.00017000 @ 73593.00 side=sell lastDelta=hyperliquid BTC intervalMs=60000 delta=15.58010000 cvd=15.58010000 closed=false lastVWAP=hyperliquid BTC value=73587.22164928 coverageStart=1780083303827 isWarm=false cumPV=1481310.77180000 cumVol=20.13000000
```

## Protocol Envelope

All stream messages use:

```json
{
  "type": "trade_mock",
  "seq": 1,
  "tsLocal": 1760000000000,
  "payload": {}
}
```

The Go market data types mirror the Phase 2 JS contracts:

- `Trade`
- `OrderBookLevel`
- `OrderBookSnapshot`
- `Candle`
- `DeltaBucket`
- `VWAPState`
- `FootprintCandle`
- `HeatmapFrame`

## Hyperliquid Adapter

The Hyperliquid adapter is public read-only:

- WebSocket URL: `wss://api.hyperliquid.xyz/ws`
- Subscription:

```json
{
  "method": "subscribe",
  "subscription": {
    "type": "trades",
    "coin": "BTC"
  }
}
```

It does not use auth, wallets, order placement, private endpoints, or exchange/trading methods.

### Side Convention

Hyperliquid trade messages use `side` values from Hyperliquid notation. The adapter documents and tests this mapping:

- `B` / `Bid` / `Buy` -> `buy`
- `A` / `Ask` / `Sell` / `Short` -> `sell`

For trades, this is treated as the aggressing side, matching the existing Hyperliquid analytics convention in the repo. Unknown side values are rejected by `NormalizeSide()` and logged instead of being guessed silently.

### Normalized Trade

Raw Hyperliquid trades are normalized to:

```json
{
  "exchange": "hyperliquid",
  "symbol": "BTC",
  "tradeId": "time:coin:tid",
  "tsExchange": 1760000000000,
  "tsLocal": 1760000000001,
  "price": 100000,
  "qty": 0.01,
  "side": "buy",
  "notional": 1000
}
```

`px` and `sz` are parsed from strings to `float64`. `tid` is preferred for `tradeId`; when absent, the adapter falls back to `hash`, then to `time:coin`.

## Delta / CVD Buckets

Delta and CVD are calculated inside Go from normalized trades, before the UI sees the stream:

- `buyVol` increments when `trade.side == "buy"`.
- `sellVol` increments when `trade.side == "sell"`.
- `delta = buyVol - sellVol`.
- `cvd` is the cumulative sum of bucket deltas since the current session reset.
- Unknown sides are ignored without panicking.

Supported intervals are configured by `MARKET_GO_DELTA_INTERVALS`. The default is:

```text
1000,5000,60000
```

Session reset currently supports:

```text
MARKET_GO_SESSION_RESET=utc_day
```

`utc_day` resets CVD at `00:00 UTC`. The session structure is ready for future `manual` and `custom_time` modes, but those are not implemented in Phase 5.

## Trade-Derived VWAP

VWAP is calculated inside Go from normalized trades:

```text
cumPV += price * qty
cumVol += qty
value = cumPV / cumVol
```

The calculation ignores trade side. Both buy and sell trades contribute by price and quantity only.

Current config:

```text
MARKET_GO_VWAP_ENABLED=true
MARKET_GO_VWAP_SESSION=utc_day
MARKET_GO_VWAP_EMIT_MS=250
```

Phase 6 supports only `utc_day`, resetting at `00:00 UTC`. On reset, `cumPV`, `cumVol`, and `value` are cleared and the next observed trade becomes the new `coverageStart`.

Important live-only limitation:

- `sessionStart` is the theoretical session start.
- `coverageStart` is the first trade actually observed by this running process.
- `source` is `"live"`.
- `isWarm` is `false`.
- There is no historical backfill yet, so VWAP is not complete from session start unless the engine was running since session start.

Invalid trades with zero, negative, NaN, or infinite price/quantity are ignored without panic. If cumulative volume is zero, no invalid division is produced.

## Why Separate From Flask

Flask remains the Journal and existing local web app backend.

The Go service is separated so high-frequency orderflow work can use:

- goroutines and channels
- local WebSocket fanout
- exchange adapters
- ring buffers
- later storage and performance metrics

This avoids coupling high-frequency market data to the existing Journal request/response routes.

## Connecting the V6 UI (Phase 7)

Phase 7 connects the Tape V6 panel to the local `/stream`. The `delta_bucket` and `vwap` messages are counted in the UI but not fully displayed in their panels yet.

## UI Shell (Phase 16)

Phase 16 introduces a dedicated UI shell for the V6 Orderflow page to reorganize the layout into a TradingView-like surface (top toolbar, left tools, central chart, right Tape/DOM, bottom Delta/VWAP). This change is purely presentational and does not modify the Go engine, exchange adapters, or Flask routes. The shell auto-connects to the local Go engine on mount; the header control remains available for disconnect/reconnect.


### Procedure

1. Start `marketd` in one terminal:

```powershell
cd services/market-go
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
$env:MARKET_GO_VWAP_ENABLED='true'
$env:MARKET_GO_VWAP_SESSION='utc_day'
go run ./cmd/marketd
```

2. Verify the engine is running:

```powershell
curl http://127.0.0.1:8765/health
curl http://127.0.0.1:8765/metrics
```

3. Start Flask in another terminal:

```powershell
$env:PORT='5001'; $env:OPEN_BROWSER='0'; .\.venv\Scripts\python.exe app.py
```

4. In the browser:

- Go to `http://127.0.0.1:5001/`
- Navigate to `Orderflow`
- The page auto-connects to the local engine
- The status dot turns green and the Tape V6 panel shows live Hyperliquid trades
- Counters in the engine bar show trades/deltas/vwaps received
- Click **Disconnect** to stop the stream

### UI Controls

- **Disconnect** / **Reconnect**: controls the auto-connected local engine stream
- **Pause** / **Resume**: stops tape render updates but keeps buffering trades
- **Clear tape**: removes all trades from the buffer and UI
- **Min qty**: filters trades below a quantity threshold
- **Max tape rows**: limits displayed rows (up to 500)

### Connection Behavior

- The WebSocket auto-connects to `window.COCKPIT_CONFIG.marketWsUrl` when the V6 Orderflow shell mounts
- Flask injects `marketWsUrl` from `COCKPIT_MARKET_WS_URL`, or derives it from `MARKET_GO_HOST`/`MARKET_GO_PORT` when no explicit URL is set
- If `marketd` is not running, the connection fails gracefully and the UI stays functional with mock data
- If the connection drops, the UI displays an error status and attempts reconnection with exponential backoff (max 8 attempts)
- Trade buffer is capped at 500 entries
- Batch rendering uses `requestAnimationFrame` + coalesced timeout to avoid excessive DOM updates

### Message Handling

- `type:"trade"` messages are displayed in the Tape V6
- `type:"delta_bucket"` messages are counted but not displayed in the CVD panel yet
- `type:"vwap"` messages are counted but not displayed in the chart yet
- `type:"heartbeat"` messages update the last message timestamp

## Next Step

Phase 8 should either display CVD/Delta/VWAP live data in the V6 panels, or add Hyperliquid `l2Book`/DOM in Go before connecting more panels.

## Phase 3.5 Validation

Validated on Windows PowerShell:

```text
go version go1.26.3 windows/amd64
C:\Program Files\Go\bin\go.exe
GOPATH=C:\Users\gb781\go
GOROOT=C:\Program Files\Go
```

Results:

- `go mod tidy`: OK.
- `gofmt -w .`: OK.
- `go test ./...`: OK.
- `go run ./cmd/marketd`: OK.
- `GET /health`: HTTP 200 with `ok=true`.
- `/stream`: WebSocket upgrade returns HTTP 101.

Go commands may need access to the Go build cache under `%LOCALAPPDATA%\go-build` on Windows.

## Phase 4 Validation

Validated on Windows PowerShell:

```text
go mod tidy: OK
gofmt -w .: OK
go test ./...: OK
```

Live run:

```text
MARKET_GO_EXCHANGE=hyperliquid
MARKET_GO_SYMBOLS=BTC
MARKET_GO_MOCK_MODE=false
go run ./cmd/marketd
```

Observed logs:

```text
[market-go] 2026/05/29 20:40:27.814118 INFO listening on http://127.0.0.1:8765 exchange=hyperliquid mockMode=false symbols=BTC
[market-go] 2026/05/29 20:40:28.857744 INFO hyperliquid websocket connected url=wss://api.hyperliquid.xyz/ws
[market-go] 2026/05/29 20:40:28.860104 INFO hyperliquid subscribed trades symbol=BTC url=wss://api.hyperliquid.xyz/ws
```

Health check:

```text
GET http://127.0.0.1:8765/health
HTTP 200
{"ok":true,"service":"cockpit-v6-market-go","version":"0.4.0-phase4","time":"2026-05-29T18:41:02.1712961Z"}
```

Local stream check:

```text
GET /stream
HTTP/1.1 101 Switching Protocols
```

Sample live trade envelope received from `/stream`:

```json
{
  "type": "trade",
  "seq": 234,
  "tsLocal": 1780080091213,
  "payload": {
    "id": "1780080091036:BTC:118892860642748",
    "tradeId": "1780080091036:BTC:118892860642748",
    "exchange": "hyperliquid",
    "symbol": "BTC",
    "tsExchange": 1780080091036,
    "tsLocal": 1780080091213,
    "price": 73783,
    "qty": 0.0007,
    "side": "buy",
    "notional": 51.6481
  }
}
```

The V6 UI remains mock-only and is not connected to this stream.

## Phase 4.5 Validation

Phase 4.5 added:

- `GET /metrics`
- runtime counters for exchange connection, inbound messages, outbound trades, stream clients, last trade timestamps, last error, and reconnect count
- `cmd/streamcheck`, a stdlib-only local WebSocket checker for `/stream`
- cleaner logs for connection, subscription, periodic trade receipt, disconnect/reconnect, and stream client connect/disconnect

Stability command:

```powershell
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
go run ./cmd/marketd
```

Initial metrics:

```json
{
  "service": "cockpit-v6-market-go",
  "exchange": "hyperliquid",
  "symbols": ["BTC"],
  "mockMode": false,
  "connected": true,
  "uptimeSeconds": 24,
  "totalMessagesIn": 49,
  "totalTradesOut": 197,
  "totalStreamClients": 0,
  "lastTradeTsExchange": 1780080717127,
  "lastTradeTsLocal": 1780080717405,
  "lastError": "",
  "reconnectCount": 0
}
```

Stream checker:

```text
go run ./cmd/streamcheck -trades 20 -timeout 60s
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=21 trades=20 elapsed=1.217s last=hyperliquid BTC 0.00017000 @ 73187.00 side=buy
```

Final metrics after a 688 second live run:

```json
{
  "service": "cockpit-v6-market-go",
  "exchange": "hyperliquid",
  "symbols": ["BTC"],
  "mockMode": false,
  "connected": true,
  "uptimeSeconds": 688,
  "totalMessagesIn": 1730,
  "totalTradesOut": 9338,
  "totalStreamClients": 0,
  "lastTradeTsExchange": 1780081381097,
  "lastTradeTsLocal": 1780081381305,
  "lastError": "",
  "reconnectCount": 0
}
```

Result:

- live stream stayed connected for more than 10 minutes
- `totalTradesOut` increased continuously
- no panic
- no reconnect loop
- `reconnectCount` stayed at `0`
- stream clients connected and disconnected cleanly
- `marketd` was stopped by exact PID after validation

## Phase 5 Validation

Phase 5 added:

- Go-side Delta/CVD bucket calculation from normalized Hyperliquid trades.
- `MARKET_GO_DELTA_INTERVALS`.
- `MARKET_GO_SESSION_RESET=utc_day`.
- `delta_bucket` stream envelopes.
- Delta/CVD metrics on `GET /metrics`.
- `streamcheck` support for counting `trade` and `delta_bucket` messages.

Live command:

```powershell
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
go run ./cmd/marketd
```

Stream checker:

```text
Command: go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=40 trades=20 deltaBuckets=19 elapsed=2.667s lastTrade=hyperliquid BTC 0.00014000 @ 73217.00 side=buy lastDelta=hyperliquid BTC intervalMs=60000 delta=7.17601000 cvd=1.23205000 closed=false
```

Final metrics after a 331 second live run:

```json
{
  "service": "cockpit-v6-market-go",
  "exchange": "hyperliquid",
  "symbols": ["BTC"],
  "mockMode": false,
  "connected": true,
  "uptimeSeconds": 331,
  "totalMessagesIn": 511,
  "totalTradesOut": 1893,
  "totalDeltaBucketsOut": 1454,
  "totalStreamClients": 0,
  "activeDeltaIntervals": [1000, 5000, 60000],
  "currentSessionId": "utc_day:2026-05-29",
  "currentSessionStart": 1780012800000,
  "lastTradeTsExchange": 1780082650382,
  "lastTradeTsLocal": 1780082650505,
  "lastDeltaTsLocal": 1780082650505,
  "lastError": "",
  "reconnectCount": 0,
  "cvdBySymbol": {"BTC": 7.976820000000014}
}
```

Result:

- live stream stayed connected for more than 5 minutes
- raw `trade` envelopes continued to stream
- `delta_bucket` envelopes streamed in addition to trades
- CVD evolved during the run
- `connected` stayed `true`
- `reconnectCount` stayed at `0`
- no panic was observed
- `marketd` was stopped by exact PID after validation

## Phase 6 Validation

Phase 6 added:

- trade-derived session VWAP calculation from normalized Hyperliquid trades
- `MARKET_GO_VWAP_ENABLED=true`
- `MARKET_GO_VWAP_SESSION=utc_day`
- `MARKET_GO_VWAP_EMIT_MS=250`
- `vwap` stream envelopes
- VWAP metrics on `GET /metrics`
- `streamcheck` support for counting `trade`, `delta_bucket`, and `vwap` messages

Live command:

```powershell
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
$env:MARKET_GO_VWAP_ENABLED='true'
$env:MARKET_GO_VWAP_SESSION='utc_day'
go run ./cmd/marketd
```

Stream checker:

```text
Command: go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=32 trades=20 deltaBuckets=9 vwaps=2 elapsed=2.066s lastTrade=hyperliquid BTC 0.00017000 @ 73593.00 side=sell lastDelta=hyperliquid BTC intervalMs=60000 delta=15.58010000 cvd=15.58010000 closed=false lastVWAP=hyperliquid BTC value=73587.22164928 coverageStart=1780083303827 isWarm=false cumPV=1481310.77180000 cumVol=20.13000000
```

Final metrics after a 336 second live run:

```json
{
  "service": "cockpit-v6-market-go",
  "exchange": "hyperliquid",
  "symbols": ["BTC"],
  "mockMode": false,
  "connected": true,
  "uptimeSeconds": 336,
  "totalMessagesIn": 630,
  "totalTradesOut": 2746,
  "totalDeltaBucketsOut": 1589,
  "totalVWAPOut": 407,
  "totalStreamClients": 0,
  "activeDeltaIntervals": [1000, 5000, 60000],
  "currentSessionId": "utc_day:2026-05-29",
  "currentSessionStart": 1780012800000,
  "vwapEnabled": true,
  "vwapSession": "utc_day",
  "lastTradeTsExchange": 1780083642396,
  "lastTradeTsLocal": 1780083642718,
  "lastDeltaTsLocal": 1780083642718,
  "lastVWAPTsLocal": 1780083642718,
  "lastError": "",
  "reconnectCount": 0,
  "cvdBySymbol": {"BTC": 74.24602000000004},
  "vwapBySymbol": {"BTC": 73649.29354394738},
  "vwapCoverageStartBySymbol": {"BTC": 1780083303827},
  "vwapIsWarmBySymbol": {"BTC": false}
}
```

Result:

- live stream stayed connected for more than 5 minutes
- raw `trade` envelopes continued to stream
- `delta_bucket` envelopes continued to stream
- `vwap` envelopes streamed in addition to trades and delta
- VWAP evolved during the run
- `cumPV` and `cumVol` increased
- `isWarm` stayed `false`, correctly reflecting live-only/no-backfill coverage
- `connected` stayed `true`
- `reconnectCount` stayed at `0`
- no NaN, panic, or reconnect loop was observed
- `marketd` was stopped by exact PID after validation

## Phase 8a UI Consumption Notes

Phase 8a connects the existing V6 browser surface to the already available local engine messages. It does not add new engine endpoints and does not connect the UI directly to Hyperliquid or Binance.

Auto UI connection:

- The user starts `marketd` manually.
- The user opens the Flask app manually.
- The user opens the V6 Orderflow page; the shell auto-connects to the local engine.
- The V6 UI opens one local WebSocket only, using `window.COCKPIT_CONFIG.marketWsUrl`

Consumed envelope types:

- `trade`
- `delta_bucket`
- `vwap`

`delta_bucket` UI handling:

- The V6 store keeps a bounded bucket history per interval.
- Supported display intervals are:
  - `1000` ms
  - `5000` ms
  - `60000` ms
- The selected interval defaults to `60000`.
- The panel displays:
  - symbol
  - selected interval
  - buy volume
  - sell volume
  - delta
  - CVD
  - closed state
  - last update time
- The panel also renders a small bounded delta histogram from the latest received buckets.

`vwap` UI handling:

- The V6 store keeps the latest VWAP state by symbol.
- The panel displays:
  - symbol
  - VWAP value
  - session ID
  - session start
  - coverage start
  - source
  - warm state
  - cumulative volume
  - last update time
- When `isWarm=false`, the UI shows:
  - `Live-only VWAP, not fully warmed from session start.`

Important VWAP limitation:

- `sessionStart` is the theoretical session start, currently the UTC day boundary.
- `coverageStart` is the first trade observed by the running Go engine.
- With `source:"live"` and `isWarm:false`, the VWAP is not a full session VWAP unless the engine started at the session boundary.
- Historical backfill is not implemented yet, so the UI must not describe this value as fully warmed from 00:00 UTC.

Outage behavior:

- If `marketd` stops, the V6 page keeps the last Delta/CVD and VWAP values visible.
- The connection status changes to connecting/error.
- The page does not crash.
- Reconnection is handled by the V6 engine client with capped exponential backoff.

## Phase 9 Hyperliquid l2Book

Phase 9 adds Hyperliquid public read-only `l2Book` ingestion on the Go side. Phase 10 connects the V6 DOM panel to the normalized `order_book` envelopes from the local stream.

Subscription:

```json
{
  "method": "subscribe",
  "subscription": {
    "type": "l2Book",
    "coin": "BTC"
  }
}
```

Hyperliquid book convention:

- `levels[0]` is bids.
- `levels[1]` is asks.
- `px` is parsed as price.
- `sz` is parsed as size.
- `n` is mapped to order count.
- `time` is mapped to `tsExchange`.

Config:

```powershell
$env:MARKET_GO_BOOK_ENABLED='true'
$env:MARKET_GO_BOOK_DEPTH='20'
$env:MARKET_GO_BOOK_EMIT_MS='250'
```

Live command with book:

```powershell
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
$env:MARKET_GO_VWAP_ENABLED='true'
$env:MARKET_GO_VWAP_SESSION='utc_day'
$env:MARKET_GO_BOOK_ENABLED='true'
$env:MARKET_GO_BOOK_DEPTH='20'
$env:MARKET_GO_BOOK_EMIT_MS='250'
go run ./cmd/marketd
```

`order_book` envelope:

```json
{
  "type": "order_book",
  "seq": 123,
  "tsLocal": 1760000000000,
  "payload": {
    "exchange": "hyperliquid",
    "symbol": "BTC",
    "tsExchange": 1760000000000,
    "tsLocal": 1760000000001,
    "bids": [
      { "price": 73500.0, "size": 1.23, "orders": 4, "cumulative": 1.23 }
    ],
    "asks": [
      { "price": 73501.0, "size": 0.82, "orders": 3, "cumulative": 0.82 }
    ],
    "bestBid": 73500.0,
    "bestAsk": 73501.0,
    "spread": 1.0,
    "mid": 73500.5,
    "depth": 20,
    "source": "l2Book"
  }
}
```

Throttling:

- `MARKET_GO_BOOK_EMIT_MS` defaults to `250`.
- If Hyperliquid sends book updates faster than the emit interval, the engine keeps only the latest pending snapshot.
- Invalid levels are skipped.
- Empty bid or ask sides are accepted without panic.

Book metrics:

- `bookEnabled`
- `totalOrderBookOut`
- `lastBookTsExchange`
- `lastBookTsLocal`
- `orderBookDepthBySymbol`
- `bestBidBySymbol`
- `bestAskBySymbol`
- `spreadBySymbol`
- `midBySymbol`

Stream checker:

```powershell
go run ./cmd/streamcheck -trades 20 -timeout 60s
```

The checker now counts:

- `trade`
- `delta_bucket`
- `vwap`
- `order_book`

Current limits:

- This is L2 snapshot streaming with a live V6 DOM panel.
- No heatmap renderer yet.
- No footprint renderer yet.
- No persistence or historical order book backfill yet.

## Phase 10 UI DOM Consumption Notes

The V6 browser surface consumes `order_book` only from the local engine stream:

- Auto-connect on V6 Orderflow shell mount; header control can disconnect/reconnect.
- WebSocket URL: injected as `window.COCKPIT_CONFIG.marketWsUrl`.
- No browser WebSocket to Hyperliquid or Binance is opened by the V6 DOM panel.
- The DOM panel keeps mock data when disconnected.
- When connected, the store keeps the latest snapshot by symbol and displays:
  - source
  - exchange
  - symbol
  - best bid
  - best ask
  - spread
  - mid
  - depth
  - last update
  - bids
  - asks
  - price
  - size
  - order count
  - cumulative size

The panel renders a 20 level DOM by default and computes cumulative size on the UI side if needed. Invalid or empty book sides are ignored gracefully without crashing the page.

Current UI limits:

- No heatmap.
- No footprint.
- No historical depth.
- No DOM persistence.
- No trading, auth, wallet, or order placement.

## Phase 11 Heatmap SD Engine Frames

Phase 11 prepares heatmap data in the Go engine only. It does not render a heatmap in the V6 UI.

The engine derives `heatmap_frame` envelopes from normalized Hyperliquid `l2Book` snapshots. The same local `/stream` continues to emit:

- `trade`
- `delta_bucket`
- `vwap`
- `order_book`
- `heatmap_frame`

Config:

```powershell
$env:MARKET_GO_HEATMAP_ENABLED='true'
$env:MARKET_GO_HEATMAP_EMIT_MS='500'
$env:MARKET_GO_HEATMAP_DEPTH='20'
$env:MARKET_GO_HEATMAP_TICK_SIZE='1'
$env:MARKET_GO_HEATMAP_MAX_LEVELS='100'
```

Live command with heatmap:

```powershell
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
$env:MARKET_GO_VWAP_ENABLED='true'
$env:MARKET_GO_VWAP_SESSION='utc_day'
$env:MARKET_GO_BOOK_ENABLED='true'
$env:MARKET_GO_BOOK_DEPTH='20'
$env:MARKET_GO_BOOK_EMIT_MS='250'
$env:MARKET_GO_HEATMAP_ENABLED='true'
$env:MARKET_GO_HEATMAP_EMIT_MS='500'
$env:MARKET_GO_HEATMAP_DEPTH='20'
$env:MARKET_GO_HEATMAP_TICK_SIZE='1'
$env:MARKET_GO_HEATMAP_MAX_LEVELS='100'
go run ./cmd/marketd
```

`heatmap_frame` envelope:

```json
{
  "type": "heatmap_frame",
  "seq": 123,
  "tsLocal": 1760000000000,
  "payload": {
    "exchange": "hyperliquid",
    "symbol": "BTC",
    "tsExchange": 1760000000000,
    "tsLocal": 1760000000001,
    "mid": 73500.5,
    "bestBid": 73500.0,
    "bestAsk": 73501.0,
    "priceMin": 73450.0,
    "priceMax": 73550.0,
    "tickSize": 1.0,
    "levels": [
      {
        "price": 73500.0,
        "bidSize": 1.23,
        "askSize": 0,
        "totalSize": 1.23,
        "intensity": 0.72
      }
    ],
    "source": "l2Book",
    "depth": 20
  }
}
```

Calculation notes:

- Bids and asks are merged by normalized price level.
- `totalSize = bidSize + askSize`.
- `intensity = totalSize / maxTotalSizeVisible`.
- `intensity` is clamped to `[0, 1]`.
- Invalid or empty book sides do not panic.
- Invalid tick size falls back to `1`.
- Frames are instantaneous; there is no long heatmap history in Go yet.

Heatmap metrics:

- `heatmapEnabled`
- `totalHeatmapFramesOut`
- `lastHeatmapTsLocal`
- `heatmapDepthBySymbol`
- `heatmapLevelsBySymbol`
- `heatmapPriceMinBySymbol`
- `heatmapPriceMaxBySymbol`

Stream checker:

```powershell
go run ./cmd/streamcheck -trades 20 -timeout 60s
```

The checker now counts and summarizes `heatmap_frame` messages.

Current Phase 11 limits:

- No heatmap Canvas UI renderer yet.
- No historical visual heatmap buffer yet.
- No footprint.
- No persistence or historical order book backfill.

## Phase 12 V6 UI Heatmap SD

Phase 12 consumes the existing Go `heatmap_frame` envelopes in the V6 frontend and renders them in the V6 canvas. No new exchange connection is opened by the browser V6 client; it still connects only to the local engine stream:

```text
ws://127.0.0.1:8765/stream
```

UI consumption path:

- `078_v6_local_engine_client.js` receives `type:"heatmap_frame"`.
- Frames are normalized defensively and invalid frames are ignored.
- `071_v6_orderflow_store.js` stores a bounded FIFO frame buffer.
- `077_v6_canvas_chart.js` renders the buffered frames with Canvas 2D.

UI state fields:

- `heatmapFrames`
- `heatmapFrameCount`
- `lastHeatmapFrame`
- `lastHeatmapTs`
- `selectedHeatmapSymbol`
- `settings.showHeatmap`
- `settings.heatmapMaxFrames`

Default UI limits:

- `heatmapMaxFrames = 360`
- Minimum accepted frame buffer: 60
- Maximum accepted frame buffer: 600
- No infinite heatmap history is kept in the browser.

Rendering model:

- X axis: frame index.
- Y axis: interpolated price between `priceMin` and `priceMax`.
- Each heatmap level is a small rectangle.
- Bid-only levels render green.
- Ask-only levels render red.
- Mixed/balanced levels render yellow.
- Alpha/intensity is clamped to `[0, 1]`.
- MID, BID, and ASK guide lines are drawn when available.
- Labels show `Heatmap SD`, frame count, level count, price range, and source.

Expected live workflow:

```powershell
cd services/market-go
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
$env:MARKET_GO_VWAP_ENABLED='true'
$env:MARKET_GO_VWAP_SESSION='utc_day'
$env:MARKET_GO_BOOK_ENABLED='true'
$env:MARKET_GO_BOOK_DEPTH='20'
$env:MARKET_GO_BOOK_EMIT_MS='250'
$env:MARKET_GO_HEATMAP_ENABLED='true'
$env:MARKET_GO_HEATMAP_EMIT_MS='500'
$env:MARKET_GO_HEATMAP_DEPTH='20'
$env:MARKET_GO_HEATMAP_TICK_SIZE='1'
$env:MARKET_GO_HEATMAP_MAX_LEVELS='100'
go run ./cmd/marketd
```

Then launch Flask on `127.0.0.1:5001` and open `Orderflow`; the V6 shell auto-connects to the local engine.

Current Phase 12 limits:

- Canvas 2D only.
- No WebGL.
- No advanced zoom/pan for heatmap yet.
- No historical heatmap backfill.
- No footprint.
- No persistence of heatmap frames.

## Phase 13 Footprint V1 Engine Candles

Phase 13 adds Go-side footprint candle calculation from normalized live trades. It does not render a footprint in the V6 UI yet.

The local `/stream` can now emit:

- `trade`
- `delta_bucket`
- `vwap`
- `order_book`
- `heatmap_frame`
- `footprint_candle`

Config:

```powershell
$env:MARKET_GO_FOOTPRINT_ENABLED='true'
$env:MARKET_GO_FOOTPRINT_INTERVAL_MS='60000'
$env:MARKET_GO_FOOTPRINT_TICK_SIZE='1'
$env:MARKET_GO_FOOTPRINT_EMIT_MS='500'
$env:MARKET_GO_FOOTPRINT_MAX_LEVELS='200'
```

Live command with footprint:

```powershell
cd services/market-go
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
$env:MARKET_GO_VWAP_ENABLED='true'
$env:MARKET_GO_VWAP_SESSION='utc_day'
$env:MARKET_GO_BOOK_ENABLED='true'
$env:MARKET_GO_BOOK_DEPTH='20'
$env:MARKET_GO_BOOK_EMIT_MS='250'
$env:MARKET_GO_HEATMAP_ENABLED='true'
$env:MARKET_GO_HEATMAP_EMIT_MS='500'
$env:MARKET_GO_HEATMAP_DEPTH='20'
$env:MARKET_GO_HEATMAP_TICK_SIZE='1'
$env:MARKET_GO_HEATMAP_MAX_LEVELS='100'
$env:MARKET_GO_FOOTPRINT_ENABLED='true'
$env:MARKET_GO_FOOTPRINT_INTERVAL_MS='60000'
$env:MARKET_GO_FOOTPRINT_TICK_SIZE='1'
$env:MARKET_GO_FOOTPRINT_EMIT_MS='500'
$env:MARKET_GO_FOOTPRINT_MAX_LEVELS='200'
go run ./cmd/marketd
```

`footprint_candle` envelope:

```json
{
  "type": "footprint_candle",
  "seq": 123,
  "tsLocal": 1760000000000,
  "payload": {
    "exchange": "hyperliquid",
    "symbol": "BTC",
    "intervalMs": 60000,
    "openTime": 1760000000000,
    "closeTime": 1760000060000,
    "open": 73500.0,
    "high": 73520.0,
    "low": 73490.0,
    "close": 73510.0,
    "volume": 12.34,
    "buyVol": 7.1,
    "sellVol": 5.24,
    "delta": 1.86,
    "poc": 73505.0,
    "closed": false,
    "levels": [
      {
        "price": 73500.0,
        "buyVol": 1.23,
        "sellVol": 0.82,
        "delta": 0.41,
        "totalVol": 2.05,
        "trades": 14
      }
    ],
    "source": "trades"
  }
}
```

Calculation notes:

- Trades are grouped by exchange, symbol, candle interval, and normalized price level.
- `open` is the first trade price in the candle.
- `high` and `low` are max/min trade prices.
- `close` is the latest trade price.
- `volume` is summed trade quantity.
- `buyVol` is summed normalized aggressive buy quantity.
- `sellVol` is summed normalized aggressive sell quantity.
- `delta = buyVol - sellVol`.
- Level `totalVol = buyVol + sellVol`.
- `poc` is the price level with highest total volume.
- Tick size <= 0 or invalid falls back to `1`.
- Unknown side, invalid price, and qty <= 0 are ignored without panic.
- Active candles are emitted periodically according to `MARKET_GO_FOOTPRINT_EMIT_MS`.
- When a new interval starts, the previous candle is emitted with `closed:true`.

Footprint metrics:

- `footprintEnabled`
- `totalFootprintCandlesOut`
- `totalFootprintClosedOut`
- `lastFootprintTsLocal`
- `footprintIntervalMs`
- `footprintTickSize`
- `footprintLevelsBySymbol`
- `footprintPOCBySymbol`
- `footprintDeltaBySymbol`
- `footprintVolumeBySymbol`

Stream checker:

```powershell
go run ./cmd/streamcheck -trades 20 -timeout 60s
```

The checker now counts and summarizes `footprint_candle` messages alongside trades, delta buckets, VWAP, order book, and heatmap frames.

Current Phase 13 limits:

- No footprint Canvas UI renderer yet.
- No long footprint history in Go.
- No footprint persistence.
- No historical backfill.
- No Binance adapter usage.
- No Wails or desktop integration.

## Phase 14 V6 UI Footprint V1

Phase 14 consumes existing `footprint_candle` envelopes in the V6 frontend and renders a simple Footprint V1 in the same V6 canvas as the Heatmap SD. No new exchange source or engine feature is added.

Browser V6 stream connection remains local-only in the V6 client:

```text
ws://127.0.0.1:8765/stream
```

UI consumption path:

- `078_v6_local_engine_client.js` receives `type:"footprint_candle"`.
- Footprint candles are normalized defensively.
- Candles are merged by `exchange:symbol:intervalMs:openTime`, so active candle updates replace the previous live version instead of appending unbounded duplicates.
- `071_v6_orderflow_store.js` stores a bounded FIFO candle buffer.
- `077_v6_canvas_chart.js` renders footprint columns with Canvas 2D.

UI state fields:

- `footprintCandles`
- `footprintCandleCount`
- `lastFootprintCandle`
- `lastFootprintTs`
- `selectedFootprintSymbol`
- `settings.showFootprint`
- `settings.chartMode`
- `settings.footprintMaxCandles`

Default UI limits:

- `footprintMaxCandles = 160`
- Minimum accepted candle buffer: 60
- Maximum accepted candle buffer: 240
- No infinite footprint history is kept in the browser.

Rendering model:

- X axis: footprint candles.
- Y axis: price.
- Each candle is one column.
- Each price level is rendered as a compact cell.
- Positive level delta renders green.
- Negative level delta renders red.
- Neutral level delta renders muted gray.
- POC is highlighted with an amber outline/line.
- OHLC is shown as a compact wick/open/close mark.
- Candle delta is shown below each column when space allows.
- Labels show `Footprint V1`, candle count, last delta, POC, volume, and closed state.

Chart settings:

- `Show Heatmap`
- `Show Footprint`
- `Chart mode`
  - `Both`
  - `Heatmap`
  - `Footprint`

Current Phase 14 limits:

- Canvas 2D only.
- No WebGL.
- No advanced zoom/pan for footprint yet.
- No footprint backfill or replay.
- No footprint persistence.
- Existing Dashboard/widget code may still open its existing browser Binance WebSocket; the V6 engine client itself only opens the local stream.

## Phase 15 UI Controls

Phase 15 adds a complete UX control layer to the V6 orderflow surface. No Go engine changes were made in this phase — all controls are browser-side only.

### Settings Persistence (localStorage)

Key: `cockpitV6.orderflow.settings`

Module: `static/js/split/079_v6_orderflow_settings.js`

Persisted fields:

| Field | Type | Default | Range |
|-------|------|---------|-------|
| `chartMode` | string | `both` | `heatmap`, `footprint`, `both`, `none` |
| `showTape` | boolean | `true` | — |
| `showDOM` | boolean | `true` | — |
| `showCVD` | boolean | `true` | — |
| `showVwap` | boolean | `true` | — |
| `showHeatmap` | boolean | `true` | — |
| `showFootprint` | boolean | `true` | — |
| `maxTrades` | number | `500` | 50–5000 |
| `maxHeatmapFrames` | number | `360` | 60–600 |
| `maxFootprintCandles` | number | `120` | 30–240 |
| `domDepth` | number | `20` | 5–50 |
| `minQty` | number | `0` | ≥0 |
| `maxRows` | number | `42` | 8–500 |

Behavior:
- Loaded at `V6OF.Layout.init()` startup.
- Saved automatically on every settings change via store subscription.
- `Reset UI Settings` clears localStorage and restores defaults.
- Invalid JSON in localStorage falls back to defaults without crash.

### Chart Modes

- `Heatmap`: shows only heatmap, footprint is masked.
- `Footprint`: shows only footprint, heatmap is masked.
- `Both`: shows heatmap + footprint overlay.
- `None`: shows a stats placeholder (symbol, mid, frame/candle counts, VWAP) — no crash.

### Panel Toggles

- `Show Tape`: hides/shows the tape panel via CSS class `.v6-panel-hidden`.
- `Show DOM`: hides/shows the DOM panel.
- `Show Delta/CVD`: hides/shows the CVD panel.
- `Show VWAP`: hides/shows the VWAP panel.
- `Show Heatmap` / `Show Footprint`: control canvas rendering (already existed pre-Phase 15).

### Buffer Controls

- `Max trades`: dynamic cap on the trade buffer in the engine client.
- `Max heatmap frames`: controls `heatmapMaxFrames` in the store.
- `Max footprint candles`: controls `footprintMaxCandles` in the store.
- `DOM depth (UI)`: UI-only filter on displayed book levels. Does NOT change Go engine depth.

### Clear Actions

- `Clear Tape`: clears trade buffer and pending trades. Does not close WebSocket.
- `Clear Heatmap`: clears heatmap frames from store and pending batch.
- `Clear Footprint`: clears footprint candles from store and pending batch.
- `Clear All UI Buffers`: clears trades + heatmap + footprint. Does NOT reset CVD/VWAP engine state.
- None of the clear actions close the WebSocket or reset the Go engine.

### Stale Detection

- A 10-second timer starts on each received message when connected.
- If no message is received for 10s while connected, `state.isStale` is set to `true`.
- Visual indicators: ⚠ STALE badge in engine bar, canvas stale warning, badge turns error color.
- Stale flag clears on next received message or on disconnect.

### Canvas Labels (Enhanced)

When heatmap or footprint is rendering, the canvas now shows:
- Current mode label (e.g., "Mode: Heatmap + Footprint")
- Symbol
- Mid price
- Price range
- Heatmap frames count and footprint candles count
- Last VWAP value if `showVwap` is active
- "⚠ live-only / not warm" warning if VWAP `isWarm=false`
- "⚠ STALE — no data" warning if stale

### Current Phase 15 Limits

- Canvas 2D only, no WebGL.
- No crosshair or tooltip on canvas hover.
- No zoom/pan.
- No volume profile sidebar.
- No timeframe selector for footprint.
- Settings are localStorage only — not synced to SQLite or Flask.
- DOM depth is a UI filter; the Go engine always sends its configured depth.
- No new data source or WebSocket was added.

## V6 Chart Engine (Phase 17 — UI only)

The Go engine is unchanged in Phase 17. This section documents the front-end
chart engine that consumes the existing `/stream` messages.

### Coordinate system

`V6OF.ChartViewport` (`static/js/split/083_v6_chart_viewport.js`) owns a
price/time window mapped onto a pixel plot rectangle:

- X axis: `timeStart..timeEnd` (ms) → left..right, time grows right.
- Y axis: `priceMax..priceMin` → top..bottom, price grows up.
- Transforms: `timeToX(ts)`, `xToTime(x)`, `priceToY(price)`, `yToPrice(y)`.
- `syncToData(bounds)` each frame: seeds on first data, then (a) slides the
  right edge to the newest timestamp while `followLive`, and (b) re-fits the
  price band while `autoFit`.

Time bounds come from heatmap frame timestamps (`tsExchange`/`tsLocal`) and
footprint candle `openTime`/`closeTime`. Price bounds come from heatmap
`priceMin`/`priceMax`, footprint `low`/`high` + level prices, and the live VWAP.

### Scales / grid

- Price scale: right gutter, nice-number ticks (1/2/5 ladder).
- Time scale: bottom strip, nice-time ticks from a fixed ladder (1s..24h),
  labels `HH:MM:SS` under a minute, else `HH:MM`.
- Grid lines drawn from the same ticks; data layers clipped to the plot rect.

### Interactions (`084_v6_chart_interactions.js`)

- Pan: drag (time + price); Shift-drag = price only.
- Zoom: wheel = time zoom centred on cursor; Ctrl/Alt+wheel = price zoom.
- Fit / Reset: re-frame to data extents, re-enable follow-live + auto-fit.
- Follow live: default ON; disabled when panning/zooming into history; the
  Follow-live tool (or reaching the live edge) re-enables it.
- Crosshair: shared state `V6OF.chartCrosshair`, price/time readouts, toggle via
  the Cursor / Crosshair left-toolbar tools.
- Listeners attach once per canvas (idempotent + detachable). All redraws go
  through the `requestAnimationFrame` queue in `V6OF.CanvasChart.draw`.

### Data integration

- Heatmap SD: each frame is a column at `timeToX(ts)` with width to the next
  frame; levels positioned by `priceToY(level.price)`; offscreen frames culled.
- Footprint V1: each candle spans `timeToX(openTime)..timeToX(closeTime)`;
  OHLC marks + level cells + POC drawn in the same space.
- MID / BID / ASK / POC / VWAP rendered as horizontal reference lines.

### Current limits (Phase 17)

- Canvas 2D only, no WebGL.
- No drawing tools (no persistent trendlines / rectangles).
- No replay / backfill. No Wails / desktop.
