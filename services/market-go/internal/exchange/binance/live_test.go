package binance

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"cockpit-v6-market-go/internal/marketdata"
)

// TestLiveBookSync connects to the real Binance diff-depth stream + REST
// snapshot and verifies the maintainer builds a deep, well-formed local book.
// It is skipped unless BINANCE_LIVE=1 so it never runs in CI/offline.
//
//	BINANCE_LIVE=1 go test ./internal/exchange/binance/ -run TestLiveBookSync -v
//
// Set BINANCE_MARKET=futures to exercise the USDⓈ-M venue.
func TestLiveBookSync(t *testing.T) {
	if os.Getenv("BINANCE_LIVE") != "1" {
		t.Skip("set BINANCE_LIVE=1 to run the live Binance integration test")
	}

	market := ParseMarket(os.Getenv("BINANCE_MARKET"))
	client := NewClient(ClientConfig{Market: market}, nil, Events{})

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var (
		mu      sync.Mutex
		last    marketdata.OrderBookSnapshot
		updates int
	)
	bookHandler := func(s marketdata.OrderBookSnapshot) {
		mu.Lock()
		last = s
		updates++
		mu.Unlock()
	}

	go func() {
		_ = client.ConnectMarket(ctx, "BTCUSDT", nil, bookHandler, 0)
	}()

	// Wait until we have a synced, deep book or the timeout elapses.
	deadline := time.Now().Add(14 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		depth := min(len(last.Bids), len(last.Asks))
		n := updates
		mu.Unlock()
		if n > 5 && depth >= 100 {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	t.Logf("market=%s updates=%d bids=%d asks=%d bestBid=%.2f bestAsk=%.2f spread=%.2f",
		market, updates, len(last.Bids), len(last.Asks), last.BestBid, last.BestAsk, last.Spread)

	if updates == 0 {
		t.Fatalf("no book updates received from live Binance %s", market)
	}
	depth := min(len(last.Bids), len(last.Asks))
	if depth < 100 {
		t.Fatalf("expected a deep maintained book (>=100 levels/side), got depth=%d "+
			"(this is the whole point: walls far from price must be present)", depth)
	}
	if last.BestBid <= 0 || last.BestAsk <= 0 || last.BestBid >= last.BestAsk {
		t.Fatalf("malformed top of book: bestBid=%.2f bestAsk=%.2f", last.BestBid, last.BestAsk)
	}
	// Bids must be strictly descending, asks strictly ascending.
	for i := 1; i < len(last.Bids); i++ {
		if last.Bids[i].Price >= last.Bids[i-1].Price {
			t.Fatalf("bids not strictly descending at %d: %.2f >= %.2f", i, last.Bids[i].Price, last.Bids[i-1].Price)
		}
	}
	for i := 1; i < len(last.Asks); i++ {
		if last.Asks[i].Price <= last.Asks[i-1].Price {
			t.Fatalf("asks not strictly ascending at %d: %.2f <= %.2f", i, last.Asks[i].Price, last.Asks[i-1].Price)
		}
	}
}
