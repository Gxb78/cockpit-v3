package ws

import (
	"context"
	"time"

	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/engine"
	"cockpit-v6-market-go/internal/exchange/binance"
	"cockpit-v6-market-go/internal/exchange/hyperliquid"
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
)

// klineBackfiller fetches historical klines for the configured intervals (from
// Binance REST or Hyperliquid, with a file cache and 1m-derivation), then emits
// each interval as a candle_history envelope. publishHistory hands the envelope
// to the stream (cache + broadcast); onOneMinStored fires after 1m data lands so
// CVD history can be (re)broadcast. Both keep the backfiller decoupled from the
// stream history cache and CVD.
type klineBackfiller struct {
	cfg        config.Config
	klineCache *KlineCache
	engine     *engine.Engine
	log        *logx.Logger

	publishHistory func(raw []byte)
	onOneMinStored func()
}

func newKlineBackfiller(cfg config.Config, klineCache *KlineCache, eng *engine.Engine, log *logx.Logger, publishHistory func([]byte), onOneMinStored func()) *klineBackfiller {
	return &klineBackfiller{
		cfg:            cfg,
		klineCache:     klineCache,
		engine:         eng,
		log:            log,
		publishHistory: publishHistory,
		onOneMinStored: onOneMinStored,
	}
}

// RunBinance backfills all configured intervals from Binance (with cache),
// emitting one candle_history envelope per interval.
func (k *klineBackfiller) RunBinance(ctx context.Context, symbol string) {
	intervals := k.cfg.BackfillIntervals
	if len(intervals) == 0 {
		intervals = []string{"1m"}
	}
	for _, interval := range intervals {
		if ctx.Err() != nil {
			return
		}
		candles := k.backfillIntervalWithCache(ctx, symbol, interval, "binance")
		if len(candles) == 0 {
			continue
		}
		envelope := k.engine.CandleHistory(symbol, interval, candles)
		raw, err := envelope.MarshalJSONBytes()
		if err != nil {
			continue
		}
		k.publishHistory(raw)
		k.log.Infof("binance backfill symbol=%s interval=%s candles=%d", symbol, interval, len(candles))

		if interval == "1m" {
			k.onOneMinStored()
		}
	}
}

// RunHyperliquid fetches historical klines for ALL configured intervals once and
// caches/broadcasts each as a candle_history envelope, so the chart can render
// real history at any timeframe (the Go engine is the single source of truth).
func (k *klineBackfiller) RunHyperliquid(ctx context.Context, symbol string) {
	intervals := k.cfg.BackfillIntervals
	if len(intervals) == 0 {
		iv := k.cfg.BackfillInterval
		if iv == "" {
			iv = "1m"
		}
		intervals = []string{iv}
	}
	bars := k.cfg.BackfillBars
	if bars <= 0 {
		bars = 1000
	}

	for _, interval := range intervals {
		if ctx.Err() != nil {
			return
		}
		end := time.Now().UnixMilli()
		start := end - int64(bars)*intervalMs(interval)

		candles, err := hyperliquid.FetchCandles(ctx, k.cfg.HyperliquidHTTPURL, symbol, interval, start, end)
		if err != nil {
			k.engine.RecordError("backfill: " + err.Error())
			k.log.Errorf("hyperliquid backfill failed symbol=%s interval=%s err=%v", symbol, interval, err)
			continue
		}
		if len(candles) == 0 {
			k.log.Infof("hyperliquid backfill empty symbol=%s interval=%s", symbol, interval)
			continue
		}

		envelope := k.engine.CandleHistory(symbol, interval, candles)
		raw, err := envelope.MarshalJSONBytes()
		if err != nil {
			k.log.Errorf("marshal candle history envelope failed symbol=%s interval=%s err=%v", symbol, interval, err)
			continue
		}

		k.publishHistory(raw)
		k.log.Infof("hyperliquid backfill symbol=%s interval=%s candles=%d", symbol, interval, len(candles))

		// Dès que les bougies 1m sont disponibles, on peut calculer et broadcast
		// le CVD historique (estimation OHLCV pour les périodes sans trades réels).
		if interval == "1m" {
			k.onOneMinStored()
		}
	}
}

