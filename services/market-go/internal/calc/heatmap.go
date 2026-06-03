package calc

import (
	"math"
	"sort"

	"cockpit-v6-market-go/internal/marketdata"
	"cockpit-v6-market-go/pkg/protocol"
)

const DefaultHeatmapTickSize = 1.0

type HeatmapConfig struct {
	Depth     int
	TickSize  float64
	MaxLevels int
}

func BuildHeatmapFrame(snapshot marketdata.OrderBookSnapshot, cfg HeatmapConfig) marketdata.HeatmapFrame {
	depth := cfg.Depth
	if depth <= 0 {
		depth = snapshot.Depth
	}
	if depth <= 0 {
		depth = 20
	}
	tickSize := cfg.TickSize
	if tickSize <= 0 || math.IsNaN(tickSize) || math.IsInf(tickSize, 0) {
		tickSize = DefaultHeatmapTickSize
	}
	maxLevels := cfg.MaxLevels
	if maxLevels <= 0 {
		maxLevels = 100
	}

	levelsByPrice := make(map[float64]*marketdata.HeatmapLevel)
	addSide := func(levels []marketdata.OrderBookLevel, isBid bool) {
		for i, level := range levels {
			if i >= depth || len(levelsByPrice) >= maxLevels && levelsByPrice[normalizeHeatmapPrice(level.Price, tickSize)] == nil {
				break
			}
			if level.Price <= 0 || level.Size < 0 || math.IsNaN(level.Price) || math.IsNaN(level.Size) || math.IsInf(level.Price, 0) || math.IsInf(level.Size, 0) {
				continue
			}
			price := normalizeHeatmapPrice(level.Price, tickSize)
			entry := levelsByPrice[price]
			if entry == nil {
				entry = &marketdata.HeatmapLevel{Price: price}
				levelsByPrice[price] = entry
			}
			if isBid {
				entry.BidSize += level.Size
			} else {
				entry.AskSize += level.Size
			}
		}
	}

	addSide(snapshot.Bids, true)
	addSide(snapshot.Asks, false)

	levels := make([]marketdata.HeatmapLevel, 0, len(levelsByPrice))
	maxTotal := 0.0
	for _, level := range levelsByPrice {
		level.TotalSize = level.BidSize + level.AskSize
		if level.TotalSize > maxTotal {
			maxTotal = level.TotalSize
		}
		levels = append(levels, *level)
	}
	sort.Slice(levels, func(i, j int) bool {
		return levels[i].Price < levels[j].Price
	})
	if len(levels) > maxLevels {
		levels = levels[:maxLevels]
	}

	priceMin := 0.0
	priceMax := 0.0
	if len(levels) > 0 {
		priceMin = levels[0].Price
		priceMax = levels[len(levels)-1].Price
	}
	for i := range levels {
		if maxTotal > 0 {
			levels[i].Intensity = clamp01(levels[i].TotalSize / maxTotal)
		}
	}

	tsLocal := snapshot.TsLocal
	if tsLocal == 0 {
		tsLocal = protocol.NowMillis()
	}
	return marketdata.HeatmapFrame{
		Exchange:   snapshot.Exchange,
		Symbol:     snapshot.Symbol,
		TsExchange: snapshot.TsExchange,
		TsLocal:    tsLocal,
		Mid:        snapshot.Mid,
		BestBid:    snapshot.BestBid,
		BestAsk:    snapshot.BestAsk,
		PriceMin:   priceMin,
		PriceMax:   priceMax,
		TickSize:   tickSize,
		Levels:     levels,
		Source:     snapshot.Source,
		Depth:      minInt(depth, len(levels)),
	}
}

func normalizeHeatmapPrice(price float64, tickSize float64) float64 {
	if tickSize <= 0 {
		tickSize = DefaultHeatmapTickSize
	}
	return math.Round(price/tickSize) * tickSize
}

func clamp01(value float64) float64 {
	if value < 0 || math.IsNaN(value) {
		return 0
	}
	if value > 1 || math.IsInf(value, 0) {
		return 1
	}
	return value
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
