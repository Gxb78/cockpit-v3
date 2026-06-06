package ws

import (
	"math"
	"sort"

	"cockpit-v6-market-go/internal/marketdata"
)

// AggregateCandles converts 1m candles into any higher timeframe by grouping
// consecutive 1m candles into buckets of `targetIntervalMs` milliseconds.
//
// targetIntervalMs must be a multiple of 60000 (1 minute). Examples:
//   300000  = 5m
//   900000  = 15m
//   3600000 = 1h
//   86400000 = 1d
//
// The input candles MUST be sorted by OpenTime ascending.
// Only complete buckets are returned (the last partial bucket is dropped)
// UNLESS includePartial is true (for the live, still-open bucket).
//
// Rules:
//   - openTime = bucket boundary aligned to epoch
//   - open = first 1m candle's open
//   - high = max of all 1m candles' high
//   - low = min of all 1m candles' low
//   - close = last 1m candle's close
//   - volume = sum of all 1m candles' volume
//   - closeTime = last 1m candle's closeTime
func AggregateCandles(oneMinCandles []marketdata.Candle, targetIntervalMs int64, includePartial bool) []marketdata.Candle {
	if len(oneMinCandles) == 0 || targetIntervalMs < 60000 {
		return nil
	}

	// Find the time range
	firstOpen := oneMinCandles[0].OpenTime
	lastOpen := oneMinCandles[len(oneMinCandles)-1].OpenTime

	// Align first bucket to epoch boundary
	firstBucketStart := (firstOpen / targetIntervalMs) * targetIntervalMs
	lastBucketStart := (lastOpen / targetIntervalMs) * targetIntervalMs

	// Count buckets
	numBuckets := int((lastBucketStart-firstBucketStart)/targetIntervalMs) + 1
	if numBuckets <= 0 {
		return nil
	}

	out := make([]marketdata.Candle, 0, numBuckets)

	for b := int64(0); b < int64(numBuckets); b++ {
		bucketStart := firstBucketStart + b*targetIntervalMs
		bucketEnd := bucketStart + targetIntervalMs

		// Find all 1m candles within this bucket
		startIdx := sort.Search(len(oneMinCandles), func(i int) bool {
			return oneMinCandles[i].OpenTime >= bucketStart
		})
		endIdx := sort.Search(len(oneMinCandles), func(i int) bool {
			return oneMinCandles[i].OpenTime >= bucketEnd
		})

		if startIdx >= endIdx {
			continue
		}

		bucketCandles := oneMinCandles[startIdx:endIdx]

		// Check if this is a complete bucket
		lastMinExpected := bucketEnd - 60000
		isComplete := bucketCandles[len(bucketCandles)-1].OpenTime >= lastMinExpected

		if !isComplete && !includePartial {
			break
		}

		c := bucketCandles[0]
		agg := marketdata.Candle{
			Symbol:    c.Symbol,
			Timeframe: "",
			OpenTime:  bucketStart,
			Open:      c.Open,
			High:      c.High,
			Low:       c.Low,
			Close:     bucketCandles[len(bucketCandles)-1].Close,
		}

		for _, c2 := range bucketCandles {
			if c2.High > agg.High {
				agg.High = c2.High
			}
			if c2.Low > 0 && c2.Low < agg.Low {
				agg.Low = c2.Low
			}
			agg.Volume += c2.Volume
			if c2.CloseTime > agg.CloseTime {
				agg.CloseTime = c2.CloseTime
			}
		}

		agg.Volume = math.Round(agg.Volume*100) / 100
		out = append(out, agg)
	}

	return out
}
