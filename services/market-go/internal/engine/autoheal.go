package engine

import (
	"fmt"

	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/storage"
)

// Healer runs startup auto-heal to detect and fix gaps between trades and footprints.
type Healer struct {
	sqlDB      *storage.DB
	log        *logx.Logger
	symbols    []string
	timeframes []string // e.g. ["5m", "15m", "1h", "4h", "1d"]
}

// NewHealer creates a new auto-healer.
func NewHealer(sqlDB *storage.DB, logger *logx.Logger, symbols []string) *Healer {
	return &Healer{
		sqlDB:   sqlDB,
		log:     logger,
		symbols: symbols,
		timeframes: []string{"5m", "15m", "1h", "4h", "1d"},
	}
}

// Run executes auto-heal for all configured symbols.
// Safe to call as a goroutine — logs progress, never panics.
func (h *Healer) Run() {
	if h.sqlDB == nil {
		return
	}
	for _, symbol := range h.symbols {
		h.healSymbol(symbol)
	}
}

func (h *Healer) healSymbol(symbol string) {
	lastTrade, err := h.sqlDB.GetLastTradeTs(symbol)
	if err != nil {
		h.log.Infof("[autoheal] %s get lastTrade: %v", symbol, err)
		return
	}
	if lastTrade == 0 {
		h.log.Infof("[autoheal] %s no trades yet, skipping", symbol)
		return
	}

	lastFP, err := h.sqlDB.GetLastFootprint1mTs(symbol)
	if err != nil {
		h.log.Infof("[autoheal] %s get lastFP: %v", symbol, err)
		return
	}

	// Align to minute boundaries
	lastTradeMin := (lastTrade / 60000) * 60000
	lastFPMin := (lastFP / 60000) * 60000

	// Gap: if lastFP is more than 1 minute behind lastTrade
	if lastFPMin < lastTradeMin-60000 {
		fromTs := lastFPMin + 60000
		toTs := lastTradeMin
		missingMin := (toTs - fromTs) / 60000
		h.log.Infof("[autoheal] %s lastTrade=%d lastFP=%d missing=%dm rebuilding [%d, %d]",
			symbol, lastTradeMin, lastFPMin, missingMin, fromTs, toTs)

		// Incremental rebuild via the existing mechanism:
		// We call RebuildFootprint1m which handles the full pipeline.
		// Since we pass fromTs...toTs and there are no footprints in that range
		// (we deleted nothing, we're just filling gaps), RebuildFootprint1m
		// would DELETE then recreate — we want INSERT only.
		// So we use the direct approach: read trades, build, insert.
		if err := h.buildGap(symbol, fromTs, toTs); err != nil {
			h.log.Infof("[autoheal] %s rebuild gap: %v", symbol, err)
			return
		}
		h.log.Infof("[autoheal] %s rebuilt %d missing minutes", symbol, missingMin)
	} else {
		h.log.Infof("[autoheal] %s 1m footprints are up to date (lastFP=%d lastTrade=%d)",
			symbol, lastFPMin, lastTradeMin)
	}

	// Heal TFs
	for _, tf := range h.timeframes {
		h.healTF(symbol, tf)
	}

	h.log.Infof("[autoheal] %s complete", symbol)
}

