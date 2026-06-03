package engine

import (
	"sync"
	"sync/atomic"
	"time"

	"cockpit-v6-market-go/internal/marketdata"
)

type Metrics struct {
	Service                  string             `json:"service"`
	Exchange                 string             `json:"exchange"`
	Symbols                  []string           `json:"symbols"`
	MockMode                 bool               `json:"mockMode"`
	Connected                bool               `json:"connected"`
	UptimeSeconds            int64              `json:"uptimeSeconds"`
	TotalMessagesIn          uint64             `json:"totalMessagesIn"`
	TotalTradesOut           uint64             `json:"totalTradesOut"`
	TotalDeltaBucketsOut     uint64             `json:"totalDeltaBucketsOut"`
	TotalVWAPOut             uint64             `json:"totalVWAPOut"`
	TotalOrderBookOut        uint64             `json:"totalOrderBookOut"`
	TotalHeatmapFramesOut    uint64             `json:"totalHeatmapFramesOut"`
	TotalFootprintCandlesOut uint64             `json:"totalFootprintCandlesOut"`
	TotalFootprintClosedOut  uint64             `json:"totalFootprintClosedOut"`
	TotalStreamClients       int64              `json:"totalStreamClients"`
	ActiveDeltaIntervals     []int64            `json:"activeDeltaIntervals"`
	CurrentSessionID         string             `json:"currentSessionId"`
	CurrentSessionStart      int64              `json:"currentSessionStart"`
	VWAPEnabled              bool               `json:"vwapEnabled"`
	VWAPSession              string             `json:"vwapSession"`
	BookEnabled              bool               `json:"bookEnabled"`
	HeatmapEnabled           bool               `json:"heatmapEnabled"`
	FootprintEnabled         bool               `json:"footprintEnabled"`
	FootprintIntervalMs      int64              `json:"footprintIntervalMs"`
	FootprintTickSize        float64            `json:"footprintTickSize"`
	LastTradeTsExchange      int64              `json:"lastTradeTsExchange"`
	LastTradeTsLocal         int64              `json:"lastTradeTsLocal"`
	LastDeltaTsLocal         int64              `json:"lastDeltaTsLocal"`
	LastVWAPTsLocal          int64              `json:"lastVWAPTsLocal"`
	LastBookTsExchange       int64              `json:"lastBookTsExchange"`
	LastBookTsLocal          int64              `json:"lastBookTsLocal"`
	LastHeatmapTsLocal       int64              `json:"lastHeatmapTsLocal"`
	LastFootprintTsLocal     int64              `json:"lastFootprintTsLocal"`
	LastError                string             `json:"lastError"`
	ReconnectCount           uint64             `json:"reconnectCount"`
	CVDBySymbol              map[string]float64 `json:"cvdBySymbol,omitempty"`
	VWAPBySymbol             map[string]float64 `json:"vwapBySymbol,omitempty"`
	VWAPCoverageStart        map[string]int64   `json:"vwapCoverageStartBySymbol,omitempty"`
	VWAPIsWarm               map[string]bool    `json:"vwapIsWarmBySymbol,omitempty"`
	OrderBookDepth           map[string]int     `json:"orderBookDepthBySymbol,omitempty"`
	BestBidBySymbol          map[string]float64 `json:"bestBidBySymbol,omitempty"`
	BestAskBySymbol          map[string]float64 `json:"bestAskBySymbol,omitempty"`
	SpreadBySymbol           map[string]float64 `json:"spreadBySymbol,omitempty"`
	MidBySymbol              map[string]float64 `json:"midBySymbol,omitempty"`
	HeatmapDepthBySymbol     map[string]int     `json:"heatmapDepthBySymbol,omitempty"`
	HeatmapLevelsBySymbol    map[string]int     `json:"heatmapLevelsBySymbol,omitempty"`
	HeatmapPriceMinBySymbol  map[string]float64 `json:"heatmapPriceMinBySymbol,omitempty"`
	HeatmapPriceMaxBySymbol  map[string]float64 `json:"heatmapPriceMaxBySymbol,omitempty"`
	FootprintLevelsBySymbol  map[string]int     `json:"footprintLevelsBySymbol,omitempty"`
	FootprintPOCBySymbol     map[string]float64 `json:"footprintPOCBySymbol,omitempty"`
	FootprintDeltaBySymbol   map[string]float64 `json:"footprintDeltaBySymbol,omitempty"`
	FootprintVolumeBySymbol  map[string]float64 `json:"footprintVolumeBySymbol,omitempty"`
}

