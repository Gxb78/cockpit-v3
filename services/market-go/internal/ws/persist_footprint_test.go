package ws

import (
	"fmt"
	"testing"

	"cockpit-v6-market-go/internal/calc"
	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/engine"
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
	"cockpit-v6-market-go/internal/storage"
)

// newPersistTestServer builds a Server backed by a throwaway SQLite DB so
// persistFootprintCandle can round-trip through storage.
func newPersistTestServer(t *testing.T) *Server {
	t.Helper()
	cfg := config.Default()
	cfg.DataDir = t.TempDir()
	s := NewServer(cfg, engine.New(cfg, logx.New(testWriter{t})), logx.New(testWriter{t}))
	if s.sqlDB == nil {
		t.Skip("sqlite unavailable in this environment")
	}
	// Close the DB before t.TempDir's removal runs (LIFO), else Windows can't
	// unlink the still-open journal.db file.
	t.Cleanup(func() { s.sqlDB.Close() })
	return s
}

// persistFootprintCandle must store the orderflow signals already derived on the
// candle by calc.DeriveFootprintSignals (the engine path the live UI consumes),
// NOT recompute them with a second, divergent algorithm. We hand the candle
// signal values that a recompute from its (signal-free) levels could never
// produce, then assert they survive the round-trip unchanged.
func TestPersistFootprintCandle_TrustsEngineDerivedSignals(t *testing.T) {
	s := newPersistTestServer(t)

	candle := marketdata.FootprintCandle{
		Symbol:     "BTCUSDT",
		OpenTime:   60000,
		IntervalMs: 60000,
		Open:       100, High: 101, Low: 100, Close: 101,
		Volume: 20, BuyVol: 10, SellVol: 10, Delta: 0,
		Closed: true,
		// Uniform, balanced levels: a recompute would yield zero/false signals.
		Levels: []marketdata.FootprintLevel{
			{Price: 100, BuyVol: 5, SellVol: 5, TotalVol: 10},
			{Price: 101, BuyVol: 5, SellVol: 5, TotalVol: 10},
		},
		// Engine-derived signals that contradict the levels above.
		MaxImbalanceRatio:    7,
		BuyImbalanceCount:    3,
		SellImbalanceCount:   1,
		StackedBuyImbalance:  3,
		StackedSellImbalance: 0,
		HasBuyAbsorption:     true,
		HasSellAbsorption:    false,
		IsExhaustionHigh:     true,
		IsExhaustionLow:      false,
		IsUnfinishedHigh:     false,
		IsUnfinishedLow:      true,
		SignalsDerived:       true,
	}

	s.persistFootprintCandle(candle)

	recs, err := s.sqlDB.GetFootprint1m("BTCUSDT", 0, 120000)
	if err != nil {
		t.Fatalf("GetFootprint1m: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("expected 1 persisted footprint, got %d", len(recs))
	}
	got := recs[0]

	if got.MaxImbalanceRatio != 7 {
		t.Errorf("MaxImbalanceRatio: got %v, want 7 (recompute would zero it)", got.MaxImbalanceRatio)
	}
	if got.BuyImbalanceCount != 3 || got.SellImbalanceCount != 1 {
		t.Errorf("imbalance counts: got buy=%d sell=%d, want 3/1", got.BuyImbalanceCount, got.SellImbalanceCount)
	}
	if got.StackedBuyImbalanceCount != 3 {
		t.Errorf("StackedBuyImbalanceCount: got %d, want 3", got.StackedBuyImbalanceCount)
	}
	if !got.HasBuyAbsorption {
		t.Errorf("HasBuyAbsorption: got false, want true")
	}
	if !got.IsExhaustionHigh || got.IsExhaustionLow {
		t.Errorf("exhaustion: got high=%v low=%v, want high=true low=false", got.IsExhaustionHigh, got.IsExhaustionLow)
	}
	if got.IsUnfinishedHigh || !got.IsUnfinishedLow {
		t.Errorf("unfinished: got high=%v low=%v, want high=false low=true", got.IsUnfinishedHigh, got.IsUnfinishedLow)
	}
}

// When a candle reaches persistence without engine-derived signals (defensive
// path), persistFootprintCandle must derive them with the canonical algorithm
// (calc.DeriveFootprintSignals) rather than leave them blank or use a different
// formula. We engineer a thin extreme high level (exhaustion-high under the
// avg*factor rule) and assert the stored result matches a direct canonical run.
func TestPersistFootprintCandle_DerivesWhenSignalsAbsent(t *testing.T) {
	s := newPersistTestServer(t)

	levels := []marketdata.FootprintLevel{
		{Price: 100, BuyVol: 5, SellVol: 5, TotalVol: 10},
		{Price: 101, BuyVol: 5, SellVol: 5, TotalVol: 10},
		{Price: 102, BuyVol: 0.5, SellVol: 0.5, TotalVol: 1}, // thin extreme high → exhaustion high
	}
	candle := marketdata.FootprintCandle{
		Symbol:     "ETHUSDT",
		OpenTime:   60000,
		IntervalMs: 60000,
		Open:       100, High: 102, Low: 100, Close: 101,
		Volume: 21, BuyVol: 10.5, SellVol: 10.5,
		Closed:         true,
		Levels:         levels,
		SignalsDerived: false,
	}

	// Expected canonical result for the same inputs at default thresholds.
	want := candle
	want.Levels = append([]marketdata.FootprintLevel(nil), levels...)
	calc.DeriveFootprintSignals(&want, calc.FootprintSignalConfig{})

	s.persistFootprintCandle(candle)

	recs, err := s.sqlDB.GetFootprint1m("ETHUSDT", 0, 120000)
	if err != nil {
		t.Fatalf("GetFootprint1m: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("expected 1 persisted footprint, got %d", len(recs))
	}
	got := recs[0]

	if got.IsExhaustionHigh != want.IsExhaustionHigh || got.IsExhaustionLow != want.IsExhaustionLow {
		t.Errorf("exhaustion mismatch: got high=%v low=%v, want high=%v low=%v",
			got.IsExhaustionHigh, got.IsExhaustionLow, want.IsExhaustionHigh, want.IsExhaustionLow)
	}
	if !want.IsExhaustionHigh {
		t.Fatalf("test setup invalid: canonical algorithm did not flag exhaustion high")
	}
	if got.IsUnfinishedHigh != want.IsUnfinishedHigh || got.IsUnfinishedLow != want.IsUnfinishedLow {
		t.Errorf("unfinished mismatch: got high=%v low=%v, want high=%v low=%v",
			got.IsUnfinishedHigh, got.IsUnfinishedLow, want.IsUnfinishedHigh, want.IsUnfinishedLow)
	}
}

// Rebuilding footprints from stored trades must reconstruct signals with the
// engine's UI-synced thresholds, not the calculator's defaults. We feed trades
// forming a thin extreme-high level whose "exhaustion" verdict flips with the
// exhaustionFactor, then rebuild under two configs and assert the stored result
// follows the synced threshold.
func TestRebuildFootprint1m_UsesEngineSyncedSignalConfig(t *testing.T) {
	s := newPersistTestServer(t)

	var trades []storage.TradeRecord
	seq := 0
	add := func(ts int64, price, qty float64, n int) {
		for i := 0; i < n; i++ {
			seq++
			trades = append(trades, storage.TradeRecord{
				Symbol:          "BTCUSDT",
				ExchangeTradeID: fmt.Sprintf("t%d", seq), // unique: INSERT OR IGNORE dedups on this
				TimestampMs:     ts + int64(i),
				Price:           price,
				Qty:             qty,
				IsBuy:           true,
			})
		}
	}
	// Minute 1 (openTime 60000): heavy low/mid, thin extreme high (avg≈6.83).
	add(60000, 100, 1, 10) // totalVol 10
	add(60100, 101, 1, 10) // totalVol 10
	add(60200, 102, 0.5, 1) // thin extreme high: totalVol 0.5
	// A trade in the next minute forces the minute-1 candle to close & persist.
	add(120000, 100, 1, 1)
	if err := s.sqlDB.InsertTradeBatch(trades); err != nil {
		t.Fatalf("InsertTradeBatch: %v", err)
	}

	rebuildHigh := func() bool {
		if _, err := s.RebuildFootprint1m("BTCUSDT", 0, 200000); err != nil {
			t.Fatalf("RebuildFootprint1m: %v", err)
		}
		recs, err := s.sqlDB.GetFootprint1m("BTCUSDT", 60000, 119999)
		if err != nil {
			t.Fatalf("GetFootprint1m: %v", err)
		}
		if len(recs) != 1 {
			t.Fatalf("expected 1 footprint for minute 1, got %d", len(recs))
		}
		return recs[0].IsExhaustionHigh
	}

	base := calc.FootprintSignalConfig{ImbalanceRatio: 3, ImbalanceStack: 3, ImbalanceMinVolume: 1}

	// Low factor: threshold ≈ 0.34 → thin high (0.5) NOT exhausted.
	lo := base
	lo.ExhaustionFactor = 0.05
	s.engine.SetFootprintSignalConfig(lo)
	if rebuildHigh() {
		t.Errorf("exhaustionFactor=0.05: high should NOT be exhausted")
	}

	// High factor: threshold ≈ 6.15 → thin high (0.5) IS exhausted.
	hi := base
	hi.ExhaustionFactor = 0.9
	s.engine.SetFootprintSignalConfig(hi)
	if !rebuildHigh() {
		t.Errorf("exhaustionFactor=0.9: high should be exhausted (synced config not applied to rebuild)")
	}
}