// buildGap reads trades from [fromTs, toTs], builds footprint candles, inserts.
func (h *Healer) buildGap(symbol string, fromTs, toTs int64) error {
	trades, err := h.sqlDB.GetTrades(symbol, fromTs, toTs)
	if err != nil {
		return fmt.Errorf("get trades: %w", err)
	}
	if len(trades) == 0 {
		return nil
	}

	// Load last known CVD before the gap
	runningCVD, _ := h.sqlDB.GetLastCVD(symbol)

	// Group trades by minute
	type minuteState struct {
		minuteTs int64
		open     float64
		high     float64
		low      float64
		close    float64
		volume   float64
		buyVol   float64
		sellVol  float64
		levels   map[float64]*struct{ buyVol, sellVol float64 }
	}

	var current *minuteState
	var toInsert []storage.FootprintRecord
	intervalMs := int64(60000)

	flush := func() {
		if current == nil {
			return
		}
		delta := current.buyVol - current.sellVol
		runningCVD += delta

		// Build profile levels
		levelList := make([]storage.PriceLevel, 0, len(current.levels))
		for price, l := range current.levels {
			levelList = append(levelList, storage.PriceLevel{
				Price:      price,
				BuyVolume:  l.buyVol,
				SellVolume: l.sellVol,
			})
		}
		// Sort by price
		for i := 0; i < len(levelList); i++ {
			for j := i + 1; j < len(levelList); j++ {
				if levelList[j].Price < levelList[i].Price {
					levelList[i], levelList[j] = levelList[j], levelList[i]
				}
			}
		}

		toInsert = append(toInsert, storage.FootprintRecord{
			Symbol:     symbol,
			MinuteTs:   current.minuteTs,
			Open:       current.open,
			High:       current.high,
			Low:        current.low,
			Close:      current.close,
			Volume:     current.volume,
			BuyVolume:  current.buyVol,
			SellVolume: current.sellVol,
			Delta:      delta,
			CVD:        runningCVD,
			Profile:    storage.FootprintProfile{Levels: levelList},
		})
		current = nil
	}

	for _, t := range trades {
		bucketStart := (t.TimestampMs / intervalMs) * intervalMs

		if current != nil && bucketStart != current.minuteTs {
			flush()
		}

		if current == nil {
			current = &minuteState{
				minuteTs: bucketStart,
				open:     t.Price,
				high:     t.Price,
				low:      t.Price,
				close:    t.Price,
				levels:   make(map[float64]*struct{ buyVol, sellVol float64 }),
			}
		}

		if t.Price > current.high {
			current.high = t.Price
		}
		if t.Price < current.low {
			current.low = t.Price
		}
		current.close = t.Price
		current.volume += t.Qty

		if t.IsBuy {
			current.buyVol += t.Qty
		} else {
			current.sellVol += t.Qty
		}

		// Price level
		// Round to tick (use default 1.0 tick)
		price := float64(int64(t.Price))
		lvl, ok := current.levels[price]
		if !ok {
			current.levels[price] = &struct{ buyVol, sellVol float64 }{}
			lvl = current.levels[price]
		}
		if t.IsBuy {
			lvl.buyVol += t.Qty
		} else {
			lvl.sellVol += t.Qty
		}
	}
	flush()

	if len(toInsert) == 0 {
		return nil
	}

	return h.sqlDB.InsertFootprint1mBatch(toInsert)
}

// healTF rebuilds a single timeframe from 1m footprints.
func (h *Healer) healTF(symbol, tf string) {
	targetMs := tfToMs(tf)
	if targetMs <= 0 {
		return
	}

	last1m, err := h.sqlDB.GetLastFootprint1mTs(symbol)
	if err != nil || last1m == 0 {
		return
	}

	lastTF, err := h.sqlDB.GetLastFootprintTFTs(symbol, tf)
	if err != nil {
		h.log.Infof("[autoheal] %s get last %s: %v", symbol, tf, err)
		return
	}

	// Align to TF boundary
	last1mAligned := (last1m / targetMs) * targetMs
	lastTFAligned := (lastTF / targetMs) * targetMs

	// Gap: if last TF candle is more than one TF interval behind last 1m
	if lastTFAligned < last1mAligned-targetMs {
		fromTs := lastTFAligned
		if fromTs <= 0 {
			fromTs = last1mAligned - targetMs*10 // start 10 candles back
		}
		toTs := last1mAligned

		h.log.Infof("[autoheal] %s rebuilding %s from %d to %d", symbol, tf, fromTs, toTs)

		// Delete existing TF candles in range
		if err := h.sqlDB.DeleteFootprintTFRange(symbol, tf, fromTs, toTs); err != nil {
			h.log.Infof("[autoheal] %s delete %s: %v", symbol, tf, err)
			return
		}

		// Load 1m footprints
		fps, err := h.sqlDB.GetFootprint1m(symbol, fromTs, toTs)
		if err != nil {
			h.log.Infof("[autoheal] %s get 1m for %s: %v", symbol, tf, err)
			return
		}

		// Aggregate
		aggregated := AggregateFootprintsFromRecords(fps, targetMs)
		for _, fp := range aggregated {
			if err := h.sqlDB.InsertFootprintTF(fp, tf); err != nil {
				h.log.Infof("[autoheal] %s insert %s: %v", symbol, tf, err)
				return
			}
		}
		h.log.Infof("[autoheal] %s %s healed: %d candles", symbol, tf, len(aggregated))
	} else {
		h.log.Infof("[autoheal] %s %s is up to date", symbol, tf)
	}
}

