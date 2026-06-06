package ws

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"cockpit-v6-market-go/internal/marketdata"
)

// TradeCache persists trades to daily JSON lines files.
// Format: data/trades_cache/<exchange>_<symbol>_YYYY-MM-DD.jsonl
// Each line is a JSON-serialized marketdata.Trade.
//
// On load, reads last N days of files, deduplicates by TradeID.
// On record, appends to current day's file.
type TradeCache struct {
	mu       sync.Mutex
	dataDir  string
	retainDays int        // days of history to keep (default 7)
}

// NewTradeCache creates a trade cache under the given data directory.
// Pass empty dataDir to disable (useful for tests or mock mode).
func NewTradeCache(dataDir string, retainDays int) *TradeCache {
	if retainDays <= 0 {
		retainDays = 7
	}
	return &TradeCache{
		dataDir:    dataDir,
		retainDays: retainDays,
	}
}

// fileName returns the cache file path for a given exchange, symbol, and date.
func (tc *TradeCache) fileName(exchange, symbol string, t time.Time) string {
	if tc.dataDir == "" {
		return ""
	}
	cleanSym := strings.NewReplacer("/", "_", "\\", "_", " ", "").Replace(symbol)
	cleanEx := strings.NewReplacer("/", "_", "\\", "_", " ", "").Replace(exchange)
	date := t.Format("2006-01-02")
	dir := filepath.Join(tc.dataDir, "trades_cache")
	return filepath.Join(dir, fmt.Sprintf("%s_%s_%s.jsonl", cleanEx, cleanSym, date))
}

// todayFileName returns the file for the current UTC day.
func (tc *TradeCache) todayFileName(exchange, symbol string) string {
	return tc.fileName(exchange, symbol, time.Now().UTC())
}

// Append writes a single trade to the current day's cache file.
// No-op if dataDir is empty (cache disabled).
func (tc *TradeCache) Append(trade marketdata.Trade) {
	if tc.dataDir == "" {
		return
	}
	tc.mu.Lock()
	defer tc.mu.Unlock()

	path := tc.todayFileName(trade.Exchange, trade.Symbol)
	if path == "" {
		return
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	if err := enc.Encode(trade); err != nil {
		return
	}
}

// AppendBatch writes multiple trades to the cache.
func (tc *TradeCache) AppendBatch(trades []marketdata.Trade) {
	// Group by (exchange, symbol, day) to minimize file opens
	type fileKey struct {
		exchange string
		symbol   string
		day      string
	}
	batches := make(map[fileKey][]marketdata.Trade)
	for _, t := range trades {
		day := time.UnixMilli(t.TsExchange).UTC().Format("2006-01-02")
		key := fileKey{t.Exchange, t.Symbol, day}
		batches[key] = append(batches[key], t)
	}

	for key, batch := range batches {
		day, _ := time.Parse("2006-01-02", key.day)
		path := tc.fileName(key.exchange, key.symbol, day)
		if path == "" {
			continue
		}
		dir := filepath.Dir(path)
		if err := os.MkdirAll(dir, 0755); err != nil {
			continue
		}

		tc.mu.Lock()
		f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			tc.mu.Unlock()
			continue
		}
		enc := json.NewEncoder(f)
		for _, t := range batch {
			enc.Encode(t)
		}
		f.Close()
		tc.mu.Unlock()
	}
}

// LoadRecent reads all cached trades for the last N days (retainDays) for
// the given exchange and symbol. Returns sorted by TsExchange ascending.
func (tc *TradeCache) LoadRecent(exchange, symbol string) []marketdata.Trade {
	if tc.dataDir == "" {
		return nil
	}

	now := time.Now().UTC()
	byID := make(map[string]marketdata.Trade)
	var maxTs int64

	for day := 0; day < tc.retainDays; day++ {
		t := now.AddDate(0, 0, -day)
		path := tc.fileName(exchange, symbol, t)
		if path == "" {
			continue
		}

		f, err := os.Open(path)
		if err != nil {
			continue // file doesn't exist yet
		}

		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 64*1024), 512*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var trade marketdata.Trade
			if err := json.Unmarshal([]byte(line), &trade); err != nil {
				continue
			}
			if trade.TsExchange <= 0 {
				continue
			}
			id := trade.TradeID
			if id == "" {
				id = trade.ID
			}
			if id == "" {
				continue
			}
			byID[id] = trade
			if trade.TsExchange > maxTs {
				maxTs = trade.TsExchange
			}
		}
		f.Close()
	}

	if len(byID) == 0 {
		return nil
	}

	out := make([]marketdata.Trade, 0, len(byID))
	for _, trade := range byID {
		out = append(out, trade)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].TsExchange < out[j].TsExchange
	})
	return out
}

// PurgeOlderThan removes cache files older than retainDays.
// Called periodically to prevent disk bloat.
func (tc *TradeCache) PurgeOlderThan(exchange, symbol string) {
	if tc.dataDir == "" {
		return
	}

	tc.mu.Lock()
	defer tc.mu.Unlock()

	cleanSym := strings.NewReplacer("/", "_", "\\", "_", " ", "").Replace(symbol)
	cleanEx := strings.NewReplacer("/", "_", "\\", "_", " ", "").Replace(exchange)
	prefix := fmt.Sprintf("%s_%s_", cleanEx, cleanSym)
	dir := filepath.Join(tc.dataDir, "trades_cache")

	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	cutoff := time.Now().UTC().AddDate(0, 0, -tc.retainDays)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), prefix) || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		// Extract date from filename: prefix + "YYYY-MM-DD.jsonl"
		datePart := strings.TrimSuffix(strings.TrimPrefix(entry.Name(), prefix), ".jsonl")
		fileTime, err := time.Parse("2006-01-02", datePart)
		if err != nil {
			continue
		}
		if fileTime.Before(cutoff) {
			fullPath := filepath.Join(dir, entry.Name())
			os.Remove(fullPath)
		}
	}
}

// Clear removes all trade cache files for a given exchange+symbol.
func (tc *TradeCache) Clear(exchange, symbol string) {
	if tc.dataDir == "" {
		return
	}

	tc.mu.Lock()
	defer tc.mu.Unlock()

	cleanSym := strings.NewReplacer("/", "_", "\\", "_", " ", "").Replace(symbol)
	cleanEx := strings.NewReplacer("/", "_", "\\", "_", " ", "").Replace(exchange)
	prefix := fmt.Sprintf("%s_%s_", cleanEx, cleanSym)
	dir := filepath.Join(tc.dataDir, "trades_cache")

	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() && strings.HasPrefix(entry.Name(), prefix) && strings.HasSuffix(entry.Name(), ".jsonl") {
			os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}
