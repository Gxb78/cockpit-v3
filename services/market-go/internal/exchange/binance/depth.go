package binance

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Default REST hosts per market. Spot allows a snapshot limit up to 5000;
// USDⓈ-M futures up to 1000.
const (
	DefaultSpotRESTURL    = "https://api.binance.com"
	DefaultFuturesRESTURL = "https://fapi.binance.com"

	DefaultSpotWSURL    = "wss://stream.binance.com:9443/stream"
	DefaultFuturesWSURL = "wss://fstream.binance.com/stream"

	spotSnapshotMaxLimit    = 5000
	futuresSnapshotMaxLimit = 1000
)

// DepthSnapshot is a REST order-book snapshot with its lastUpdateId, the anchor
// for diff-stream sequencing.
type DepthSnapshot struct {
	LastUpdateID int64
	Bids         [][]string
	Asks         [][]string
}

type wsDepthSnapshot struct {
	LastUpdateID int64      `json:"lastUpdateId"`
	Bids         [][]string `json:"bids"`
	Asks         [][]string `json:"asks"`
}

// ParseDepthSnapshotJSON decodes a REST depth response. Exported for testing
// without network.
func ParseDepthSnapshotJSON(data []byte) (DepthSnapshot, error) {
	var w wsDepthSnapshot
	if err := json.Unmarshal(data, &w); err != nil {
		return DepthSnapshot{}, err
	}
	if w.LastUpdateID <= 0 {
		return DepthSnapshot{}, fmt.Errorf("%w: missing lastUpdateId", ErrInvalid)
	}
	return DepthSnapshot{
		LastUpdateID: w.LastUpdateID,
		Bids:         w.Bids,
		Asks:         w.Asks,
	}, nil
}

// depthSnapshotPath builds the market-specific REST path for a depth snapshot.
func depthSnapshotPath(market Market, restURL, symbol string, limit int) string {
	base := strings.TrimRight(restURL, "/")
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	if market == MarketFutures {
		if base == "" {
			base = DefaultFuturesRESTURL
		}
		if limit <= 0 || limit > futuresSnapshotMaxLimit {
			limit = futuresSnapshotMaxLimit
		}
		return fmt.Sprintf("%s/fapi/v1/depth?symbol=%s&limit=%d", base, sym, limit)
	}
	if base == "" {
		base = DefaultSpotRESTURL
	}
	if limit <= 0 || limit > spotSnapshotMaxLimit {
		limit = spotSnapshotMaxLimit
	}
	return fmt.Sprintf("%s/api/v3/depth?symbol=%s&limit=%d", base, sym, limit)
}

// FetchDepthSnapshot requests a REST order-book snapshot for the given market.
func FetchDepthSnapshot(ctx context.Context, market Market, restURL, symbol string, limit int) (DepthSnapshot, error) {
	url := depthSnapshotPath(market, restURL, symbol, limit)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return DepthSnapshot{}, err
	}
	req.Header.Set("User-Agent", "CockpitV6-MarketGo/0.8")
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return DepthSnapshot{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return DepthSnapshot{}, fmt.Errorf("binance depth http %d: %s", res.StatusCode, strings.TrimSpace(string(snippet)))
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if err != nil {
		return DepthSnapshot{}, err
	}
	return ParseDepthSnapshotJSON(data)
}