// tfToMs converts a timeframe string to milliseconds.
func tfToMs(tf string) int64 {
	if tf == "" {
		return 0
	}
	unit := tf[len(tf)-1]
	var n int64
	for _, c := range tf[:len(tf)-1] {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int64(c-'0')
	}
	if n <= 0 {
		return 0
	}
	switch unit {
	case 'm':
		return n * 60000
	case 'h':
		return n * 3600000
	case 'd':
		return n * 86400000
	default:
		return 0
	}
}

// AggregateFootprintsFromRecords aggregates 1m footprint records into a target interval.
// Same logic as calc.AggregateFootprints but works on storage.FootprintRecord directly.
func AggregateFootprintsFromRecords(fps []storage.FootprintRecord, targetMs int64) []storage.FootprintRecord {
	if len(fps) == 0 || targetMs < 60000 {
		return nil
	}

	// Group by bucket
	type bucket struct {
		records []storage.FootprintRecord
	}
	buckets := make(map[int64]*bucket)

	for _, fp := range fps {
		bStart := (fp.MinuteTs / targetMs) * targetMs
		b, ok := buckets[bStart]
		if !ok {
			b = &bucket{}
			buckets[bStart] = b
		}
		b.records = append(b.records, fp)
	}

	// Sort bucket starts
	var starts []int64
	for s := range buckets {
		starts = append(starts, s)
	}
	for i := 0; i < len(starts); i++ {
		for j := i + 1; j < len(starts); j++ {
			if starts[j] < starts[i] {
				starts[i], starts[j] = starts[j], starts[i]
			}
		}
	}

	out := make([]storage.FootprintRecord, 0, len(starts))
	for _, bStart := range starts {
		recs := buckets[bStart].records
		if len(recs) == 0 {
			continue
		}

		// Only complete buckets
		lastMinExpected := bStart + targetMs - 60000
		if recs[len(recs)-1].MinuteTs < lastMinExpected {
			break
		}

		agg := storage.FootprintRecord{
			Symbol:   recs[0].Symbol,
			MinuteTs: bStart,
			Open:     recs[0].Open,
			High:     recs[0].High,
			Low:      recs[0].Low,
			Close:    recs[len(recs)-1].Close,
		}

		levelMap := make(map[float64]*storage.PriceLevel)
		for _, r := range recs {
			if r.High > agg.High {
				agg.High = r.High
			}
			if r.Low > 0 && r.Low < agg.Low {
				agg.Low = r.Low
			}
			agg.Volume += r.Volume
			agg.BuyVolume += r.BuyVolume
			agg.SellVolume += r.SellVolume
			agg.Delta += r.Delta
			// CVD = last 1m CVD (CVD is cumulative)
			agg.CVD = r.CVD

			for _, l := range r.Profile.Levels {
				existing, ok := levelMap[l.Price]
				if !ok {
					levelMap[l.Price] = &storage.PriceLevel{
						Price:      l.Price,
						BuyVolume:  l.BuyVolume,
						SellVolume: l.SellVolume,
					}
				} else {
					existing.BuyVolume += l.BuyVolume
					existing.SellVolume += l.SellVolume
				}
			}
		}

		var prices []float64
		for p := range levelMap {
			prices = append(prices, p)
		}
		for i := 0; i < len(prices); i++ {
			for j := i + 1; j < len(prices); j++ {
				if prices[j] < prices[i] {
					prices[i], prices[j] = prices[j], prices[i]
				}
			}
		}

		levels := make([]storage.PriceLevel, 0, len(prices))
		for _, p := range prices {
			levels = append(levels, *levelMap[p])
		}
		agg.Profile = storage.FootprintProfile{Levels: levels}
		out = append(out, agg)
	}

	return out
}

