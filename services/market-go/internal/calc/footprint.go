package calc

import (
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"cockpit-v6-market-go/internal/marketdata"
)

const FootprintSourceTrades = "trades"
const DefaultFootprintTickSize = 1.0

type FootprintConfig struct {
	Enabled    bool
	IntervalMs int64
	TickSize   float64
	EmitEvery  time.Duration
	MaxLevels  int
}

type FootprintCalculator struct {
	mu         sync.Mutex
	enabled    bool
	intervalMs int64
	tickSize   float64
	throttleMs int64
	maxLevels  int
	current    map[footprintKey]*footprintState
	lastEmitMs map[footprintKey]int64
}

type footprintKey struct {
	exchange string
	symbol   string
}

type footprintState struct {
	candle marketdata.FootprintCandle
	levels map[float64]*marketdata.FootprintLevel
}

func NewFootprintCalculator(cfg FootprintConfig) *FootprintCalculator {
	intervalMs := cfg.IntervalMs
	if intervalMs <= 0 {
		intervalMs = 60000
	}
	tickSize := normalizeFootprintTickSize(cfg.TickSize)
	maxLevels := cfg.MaxLevels
	if maxLevels <= 0 {
		maxLevels = 200
	}
	return &FootprintCalculator{
		enabled:    cfg.Enabled,
		intervalMs: intervalMs,
		tickSize:   tickSize,
		throttleMs: cfg.EmitEvery.Milliseconds(),
		maxLevels:  maxLevels,
		current:    make(map[footprintKey]*footprintState),
		lastEmitMs: make(map[footprintKey]int64),
	}
}

func (c *FootprintCalculator) Enabled() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.enabled
}

func (c *FootprintCalculator) IntervalMs() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.intervalMs
}

func (c *FootprintCalculator) TickSize() float64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.tickSize
}

func (c *FootprintCalculator) UpdateTrade(trade marketdata.Trade) []marketdata.FootprintCandle {
	return c.UpdateTradeAt(trade, time.Now().UnixMilli())
}

func (c *FootprintCalculator) UpdateTradeAt(trade marketdata.Trade, emitTimeMs int64) []marketdata.FootprintCandle {
	if !c.enabled || !validFootprintTrade(trade) {
		return nil
	}
	side := strings.ToLower(strings.TrimSpace(trade.Side))
	if side != "buy" && side != "sell" {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	key := footprintKey{exchange: trade.Exchange, symbol: trade.Symbol}
	start := bucketStart(trade.TsExchange, c.intervalMs)
	state := c.current[key]
	out := make([]marketdata.FootprintCandle, 0, 2)

	if state != nil && start < state.candle.OpenTime {
		return nil
	}

	if state != nil && state.candle.OpenTime != start {
		closed := c.snapshot(state, true)
		out = append(out, closed)
		delete(c.lastEmitMs, key)
		state = nil
	}

	if state == nil {
		state = newFootprintState(trade, c.intervalMs, start)
		c.current[key] = state
	}

	applyFootprintTrade(state, trade, side, c.tickSize)

	if c.shouldEmitLive(key, emitTimeMs) {
		out = append(out, c.snapshot(state, false))
		c.lastEmitMs[key] = emitTimeMs
	}

	return out
}

func (c *FootprintCalculator) shouldEmitLive(key footprintKey, emitTimeMs int64) bool {
	if c.throttleMs <= 0 {
		return true
	}
	last := c.lastEmitMs[key]
	return last == 0 || emitTimeMs-last >= c.throttleMs
}

func (c *FootprintCalculator) snapshot(state *footprintState, closed bool) marketdata.FootprintCandle {
	candle := state.candle
	candle.Closed = closed
	candle.Levels = footprintLevels(state.levels, c.maxLevels)
	candle.POC = footprintPOC(state.levels)
	return candle
}

func newFootprintState(trade marketdata.Trade, intervalMs int64, start int64) *footprintState {
	return &footprintState{
		candle: marketdata.FootprintCandle{
			Exchange:   trade.Exchange,
			Symbol:     trade.Symbol,
			IntervalMs: intervalMs,
			OpenTime:   start,
			CloseTime:  start + intervalMs,
			Open:       trade.Price,
			High:       trade.Price,
			Low:        trade.Price,
			Close:      trade.Price,
			Source:     FootprintSourceTrades,
		},
		levels: make(map[float64]*marketdata.FootprintLevel),
	}
}

func applyFootprintTrade(state *footprintState, trade marketdata.Trade, side string, tickSize float64) {
	candle := &state.candle
	if trade.Price > candle.High {
		candle.High = trade.Price
	}
	if trade.Price < candle.Low {
		candle.Low = trade.Price
	}
	candle.Close = trade.Price
	candle.Volume += trade.Qty
	if side == "buy" {
		candle.BuyVol += trade.Qty
	} else {
		candle.SellVol += trade.Qty
	}
	candle.Delta = candle.BuyVol - candle.SellVol

	price := normalizeFootprintPrice(trade.Price, tickSize)
	level := state.levels[price]
	if level == nil {
		level = &marketdata.FootprintLevel{Price: price}
		state.levels[price] = level
	}
	if side == "buy" {
		level.BuyVol += trade.Qty
	} else {
		level.SellVol += trade.Qty
	}
	level.Delta = level.BuyVol - level.SellVol
	level.TotalVol = level.BuyVol + level.SellVol
	level.Trades++
}

func footprintLevels(levelMap map[float64]*marketdata.FootprintLevel, maxLevels int) []marketdata.FootprintLevel {
	levels := make([]marketdata.FootprintLevel, 0, len(levelMap))
	for _, level := range levelMap {
		levels = append(levels, *level)
	}
	sort.Slice(levels, func(i, j int) bool {
		return levels[i].Price < levels[j].Price
	})
	if maxLevels > 0 && len(levels) > maxLevels {
		levels = levels[:maxLevels]
	}
	return levels
}

func footprintPOC(levelMap map[float64]*marketdata.FootprintLevel) float64 {
	poc := 0.0
	maxVol := -1.0
	for _, level := range levelMap {
		if level.TotalVol > maxVol || (level.TotalVol == maxVol && (poc == 0 || level.Price < poc)) {
			poc = level.Price
			maxVol = level.TotalVol
		}
	}
	return poc
}

func normalizeFootprintPrice(price float64, tickSize float64) float64 {
	tickSize = normalizeFootprintTickSize(tickSize)
	return math.Round(price/tickSize) * tickSize
}

func normalizeFootprintTickSize(tickSize float64) float64 {
	if tickSize <= 0 || math.IsNaN(tickSize) || math.IsInf(tickSize, 0) {
		return DefaultFootprintTickSize
	}
	return tickSize
}

func validFootprintTrade(trade marketdata.Trade) bool {
	return trade.TsExchange > 0 &&
		trade.Price > 0 &&
		trade.Qty > 0 &&
		!math.IsNaN(trade.Price) &&
		!math.IsNaN(trade.Qty) &&
		!math.IsInf(trade.Price, 0) &&
		!math.IsInf(trade.Qty, 0)
}
