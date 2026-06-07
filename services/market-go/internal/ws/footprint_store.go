package ws

import (
	"fmt"

	"cockpit-v6-market-go/internal/calc"
	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/engine"
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
	"cockpit-v6-market-go/internal/storage"
)

// footprintStore owns footprint persistence to SQLite: writing closed candles
// (with their engine-derived signals), rebuilding 1m footprints from stored
// trades, and aggregating 1m footprints into higher timeframes. It accumulates
// CVD through cvdTracker and reads rebuild thresholds from the engine.
type footprintStore struct {
	sqlDB  *storage.DB
	cvd    *cvdTracker
	engine *engine.Engine
	cfg    config.Config
	log    *logx.Logger
}

func newFootprintStore(sqlDB *storage.DB, cvd *cvdTracker, eng *engine.Engine, cfg config.Config, log *logx.Logger) *footprintStore {
	return &footprintStore{sqlDB: sqlDB, cvd: cvd, engine: eng, cfg: cfg, log: log}
}

// Rebuild1m deletes footprints in [fromTs, toTs] and reconstructs them from the
// stored trades, using the engine's UI-synced signal thresholds. Returns the
// number of closed candles created.
func (f *footprintStore) Rebuild1m(symbol string, fromTs, toTs int64) (int, error) {
	if f.sqlDB == nil {
		return 0, fmt.Errorf("sqlite not available")
	}

	// Delete existing footprints in range
	if err := f.sqlDB.DeleteFootprint1mRange(symbol, fromTs, toTs); err != nil {
		return 0, fmt.Errorf("delete footprints: %w", err)
	}

	// Load trades
	trades, err := f.sqlDB.GetTrades(symbol, fromTs, toTs)
	if err != nil {
		return 0, fmt.Errorf("get trades: %w", err)
	}
	if len(trades) == 0 {
		f.log.Infof("rebuild footprint: no trades for %s [%d, %d]", symbol, fromTs, toTs)
		return 0, nil
	}

	// Use the engine's footprint calculator config
	fpCfg := calc.FootprintConfig{
		Enabled:    true,
		IntervalMs: f.cfg.FootprintIntervalMs, // should be 60000 for 1m
		TickSize:   f.cfg.FootprintTickSize,
		EmitEvery:  0, // emit every trade during rebuild (no throttle)
		MaxLevels:  f.cfg.FootprintMaxLevels,
	}
	if fpCfg.IntervalMs <= 0 {
		fpCfg.IntervalMs = 60000
	}
	builder := calc.NewFootprintCalculator(fpCfg)
	// Reconstruct signals with the engine's UI-synced thresholds so a rebuilt
	// footprint matches what the user saw live (not the calculator's defaults).
	builder.SetSignalConfig(f.engine.FootprintSignalConfig())

	var closedCount int
	for _, t := range trades {
		// Convert storage.TradeRecord to marketdata.Trade
		side := "sell"
		if t.IsBuy {
			side = "buy"
		}
		mt := marketdata.Trade{
			Symbol:     t.Symbol,
			TsExchange: t.TimestampMs,
			TsLocal:    t.TimestampMs,
			Price:      t.Price,
			Qty:        t.Qty,
			Side:       side,
		}
		candles := builder.UpdateTradeAt(mt, t.TimestampMs)
		for _, c := range candles {
			if c.Closed {
				f.Persist(c)
				closedCount++
			}
		}
	}

	f.log.Infof("rebuild footprint: created %d footprints for %s [%d, %d]", closedCount, symbol, fromTs, toTs)
	return closedCount, nil
}

