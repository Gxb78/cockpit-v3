package binance

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"cockpit-v6-market-go/internal/marketdata"
)

// DefaultRESTURL is Binance public spot REST (no key required).
const DefaultRESTURL = "https://api.binance.com"

// MaxPerRequest is Binance's max candles per klines request.
const MaxPerRequest = 1000

// FetchKlines requests historical OHLCV candles from Binance public REST.
// Supports deep pagination: fetches batches of MaxPerRequest (1000) in a loop
// using endTime to walk backwards in time until limit candles are collected,
// or no more data is available.
//
//   GET /api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000
//   Then subsequent requests use endTime to go further back.
func FetchKlines(ctx context.Context, restURL, symbol, interval string, limit int) ([]marketdata.Candle, error) {
	if strings.TrimSpace(restURL) == "" {
		restURL = DefaultRESTURL
	}
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	if interval == "" {
		interval = "1m"
	}
	if limit <= 0 {
		limit = MaxPerRequest
	}

	var all []marketdata.Candle
	var endTime int64 // 0 = most recent

	for len(all) < limit {
		batchSize := MaxPerRequest
		if limit-len(all) < batchSize {
			batchSize = limit - len(all)
		}

		batch, err := fetchSingleBatch(ctx, restURL, sym, interval, batchSize, endTime)
		if err != nil {
			if len(all) > 0 {
				// Return what we have on error
				break
			}
			return nil, err
		}
		if len(batch) == 0 {
			break
		}

		// Prepend: batch comes oldest-first, we want chronological order
		all = append(batch, all...)

		// If batch was smaller than requested, we hit the beginning
		if len(batch) < batchSize {
			break
		}

		// Next endTime = oldest candle's OpenTime - 1ms to avoid overlap
		endTime = batch[0].OpenTime - 1
	}

	return all, nil
}

// fetchSingleBatch fetches one page of up to `limit` klines from Binance.
// When endTime > 0, fetches candles with closeTime <= endTime (going backward).
func fetchSingleBatch(ctx context.Context, restURL, symbol, interval string, limit int, endTime int64) ([]marketdata.Candle, error) {
	url := fmt.Sprintf("%s/api/v3/klines?symbol=%s&interval=%s&limit=%d",
		strings.TrimRight(restURL, "/"), symbol, interval, limit)
	if endTime > 0 {
		url += fmt.Sprintf("&endTime=%d", endTime)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "CockpitV6-MarketGo/0.8")
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, fmt.Errorf("binance klines http %d: %s", res.StatusCode, strings.TrimSpace(string(snippet)))
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	return ParseKlinesJSON(data, symbol, interval)
}

// ParseKlinesJSON decodes Binance klines (array of arrays) into candles.
// Each row: [openTime, open, high, low, close, volume, closeTime, ...].
// Exported for unit testing without network.
func ParseKlinesJSON(data []byte, symbol, interval string) ([]marketdata.Candle, error) {
	var rows [][]json.RawMessage
	if err := json.Unmarshal(data, &rows); err != nil {
		return nil, err
	}
	out := make([]marketdata.Candle, 0, len(rows))
	for _, r := range rows {
		if len(r) < 7 {
			continue
		}
		openTime := jsonInt(r[0])
		closeTime := jsonInt(r[6])
		open := jsonFloatStr(r[1])
		high := jsonFloatStr(r[2])
		low := jsonFloatStr(r[3])
		closePx := jsonFloatStr(r[4])
		vol := jsonFloatStr(r[5])
		if openTime <= 0 || open <= 0 || closePx <= 0 {
			continue
		}
		out = append(out, marketdata.Candle{
			Symbol:    symbol,
			Timeframe: interval,
			OpenTime:  openTime,
			CloseTime: closeTime,
			Open:      open,
			High:      high,
			Low:       low,
			Close:     closePx,
			Volume:    vol,
		})
	}
	return out, nil
}

// jsonInt parses a JSON number token to int64.
func jsonInt(raw json.RawMessage) int64 {
	n, err := strconv.ParseInt(strings.TrimSpace(string(raw)), 10, 64)
	if err != nil {
		return 0
	}
	return n
}

// jsonFloatStr parses a JSON string token ("123.4") to float64.
func jsonFloatStr(raw json.RawMessage) float64 {
	s := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return f
}
