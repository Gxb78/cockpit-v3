package engine

import (
	"math/rand"
	"sync"
	"sync/atomic"
	"time"

	"cockpit-v6-market-go/internal/calc"
	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
	"cockpit-v6-market-go/pkg/protocol"
)

const ServiceName = "cockpit-v6-market-go"

type Health struct {
	OK      bool   `json:"ok"`
	Service string `json:"service"`
	Version string `json:"version"`
	Time    string `json:"time"`
}

type Engine struct {
	cfg       config.Config
	log       *logx.Logger
	seq       atomic.Uint64
	rngMu     sync.Mutex
	rng       *rand.Rand
	start     time.Time
	prices    map[string]float64
	metrics   metricState
	delta     *calc.DeltaCalculator
	vwap      *calc.VWAPCalculator
	footprint *calc.FootprintCalculator
}

func New(cfg config.Config, logger *logx.Logger) *Engine {
	return &Engine{
		cfg:    cfg,
		log:    logger,
		rng:    rand.New(rand.NewSource(42)),
		start:  time.Now(),
		prices: defaultPrices(cfg.Symbols),
		delta:  calc.NewDeltaCalculator(cfg.DeltaIntervals, cfg.SessionReset, 250*time.Millisecond),
		vwap:   calc.NewVWAPCalculator(cfg.VWAPEnabled, cfg.VWAPSession, time.Duration(cfg.VWAPEmitMs)*time.Millisecond),
		footprint: calc.NewFootprintCalculator(calc.FootprintConfig{
			Enabled:    cfg.FootprintEnabled,
			IntervalMs: cfg.FootprintIntervalMs,
			TickSize:   cfg.FootprintTickSize,
			EmitEvery:  time.Duration(cfg.FootprintEmitMs) * time.Millisecond,
			MaxLevels:  cfg.FootprintMaxLevels,
		}),
	}
}

func (e *Engine) Health() Health {
	return Health{
		OK:      true,
		Service: ServiceName,
		Version: e.cfg.Version,
		Time:    time.Now().UTC().Format(time.RFC3339Nano),
	}
}

func (e *Engine) Heartbeat() protocol.Envelope {
	payload := map[string]any{
		"service":   ServiceName,
		"version":   e.cfg.Version,
		"mockMode":  e.cfg.MockMode,
		"symbols":   e.cfg.Symbols,
		"uptimeSec": int64(time.Since(e.start).Seconds()),
	}
	return e.next("heartbeat", payload)
}

func (e *Engine) MockTrade() protocol.Envelope {
	symbol := "BTCUSDT"
	if len(e.cfg.Symbols) > 0 {
		symbol = e.cfg.Symbols[0]
	}
	now := protocol.NowMillis()
	price := e.nextPrice(symbol)
	qty := e.nextQty(symbol)
	side := "buy"
	if price < e.prices[symbol] {
		side = "sell"
	}

	tradeID := "mock-" + time.Now().UTC().Format("150405.000000000")
	trade := marketdata.Trade{
		ID:         tradeID,
		TradeID:    tradeID,
		Exchange:   "mock",
		Symbol:     symbol,
		TsExchange: now,
		TsLocal:    now,
		Price:      round(price, 2),
		Qty:        round(qty, 4),
		Side:       side,
		Notional:   round(price*qty, 2),
	}
	e.prices[symbol] = price
	return e.next("trade_mock", trade)
}

func (e *Engine) Trade(trade marketdata.Trade) protocol.Envelope {
	e.RecordTradeOut(trade)
	return e.next("trade", trade)
}

func (e *Engine) DeltaBuckets(trade marketdata.Trade) []protocol.Envelope {
	buckets := e.delta.UpdateTrade(trade)
	if len(buckets) == 0 {
		return nil
	}

	envelopes := make([]protocol.Envelope, 0, len(buckets))
	for _, bucket := range buckets {
		env := e.next("delta_bucket", bucket)
		e.RecordDeltaBucketOut(bucket, env.TsLocal)
		envelopes = append(envelopes, env)
	}
	return envelopes
}

func (e *Engine) VWAP(trade marketdata.Trade) (protocol.Envelope, bool) {
	state, ok := e.vwap.UpdateTrade(trade)
	if !ok {
		return protocol.Envelope{}, false
	}
	env := e.next("vwap", state)
	e.RecordVWAPOut(state, env.TsLocal)
	return env, true
}