// AggregateTF reads 1m footprints, aggregates them to targetMs, and persists to
// market_footprint_tf. Returns the number of TF candles created.
func (f *footprintStore) AggregateTF(symbol, timeframe string, targetMs int64, fromTs, toTs int64) (int, error) {
	if f.sqlDB == nil {
		return 0, fmt.Errorf("sqlite not available")
	}

	// Delete existing TF footprints in range
	if err := f.sqlDB.DeleteFootprintTFRange(symbol, timeframe, fromTs, toTs); err != nil {
		return 0, fmt.Errorf("delete tf footprints: %w", err)
	}

	// Load 1m footprints
	oneMinFps, err := f.sqlDB.GetFootprint1m(symbol, fromTs, toTs)
	if err != nil {
		return 0, fmt.Errorf("get 1m footprints: %w", err)
	}
	if len(oneMinFps) == 0 {
		f.log.Infof("aggregate tf: no 1m footprints for %s [%d, %d]", symbol, fromTs, toTs)
		return 0, nil
	}

	// Aggregate
	aggregated := calc.AggregateFootprints(oneMinFps, targetMs)
	if len(aggregated) == 0 {
		return 0, nil
	}

	// Persist
	for _, fp := range aggregated {
		if err := f.sqlDB.InsertFootprintTF(fp, timeframe); err != nil {
			return 0, fmt.Errorf("insert tf footprint: %w", err)
		}
	}

	f.log.Infof("aggregate tf: created %d %s candles for %s [%d, %d]",
		len(aggregated), timeframe, symbol, fromTs, toTs)
	return len(aggregated), nil
}

// Persist writes a closed footprint candle to SQLite, computing delta from
// buy/sell volume and accumulating CVD.
func (f *footprintStore) Persist(candle marketdata.FootprintCandle) {
	// Compute delta if not already set
	delta := candle.Delta
	if delta == 0 && (candle.BuyVol > 0 || candle.SellVol > 0) {
		delta = candle.BuyVol - candle.SellVol
	}

	// Accumulate CVD per symbol
	cvd := f.cvd.Accumulate(candle.Symbol, delta)

	// Build price levels
	levels := make([]storage.PriceLevel, len(candle.Levels))
	for i, l := range candle.Levels {
		levels[i] = storage.PriceLevel{
			Price:      l.Price,
			BuyVolume:  l.BuyVol,
			SellVolume: l.SellVol,
		}
	}

	// Persist the engine-derived signals carried on the candle. These were
	// computed by calc.DeriveFootprintSignals in the footprint calculator using
	// the UI-synced thresholds — the same values the UI consumes live. Persisting
	// them (rather than recomputing with a second, divergent algorithm) keeps the
	// stored footprint identical to what the user saw in real time. As a defensive
	// fallback, derive with defaults if the candle never passed through the engine.
	if !candle.SignalsDerived {
		calc.DeriveFootprintSignals(&candle, calc.FootprintSignalConfig{})
	}

	rec := storage.FootprintRecord{
		Symbol:                    candle.Symbol,
		MinuteTs:                  candle.OpenTime,
		Open:                      candle.Open,
		High:                      candle.High,
		Low:                       candle.Low,
		Close:                     candle.Close,
		Volume:                    candle.Volume,
		BuyVolume:                 candle.BuyVol,
		SellVolume:                candle.SellVol,
		Delta:                     delta,
		CVD:                       cvd,
		Profile:                   storage.FootprintProfile{Levels: levels},
		MaxImbalanceRatio:         candle.MaxImbalanceRatio,
		BuyImbalanceCount:         candle.BuyImbalanceCount,
		SellImbalanceCount:        candle.SellImbalanceCount,
		StackedBuyImbalanceCount:  candle.StackedBuyImbalance,
		StackedSellImbalanceCount: candle.StackedSellImbalance,
		HasBuyAbsorption:          candle.HasBuyAbsorption,
		HasSellAbsorption:         candle.HasSellAbsorption,
		IsExhaustionHigh:          candle.IsExhaustionHigh,
		IsExhaustionLow:           candle.IsExhaustionLow,
		IsUnfinishedHigh:          candle.IsUnfinishedHigh,
		IsUnfinishedLow:           candle.IsUnfinishedLow,
	}

	if err := f.sqlDB.InsertFootprint1m(rec); err != nil {
		f.log.Infof("sqlite insert footprint: %v", err)
	}
}
