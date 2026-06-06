package calc

import (
	"math"
	"testing"

	"cockpit-v6-market-go/internal/marketdata"
)

func lvl(price, buy, sell float64) marketdata.FootprintLevel {
	return marketdata.FootprintLevel{
		Price:    price,
		BuyVol:   buy,
		SellVol:  sell,
		Delta:    buy - sell,
		TotalVol: buy + sell,
	}
}

func TestDeriveFootprintSignals_BuyImbalanceStack(t *testing.T) {
	candle := &marketdata.FootprintCandle{
		Open:  100,
		Close: 100,
		Levels: []marketdata.FootprintLevel{
			lvl(100, 1, 10),
			lvl(101, 40, 10),
			lvl(102, 40, 10),
			lvl(103, 40, 10),
		},
	}
	// Zero cfg → defaults (ratio 3, stack 3, minVol 1, exhaustion 0.35).
	DeriveFootprintSignals(candle, FootprintSignalConfig{})

	if !candle.SignalsDerived {
		t.Fatalf("SignalsDerived should be true")
	}
	if candle.BuyImbalanceCount != 3 {
		t.Fatalf("BuyImbalanceCount = %d, want 3", candle.BuyImbalanceCount)
	}
	if candle.StackedBuyImbalance != 3 {
		t.Fatalf("StackedBuyImbalance = %d, want 3", candle.StackedBuyImbalance)
	}
	if candle.SellImbalanceCount != 0 || candle.StackedSellImbalance != 0 {
		t.Fatalf("unexpected sell imbalance: %#v", candle)
	}
	if math.Abs(candle.MaxImbalanceRatio-4) > 1e-9 {
		t.Fatalf("MaxImbalanceRatio = %v, want 4", candle.MaxImbalanceRatio)
	}
	if candle.Levels[0].BuyImbalance {
		t.Fatalf("level 0 should not be a buy imbalance")
	}
	for i := 1; i <= 3; i++ {
		if !candle.Levels[i].BuyImbalance {
			t.Fatalf("level %d should be a buy imbalance", i)
		}
	}
	if !candle.IsUnfinishedHigh || !candle.IsUnfinishedLow {
		t.Fatalf("expected unfinished high & low (both sides traded at extremes)")
	}
}

func TestDeriveFootprintSignals_Absorption(t *testing.T) {
	candle := &marketdata.FootprintCandle{
		Open:  100,
		Close: 101, // close >= open → buy absorption eligible
		Levels: []marketdata.FootprintLevel{
			lvl(100, 30, 1), // low: strong buy vs sell → absorbed
			lvl(101, 5, 5),
		},
	}
	DeriveFootprintSignals(candle, FootprintSignalConfig{})
	if !candle.HasBuyAbsorption {
		t.Fatalf("expected buy absorption at low")
	}
	if candle.HasSellAbsorption {
		t.Fatalf("did not expect sell absorption")
	}
}

func TestDeriveFootprintSignals_Exhaustion(t *testing.T) {
	candle := &marketdata.FootprintCandle{
		Open:  100,
		Close: 100,
		Levels: []marketdata.FootprintLevel{
			lvl(100, 20, 20),
			lvl(101, 20, 20),
			lvl(102, 1, 1), // high: thin vs average → exhaustion
		},
	}
	DeriveFootprintSignals(candle, FootprintSignalConfig{})
	if !candle.IsExhaustionHigh {
		t.Fatalf("expected exhaustion high")
	}
	if candle.IsExhaustionLow {
		t.Fatalf("did not expect exhaustion low")
	}
}

func TestDeriveFootprintSignals_EmptyLevelsStillDerived(t *testing.T) {
	candle := &marketdata.FootprintCandle{Open: 100, Close: 100}
	DeriveFootprintSignals(candle, FootprintSignalConfig{})
	if !candle.SignalsDerived {
		t.Fatalf("SignalsDerived should be true even with no levels")
	}
	if candle.BuyImbalanceCount != 0 || candle.HasBuyAbsorption || candle.IsExhaustionHigh {
		t.Fatalf("expected zeroed signals for empty candle: %#v", candle)
	}
}

func TestDeriveFootprintSignals_CustomThreshold(t *testing.T) {
	// ratio 4: with diag 10 and cur 35 → 3.5 < 4 → no imbalance.
	candle := &marketdata.FootprintCandle{
		Open: 100, Close: 100,
		Levels: []marketdata.FootprintLevel{lvl(100, 1, 10), lvl(101, 35, 10)},
	}
	DeriveFootprintSignals(candle, FootprintSignalConfig{ImbalanceRatio: 4})
	if candle.BuyImbalanceCount != 0 {
		t.Fatalf("ratio 4 should suppress a 3.5x imbalance, got count %d", candle.BuyImbalanceCount)
	}
	// Same levels at default ratio 3 → flagged.
	candle2 := &marketdata.FootprintCandle{
		Open: 100, Close: 100,
		Levels: []marketdata.FootprintLevel{lvl(100, 1, 10), lvl(101, 35, 10)},
	}
	DeriveFootprintSignals(candle2, FootprintSignalConfig{})
	if candle2.BuyImbalanceCount != 1 {
		t.Fatalf("default ratio 3 should flag a 3.5x imbalance, got count %d", candle2.BuyImbalanceCount)
	}
}
