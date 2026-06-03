package ws

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"cockpit-v6-market-go/internal/marketdata"
)

// KlineCache provides file-based caching for historical klines.
// Format: one JSON line per candle (symbol_timeframe sorted).
// Files are stored under <dataDir>/klines_cache/<symbol>_<interval>.jsonl
//
// The cache is append-only on write, and deduplicates on load by openTime.
type KlineCache struct {
	mu      sync.RWMutex
	dataDir string
}

// NewKlineCache creates a kline cache under the given data directory.
// Pass empty string to disable file caching.
func NewKlineCache(dataDir string) *KlineCache {
	if dataDir == "" {
		return &KlineCache{} // disabled
	}
	return &KlineCache{dataDir: dataDir}
}

func (kc *KlineCache) cachePath(symbol, interval string) string {
	if kc.dataDir == "" {
		return ""
	}
	cleanSym := strings.NewReplacer("/", "_", "\\", "_", " ", "").Replace(symbol)
	dir := filepath.Join(kc.dataDir, "klines_cache")
	return filepath.Join(dir, cleanSym+"_"+interval+".jsonl")
}

// Load reads cached klines for a symbol+interval. Returns the candles sorted
// by openTime ascending, and the openTime of the newest candle (0 if empty).
func (kc *KlineCache) Load(symbol, interval string) ([]marketdata.Candle, int64) {
	if kc.dataDir == "" {
		return nil, 0
	}
	kc.mu.RLock()
	defer kc.mu.RUnlock()

	path := kc.cachePath(symbol, interval)
	f, err := os.Open(path)
	if err != nil {
		return nil, 0
	}
	defer f.Close()

	byOpenTime := make(map[int64]marketdata.Candle)
	var newest int64
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 512*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var c marketdata.Candle
		if err := json.Unmarshal([]byte(line), &c); err != nil {
			continue
		}
		if c.OpenTime <= 0 {
			continue
		}
		byOpenTime[c.OpenTime] = c
		if c.OpenTime > newest {
			newest = c.OpenTime
		}
	}

	out := make([]marketdata.Candle, 0, len(byOpenTime))
	for _, c := range byOpenTime {
		out = append(out, c)
	}
	// Sort by openTime
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].OpenTime < out[i].OpenTime {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out, newest
}

// Append writes new candles to the cache file (append-only, no dedup here).
// Dedup happens on Load. Call this after fetching from Binance.
func (kc *KlineCache) Append(symbol, interval string, candles []marketdata.Candle) {
	if kc.dataDir == "" || len(candles) == 0 {
		return
	}
	kc.mu.Lock()
	defer kc.mu.Unlock()

	path := kc.cachePath(symbol, interval)
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
	for _, c := range candles {
		if err := enc.Encode(c); err != nil {
			return
		}
	}
}

// Save replaces the entire cache file with the given candles (deduplicated by openTime).
func (kc *KlineCache) Save(symbol, interval string, candles []marketdata.Candle) {
	if kc.dataDir == "" {
		return
	}
	kc.mu.Lock()
	defer kc.mu.Unlock()

	path := kc.cachePath(symbol, interval)
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}

	f, err := os.Create(path)
	if err != nil {
		return
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	for _, c := range candles {
		if err := enc.Encode(c); err != nil {
			return
		}
	}
}
