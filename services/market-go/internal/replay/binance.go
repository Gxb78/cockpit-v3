package replay

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"cockpit-v6-market-go/internal/marketdata"
)

// BinanceSource pulls free, public, tick-level aggTrades from Binance Data
// Vision (no API key, no credentials). One zip per symbol per UTC day.
//
// CSV columns (no header):
//   aggTradeId, price, qty, firstId, lastId, timestamp(µs), isBuyerMaker, isBestMatch
// isBuyerMaker=true  -> the aggressor is the SELLER  (side = "sell")
// isBuyerMaker=false -> the aggressor is the BUYER   (side = "buy")
type BinanceSource struct {
	BaseURL string // default https://data.binance.vision
	Market  string // "spot" or "futures/um"
	client  *http.Client
}

func NewBinanceSource() *BinanceSource {
	return &BinanceSource{
		BaseURL: "https://data.binance.vision",
		Market:  "spot",
		client:  &http.Client{Timeout: 120 * time.Second},
	}
}

func (s *BinanceSource) Name() string { return "binance-data-vision" }

func (s *BinanceSource) url(symbol, date string) string {
	base := strings.TrimRight(s.BaseURL, "/")
	market := s.Market
	if market == "" {
		market = "spot"
	}
	sym := strings.ToUpper(symbol)
	// e.g. /data/spot/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2025-05-28.zip
	return fmt.Sprintf("%s/data/%s/daily/aggTrades/%s/%s-aggTrades-%s.zip", base, market, sym, sym, date)
}

func (s *BinanceSource) LoadDay(ctx context.Context, symbol, date string) ([]marketdata.Trade, error) {
	u := s.url(symbol, date)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "CockpitV6-MarketGo/0.8")

	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("binance data vision http %d for %s", res.StatusCode, u)
	}

	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("unzip: %w", err)
	}
	for _, f := range zr.File {
		if !strings.HasSuffix(strings.ToLower(f.Name), ".csv") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		trades, err := ParseAggTradesCSV(rc, symbol)
		rc.Close()
		return trades, err
	}
	return nil, fmt.Errorf("no csv inside zip for %s", u)
}

// ParseAggTradesCSV parses Binance aggTrades CSV into normalised trades.
// Exported and stream-based so it can be unit tested without network/zip.
func ParseAggTradesCSV(r io.Reader, symbol string) ([]marketdata.Trade, error) {
	sym := strings.ToUpper(symbol)
	out := make([]marketdata.Trade, 0, 1<<20)
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 1024*1024), 8*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		// Skip an optional header row.
		if line[0] < '0' || line[0] > '9' {
			continue
		}
		cols := strings.Split(line, ",")
		if len(cols) < 7 {
			continue
		}
		price, e1 := strconv.ParseFloat(cols[1], 64)
		qty, e2 := strconv.ParseFloat(cols[2], 64)
		tsRaw, e3 := strconv.ParseInt(cols[5], 10, 64)
		if e1 != nil || e2 != nil || e3 != nil || price <= 0 || qty <= 0 {
			continue
		}
		ts := normalizeTsMillis(tsRaw)
		isBuyerMaker := parseBool(cols[6])
		side := "buy"
		if isBuyerMaker {
			side = "sell"
		}
		out = append(out, marketdata.Trade{
			ID:         cols[0],
			TradeID:    cols[0],
			Exchange:   "binance",
			Symbol:     sym,
			TsExchange: ts,
			TsLocal:    ts,
			Price:      price,
			Qty:        qty,
			Side:       side,
			Notional:   price * qty,
		})
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// Binance timestamps may be in ms or µs depending on dataset era; normalise to ms.
func normalizeTsMillis(ts int64) int64 {
	switch {
	case ts > 1e17: // nanoseconds
		return ts / 1e6
	case ts > 1e14: // microseconds
		return ts / 1e3
	default: // already milliseconds
		return ts
	}
}

func parseBool(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "true", "1":
		return true
	default:
		return false
	}
}

var _ Source = (*BinanceSource)(nil)
