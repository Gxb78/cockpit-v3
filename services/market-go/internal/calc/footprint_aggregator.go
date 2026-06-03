package calc

import (
	"math"
	"sort"

	"cockpit-v6-market-go/internal/storage"
)

// AggregateFootprints aggregates 1m footprint records into a higher timeframe.
// Returns a slice of FootprintRecord at the target interval.
//
// targetMs must be a multiple of 60000 (1 minute). Examples:
//   300000 = 5m
//   900000 = 15m
//   3600000 = 1h
//   86400000 = 1d
//
// Input footprints MUST be sorted by MinuteTs ascending.
// Only complete buckets are aggregated (last partial bucket dropped).
func AggregateFootprints(fps []storage.FootprintRecord, targetMs int64) []storage.FootprintRecord {
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
	sort.Slice(starts, func(i, j int) bool { return starts[i] < starts[j] })

	out := make([]storage.FootprintRecord, 0, len(starts))

	for _, bStart := range starts {
		recs := buckets[bStart].records
		if len(recs) == 0 {
			continue
		}

		// Check if this bucket is complete: the last 1m record should be
		// at bStart + targetMs - 60000 (the last minute of the bucket)
		lastMinExpected := bStart + targetMs - 60000
		isComplete := recs[len(recs)-1].MinuteTs >= lastMinExpected

		if !isComplete {
			// Partial bucket (current forming candle) — stop here
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

		// Merge levels
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
			// CVD = last 1m CVD in the bucket (CVD is cumulative)
			agg.CVD = r.CVD

			// Merge price levels
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

		// Build sorted levels
		agg.Volume = math.Round(agg.Volume*100) / 100
		agg.BuyVolume = math.Round(agg.BuyVolume*100) / 100
		agg.SellVolume = math.Round(agg.SellVolume*100) / 100
		agg.Delta = math.Round(agg.Delta*100) / 100

		var prices []float64
		for p := range levelMap {
			prices = append(prices, p)
		}
		sort.Slice(prices, func(i, j int) bool { return prices[i] < prices[j] })

		levels := make([]storage.PriceLevel, 0, len(prices))
		for _, p := range prices {
			l := levelMap[p]
			l.BuyVolume = math.Round(l.BuyVolume*100) / 100
			l.SellVolume = math.Round(l.SellVolume*100) / 100
			levels = append(levels, *l)
		}

		agg.Profile = storage.FootprintProfile{Levels: levels}
		out = append(out, agg)
	}

	return out
}
