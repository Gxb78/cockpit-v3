package hyperliquid

import (
	"bytes"
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

// DefaultHTTPURL is the Hyperliquid public info endpoint (read-only).
const DefaultHTTPURL = "https://api.hyperliquid.xyz/info"

type candleSnapshotReq struct {
	Type string             `json:"type"`
	Req  candleSnapshotBody `json:"req"`
}

type candleSnapshotBody struct {
	Coin      string `json:"coin"`
	Interval  string `json:"interval"`
	StartTime int64  `json:"startTime"`
	EndTime   int64  `json:"endTime"`
}

// rawCandle mirrors a Hyperliquid candleSnapshot element.
// Numeric OHLCV fields arrive as strings.
type rawCandle struct {
	T int64  `json:"t"` // open time (ms)
	E int64  `json:"T"` // close time (ms)
	S string `json:"s"` // symbol
	I string `json:"i"` // interval
	O string `json:"o"`
	C string `json:"c"`
	H string `json:"h"`
	L string `json:"l"`
	V string `json:"v"`
	N int    `json:"n"`
}

// FetchCandles requests historical OHLCV candles from Hyperliquid's public
// candleSnapshot endpoint and normalises them to marketdata.Candle.
func FetchCandles(ctx context.Context, httpURL, coin, interval string, startMs, endMs int64) ([]marketdata.Candle, error) {
	if strings.TrimSpace(httpURL) == "" {
		httpURL = DefaultHTTPURL
	}
	coin = normalizeCoin(coin)
	if interval == "" {
		interval = "1m"
	}

	reqBody := candleSnapshotReq{
		Type: "candleSnapshot",
		Req:  candleSnapshotBody{Coin: coin, Interval: interval, StartTime: startMs, EndTime: endMs},
	}
	buf, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, httpURL, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("User-Agent", "CockpitV6-MarketGo/0.7")

	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, fmt.Errorf("candleSnapshot http %d: %s", res.StatusCode, strings.TrimSpace(string(snippet)))
	}

	data, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	return ParseCandlesJSON(data, coin, interval)
}

// ParseCandlesJSON decodes a candleSnapshot JSON array into normalised candles.
// Exported so it can be unit tested without network access.
func ParseCandlesJSON(data []byte, coin, interval string) ([]marketdata.Candle, error) {
	var raws []rawCandle
	if err := json.Unmarshal(data, &raws); err != nil {
		return nil, err
	}
	out := make([]marketdata.Candle, 0, len(raws))
	for _, r := range raws {
		open := parseFloat(r.O)
		high := parseFloat(r.H)
		low := parseFloat(r.L)
		closePx := parseFloat(r.C)
		vol := parseFloat(r.V)
		if r.T <= 0 || open <= 0 || closePx <= 0 {
			continue
		}
		sym := coin
		if strings.TrimSpace(r.S) != "" {
			sym = normalizeCoin(r.S)
		}
		tf := interval
		if strings.TrimSpace(r.I) != "" {
			tf = r.I
		}
		out = append(out, marketdata.Candle{
			Symbol:    sym,
			Timeframe: tf,
			OpenTime:  r.T,
			CloseTime: r.E,
			Open:      open,
			High:      high,
			Low:       low,
			Close:     closePx,
			Volume:    vol,
		})
	}
	return out, nil
}

func parseFloat(s string) float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0
	}
	return f
}