type metricState struct {
	connected                atomic.Bool
	totalMessagesIn          atomic.Uint64
	totalTradesOut           atomic.Uint64
	totalDeltaBucketsOut     atomic.Uint64
	totalVWAPOut             atomic.Uint64
	totalOrderBookOut        atomic.Uint64
	totalHeatmapFramesOut    atomic.Uint64
	totalFootprintCandlesOut atomic.Uint64
	totalFootprintClosedOut  atomic.Uint64
	totalStreamClients       atomic.Int64
	lastTradeTsExchange      atomic.Int64
	lastTradeTsLocal         atomic.Int64
	lastDeltaTsLocal         atomic.Int64
	lastVWAPTsLocal          atomic.Int64
	lastBookTsExchange       atomic.Int64
	lastBookTsLocal          atomic.Int64
	lastHeatmapTsLocal       atomic.Int64
	lastFootprintTsLocal     atomic.Int64
	reconnectCount           atomic.Uint64
	lastErrorMu              sync.RWMutex
	lastError                string
	bookMu                   sync.RWMutex
	orderBookDepth           map[string]int
	bestBidBySymbol          map[string]float64
	bestAskBySymbol          map[string]float64
	spreadBySymbol           map[string]float64
	midBySymbol              map[string]float64
	heatmapDepthBySymbol     map[string]int
	heatmapLevelsBySymbol    map[string]int
	heatmapPriceMinBySymbol  map[string]float64
	heatmapPriceMaxBySymbol  map[string]float64
	footprintLevelsBySymbol  map[string]int
	footprintPOCBySymbol     map[string]float64
	footprintDeltaBySymbol   map[string]float64
	footprintVolumeBySymbol  map[string]float64
}

func (e *Engine) Metrics() Metrics {
	e.metrics.lastErrorMu.RLock()
	lastError := e.metrics.lastError
	e.metrics.lastErrorMu.RUnlock()
	deltaSnapshot := e.delta.Snapshot()
	vwapSnapshot := e.vwap.Snapshot()
	bookDepth, bestBid, bestAsk, spread, mid, heatmapDepth, heatmapLevels, heatmapPriceMin, heatmapPriceMax, footprintLevels, footprintPOC, footprintDelta, footprintVolume := e.bookSnapshots()

	return Metrics{
		Service:                  ServiceName,
		Exchange:                 e.cfg.Exchange,
		Symbols:                  append([]string(nil), e.cfg.Symbols...),
		MockMode:                 e.cfg.MockMode,
		Connected:                e.metrics.connected.Load(),
		UptimeSeconds:            int64(time.Since(e.start).Seconds()),
		TotalMessagesIn:          e.metrics.totalMessagesIn.Load(),
		TotalTradesOut:           e.metrics.totalTradesOut.Load(),
		TotalDeltaBucketsOut:     e.metrics.totalDeltaBucketsOut.Load(),
		TotalVWAPOut:             e.metrics.totalVWAPOut.Load(),
		TotalOrderBookOut:        e.metrics.totalOrderBookOut.Load(),
		TotalHeatmapFramesOut:    e.metrics.totalHeatmapFramesOut.Load(),
		TotalFootprintCandlesOut: e.metrics.totalFootprintCandlesOut.Load(),
		TotalFootprintClosedOut:  e.metrics.totalFootprintClosedOut.Load(),
		TotalStreamClients:       e.metrics.totalStreamClients.Load(),
		ActiveDeltaIntervals:     e.delta.Intervals(),
		CurrentSessionID:         deltaSnapshot.CurrentSessionID,
		CurrentSessionStart:      deltaSnapshot.CurrentSessionStart,
		VWAPEnabled:              vwapSnapshot.Enabled,
		VWAPSession:              vwapSnapshot.Session,
		BookEnabled:              e.cfg.BookEnabled,
		HeatmapEnabled:           e.cfg.HeatmapEnabled,
		FootprintEnabled:         e.cfg.FootprintEnabled,
		FootprintIntervalMs:      e.cfg.FootprintIntervalMs,
		FootprintTickSize:        e.cfg.FootprintTickSize,
		LastTradeTsExchange:      e.metrics.lastTradeTsExchange.Load(),
		LastTradeTsLocal:         e.metrics.lastTradeTsLocal.Load(),
		LastDeltaTsLocal:         e.metrics.lastDeltaTsLocal.Load(),
		LastVWAPTsLocal:          e.metrics.lastVWAPTsLocal.Load(),
		LastBookTsExchange:       e.metrics.lastBookTsExchange.Load(),
		LastBookTsLocal:          e.metrics.lastBookTsLocal.Load(),
		LastHeatmapTsLocal:       e.metrics.lastHeatmapTsLocal.Load(),
		LastFootprintTsLocal:     e.metrics.lastFootprintTsLocal.Load(),
		LastError:                lastError,
		ReconnectCount:           e.metrics.reconnectCount.Load(),
		CVDBySymbol:              deltaSnapshot.CVDBySymbol,
		VWAPBySymbol:             vwapSnapshot.VWAPBySymbol,
		VWAPCoverageStart:        vwapSnapshot.CoverageStartBySymbol,
		VWAPIsWarm:               vwapSnapshot.IsWarmBySymbol,
		OrderBookDepth:           bookDepth,
		BestBidBySymbol:          bestBid,
		BestAskBySymbol:          bestAsk,
		SpreadBySymbol:           spread,
		MidBySymbol:              mid,
		HeatmapDepthBySymbol:     heatmapDepth,
		HeatmapLevelsBySymbol:    heatmapLevels,
		HeatmapPriceMinBySymbol:  heatmapPriceMin,
		HeatmapPriceMaxBySymbol:  heatmapPriceMax,
		FootprintLevelsBySymbol:  footprintLevels,
		FootprintPOCBySymbol:     footprintPOC,
		FootprintDeltaBySymbol:   footprintDelta,
		FootprintVolumeBySymbol:  footprintVolume,
	}
}

