package engine

import (
	"encoding/json"
	"testing"

	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
)

func TestTradeEnvelope(t *testing.T) {
	e := New(config.Default(), logx.New(testWriter{t}))
	env := e.Trade(marketdata.Trade{
		TradeID:    "1760000000000:BTC:123",
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: 1760000000000,
		TsLocal:    1760000000001,
		Price:      100000,
		Qty:        0.01,
		Side:       "buy",
		Notional:   1000,
	})

	raw, err := env.MarshalJSONBytes()
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}

	var decoded struct {
		Type    string         `json:"type"`
		Payload map[string]any `json:"payload"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	if decoded.Type != "trade" {
		t.Fatalf("unexpected envelope type: %s", decoded.Type)
	}
	if decoded.Payload["tradeId"] != "1760000000000:BTC:123" {
		t.Fatalf("unexpected trade id: %#v", decoded.Payload["tradeId"])
	}
	if decoded.Payload["exchange"] != "hyperliquid" {
		t.Fatalf("unexpected exchange: %#v", decoded.Payload["exchange"])
	}

	metrics := e.Metrics()
	if metrics.TotalTradesOut != 1 {
		t.Fatalf("unexpected total trades out: %d", metrics.TotalTradesOut)
	}
	if metrics.LastTradeTsExchange != 1760000000000 || metrics.LastTradeTsLocal != 1760000000001 {
		t.Fatalf("unexpected last trade timestamps: %#v", metrics)
	}
}

func TestMetricsRecorders(t *testing.T) {
	e := New(config.Default(), logx.New(testWriter{t}))
	e.SetConnected(true)
	e.RecordMessageIn()
	e.RecordReconnect()
	e.SetStreamClients(2)
	e.RecordError("temporary disconnect")

	metrics := e.Metrics()
	if !metrics.Connected {
		t.Fatalf("expected connected")
	}
	if metrics.TotalMessagesIn != 1 {
		t.Fatalf("unexpected messages in: %d", metrics.TotalMessagesIn)
	}
	if metrics.ReconnectCount != 1 {
		t.Fatalf("unexpected reconnect count: %d", metrics.ReconnectCount)
	}
	if metrics.TotalStreamClients != 2 {
		t.Fatalf("unexpected stream clients: %d", metrics.TotalStreamClients)
	}
	if metrics.LastError != "temporary disconnect" {
		t.Fatalf("unexpected last error: %q", metrics.LastError)
	}
}

func TestDeltaBucketEnvelopes(t *testing.T) {
	cfg := config.Default()
	cfg.DeltaIntervals = []int64{1000}
	e := New(cfg, logx.New(testWriter{t}))

	envs := e.DeltaBuckets(marketdata.Trade{
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: 1760000000123,
		TsLocal:    1760000000124,
		Qty:        2,
		Side:       "buy",
		Price:      100000,
	})
	if len(envs) != 1 {
		t.Fatalf("expected one delta envelope, got %d", len(envs))
	}
	if envs[0].Type != "delta_bucket" {
		t.Fatalf("unexpected type: %s", envs[0].Type)
	}

	metrics := e.Metrics()
	if metrics.TotalDeltaBucketsOut != 1 {
		t.Fatalf("unexpected delta buckets out: %d", metrics.TotalDeltaBucketsOut)
	}
	if metrics.LastDeltaTsLocal == 0 {
		t.Fatalf("last delta ts local should be set")
	}
	if got := metrics.CVDBySymbol["BTC"]; got != 2 {
		t.Fatalf("unexpected cvd: %f", got)
	}
}

func TestVWAPEnvelope(t *testing.T) {
	cfg := config.Default()
	cfg.VWAPEnabled = true
	cfg.VWAPEmitMs = 0
	e := New(cfg, logx.New(testWriter{t}))

	env, ok := e.VWAP(marketdata.Trade{
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: 1760000000123,
		TsLocal:    1760000000124,
		Qty:        2,
		Side:       "sell",
		Price:      100000,
	})
	if !ok {
		t.Fatalf("expected vwap envelope")
	}
	if env.Type != "vwap" {
		t.Fatalf("unexpected type: %s", env.Type)
	}

	metrics := e.Metrics()
	if metrics.TotalVWAPOut != 1 {
		t.Fatalf("unexpected vwap out: %d", metrics.TotalVWAPOut)
	}
	if metrics.LastVWAPTsLocal == 0 {
		t.Fatalf("last vwap ts local should be set")
	}
	if got := metrics.VWAPBySymbol["BTC"]; got != 100000 {
		t.Fatalf("unexpected vwap: %f", got)
	}
	if metrics.VWAPIsWarm["BTC"] {
		t.Fatalf("live-only vwap should not be warm")
	}
	if metrics.VWAPCoverageStart["BTC"] != 1760000000123 {
		t.Fatalf("unexpected coverage start: %d", metrics.VWAPCoverageStart["BTC"])
	}
}

func TestOrderBookEnvelopeAndMetrics(t *testing.T) {
	cfg := config.Default()
	cfg.BookEnabled = true
	e := New(cfg, logx.New(testWriter{t}))

	snapshot := marketdata.OrderBookSnapshot{
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: 1760000000123,
		TsLocal:    1760000000124,
		Bids:       []marketdata.OrderBookLevel{{Price: 73500, Size: 1.23, Orders: 4}},
		Asks:       []marketdata.OrderBookLevel{{Price: 73501, Size: 0.82, Orders: 3}},
		BestBid:    73500,
		BestAsk:    73501,
		Spread:     1,
		Mid:        73500.5,
		Depth:      1,
		Source:     "l2Book",
	}
	env := e.OrderBook(snapshot)
	if env.Type != "order_book" {
		t.Fatalf("unexpected type: %s", env.Type)
	}
	e.RecordOrderBookOut(snapshot, env.TsLocal)

	metrics := e.Metrics()
	if !metrics.BookEnabled {
		t.Fatalf("book should be enabled")
	}
	if metrics.TotalOrderBookOut != 1 {
		t.Fatalf("unexpected order book out: %d", metrics.TotalOrderBookOut)
	}
	if metrics.LastBookTsExchange != 1760000000123 || metrics.LastBookTsLocal == 0 {
		t.Fatalf("unexpected book timestamps: %#v", metrics)
	}
	if metrics.OrderBookDepth["BTC"] != 1 || metrics.BestBidBySymbol["BTC"] != 73500 || metrics.BestAskBySymbol["BTC"] != 73501 {
		t.Fatalf("unexpected book metrics: %#v", metrics)
	}
	if metrics.SpreadBySymbol["BTC"] != 1 || metrics.MidBySymbol["BTC"] != 73500.5 {
		t.Fatalf("unexpected spread/mid metrics: %#v", metrics)
	}
}

func TestHeatmapFrameEnvelopeAndMetrics(t *testing.T) {
	cfg := config.Default()
	cfg.HeatmapEnabled = true
	cfg.HeatmapDepth = 20
	cfg.HeatmapTickSize = 1
	cfg.HeatmapMaxLevels = 100
	e := New(cfg, logx.New(testWriter{t}))

	snapshot := marketdata.OrderBookSnapshot{
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: 1760000000123,
		TsLocal:    1760000000124,
		Bids:       []marketdata.OrderBookLevel{{Price: 73500, Size: 1.23, Orders: 4}},
		Asks:       []marketdata.OrderBookLevel{{Price: 73501, Size: 0.82, Orders: 3}},
		BestBid:    73500,
		BestAsk:    73501,
		Spread:     1,
		Mid:        73500.5,
		Depth:      1,
		Source:     "l2Book",
	}
	env := e.HeatmapFrame(snapshot)
	if env.Type != "heatmap_frame" {
		t.Fatalf("unexpected type: %s", env.Type)
	}
	frame, ok := env.Payload.(marketdata.HeatmapFrame)
	if !ok {
		t.Fatalf("unexpected heatmap payload type: %T", env.Payload)
	}
	e.RecordHeatmapFrameOut(frame, env.TsLocal)

	metrics := e.Metrics()
	if !metrics.HeatmapEnabled {
		t.Fatalf("heatmap should be enabled")
	}
	if metrics.TotalHeatmapFramesOut != 1 {
		t.Fatalf("unexpected heatmap frames out: %d", metrics.TotalHeatmapFramesOut)
	}
	if metrics.LastHeatmapTsLocal == 0 {
		t.Fatalf("last heatmap ts local should be set")
	}
	if metrics.HeatmapLevelsBySymbol["BTC"] != 2 {
		t.Fatalf("unexpected heatmap levels: %#v", metrics.HeatmapLevelsBySymbol)
	}
	if metrics.HeatmapPriceMinBySymbol["BTC"] != 73500 || metrics.HeatmapPriceMaxBySymbol["BTC"] != 73501 {
		t.Fatalf("unexpected heatmap price range: %#v %#v", metrics.HeatmapPriceMinBySymbol, metrics.HeatmapPriceMaxBySymbol)
	}
}

func TestHeatmapEnabledDoesNotBlockTradeMessages(t *testing.T) {
	cfg := config.Default()
	cfg.HeatmapEnabled = true
	e := New(cfg, logx.New(testWriter{t}))

	tradeEnv := e.Trade(marketdata.Trade{
		TradeID:    "trade-1",
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: 1760000000100,
		TsLocal:    1760000000101,
		Price:      73500,
		Qty:        1,
		Side:       "buy",
	})
	heatmapEnv := e.HeatmapFrame(marketdata.OrderBookSnapshot{
		Exchange: "hyperliquid",
		Symbol:   "BTC",
		Bids:     []marketdata.OrderBookLevel{{Price: 73500, Size: 1}},
		Asks:     []marketdata.OrderBookLevel{{Price: 73501, Size: 1}},
		BestBid:  73500,
		BestAsk:  73501,
		Mid:      73500.5,
		Source:   "l2Book",
	})

	if tradeEnv.Type != "trade" {
		t.Fatalf("unexpected trade envelope type: %s", tradeEnv.Type)
	}
	if heatmapEnv.Type != "heatmap_frame" {
		t.Fatalf("unexpected heatmap envelope type: %s", heatmapEnv.Type)
	}
	if e.Metrics().TotalTradesOut != 1 {
		t.Fatalf("trade output should not be blocked by heatmap")
	}
}

func TestFootprintCandleEnvelopeAndMetrics(t *testing.T) {
	cfg := config.Default()
	cfg.FootprintEnabled = true
	cfg.FootprintIntervalMs = 60000
	cfg.FootprintTickSize = 1
	cfg.FootprintEmitMs = 0
	cfg.FootprintMaxLevels = 200
	e := New(cfg, logx.New(testWriter{t}))

	envs := e.FootprintCandles(marketdata.Trade{
		TradeID:    "trade-1",
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: 1760000000100,
		TsLocal:    1760000000101,
		Price:      73500,
		Qty:        1.5,
		Side:       "buy",
		Notional:   110250,
	})
	if len(envs) != 1 {
		t.Fatalf("expected one footprint envelope, got %d", len(envs))
	}
	if envs[0].Type != "footprint_candle" {
		t.Fatalf("unexpected type: %s", envs[0].Type)
	}
	candle, ok := envs[0].Payload.(marketdata.FootprintCandle)
	if !ok {
		t.Fatalf("unexpected footprint payload type: %T", envs[0].Payload)
	}
	if candle.POC != 73500 || candle.Volume != 1.5 || candle.BuyVol != 1.5 || candle.Delta != 1.5 {
		t.Fatalf("unexpected footprint candle: %#v", candle)
	}

	metrics := e.Metrics()
	if !metrics.FootprintEnabled {
		t.Fatalf("footprint should be enabled")
	}
	if metrics.TotalFootprintCandlesOut != 1 {
		t.Fatalf("unexpected footprint candles out: %d", metrics.TotalFootprintCandlesOut)
	}
	if metrics.TotalFootprintClosedOut != 0 {
		t.Fatalf("unexpected closed footprints: %d", metrics.TotalFootprintClosedOut)
	}
	if metrics.LastFootprintTsLocal == 0 {
		t.Fatalf("last footprint ts local should be set")
	}
	if metrics.FootprintLevelsBySymbol["BTC"] != 1 || metrics.FootprintPOCBySymbol["BTC"] != 73500 {
		t.Fatalf("unexpected footprint metrics: %#v", metrics)
	}
	if metrics.FootprintDeltaBySymbol["BTC"] != 1.5 || metrics.FootprintVolumeBySymbol["BTC"] != 1.5 {
		t.Fatalf("unexpected footprint volume metrics: %#v", metrics)
	}
}

func TestFootprintClosedCandleMetric(t *testing.T) {
	cfg := config.Default()
	cfg.FootprintEnabled = true
	cfg.FootprintIntervalMs = 1000
	cfg.FootprintEmitMs = 0
	e := New(cfg, logx.New(testWriter{t}))

	_ = e.FootprintCandles(marketdata.Trade{
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: 1760000000100,
		TsLocal:    1760000000101,
		Price:      73500,
		Qty:        1,
		Side:       "buy",
	})
	envs := e.FootprintCandles(marketdata.Trade{
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: 1760000001100,
		TsLocal:    1760000001101,
		Price:      73501,
		Qty:        1,
		Side:       "sell",
	})
	if len(envs) != 2 {
		t.Fatalf("expected closed and live envelopes, got %d", len(envs))
	}
	if candle, ok := envs[0].Payload.(marketdata.FootprintCandle); !ok || !candle.Closed {
		t.Fatalf("expected first envelope to be closed footprint: %#v", envs[0].Payload)
	}
	if got := e.Metrics().TotalFootprintClosedOut; got != 1 {
		t.Fatalf("unexpected closed footprint metric: %d", got)
	}
}

type testWriter struct {
	t *testing.T
}

func (w testWriter) Write(p []byte) (int, error) {
	w.t.Log(string(p))
	return len(p), nil
}
