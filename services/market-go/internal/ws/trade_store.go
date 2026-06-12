package ws

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
	"cockpit-v6-market-go/internal/storage"
)

const (
	maxLiveTrades                 = 100000
	binanceAggTradesMaxPerRequest = 1000
)

// tradeStore owns the in-memory live trade buffer plus its file-cache and SQLite
// persistence, and the recent-trade backfill from the active exchange's REST API.
// onLoaded is invoked after a backfill/persisted-load brings in new trades (wired
// to cvdTracker.broadcastInit) so the store stays decoupled from CVD.
type tradeStore struct {
	mu     sync.RWMutex
	trades []marketdata.Trade

	cache *TradeCache
	sqlDB *storage.DB
	// cfg is shared by pointer so a runtime exchange switch (which mutates
	// Exchange/Symbols) is seen here without reconstructing the store.
	cfg *config.Config
	log *logx.Logger

	onLoaded func()
}

func newTradeStore(cfg *config.Config, cache *TradeCache, sqlDB *storage.DB, log *logx.Logger, onLoaded func()) *tradeStore {
	return &tradeStore{cache: cache, sqlDB: sqlDB, cfg: cfg, log: log, onLoaded: onLoaded}
}

// Record appends a live trade to the buffer and persists it to the file cache
// and SQLite (both fire-and-forget).
func (t *tradeStore) Record(trade marketdata.Trade) {
	if t.cache != nil {
		go t.cache.Append(trade)
	}
	if t.sqlDB != nil {
		go func(tr marketdata.Trade) {
			side := strings.ToLower(strings.TrimSpace(tr.Side))
			rec := storage.TradeRecord{
				Symbol:          tr.Symbol,
				ExchangeTradeID: tr.TradeID,
				TimestampMs:     tr.TsExchange,
				Price:           tr.Price,
				Qty:             tr.Qty,
				IsBuy:           side == "buy",
			}
			if err := t.sqlDB.InsertTrade(rec); err != nil {
				t.log.Infof("sqlite insert trade: %v", err)
			}
		}(trade)
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	t.trades = append(t.trades, trade)
	if len(t.trades) > maxLiveTrades {
		t.trades = t.trades[len(t.trades)-maxLiveTrades:]
	}
}

// Snapshot returns a copy of the live trade buffer.
func (t *tradeStore) Snapshot() []marketdata.Trade {
	t.mu.RLock()
	defer t.mu.RUnlock()
	out := make([]marketdata.Trade, len(t.trades))
	copy(out, t.trades)
	return out
}

// Len returns the number of buffered trades.
func (t *tradeStore) Len() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.trades)
}

// Reset clears the live buffer (e.g. on exchange switch).
func (t *tradeStore) Reset() {
	t.mu.Lock()
	t.trades = nil
	t.mu.Unlock()
}

// defaultSymbols returns the configured symbols, falling back to the venue default.
func (t *tradeStore) defaultSymbols() []string {
	symbols := t.cfg.Symbols
	if len(symbols) == 0 {
		if t.cfg.Exchange == config.ExchangeHyperliquid {
			return []string{"BTC"}
		}
		return []string{"BTCUSDT"}
	}
	return symbols
}

// mergeSorted appends trades to the buffer, sorts by exchange timestamp, and caps.
func (t *tradeStore) mergeSorted(in []marketdata.Trade) {
	t.mu.Lock()
	t.trades = append(t.trades, in...)
	sort.Slice(t.trades, func(i, j int) bool {
		return t.trades[i].TsExchange < t.trades[j].TsExchange
	})
	if len(t.trades) > maxLiveTrades {
		t.trades = t.trades[len(t.trades)-maxLiveTrades:]
	}
	t.mu.Unlock()
}

// Backfill fetches recent trades from the active exchange's REST API, merges
// them, persists them to cache, and broadcasts a fresh cvd_init via onLoaded.
func (t *tradeStore) Backfill(ctx context.Context) {
	for _, symbol := range t.defaultSymbols() {
		var fetched []marketdata.Trade
		var err error
		if t.cfg.Exchange == config.ExchangeBinance {
			fetched, err = t.fetchBinanceRecentTrades(ctx, symbol)
		} else if t.cfg.Exchange == config.ExchangeHyperliquid {
			fetched, err = t.fetchHyperliquidRecentTrades(ctx, symbol)
		}
		if err != nil {
			t.log.Errorf("failed to backfill trades for symbol=%s: %v", symbol, err)
			continue
		}
		t.log.Infof("backfilled %d historical trades for symbol=%s", len(fetched), symbol)

		t.mergeSorted(fetched)

		if t.cache != nil {
			t.cache.AppendBatch(fetched)
		}
	}

	// Broadcast a fresh cvd_init after trade backfill, if enough data exists.
	if t.onLoaded != nil {
		t.onLoaded()
	}
}

