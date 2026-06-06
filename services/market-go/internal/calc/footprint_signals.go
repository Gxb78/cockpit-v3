package calc

import (
	"math"

	"cockpit-v6-market-go/internal/marketdata"
)

// Defaults mirror the UI's settings defaults so engine-computed signals and the
// client-side fallback agree at default thresholds.
const (
	DefaultImbalanceRatio     = 3.0
	DefaultImbalanceStack     = 3
	DefaultImbalanceMinVolume = 1.0
	DefaultExhaustionFactor   = 0.35
)

// FootprintSignalConfig holds the thresholds used to derive orderflow signals.
type FootprintSignalConfig struct {
	ImbalanceRatio     float64
	ImbalanceStack     int
	ImbalanceMinVolume float64
	ExhaustionFactor   float64
}

func (c FootprintSignalConfig) withDefaults() FootprintSignalConfig {
	if c.ImbalanceRatio <= 0 {
		c.ImbalanceRatio = DefaultImbalanceRatio
	}
	if c.ImbalanceStack <= 0 {
		c.ImbalanceStack = DefaultImbalanceStack
	}
	if c.ImbalanceMinVolume < 0 {
		c.ImbalanceMinVolume = DefaultImbalanceMinVolume
	}
	if c.ExhaustionFactor <= 0 {
		c.ExhaustionFactor = DefaultExhaustionFactor
	}
	return c
}

// sideRatio mirrors the client formula: denom>0 → num/denom; else num>0 → +Inf; else 0.
func sideRatio(num, denom float64) float64 {
	if denom > 0 {
		return num / denom
	}
	if num > 0 {
		return math.Inf(1)
	}
	return 0
}

// DeriveFootprintSignals computes diagonal-imbalance, stacked-imbalance,
// absorption, exhaustion, and unfinished-auction flags for a footprint candle,
// writing them onto the candle (and per-level imbalance flags onto its levels).
// It is a faithful port of the inspector's client-side deriveMetrics so the two
// agree level-for-level. Levels must be sorted ascending by price (as emitted by
// footprintLevels). Marks SignalsDerived = true.
func DeriveFootprintSignals(candle *marketdata.FootprintCandle, cfg FootprintSignalConfig) {
	if candle == nil {
		return
	}
	cfg = cfg.withDefaults()

	// Reset, then mark as engine-derived even when there are no levels.
	candle.MaxImbalanceRatio = 0
	candle.BuyImbalanceCount = 0
	candle.SellImbalanceCount = 0
	candle.StackedBuyImbalance = 0
	candle.StackedSellImbalance = 0
	candle.HasBuyAbsorption = false
	candle.HasSellAbsorption = false
	candle.IsExhaustionHigh = false
	candle.IsExhaustionLow = false
	candle.IsUnfinishedHigh = false
	candle.IsUnfinishedLow = false
	candle.SignalsDerived = true

	levels := candle.Levels
	n := len(levels)
	if n == 0 {
		return
	}

	imbRatio := cfg.ImbalanceRatio
	minVol := cfg.ImbalanceMinVolume

	maxRatio := 0.0
	buyImb, sellImb := 0, 0
	buyRun, sellRun, maxBuyRun, maxSellRun := 0, 0, 0, 0

	for i := 0; i < n; i++ {
		lvl := &levels[i]
		lvl.BuyImbalance = false
		lvl.SellImbalance = false

		// Buy imbalance: ask volume at P vs bid volume at P-1 (diagonal).
		if i > 0 {
			diagSell := levels[i-1].SellVol
			curBuy := lvl.BuyVol
			if diagSell > minVol && curBuy > minVol {
				r := curBuy / diagSell
				if r >= imbRatio {
					lvl.BuyImbalance = true
				}
				if r > maxRatio {
					maxRatio = r
				}
			}
		}
		// Sell imbalance: bid volume at P vs ask volume at P+1 (diagonal).
		if i < n-1 {
			diagBuy := levels[i+1].BuyVol
			curSell := lvl.SellVol
			if diagBuy > minVol && curSell > minVol {
				r := curSell / diagBuy
				if r >= imbRatio {
					lvl.SellImbalance = true
				}
				if r > maxRatio {
					maxRatio = r
				}
			}
		}

		// Stacked runs (buy branch takes precedence, mirroring the client).
		if lvl.BuyImbalance {
			buyImb++
			buyRun++
			sellRun = 0
		} else if lvl.SellImbalance {
			sellImb++
			sellRun++
			buyRun = 0
		} else {
			buyRun = 0
			sellRun = 0
		}
		if buyRun > maxBuyRun {
			maxBuyRun = buyRun
		}
		if sellRun > maxSellRun {
			maxSellRun = sellRun
		}
	}

	candle.MaxImbalanceRatio = maxRatio
	candle.BuyImbalanceCount = buyImb
	candle.SellImbalanceCount = sellImb
	if maxBuyRun >= cfg.ImbalanceStack {
		candle.StackedBuyImbalance = maxBuyRun
	}
	if maxSellRun >= cfg.ImbalanceStack {
		candle.StackedSellImbalance = maxSellRun
	}

	low := &levels[0]
	high := &levels[n-1]

	// Absorption: aggressive flow at an extreme absorbed by resting size, with
	// price holding (close back through the candle).
	lowBuyRatio := sideRatio(low.BuyVol, low.SellVol)
	highSellRatio := sideRatio(high.SellVol, high.BuyVol)
	candle.HasBuyAbsorption = lowBuyRatio >= imbRatio && candle.Close >= candle.Open
	candle.HasSellAbsorption = highSellRatio >= imbRatio && candle.Close <= candle.Open

	// Exhaustion: an extreme level with unusually thin volume.
	var sumVol float64
	for i := range levels {
		sumVol += levels[i].TotalVol
	}
	avg := sumVol / float64(n)
	if avg > 0 {
		candle.IsExhaustionHigh = high.TotalVol < avg*cfg.ExhaustionFactor
		candle.IsExhaustionLow = low.TotalVol < avg*cfg.ExhaustionFactor
	}

	// Unfinished auction: both sides traded at an extreme (no single-print).
	candle.IsUnfinishedHigh = high.BuyVol > 0 && high.SellVol > 0
	candle.IsUnfinishedLow = low.BuyVol > 0 && low.SellVol > 0
}
