package calc

import (
	"sort"
	"strings"
	"sync"
	"time"

	"cockpit-v6-market-go/internal/marketdata"
)

type DeltaCalculator struct {
	mu           sync.Mutex
	intervals    []int64
	sessionReset string
	throttleMs   int64
	current      map[deltaKey]*bucketState
	closedCVD    map[deltaKey]float64
	lastEmitMs   map[deltaKey]int64
	cvdBySymbol  map[string]float64
	session      SessionInfo
}

type Snapshot struct {
	CurrentSessionID    string
	CurrentSessionStart int64
	CVDBySymbol         map[string]float64
}

type deltaKey struct {
	exchange   string
	symbol     string
	intervalMs int64
}

type bucketState struct {
	sessionID string
	bucket    marketdata.DeltaBucket
}

func NewDeltaCalculator(intervals []int64, sessionReset string, throttle time.Duration) *DeltaCalculator {
	normalized := normalizeIntervals(intervals)
	if sessionReset == "" {
		sessionReset = SessionResetUTCDay
	}
	return &DeltaCalculator{
		intervals:    normalized,
		sessionReset: sessionReset,
		throttleMs:   throttle.Milliseconds(),
		current:      make(map[deltaKey]*bucketState),
		closedCVD:    make(map[deltaKey]float64),
		lastEmitMs:   make(map[deltaKey]int64),
		cvdBySymbol:  make(map[string]float64),
	}
}

func (c *DeltaCalculator) Intervals() []int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]int64(nil), c.intervals...)
}

func (c *DeltaCalculator) UpdateTrade(trade marketdata.Trade) []marketdata.DeltaBucket {
	return c.UpdateTradeAt(trade, time.Now().UnixMilli())
}

func (c *DeltaCalculator) UpdateTradeAt(trade marketdata.Trade, emitTimeMs int64) []marketdata.DeltaBucket {
	side := strings.ToLower(strings.TrimSpace(trade.Side))
	if side != "buy" && side != "sell" {
		return nil
	}
	if trade.Qty <= 0 || trade.TsExchange <= 0 {
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	session := SessionFor(trade.TsExchange, c.sessionReset)
	c.session = session

	out := make([]marketdata.DeltaBucket, 0, len(c.intervals))
	for _, intervalMs := range c.intervals {
		key := deltaKey{exchange: trade.Exchange, symbol: trade.Symbol, intervalMs: intervalMs}
		start := bucketStart(trade.TsExchange, intervalMs)
		state := c.current[key]

		if state != nil && state.sessionID != session.ID {
			delete(c.current, key)
			delete(c.closedCVD, key)
			delete(c.lastEmitMs, key)
			state = nil
		}

		if state != nil && state.bucket.StartTime != start {
			closed := state.bucket
			closed.Closed = true
			out = append(out, closed)
			c.closedCVD[key] += closed.Delta
			state = nil
		}

		if state == nil {
			state = &bucketState{
				sessionID: session.ID,
				bucket: marketdata.DeltaBucket{
					Exchange:   trade.Exchange,
					Symbol:     trade.Symbol,
					IntervalMs: intervalMs,
					StartTime:  start,
					EndTime:    start + intervalMs,
					Closed:     false,
				},
			}
			c.current[key] = state
		}

		if side == "buy" {
			state.bucket.BuyVol += trade.Qty
		} else {
			state.bucket.SellVol += trade.Qty
		}
		state.bucket.Delta = state.bucket.BuyVol - state.bucket.SellVol
		state.bucket.CVD = c.closedCVD[key] + state.bucket.Delta
		c.cvdBySymbol[trade.Symbol] = state.bucket.CVD

		if c.shouldEmitLive(key, emitTimeMs) {
			out = append(out, state.bucket)
			c.lastEmitMs[key] = emitTimeMs
		}
	}

	return out
}

func (c *DeltaCalculator) Snapshot() Snapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	return Snapshot{
		CurrentSessionID:    c.session.ID,
		CurrentSessionStart: c.session.Start,
		CVDBySymbol:         copyFloatMap(c.cvdBySymbol),
	}
}

func (c *DeltaCalculator) shouldEmitLive(key deltaKey, emitTimeMs int64) bool {
	if c.throttleMs <= 0 {
		return true
	}
	last := c.lastEmitMs[key]
	return last == 0 || emitTimeMs-last >= c.throttleMs
}

func bucketStart(tsMillis int64, intervalMs int64) int64 {
	return (tsMillis / intervalMs) * intervalMs
}

func normalizeIntervals(intervals []int64) []int64 {
	out := make([]int64, 0, len(intervals))
	seen := make(map[int64]struct{})
	for _, interval := range intervals {
		if interval <= 0 {
			continue
		}
		if _, ok := seen[interval]; ok {
			continue
		}
		seen[interval] = struct{}{}
		out = append(out, interval)
	}
	if len(out) == 0 {
		out = []int64{1000, 5000, 60000}
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func copyFloatMap(in map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}
