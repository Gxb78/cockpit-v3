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

// FetchKlines requests historical OHLCV candles from Binance public REST.
//   GET /api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000
// If limit > 1000, makes a second request with endTime to cover earlier data.
func FetchKlines(ctx context.Context, restURL, symbol, interval string, limit int) ([]marketdata.Candle, error) {
	if strings.TrimSpace(restURL) == "" {
		restURL = DefaultRESTURL
	}
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	if interval == "" {
		interval = "1m"
	}
	if limit <= 0 {
		limit = 1000
	}
	perReq := 1000
	if limit < perReq {
		perReq = limit
	}

	// Step 1: get the most recent batch (Binance returns oldest-first)
	batch, err := fetchSingleBatch(ctx, restURL, sym, interval, perReq, 0)
	if err != nil {
		return nil, err
	}
	if len(batch) == 0 {
		return batch, nil
	}

	// Step 2: if we need more and got a full batch, request an earlier batch
	if limit > perReq && len(batch) == perReq {
		endTime := batch[0].OpenTime - 1 // batch[0] is the oldest candle
		earlier, err := fetchSingleBatch(ctx, restURL, sym, interval, perReq, endTime)
		if err == nil && len(earlier) > 0 {
			all := make([]marketdata.Candle, 0, len(earlier)+len(batch))
			all = append(all, earlier...)
			all = append(all, batch...)
			return all, nil
		}
	}
	return batch, nil
}

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