func (e *Engine) SetConnected(connected bool) {
	e.metrics.connected.Store(connected)
	if connected {
		e.RecordError("")
	}
}

func (e *Engine) RecordMessageIn() uint64 {
	return e.metrics.totalMessagesIn.Add(1)
}

func (e *Engine) RecordTradeOut(trade marketdata.Trade) uint64 {
	e.metrics.lastTradeTsExchange.Store(trade.TsExchange)
	e.metrics.lastTradeTsLocal.Store(trade.TsLocal)
	return e.metrics.totalTradesOut.Add(1)
}

func (e *Engine) RecordDeltaBucketOut(_ marketdata.DeltaBucket, tsLocal int64) uint64 {
	e.metrics.lastDeltaTsLocal.Store(tsLocal)
	return e.metrics.totalDeltaBucketsOut.Add(1)
}

func (e *Engine) RecordVWAPOut(_ marketdata.VWAPState, tsLocal int64) uint64 {
	e.metrics.lastVWAPTsLocal.Store(tsLocal)
	return e.metrics.totalVWAPOut.Add(1)
}

func (e *Engine) RecordOrderBookOut(snapshot marketdata.OrderBookSnapshot, tsLocal int64) uint64 {
	e.metrics.lastBookTsExchange.Store(snapshot.TsExchange)
	e.metrics.lastBookTsLocal.Store(tsLocal)

	e.metrics.bookMu.Lock()
	if e.metrics.orderBookDepth == nil {
		e.metrics.orderBookDepth = make(map[string]int)
		e.metrics.bestBidBySymbol = make(map[string]float64)
		e.metrics.bestAskBySymbol = make(map[string]float64)
		e.metrics.spreadBySymbol = make(map[string]float64)
		e.metrics.midBySymbol = make(map[string]float64)
	}
	e.metrics.orderBookDepth[snapshot.Symbol] = snapshot.Depth
	e.metrics.bestBidBySymbol[snapshot.Symbol] = snapshot.BestBid
	e.metrics.bestAskBySymbol[snapshot.Symbol] = snapshot.BestAsk
	e.metrics.spreadBySymbol[snapshot.Symbol] = snapshot.Spread
	e.metrics.midBySymbol[snapshot.Symbol] = snapshot.Mid
	e.metrics.bookMu.Unlock()

	return e.metrics.totalOrderBookOut.Add(1)
}

