package ws

import (
	"encoding/json"
	"sort"
	"strings"
	"sync"

	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
)

// broadcaster is the subset of *Hub the components depend on to push envelopes
// to all connected stream clients.
type broadcaster interface {
	Broadcast(raw []byte)
}

type CvdPoint struct {
	T int64   `json:"t"`
	V float64 `json:"v"`
}

type DeltaVolPoint struct {
	T     int64   `json:"t"`
	Delta float64 `json:"delta"`
}

type CvdHistoryPayload struct {
	Series   map[string][]CvdPoint `json:"series"`
	DeltaVol []DeltaVolPoint       `json:"deltaVol"`
	Cvd      map[string]float64    `json:"cvd"`
	// Metadata pour distinguer estimation vs trades réels
	Source         string `json:"cvdSource"`      // "ohlcv_estimate" | "real_trades" | "mixed"
	RealTradeCount int    `json:"realTradeCount"` // nombre de trades réels utilisés
	EstimatedUntil int64  `json:"estimatedUntil"` // timestamp ms jusqu'auquel c'est estimé (0 = tout réel)
}

type CvdInitMessage struct {
	Type    string            `json:"type"`
	Payload CvdHistoryPayload `json:"payload"`
}

// cvdTracker owns the running cumulative-volume-delta per symbol (an accumulator
// fed by footprint persistence) and computes/broadcasts the cvd_init history
// envelope from recent trades (falling back to OHLCV estimates from the cached
// 1m candle history). It reads trades and candle history through injected
// accessors so it stays decoupled from where that data lives.
type cvdTracker struct {
	mu       sync.Mutex
	bySymbol map[string]float64

	hub broadcaster
	log *logx.Logger

	// tradesSnapshot returns a copy of the live trade buffer.
	tradesSnapshot func() []marketdata.Trade
	// candleHistory1m returns the cached 1m candle history (for CVD estimation).
	candleHistory1m func() []marketdata.Candle
}

func newCvdTracker(
	hub broadcaster,
	log *logx.Logger,
	tradesSnapshot func() []marketdata.Trade,
	candleHistory1m func() []marketdata.Candle,
) *cvdTracker {
	return &cvdTracker{
		bySymbol:        make(map[string]float64),
		hub:             hub,
		log:             log,
		tradesSnapshot:  tradesSnapshot,
		candleHistory1m: candleHistory1m,
	}
}

// Accumulate adds delta to the running CVD for symbol and returns the new value.
func (c *cvdTracker) Accumulate(symbol string, delta float64) float64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	cvd := c.bySymbol[symbol] + delta
	c.bySymbol[symbol] = cvd
	return cvd
}

// broadcastInit computes the cvd history and broadcasts a cvd_init envelope to
// all connected clients (skipping when there is nothing to send yet).
func (c *cvdTracker) broadcastInit() {
	history := c.computeHistory("1m")
	total := 0
	for _, pts := range history.Series {
		total += len(pts)
	}
	if total == 0 && len(history.DeltaVol) == 0 {
		return // nothing to send yet
	}
	if raw, err := json.Marshal(CvdInitMessage{Type: "cvd_init", Payload: history}); err == nil {
		c.hub.Broadcast(raw)
		c.log.Infof("broadcast cvd_init: %d series points, %d delta points", total, len(history.DeltaVol))
	}
}

// computeHistory builds the CVD series for a timeframe: real trades when present,
// OHLCV estimates from cached candles otherwise. Faithful port of the former
// Server.computeSizeCvdHistory.
func (c *cvdTracker) computeHistory(timeframe string) CvdHistoryPayload {
	intervalMs := intervalMs(timeframe)

	tradesCopy := c.tradesSnapshot()

	// Bucket real trades by interval
	tradesByBucket := make(map[int64][]marketdata.Trade)
	for _, t := range tradesCopy {
		ts := t.TsExchange
		if ts <= 0 {
			ts = t.TsLocal
		}
		if ts <= 0 {
			continue
		}
		bucketStart := (ts / intervalMs) * intervalMs
		tradesByBucket[bucketStart] = append(tradesByBucket[bucketStart], t)
	}

	// Cached 1m candle history to estimate CVD for periods with no real trades.
	historicalCandles := c.candleHistory1m()

	// Build sorted timeline: union of trade buckets + candle timestamps
	timeline := make(map[int64]bool)
	for b := range tradesByBucket {
		timeline[b] = true
	}
	for _, cnd := range historicalCandles {
		bucketStart := (cnd.OpenTime / intervalMs) * intervalMs
		timeline[bucketStart] = true
	}

	var sortedBuckets []int64
	for b := range timeline {
		sortedBuckets = append(sortedBuckets, b)
	}
	sort.Slice(sortedBuckets, func(i, j int) bool {
		return sortedBuckets[i] < sortedBuckets[j]
	})

	var runningCvd float64
	var series []CvdPoint
	var deltaVol []DeltaVolPoint
	realBuckets := 0
	estimatedBuckets := 0
	var lastEstimatedTs int64

	for _, bStart := range sortedBuckets {
		bucketTrades := tradesByBucket[bStart]
		netDelta := 0.0

		if len(bucketTrades) > 0 {
			// Use real trade data (total delta, no size buckets)
			realBuckets++
			for _, t := range bucketTrades {
				signed := t.Qty
				if strings.ToLower(t.Side) == "sell" {
					signed = -t.Qty
				}
				netDelta += signed
			}
		} else if len(historicalCandles) > 0 {
			// Estimate from candle OHLCV data — marked as estimated
			estimatedBuckets++
			lastEstimatedTs = bStart + intervalMs
			for _, cnd := range historicalCandles {
				cbStart := (cnd.OpenTime / intervalMs) * intervalMs
				if cbStart == bStart {
					range_ := cnd.High - cnd.Low
					if range_ > 0 {
						ratio := (cnd.Close - cnd.Open) / range_
						if ratio > 0.5 {
							ratio = 0.5
						} else if ratio < -0.5 {
							ratio = -0.5
						}
						netDelta = cnd.Volume * ratio * 2
					}
					break
				}
			}
		} else {
			continue
		}

		runningCvd += netDelta
		series = append(series, CvdPoint{T: bStart, V: runningCvd})
		deltaVol = append(deltaVol, DeltaVolPoint{T: bStart, Delta: netDelta})
	}

	// Wrap series into a single "total" bucket for backward compat with frontend
	wSeries := map[string][]CvdPoint{"total": series}
	wCvd := map[string]float64{"total": runningCvd}

	// Compute metadata
	source := "real_trades"
	if estimatedBuckets > 0 && realBuckets > 0 {
		source = "mixed"
	} else if estimatedBuckets > 0 && realBuckets == 0 {
		source = "ohlcv_estimate"
	}

	return CvdHistoryPayload{
		Series:         wSeries,
		DeltaVol:       deltaVol,
		Cvd:            wCvd,
		Source:         source,
		RealTradeCount: len(tradesCopy),
		EstimatedUntil: lastEstimatedTs,
	}
}
