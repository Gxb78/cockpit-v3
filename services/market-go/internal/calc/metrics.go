package calc

import (
	"math"
	"sort"

	"cockpit-v6-market-go/internal/storage"
)

// ImbalanceThreshold is the minimum ratio for a level to be considered imbalanced.
const ImbalanceThreshold = 3.0

// StackedMinRun is the minimum consecutive levels for stacked imbalance.
const StackedMinRun = 3

// AbsorptionPercentile is the volume percentile threshold for absorption.
const AbsorptionPercentile = 0.80

// ExhaustionPercentile is the volume percentile threshold for exhaustion.
const ExhaustionPercentile = 0.20

// CandleMetrics holds all derived metrics for a single footprint candle.
type CandleMetrics struct {
	MaxImbalanceRatio        float64
	BuyImbalanceCount        int
	SellImbalanceCount       int
	StackedBuyImbalanceCount int
	StackedSellImbalanceCount int
	HasBuyAbsorption         bool
	HasSellAbsorption        bool
	AbsorptionPriceBuy       float64
	AbsorptionPriceSell      float64
	IsExhaustionHigh         bool
	IsExhaustionLow          bool
	IsUnfinishedHigh         bool
	IsUnfinishedLow          bool
}

// OHLCData captures the open/high/low/close of a candle for metrics computation.
type OHLCData struct {
	Open  float64
	High  float64
	Low   float64
	Close float64
}

// ComputeMetrics derives all footprint metrics from price levels and OHLC.
// levels must be sorted by Price ascending.
func ComputeMetrics(levels []storage.PriceLevel, ohlc OHLCData, candleDelta float64) CandleMetrics {
	if len(levels) == 0 {
		return CandleMetrics{}
	}

	// Ensure sorted
	if !sort.SliceIsSorted(levels, func(i, j int) bool { return levels[i].Price < levels[j].Price }) {
		sorted := make([]storage.PriceLevel, len(levels))
		copy(sorted, levels)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i].Price < sorted[j].Price })
		levels = sorted
	}

	m := CandleMetrics{}

	// ── Pass 1: compute level volumes and track imbalance ──
	type levelInfo struct {
		volume         float64
		buyVol         float64
		sellVol        float64
		isBuyImb       bool
		isSellImb      bool
		imbalanceRatio float64
	}

	infos := make([]levelInfo, len(levels))
	var totalLevelVol float64

	for i, l := range levels {
		vol := l.BuyVolume + l.SellVolume
		totalLevelVol += vol
		buy := l.BuyVolume
		sell := l.SellVolume

		// Imbalance ratio (avoid div by zero)
		minVol := math.Min(buy, sell)
		var ratio float64
		if minVol > 0 {
			ratio = math.Max(buy, sell) / minVol
		} else if buy > 0 {
			ratio = math.Inf(1) // only buy volume → infinite imbalance
		} else if sell > 0 {
			ratio = math.Inf(1) // only sell volume
		}

		infos[i] = levelInfo{
			volume:         vol,
			buyVol:         buy,
			sellVol:        sell,
			isBuyImb:       buy >= sell*ImbalanceThreshold,
			isSellImb:      sell >= buy*ImbalanceThreshold,
			imbalanceRatio: ratio,
		}

		if ratio > m.MaxImbalanceRatio {
			m.MaxImbalanceRatio = ratio
		}
		if infos[i].isBuyImb {
			m.BuyImbalanceCount++
		}
		if infos[i].isSellImb {
			m.SellImbalanceCount++
		}
	}

	// ── Pass 2: stacked imbalance (consecutive runs) ──
	buyRun := 0
	sellRun := 0
	for _, info := range infos {
		if info.isBuyImb {
			buyRun++
			sellRun = 0
			if buyRun == StackedMinRun {
				m.StackedBuyImbalanceCount++
			}
		} else if info.isSellImb {
			sellRun++
			buyRun = 0
			if sellRun == StackedMinRun {
				m.StackedSellImbalanceCount++
			}
		} else {
			buyRun = 0
			sellRun = 0
		}
	}

	// ── Pass 3: absorption ──
	// Volume at high (last level) and low (first level)
	volAtLow := infos[0].volume
	volAtHigh := infos[len(infos)-1].volume

	// Find the 80th percentile level volume
	var sortedVols []float64
	for _, info := range infos {
		sortedVols = append(sortedVols, info.volume)
	}
	sort.Slice(sortedVols, func(i, j int) bool { return sortedVols[i] < sortedVols[j] })
	p80Idx := int(float64(len(sortedVols)-1) * AbsorptionPercentile)
	p80Vol := sortedVols[p80Idx]
	p20Idx := int(float64(len(sortedVols)-1) * ExhaustionPercentile)
	p20Vol := sortedVols[p20Idx]

	// Check each level for absorption
	for i, info := range infos {
		if info.volume >= p80Vol && info.volume > 0 {
			price := levels[i].Price

			// Buy absorption: strong buy volume but price rejected
			buyDelta := info.buyVol - info.sellVol
			if buyDelta > 0 {
				buyRatio := buyDelta / candleDelta
				if candleDelta > 0 && buyRatio >= 0.7 {
					// Price rejected: close not significantly above open
					if ohlc.Close <= ohlc.Open || (ohlc.High-ohlc.Close) > (ohlc.High-ohlc.Low)*0.3 {
						if !m.HasBuyAbsorption {
							m.HasBuyAbsorption = true
							m.AbsorptionPriceBuy = price
						}
					}
				}
			}

			// Sell absorption: strong sell volume but price rejected
			if buyDelta < 0 {
				sellRatio := -buyDelta / math.Abs(candleDelta)
				if candleDelta != 0 && sellRatio >= 0.7 {
					// Price rejected: close not significantly below open
					if ohlc.Close >= ohlc.Open || (ohlc.Close-ohlc.Low) > (ohlc.High-ohlc.Low)*0.3 {
						if !m.HasSellAbsorption {
							m.HasSellAbsorption = true
							m.AbsorptionPriceSell = price
						}
					}
				}
			}
		}
	}

	// ── Pass 4: exhaustion / unfinished auction ──
	// Exhaustion: low volume at the extreme
	m.IsExhaustionHigh = volAtHigh <= p20Vol && volAtHigh > 0
	m.IsExhaustionLow = volAtLow <= p20Vol && volAtLow > 0

	// Unfinished auction: high volume at the extreme
	m.IsUnfinishedHigh = volAtHigh >= p80Vol
	m.IsUnfinishedLow = volAtLow >= p80Vol

	// Cap infinite ratios for JSON serialization
	if math.IsInf(m.MaxImbalanceRatio, 1) || m.MaxImbalanceRatio > 1e6 {
		m.MaxImbalanceRatio = 1e6
	}

	return m
}