func (e *Engine) RecordHeatmapFrameOut(frame marketdata.HeatmapFrame, tsLocal int64) uint64 {
	e.metrics.lastHeatmapTsLocal.Store(tsLocal)

	e.metrics.bookMu.Lock()
	if e.metrics.heatmapDepthBySymbol == nil {
		e.metrics.heatmapDepthBySymbol = make(map[string]int)
		e.metrics.heatmapLevelsBySymbol = make(map[string]int)
		e.metrics.heatmapPriceMinBySymbol = make(map[string]float64)
		e.metrics.heatmapPriceMaxBySymbol = make(map[string]float64)
	}
	e.metrics.heatmapDepthBySymbol[frame.Symbol] = frame.Depth
	e.metrics.heatmapLevelsBySymbol[frame.Symbol] = len(frame.Levels)
	e.metrics.heatmapPriceMinBySymbol[frame.Symbol] = frame.PriceMin
	e.metrics.heatmapPriceMaxBySymbol[frame.Symbol] = frame.PriceMax
	e.metrics.bookMu.Unlock()

	return e.metrics.totalHeatmapFramesOut.Add(1)
}

func (e *Engine) RecordFootprintCandleOut(candle marketdata.FootprintCandle, tsLocal int64) uint64 {
	e.metrics.lastFootprintTsLocal.Store(tsLocal)

	e.metrics.bookMu.Lock()
	if e.metrics.footprintLevelsBySymbol == nil {
		e.metrics.footprintLevelsBySymbol = make(map[string]int)
		e.metrics.footprintPOCBySymbol = make(map[string]float64)
		e.metrics.footprintDeltaBySymbol = make(map[string]float64)
		e.metrics.footprintVolumeBySymbol = make(map[string]float64)
	}
	e.metrics.footprintLevelsBySymbol[candle.Symbol] = len(candle.Levels)
	e.metrics.footprintPOCBySymbol[candle.Symbol] = candle.POC
	e.metrics.footprintDeltaBySymbol[candle.Symbol] = candle.Delta
	e.metrics.footprintVolumeBySymbol[candle.Symbol] = candle.Volume
	e.metrics.bookMu.Unlock()

	if candle.Closed {
		e.metrics.totalFootprintClosedOut.Add(1)
	}
	return e.metrics.totalFootprintCandlesOut.Add(1)
}

func (e *Engine) SetStreamClients(count int) {
	e.metrics.totalStreamClients.Store(int64(count))
}

func (e *Engine) RecordError(message string) {
	e.metrics.lastErrorMu.Lock()
	defer e.metrics.lastErrorMu.Unlock()
	e.metrics.lastError = message
}

func (e *Engine) RecordReconnect() uint64 {
	return e.metrics.reconnectCount.Add(1)
}

func (e *Engine) bookSnapshots() (map[string]int, map[string]float64, map[string]float64, map[string]float64, map[string]float64, map[string]int, map[string]int, map[string]float64, map[string]float64, map[string]int, map[string]float64, map[string]float64, map[string]float64) {
	e.metrics.bookMu.RLock()
	defer e.metrics.bookMu.RUnlock()
	return cloneIntMap(e.metrics.orderBookDepth),
		cloneFloatMap(e.metrics.bestBidBySymbol),
		cloneFloatMap(e.metrics.bestAskBySymbol),
		cloneFloatMap(e.metrics.spreadBySymbol),
		cloneFloatMap(e.metrics.midBySymbol),
		cloneIntMap(e.metrics.heatmapDepthBySymbol),
		cloneIntMap(e.metrics.heatmapLevelsBySymbol),
		cloneFloatMap(e.metrics.heatmapPriceMinBySymbol),
		cloneFloatMap(e.metrics.heatmapPriceMaxBySymbol),
		cloneIntMap(e.metrics.footprintLevelsBySymbol),
		cloneFloatMap(e.metrics.footprintPOCBySymbol),
		cloneFloatMap(e.metrics.footprintDeltaBySymbol),
		cloneFloatMap(e.metrics.footprintVolumeBySymbol)
}

func cloneIntMap(in map[string]int) map[string]int {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]int, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func cloneFloatMap(in map[string]float64) map[string]float64 {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]float64, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}
