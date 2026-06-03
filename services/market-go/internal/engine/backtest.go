package engine

import (
	"fmt"
	"path/filepath"
	"time"

	"cockpit-v6-market-go/internal/calc"
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
	"cockpit-v6-market-go/internal/storage"
)

// BacktestConfig defines a footprint backtest run.
type BacktestConfig struct {
	Symbol     string
	FromTs     int64
	ToTs       int64
	Timeframes []string // TFs to aggregate (e.g. ["5m","15m","1h"])
	Save1m     bool     // persist rebuilt 1m footprints
	SaveTF     bool     // persist aggregated TF footprints
	OutputPath string   // if set, write to a separate DB instead of live
}

// BacktestEngine replays historical trades through the footprint builder
// and optionally persists the results.
type BacktestEngine struct {
	loader *MultiSourceLoader
	sqlDB  *storage.DB
	log    *logx.Logger
}

// NewBacktestEngine creates a new backtest engine.
func NewBacktestEngine(loader *MultiSourceLoader, sqlDB *storage.DB, logger *logx.Logger) *BacktestEngine {
	return &BacktestEngine{
		loader: loader,
		sqlDB:  sqlDB,
		log:    logger,
	}
}

// Run executes a full backtest: load trades → build 1m footprints → aggregate TF.
func (e *BacktestEngine) Run(cfg BacktestConfig) error {
	e.log.Infof("[backtest] starting %s [%d, %d] timeframes=%v save1m=%v saveTF=%v",
		cfg.Symbol, cfg.FromTs, cfg.ToTs, cfg.Timeframes, cfg.Save1m, cfg.SaveTF)

	// Resolve output DB
	outDB := e.sqlDB
	if cfg.OutputPath != "" {
		var err error
		outDB, err = storage.NewDB(cfg.OutputPath)
		if err != nil {
			return fmt.Errorf("open output db: %w", err)
		}
		defer outDB.Close()
	}

	// Step 1: Load all trades for the period
	trades, err := e.loader.LoadTrades(cfg.Symbol, cfg.FromTs, cfg.ToTs)
	if err != nil {
		return fmt.Errorf("load trades: %w", err)
	}
	if len(trades) == 0 {
		e.log.Infof("[backtest] no trades for %s [%d, %d]", cfg.Symbol, cfg.FromTs, cfg.ToTs)
		return nil
	}
	e.log.Infof("[backtest] loaded %d trades", len(trades))

	// Step 2: Load last known CVD before the range
	runningCVD, _ := e.sqlDB.GetLastCVD(cfg.Symbol)

	// Step 3: Build footprint calculator
	fpCfg := calc.FootprintConfig{
		Enabled:    true,
		IntervalMs: 60000,
		TickSize:   1.0,
		EmitEvery:  0, // no throttle during backtest
		MaxLevels:  500,
	}
	builder := calc.NewFootprintCalculator(fpCfg)

	// Step 3: Replay trades, collect closed footprint candles
	var closedFPs []storage.FootprintRecord

	for _, t := range trades {
		side := "sell"
		if t.IsBuy {
			side = "buy"
		}
		mt := marketdata.Trade{
			Symbol:     t.Symbol,
			TradeID:    t.ExchangeTradeID,
			TsExchange: t.TimestampMs,
			TsLocal:    t.TimestampMs,
			Price:      t.Price,
			Qty:        t.Qty,
			Side:       side,
		}

		candles := builder.UpdateTradeAt(mt, t.TimestampMs)
		for _, c := range candles {
			if c.Closed {
				delta := c.BuyVol - c.SellVol
				runningCVD += delta
				fp := candleToRecord(c)
				fp.Delta = delta
				fp.CVD = runningCVD
				closedFPs = append(closedFPs, fp)
			}
		}
	}

	e.log.Infof("[backtest] built %d 1m footprints from %d trades", len(closedFPs), len(trades))

	// Step 4: Persist 1m footprints
	if cfg.Save1m && len(closedFPs) > 0 {
		if err := outDB.InsertFootprint1mBatch(closedFPs); err != nil {
			return fmt.Errorf("save 1m footprints: %w", err)
		}
		e.log.Infof("[backtest] saved %d 1m footprints", len(closedFPs))
	}

	// Step 5: Aggregate to higher timeframes
	if cfg.SaveTF && len(cfg.Timeframes) > 0 && len(closedFPs) > 0 {
		for _, tf := range cfg.Timeframes {
			targetMs := tfToMs(tf)
			if targetMs <= 0 {
				continue
			}

			aggregated := AggregateFootprintsFromRecords(closedFPs, targetMs)
			if len(aggregated) == 0 {
				continue
			}

			for _, fp := range aggregated {
				if err := outDB.InsertFootprintTF(fp, tf); err != nil {
					return fmt.Errorf("save %s footprint: %w", tf, err)
				}
			}
			e.log.Infof("[backtest] saved %d %s footprints", len(aggregated), tf)
		}
	}

	e.log.Infof("[backtest] complete for %s [%d, %d]", cfg.Symbol, cfg.FromTs, cfg.ToTs)
	return nil
}

// candleToRecord converts a marketdata.FootprintCandle to storage.FootprintRecord.
func candleToRecord(c marketdata.FootprintCandle) storage.FootprintRecord {
	levels := make([]storage.PriceLevel, len(c.Levels))
	for i, l := range c.Levels {
		levels[i] = storage.PriceLevel{
			Price:      l.Price,
			BuyVolume:  l.BuyVol,
			SellVolume: l.SellVol,
		}
	}
	return storage.FootprintRecord{
		Symbol:     c.Symbol,
		MinuteTs:   c.OpenTime,
		Open:       c.Open,
		High:       c.High,
		Low:        c.Low,
		Close:      c.Close,
		Volume:     c.Volume,
		BuyVolume:  c.BuyVol,
		SellVolume: c.SellVol,
		Delta:      c.Delta,
		Profile:    storage.FootprintProfile{Levels: levels},
	}
}

// ArchiveRoot returns the archive root directory path.
func ArchiveRoot(dataDir string) string {
	return filepath.Join(dataDir, "archive")
}

// MonthRange generates year/month pairs for each month in [fromTs, toTs].
func MonthRange(fromTs, toTs int64) []struct{ Year, Month int } {
	var out []struct{ Year, Month int }
	start := time.UnixMilli(fromTs).UTC()
	end := time.UnixMilli(toTs).UTC()
	for y := start.Year(); y <= end.Year(); y++ {
		startM := 1
		if y == start.Year() {
			startM = int(start.Month())
		}
		endM := 12
		if y == end.Year() {
			endM = int(end.Month())
		}
		for m := startM; m <= endM; m++ {
			out = append(out, struct{ Year, Month int }{y, m})
		}
	}
	return out
}