// LoadPersisted loads recent trades from the file cache into the buffer so CVD
// history survives restarts. Called at the start of startExchange.
func (t *tradeStore) LoadPersisted() {
	if t.cache == nil {
		return
	}
	exchange := t.cfg.Exchange
	if exchange == config.ExchangeMock {
		return
	}

	var totalLoaded int
	for _, symbol := range t.defaultSymbols() {
		cached := t.cache.LoadRecent(exchange, symbol)
		if len(cached) == 0 {
			continue
		}
		t.mergeSorted(cached)
		totalLoaded += len(cached)
		t.log.Infof("loaded %d persisted trades for %s/%s", len(cached), exchange, symbol)
	}

	if totalLoaded > 0 && t.onLoaded != nil {
		t.onLoaded()
	}
}

// Purge runs one retention sweep of the file cache for all configured symbols.
func (t *tradeStore) Purge() {
	if t.cache == nil {
		return
	}
	syms := t.cfg.Symbols
	if len(syms) == 0 {
		syms = []string{"BTCUSDT"}
	}
	for _, sym := range syms {
		t.cache.PurgeOlderThan(t.cfg.Exchange, sym)
	}
	t.log.Infof("periodic purge complete for %d symbols", len(syms))
}

// RunPurgeLoop purges the trade cache every hour until ctx is cancelled.
func (t *tradeStore) RunPurgeLoop(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			t.Purge()
		}
	}
}

type binanceAggTrade struct {
	ID           int64  `json:"a"`
	Price        string `json:"p"`
	Qty          string `json:"q"`
	FirstID      int64  `json:"f"`
	LastID       int64  `json:"l"`
	Time         int64  `json:"T"`
	IsBuyerMaker bool   `json:"m"`
}

func (t *tradeStore) fetchBinanceRecentTrades(ctx context.Context, symbol string) ([]marketdata.Trade, error) {
	url := fmt.Sprintf("%s/api/v3/aggTrades?symbol=%s&limit=%d", t.cfg.BinanceRESTURL, symbol, binanceAggTradesMaxPerRequest)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "CockpitV6-MarketGo/0.7")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("http status %d", resp.StatusCode)
	}

	var rawTrades []binanceAggTrade
	if err := json.NewDecoder(resp.Body).Decode(&rawTrades); err != nil {
		return nil, err
	}

	var out []marketdata.Trade
	for _, tr := range rawTrades {
		price, _ := strconv.ParseFloat(tr.Price, 64)
		qty, _ := strconv.ParseFloat(tr.Qty, 64)
		side := "buy"
		if tr.IsBuyerMaker {
			side = "sell"
		}
		tradeID := fmt.Sprintf("%d", tr.ID)
		out = append(out, marketdata.Trade{
			ID:         tradeID,
			TradeID:    tradeID,
			Exchange:   "binance",
			Symbol:     symbol,
			TsExchange: tr.Time,
			TsLocal:    time.Now().UnixMilli(),
			Price:      price,
			Qty:        qty,
			Side:       side,
			Notional:   price * qty,
		})
	}
	return out, nil
}

type hlRestTrade struct {
	Coin string `json:"coin"`
	Side string `json:"side"`
	Px   string `json:"px"`
	Sz   string `json:"sz"`
	Hash string `json:"hash"`
	Time int64  `json:"time"`
	TID  int64  `json:"tid"`
}

func (t *tradeStore) fetchHyperliquidRecentTrades(ctx context.Context, symbol string) ([]marketdata.Trade, error) {
	coin := normalizeHlCoin(symbol)
	url := t.cfg.HyperliquidHTTPURL
	if url == "" {
		url = "https://api.hyperliquid.xyz/info"
	}

	bodyMap := map[string]any{
		"type": "recentTrades",
		"coin": coin,
	}
	bodyBytes, err := json.Marshal(bodyMap)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "CockpitV6-MarketGo/0.7")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("http status %d", resp.StatusCode)
	}

	var rawTrades []hlRestTrade
	if err := json.NewDecoder(resp.Body).Decode(&rawTrades); err != nil {
		return nil, err
	}

	var out []marketdata.Trade
	for _, tr := range rawTrades {
		price, _ := strconv.ParseFloat(tr.Px, 64)
		qty, _ := strconv.ParseFloat(tr.Sz, 64)
		side := "buy"
		if strings.ToUpper(tr.Side) == "A" || strings.ToUpper(tr.Side) == "ASK" || strings.ToUpper(tr.Side) == "SELL" {
			side = "sell"
		}
		tradeID := fmt.Sprintf("%d:%s:%d", tr.Time, tr.Coin, tr.TID)
		out = append(out, marketdata.Trade{
			ID:         tradeID,
			TradeID:    tradeID,
			Exchange:   "hyperliquid",
			Symbol:     symbol,
			TsExchange: tr.Time,
			TsLocal:    time.Now().UnixMilli(),
			Price:      price,
			Qty:        qty,
			Side:       side,
			Notional:   price * qty,
		})
	}
	return out, nil
}

func normalizeHlCoin(coin string) string {
	c := strings.ToUpper(strings.TrimSpace(coin))
	c = strings.ReplaceAll(c, "USDT", "")
	c = strings.ReplaceAll(c, "USD", "")
	c = strings.ReplaceAll(c, "-PERP", "")
	c = strings.ReplaceAll(c, "/", "")
	return c
}
