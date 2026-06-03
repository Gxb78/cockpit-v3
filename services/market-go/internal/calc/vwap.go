package calc

import (
	"math"
	"sync"
	"time"

	"cockpit-v6-market-go/internal/marketdata"
)

const VWAPSourceLive = "live"

type VWAPCalculator struct {
	mu           sync.Mutex
	enabled      bool
	sessionReset string
	throttleMs   int64
	states       map[vwapKey]marketdata.VWAPState
	lastEmitMs   map[vwapKey]int64
}

type VWAPSnapshot struct {
	Enabled               bool
	Session               string
	VWAPBySymbol          map[string]float64
	CoverageStartBySymbol map[string]int64
	IsWarmBySymbol        map[string]bool
}

type vwapKey struct {
	exchange string
	symbol   string
}

func NewVWAPCalculator(enabled bool, sessionReset string, emitEvery time.Duration) *VWAPCalculator {
	if sessionReset == "" {
		sessionReset = SessionResetUTCDay
	}
	return &VWAPCalculator{
		enabled:      enabled,
		sessionReset: sessionReset,
		throttleMs:   emitEvery.Milliseconds(),
		states:       make(map[vwapKey]marketdata.VWAPState),
		lastEmitMs:   make(map[vwapKey]int64),
	}
}

func (c *VWAPCalculator) Enabled() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.enabled
}

func (c *VWAPCalculator) Session() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.sessionReset
}

func (c *VWAPCalculator) UpdateTrade(trade marketdata.Trade) (marketdata.VWAPState, bool) {
	return c.UpdateTradeAt(trade, time.Now().UnixMilli())
}

func (c *VWAPCalculator) UpdateTradeAt(trade marketdata.Trade, emitTimeMs int64) (marketdata.VWAPState, bool) {
	if !c.enabled || !validVWAPTrade(trade) {
		return marketdata.VWAPState{}, false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	session := SessionFor(trade.TsExchange, c.sessionReset)
	key := vwapKey{exchange: trade.Exchange, symbol: trade.Symbol}
	state, ok := c.states[key]
	if !ok || state.SessionID != session.ID {
		state = marketdata.VWAPState{
			Exchange:      trade.Exchange,
			Symbol:        trade.Symbol,
			SessionID:     session.ID,
			SessionStart:  session.Start,
			CoverageStart: trade.TsExchange,
			Source:        VWAPSourceLive,
			IsWarm:        false,
		}
		delete(c.lastEmitMs, key)
	}

	state.LastUpdateTs = trade.TsExchange
	state.CumPV += trade.Price * trade.Qty
	state.CumVol += trade.Qty
	if state.CumVol > 0 {
		state.Value = state.CumPV / state.CumVol
	} else {
		state.Value = 0
	}
	c.states[key] = state

	if !c.shouldEmitLive(key, emitTimeMs) {
		return marketdata.VWAPState{}, false
	}
	c.lastEmitMs[key] = emitTimeMs
	return state, true
}

func (c *VWAPCalculator) Snapshot() VWAPSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()

	values := make(map[string]float64, len(c.states))
	coverage := make(map[string]int64, len(c.states))
	warm := make(map[string]bool, len(c.states))
	for _, state := range c.states {
		values[state.Symbol] = state.Value
		coverage[state.Symbol] = state.CoverageStart
		warm[state.Symbol] = state.IsWarm
	}
	return VWAPSnapshot{
		Enabled:               c.enabled,
		Session:               c.sessionReset,
		VWAPBySymbol:          values,
		CoverageStartBySymbol: coverage,
		IsWarmBySymbol:        warm,
	}
}

func (c *VWAPCalculator) shouldEmitLive(key vwapKey, emitTimeMs int64) bool {
	if c.throttleMs <= 0 {
		return true
	}
	last := c.lastEmitMs[key]
	return last == 0 || emitTimeMs-last >= c.throttleMs
}

func validVWAPTrade(trade marketdata.Trade) bool {
	return trade.TsExchange > 0 &&
		trade.Price > 0 &&
		trade.Qty > 0 &&
		!math.IsNaN(trade.Price) &&
		!math.IsNaN(trade.Qty) &&
		!math.IsInf(trade.Price, 0) &&
		!math.IsInf(trade.Qty, 0)
}