func (e *Engine) FootprintCandles(trade marketdata.Trade) []protocol.Envelope {
	candles := e.footprint.UpdateTrade(trade)
	if len(candles) == 0 {
		return nil
	}

	envelopes := make([]protocol.Envelope, 0, len(candles))
	for _, candle := range candles {
		env := e.next("footprint_candle", candle)
		e.RecordFootprintCandleOut(candle, env.TsLocal)
		envelopes = append(envelopes, env)
	}
	return envelopes
}

// SetFootprintSignalConfig forwards UI-seeded orderflow-signal thresholds to the
// footprint calculator so engine-derived signals match the client's settings.
func (e *Engine) SetFootprintSignalConfig(cfg calc.FootprintSignalConfig) {
	if e.footprint != nil {
		e.footprint.SetSignalConfig(cfg)
	}
}

func (e *Engine) OrderBook(snapshot marketdata.OrderBookSnapshot) protocol.Envelope {
	// Guarantee a positive contract size so the UI never has to guess a default
	// (covers any snapshot source that didn't populate the metadata field).
	if snapshot.ContractSize <= 0 {
		snapshot.ContractSize = 1
	}
	return e.next("order_book", snapshot)
}

func (e *Engine) HeatmapFrame(snapshot marketdata.OrderBookSnapshot) protocol.Envelope {
	frame := calc.BuildHeatmapFrame(snapshot, calc.HeatmapConfig{
		Depth:     e.cfg.HeatmapDepth,
		TickSize:  e.cfg.HeatmapTickSize,
		MaxLevels: e.cfg.HeatmapMaxLevels,
	})
	return e.next("heatmap_frame", frame)
}

// CandleHistory builds a one-shot historical-candle envelope (backfill).
func (e *Engine) CandleHistory(symbol, interval string, candles []marketdata.Candle) protocol.Envelope {
	payload := map[string]any{
		"symbol":   symbol,
		"interval": interval,
		"source":   "hyperliquid_backfill",
		"count":    len(candles),
		"candles":  candles,
	}
	return e.next("candle_history", payload)
}

// ReplayStatus wraps a backtest player status into a stream envelope.
func (e *Engine) ReplayStatus(payload any) protocol.Envelope {
	return e.next("replay_status", payload)
}

func (e *Engine) next(eventType string, payload any) protocol.Envelope {
	return protocol.NewEnvelope(eventType, e.seq.Add(1), payload)
}

func (e *Engine) nextPrice(symbol string) float64 {
	e.rngMu.Lock()
	defer e.rngMu.Unlock()

	base := e.prices[symbol]
	if base == 0 {
		base = 100000
	}
	move := (e.rng.Float64() - 0.5) * 45
	next := base + move
	if next <= 0 {
		return base
	}
	return next
}

func (e *Engine) nextQty(symbol string) float64 {
	e.rngMu.Lock()
	defer e.rngMu.Unlock()

	mult := 1.0
	if symbol == "ETHUSDT" {
		mult = 12
	} else if symbol == "SOLUSDT" {
		mult = 220
	}
	return (0.05 + e.rng.Float64()*2.5) * mult
}

func defaultPrices(symbols []string) map[string]float64 {
	prices := map[string]float64{
		"BTCUSDT": 104200,
		"ETHUSDT": 4200,
		"SOLUSDT": 184,
	}
	for _, symbol := range symbols {
		if _, ok := prices[symbol]; !ok {
			prices[symbol] = 100000
		}
	}
	return prices
}

// Reset clears all engine calculators and metrics. Called after an exchange
// switch so that the new exchange starts with a clean slate.
func (e *Engine) Reset() {
	e.delta = calc.NewDeltaCalculator(e.cfg.DeltaIntervals, e.cfg.SessionReset, 250*time.Millisecond)
	e.vwap = calc.NewVWAPCalculator(e.cfg.VWAPEnabled, e.cfg.VWAPSession, time.Duration(e.cfg.VWAPEmitMs)*time.Millisecond)
	e.footprint = calc.NewFootprintCalculator(calc.FootprintConfig{
		Enabled:    e.cfg.FootprintEnabled,
		IntervalMs: e.cfg.FootprintIntervalMs,
		TickSize:   e.cfg.FootprintTickSize,
		EmitEvery:  time.Duration(e.cfg.FootprintEmitMs) * time.Millisecond,
		MaxLevels:  e.cfg.FootprintMaxLevels,
	})
	e.prices = defaultPrices(e.cfg.Symbols)
	e.start = time.Now()
}

func round(value float64, precision int) float64 {
	scale := 1.0
	for i := 0; i < precision; i++ {
		scale *= 10
	}
	if value >= 0 {
		return float64(int64(value*scale+0.5)) / scale
	}
	return float64(int64(value*scale-0.5)) / scale
}