// backfillIntervalWithCache returns candles for one symbol+interval, using
// the file cache to minimize Binance API calls.
//  1. Load cached candles from disk (or derive from 1m for higher TFs)
//  2. Determine what's missing (newest cached → now)
//  3. Fetch only the missing range from Binance
//  4. Merge, deduplicate by openTime, sort, save to cache
func (k *klineBackfiller) backfillIntervalWithCache(ctx context.Context, symbol, interval, source string) []marketdata.Candle {
	// For non-1m intervals: try to derive from 1m data first
	if interval != "1m" {
		candles := k.deriveFromOneMin(ctx, symbol, interval)
		if candles != nil {
			return candles
		}
		// Derivation failed (1m cache insufficient) — fall through to direct fetch
	}

	// Below this point: 1m interval or derivation failed — do direct cache+fetch
	intervalMs := intervalMs(interval)
	now := time.Now().UnixMilli()

	// Calculate how many candles we need
	needed := k.cfg.BackfillBars
	if needed <= 0 {
		needed = 1000
	}
	if interval == "1m" {
		days := k.cfg.BackfillDays
		if days <= 0 {
			days = 30
		}
		needed = days * 24 * 60
	}

	// Load cached candles first
	cached, newestCached := k.klineCache.Load(symbol, interval)
	oldestNeeded := now - int64(needed)*intervalMs

	// If cache covers everything we need, return cached data
	if newestCached > 0 && len(cached) > 0 && cached[0].OpenTime <= oldestNeeded {
		if newestCached >= now-int64(2)*intervalMs {
			k.log.Infof("kline cache hit symbol=%s interval=%s cached=%d range=%d→%d",
				symbol, interval, len(cached), cached[0].OpenTime, newestCached)
			return cached
		}
		// Cache has old data but missing recent candles — fetch incremental
		fresh, err := binance.FetchKlines(ctx, k.cfg.BinanceRESTURL, symbol, interval, needed)
		if err != nil {
			k.log.Infof("backfill inc fetch failed, using cached: %v", err)
			return cached
		}
		merged := mergeCandleLists(cached, fresh)
		merged = k.trimKlinesByAge(symbol, interval, merged)
		k.klineCache.Save(symbol, interval, merged)
		k.log.Infof("kline cache incremental symbol=%s interval=%s cached=%d fresh=%d merged=%d",
			symbol, interval, len(cached), len(fresh), len(merged))
		return merged
	}

	// Cache miss or insufficient — fetch full from Binance
	k.log.Infof("kline cache miss symbol=%s interval=%s fetching %d candles",
		symbol, interval, needed)

	fresh, err := binance.FetchKlines(ctx, k.cfg.BinanceRESTURL, symbol, interval, needed)
	if err != nil {
		k.log.Errorf("binance backfill failed symbol=%s interval=%s err=%v", symbol, interval, err)
		if len(cached) > 0 {
			return cached
		}
		return nil
	}
	if len(fresh) == 0 {
		return cached
	}

	merged := mergeCandleLists(cached, fresh)
	merged = k.trimKlinesByAge(symbol, interval, merged)
	k.klineCache.Save(symbol, interval, merged)
	k.log.Infof("kline cache saved symbol=%s interval=%s candles=%d", symbol, interval, len(merged))
	return merged
}

// deriveFromOneMin tries to build `targetInterval` candles by aggregating
// from the 1m cache. Returns nil if 1m cache doesn't cover enough range.
func (k *klineBackfiller) deriveFromOneMin(ctx context.Context, symbol, targetInterval string) []marketdata.Candle {
	// First, make sure 1m is loaded/available
	oneMin := k.backfillIntervalWithCache(ctx, symbol, "1m", "binance")
	if len(oneMin) < 2 {
		return nil
	}

	targetMs := intervalMs(targetInterval)
	daysNeeded := (k.cfg.BackfillBars * int(targetMs/60000)) / 1440
	if daysNeeded < 1 {
		daysNeeded = 1
	}
	if daysNeeded > k.cfg.BackfillDays {
		daysNeeded = k.cfg.BackfillDays
	}

	// Check if 1m cache goes back far enough for the target interval
	oneMinOldest := oneMin[0].OpenTime
	oneMinNewest := oneMin[len(oneMin)-1].OpenTime
	now := time.Now().UnixMilli()
	neededOldest := now - int64(daysNeeded)*86400000

	if oneMinOldest > neededOldest {
		// 1m doesn't go back far enough for this interval
		return nil
	}

	// Check 1m is recent enough (within 2 intervals)
	if oneMinNewest < now-int64(2)*targetMs {
		// 1m data is stale — would need refresh, but this is handled by
		// the recursive call to backfillIntervalWithCache above
		return nil
	}

	// Derive by aggregating 1m candles
	candles := AggregateCandles(oneMin, targetMs, false)
	if len(candles) == 0 {
		return nil
	}

	// Set Timeframe on each aggregated candle
	for i := range candles {
		candles[i].Timeframe = targetInterval
	}

	// Save derived candles to cache so subsequent loads are instant
	candles = k.trimKlinesByAge(symbol, targetInterval, candles)
	k.klineCache.Save(symbol, targetInterval, candles)
	k.log.Infof("derived %s %s from 1m: %d candles (1m source: %d candles, range %d→%d)",
		symbol, targetInterval, len(candles), len(oneMin), oneMinOldest, oneMinNewest)
	return candles
}

// trimKlinesByAge removes candles older than KlineRetainDays from the slice.
// The input should be sorted by OpenTime ascending.
func (k *klineBackfiller) trimKlinesByAge(symbol, interval string, candles []marketdata.Candle) []marketdata.Candle {
	retainDays := k.cfg.KlineRetainDays
	if retainDays <= 0 {
		return candles
	}
	cutoff := time.Now().UnixMilli() - int64(retainDays)*86400000

	// Find first candle within cutoff
	cutIdx := 0
	for cutIdx < len(candles) && candles[cutIdx].OpenTime < cutoff {
		cutIdx++
	}

	if cutIdx == 0 {
		return candles // nothing to trim
	}

	trimmed := candles[cutIdx:]
	k.log.Infof("kline retain: trimmed %d old candles for %s/%s (retainDays=%d, kept=%d)",
		cutIdx, symbol, interval, retainDays, len(trimmed))
	return trimmed
}

// mergeCandleLists merges two candle slices, deduplicating by OpenTime.
// Returns a single sorted slice.
func mergeCandleLists(a, b []marketdata.Candle) []marketdata.Candle {
	byOpenTime := make(map[int64]marketdata.Candle)
	for _, c := range a {
		if c.OpenTime > 0 {
			byOpenTime[c.OpenTime] = c
		}
	}
	for _, c := range b {
		if c.OpenTime > 0 {
			byOpenTime[c.OpenTime] = c
		}
	}
	out := make([]marketdata.Candle, 0, len(byOpenTime))
	for _, c := range byOpenTime {
		out = append(out, c)
	}
	// Sort by OpenTime
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].OpenTime < out[i].OpenTime {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}
