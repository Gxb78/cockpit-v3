package ws

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"cockpit-v6-market-go/internal/calc"
	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/engine"
	"cockpit-v6-market-go/internal/exchange/binance"
	"cockpit-v6-market-go/internal/exchange/hyperliquid"
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
	"cockpit-v6-market-go/internal/replay"
	"cockpit-v6-market-go/internal/storage"
)

const websocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const streamSendBuffer = 2048

type Server struct {
	cfg    config.Config
	engine *engine.Engine
	hub    *Hub
	log    *logx.Logger

	historyMu  sync.RWMutex
	historyRaw [][]byte // cached candle_history envelopes, replayed to new clients

	player *replay.Player

	trades *tradeStore // live trade buffer + cache/SQLite persistence + backfill

	klineCache *KlineCache // file-based kline persistence

	sqlDB *storage.DB // SQLite for trades + footprints

	cvd        *cvdTracker     // running CVD-per-symbol + cvd_init history/broadcast
	footprints *footprintStore // footprint persist / rebuild / aggregate

	// Exchange switching
	exchangeCancel context.CancelFunc
	exchangeMu     sync.Mutex
	rootCtx        context.Context // parent context for exchange switching
}

func NewServer(cfg config.Config, marketEngine *engine.Engine, logger *logx.Logger) *Server {
	dataDir := cfg.DataDir
	if dataDir == "" {
		dataDir = "data"
	}
	s := &Server{
		cfg:        cfg,
		engine:     marketEngine,
		hub:        NewHub(),
		log:        logger,
		klineCache: NewKlineCache(dataDir),
	}

	// Initialize SQLite for trade + footprint persistence
	if dataDir != "" {
		dbPath := filepath.Join(dataDir, "journal.db")
		sqlDB, err := storage.NewDB(dbPath)
		if err != nil {
			logger.Errorf("failed to open SQLite at %s: %v", dbPath, err)
		} else {
			s.sqlDB = sqlDB
			logger.Infof("SQLite storage ready at %s", dbPath)
		}
	}

	// Wire components. cvd reads trades through a closure (resolved at call time)
	// so the two can be constructed without a circular dependency: trades feeds
	// cvd's broadcast on (re)load.
	s.cvd = newCvdTracker(s.hub, s.log,
		func() []marketdata.Trade { return s.trades.Snapshot() },
		s.cachedCandleHistory1m)
	s.trades = newTradeStore(cfg, NewTradeCache(dataDir, cfg.TradeRetainDays), s.sqlDB, s.log, s.cvd.broadcastInit)
	s.footprints = newFootprintStore(s.sqlDB, s.cvd, s.engine, cfg, s.log)

	s.player = replay.NewPlayer(replay.NewBinanceSource(), s.replayEmit, s.replayStatus)
	return s
}

// replayEmit pushes a replayed trade through the SAME engine pipeline as live
// data, then broadcasts every derived envelope to all stream clients.
func (s *Server) replayEmit(trade marketdata.Trade) {
	s.trades.Record(trade)
	if raw, err := s.engine.Trade(trade).MarshalJSONBytes(); err == nil {
		s.hub.Broadcast(raw)
	}
	for _, env := range s.engine.DeltaBuckets(trade) {
		if raw, err := env.MarshalJSONBytes(); err == nil {
			s.hub.Broadcast(raw)
		}
	}
	if env, ok := s.engine.VWAP(trade); ok {
		if raw, err := env.MarshalJSONBytes(); err == nil {
			s.hub.Broadcast(raw)
		}
	}
	for _, env := range s.engine.FootprintCandles(trade) {
		if raw, err := env.MarshalJSONBytes(); err == nil {
			s.hub.Broadcast(raw)
		}

		// Persist closed footprint candles to SQLite
		if s.sqlDB != nil {
			if fpCandle, ok := env.Payload.(marketdata.FootprintCandle); ok && fpCandle.Closed {
				go s.persistFootprintCandle(fpCandle)
			}
		}
	}
}

func (s *Server) replayStatus(st replay.Status) {
	env := s.engine.ReplayStatus(st)
	if raw, err := env.MarshalJSONBytes(); err == nil {
		s.hub.Broadcast(raw)
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/metrics", s.handleMetrics)
	mux.HandleFunc("/stream", s.handleStream)
	mux.HandleFunc("/replay", s.handleReplay)
	// Footprint UI
	mux.HandleFunc("/footprint", s.handleFootprintUI)
	mux.HandleFunc("/footprint.html", s.handleFootprintUI)
	// Footprint API v1
	mux.HandleFunc("/api/v1/footprint/1m", s.handleGetFootprint1m)
	mux.HandleFunc("/api/v1/footprint/tf", s.handleGetFootprintTF)
	mux.HandleFunc("/api/v1/footprint/profile", s.handleGetFootprintProfile)
	mux.HandleFunc("/api/v1/footprint/latest", s.handleGetFootprintLatest)
	mux.HandleFunc("/api/v1/footprint/stats", s.handleGetFootprintStats)
	// Archive rotation
	mux.HandleFunc("/api/v1/archive/rotate", s.handleArchiveRotate)

	// Wrap in global CORS middleware. The allowed origin is scoped (loopback-only
	// by default; see resolveAllowedOrigin) instead of a blanket wildcard.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if allow := s.resolveAllowedOrigin(r.Header.Get("Origin")); allow != "" {
			w.Header().Set("Access-Control-Allow-Origin", allow)
			if allow != "*" {
				// Reflected origin varies per request: keep caches honest.
				w.Header().Add("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// resolveAllowedOrigin returns the value to echo in Access-Control-Allow-Origin
// for a given request Origin, or "" when no CORS header should be sent (same-
// origin / non-browser callers, or a disallowed cross-origin). Policy:
//   - empty Origin            → "" (same-origin or curl: no CORS needed)
//   - AllowedOrigins unset     → loopback origins only (mirrors the Flask app)
//   - AllowedOrigins contains "*" → "*" (explicit opt-in for trusted dev)
//   - AllowedOrigins lists it  → echo it; otherwise ""
func (s *Server) resolveAllowedOrigin(origin string) string {
	if origin == "" {
		return ""
	}
	allowed := s.cfg.AllowedOrigins
	if len(allowed) == 0 {
		if isLoopbackOrigin(origin) {
			return origin
		}
		return ""
	}
	for _, a := range allowed {
		if a == "*" {
			return "*"
		}
		if a == origin {
			return origin
		}
	}
	return ""
}

// isLoopbackOrigin reports whether an Origin's host is a loopback address.
// Uses url.Parse (not a prefix check) so "http://localhost.attacker.com" is
// correctly rejected.
func isLoopbackOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}

func (s *Server) Run(ctx context.Context) error {
	s.rootCtx = ctx
	server := &http.Server{
		Addr:              s.cfg.Addr(),
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	if s.cfg.MockMode {
		go s.mockLoop(ctx)
	} else {
		// Honor an explicitly configured live exchange (MARKET_GO_EXCHANGE).
		// When none is set (still the mock default), fall back to hyperliquid
		// as the default live view — preserving prior startup behavior.
		if s.cfg.Exchange == config.ExchangeMock || strings.TrimSpace(s.cfg.Exchange) == "" {
			s.cfg.Exchange = config.ExchangeHyperliquid
		}
		s.startExchange(ctx)
	}

	// Periodic cache cleanup (every hour)
	go s.trades.RunPurgeLoop(ctx)

	// Auto-heal: detect gaps and rebuild footprints on startup
	if s.sqlDB != nil {
		symbols := s.cfg.Symbols
		if len(symbols) == 0 {
			symbols = []string{"BTCUSDT"}
		}
		healer := engine.NewHealer(s.sqlDB, s.log, symbols)
		go healer.Run()

		// Retention service
		retCfg := engine.RetentionConfig{
			TradesDays:       s.cfg.TradeRetainDays,
			Footprint1mDays:  s.cfg.Footprint1mRetainDays,
			FootprintTFDays:  s.cfg.FootprintTFRetainDays,
			PurgeIntervalMin: 60,
		}
		retSvc := engine.NewRetentionService(retCfg, s.sqlDB, s.log, symbols)
		go retSvc.Run(ctx.Done())
	}

	errCh := make(chan error, 1)
	go func() {
		s.log.Infof("listening on http://%s exchange=%s mockMode=%t symbols=%s", s.cfg.Addr(), s.cfg.Exchange, s.cfg.MockMode, strings.Join(s.cfg.Symbols, ","))
		err := server.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return err
		}
		if s.sqlDB != nil {
			s.sqlDB.Close()
		}
		return <-errCh
	case err := <-errCh:
		if s.sqlDB != nil {
			s.sqlDB.Close()
		}
		return err
	}
}

func (s *Server) startHyperliquid(ctx context.Context) {
	symbols := s.cfg.Symbols
	if len(symbols) == 0 {
		symbols = []string{"BTC"}
	}
	for _, symbol := range symbols {
		symbol := symbol
		if s.cfg.BackfillEnabled {
			go s.runBackfill(ctx, symbol)
		}
		client := hyperliquid.NewWithEvents(s.cfg.HyperliquidWSURL, s.log, hyperliquid.Events{
			OnConnected: func() {
				s.engine.SetConnected(true)
				s.log.Infof("hyperliquid connected symbol=%s", symbol)
			},
			OnSubscribed: func(subscribedSymbol string) {
				s.log.Infof("hyperliquid subscribed trades symbol=%s", subscribedSymbol)
			},
			OnMessage: func() {
				s.engine.RecordMessageIn()
			},
			OnTrade: func(tradeSymbol string) {
				count := s.engine.Metrics().TotalTradesOut + 1
				if count == 1 || count%100 == 0 {
					s.log.Infof("hyperliquid trade received symbol=%s totalTradesOut=%d", tradeSymbol, count)
				}
			},
			OnBook: func(bookSymbol string) {
				count := s.engine.Metrics().TotalOrderBookOut + 1
				if count == 1 || count%100 == 0 {
					s.log.Infof("hyperliquid l2Book received symbol=%s totalOrderBookOut=%d", bookSymbol, count)
				}
			},
			OnDisconnected: func(err error) {
				s.engine.SetConnected(false)
				if err != nil {
					s.engine.RecordError(err.Error())
				}
				s.log.Errorf("hyperliquid disconnected symbol=%s err=%v", symbol, err)
			},
			OnReconnect: func(attempt int, delay time.Duration, err error) {
				count := s.engine.RecordReconnect()
				s.log.Errorf("hyperliquid reconnect scheduled symbol=%s attempt=%d reconnectCount=%d delay=%s err=%v", symbol, attempt, count, delay, err)
			},
			OnError: func(err error) {
				if err != nil {
					s.engine.RecordError(err.Error())
				}
			},
		})
		go func() {
			var bookHandler func(marketdata.OrderBookSnapshot)
			if s.cfg.BookEnabled || s.cfg.HeatmapEnabled {
				bookHandler = s.throttledBookHandler(ctx, symbol)
			}
			err := client.ConnectMarket(ctx, symbol, func(trade marketdata.Trade) {
				s.trades.Record(trade)
				if raw, err := s.engine.Trade(trade).MarshalJSONBytes(); err == nil {
					s.hub.Broadcast(raw)
				} else {
					s.log.Errorf("marshal trade envelope failed symbol=%s err=%v", symbol, err)
				}
				for _, envelope := range s.engine.DeltaBuckets(trade) {
					if raw, err := envelope.MarshalJSONBytes(); err == nil {
						s.hub.Broadcast(raw)
					} else {
						s.log.Errorf("marshal delta bucket envelope failed symbol=%s err=%v", symbol, err)
					}
				}
				if envelope, ok := s.engine.VWAP(trade); ok {
					if raw, err := envelope.MarshalJSONBytes(); err == nil {
						s.hub.Broadcast(raw)
					} else {
						s.log.Errorf("marshal vwap envelope failed symbol=%s err=%v", symbol, err)
					}
				}
				for _, envelope := range s.engine.FootprintCandles(trade) {
					if raw, err := envelope.MarshalJSONBytes(); err == nil {
						s.hub.Broadcast(raw)
					} else {
						s.log.Errorf("marshal footprint candle envelope failed symbol=%s err=%v", symbol, err)
					}
				}
			}, bookHandler, s.cfg.BookDepth)
			if err != nil && ctx.Err() == nil {
				s.log.Errorf("hyperliquid adapter stopped symbol=%s err=%v", symbol, err)
			}
		}()
	}
}

// startBinance connects the Binance adapter (live aggTrade + depth) and pushes
// trades through the SAME engine pipeline as Hyperliquid, plus a REST backfill.
func (s *Server) startBinance(ctx context.Context) {
	symbols := s.cfg.Symbols
	if len(symbols) == 0 {
		symbols = []string{"BTCUSDT"}
	}
	for _, symbol := range symbols {
		symbol := symbol
		if s.cfg.BackfillEnabled {
			go s.runBinanceBackfill(ctx, symbol)
		}
		client := binance.NewClient(binance.ClientConfig{
			Market:        binance.ParseMarket(s.cfg.BinanceMarket),
			WSURL:         s.cfg.BinanceWSURL,
			RESTURL:       s.cfg.BinanceRESTURL,
			SnapshotLimit: s.cfg.BinanceSnapshotLimit,
		}, s.log, binance.Events{
			OnConnected:  func() { s.engine.SetConnected(true); s.log.Infof("binance connected symbol=%s", symbol) },
			OnSubscribed: func(sym string) { s.log.Infof("binance subscribed symbol=%s", sym) },
			OnMessage:    func() { s.engine.RecordMessageIn() },
			OnTrade: func(sym string) {
				count := s.engine.Metrics().TotalTradesOut + 1
				if count == 1 || count%100 == 0 {
					s.log.Infof("binance trade received symbol=%s totalTradesOut=%d", sym, count)
				}
			},
			OnBook: func(sym string) {
				count := s.engine.Metrics().TotalOrderBookOut + 1
				if count == 1 || count%100 == 0 {
					s.log.Infof("binance depth received symbol=%s totalOrderBookOut=%d", sym, count)
				}
			},
			OnDisconnected: func(err error) {
				s.engine.SetConnected(false)
				if err != nil {
					s.engine.RecordError(err.Error())
				}
				s.log.Errorf("binance disconnected symbol=%s err=%v", symbol, err)
			},
			OnReconnect: func(attempt int, delay time.Duration, err error) {
				count := s.engine.RecordReconnect()
				s.log.Errorf("binance reconnect symbol=%s attempt=%d reconnectCount=%d delay=%s err=%v", symbol, attempt, count, delay, err)
			},
			OnError: func(err error) {
				if err != nil {
					s.engine.RecordError(err.Error())
				}
			},
		})
		go func() {
			var bookHandler func(marketdata.OrderBookSnapshot)
			if s.cfg.BookEnabled || s.cfg.HeatmapEnabled {
				bookHandler = s.throttledBookHandler(ctx, symbol)
			}
			err := client.ConnectMarket(ctx, symbol, s.replayEmit, bookHandler, s.cfg.BookDepth)
			if err != nil && ctx.Err() == nil {
				s.log.Errorf("binance adapter stopped symbol=%s err=%v", symbol, err)
			}
		}()
	}
}

// startExchange launches the adapter for the current cfg.Exchange and runs
// backfills. It uses a new derived context stored in exchangeCancel so that
// subsequent switchExchange calls can cancel it cleanly.
func (s *Server) startExchange(parent context.Context) {
	s.exchangeMu.Lock()
	if s.exchangeCancel != nil {
		s.exchangeCancel()
	}
	ctx, cancel := context.WithCancel(parent)
	s.exchangeCancel = cancel
	s.exchangeMu.Unlock()

	// Load persisted trades from cache to restore CVD history
	s.trades.LoadPersisted()

	// Purge old trade cache files (async, fire and forget)
	go s.trades.Purge()

	switch s.cfg.Exchange {
	case config.ExchangeHyperliquid:
		go s.trades.Backfill(ctx)
		s.startHyperliquid(ctx)
	case config.ExchangeBinance:
		go s.trades.Backfill(ctx)
		s.startBinance(ctx)
	default:
		s.log.Errorf("unknown exchange: %s", s.cfg.Exchange)
	}
}

// switchExchange stops the current exchange, clears all cached state, and
// starts the new one. Called when a WS client sends "source_switch".
func (s *Server) switchExchange(parent context.Context, exchangeName string) {
	s.log.Infof("switching exchange: %s -> %s", s.cfg.Exchange, exchangeName)

	// Cancel current exchange goroutines
	s.exchangeMu.Lock()
	if s.exchangeCancel != nil {
		s.exchangeCancel()
		s.exchangeCancel = nil
	}
	s.exchangeMu.Unlock()

	// Clear all server state
	s.trades.Reset()

	s.historyMu.Lock()
	s.historyRaw = nil
	s.historyMu.Unlock()

	// Update config
	s.cfg.Exchange = exchangeName
	if exchangeName == config.ExchangeHyperliquid {
		s.cfg.Symbols = []string{"BTC"}
	} else {
		s.cfg.Symbols = []string{"BTCUSDT"}
	}

	// Reset engine calculators
	s.engine.Reset()

	// Broadcast reset to all connected clients so they clear their local state
	if raw, err := json.Marshal(map[string]string{"type": "source_switched", "source": exchangeName}); err == nil {
		s.hub.Broadcast(raw)
	}

	// Start the new exchange
	s.startExchange(parent)

	s.log.Infof("exchange switch complete: %s", exchangeName)
}

// cachedCandleHistory1m returns the candles from the cached 1m candle_history
// envelope (used by cvdTracker for OHLCV-based CVD estimation), or nil.
func (s *Server) cachedCandleHistory1m() []marketdata.Candle {
	type candlePayload struct {
		Symbol   string              `json:"symbol"`
		Interval string              `json:"interval"`
		Candles  []marketdata.Candle `json:"candles"`
	}
	type candleEnvelope struct {
		Type    string        `json:"type"`
		Payload candlePayload `json:"payload"`
	}
	s.historyMu.RLock()
	defer s.historyMu.RUnlock()
	for _, raw := range s.historyRaw {
		var env candleEnvelope
		if err := json.Unmarshal(raw, &env); err == nil && env.Type == "candle_history" && env.Payload.Interval == "1m" {
			return env.Payload.Candles
		}
	}
	return nil
}

// runBinanceBackfill fetches REST klines for all configured intervals, caching
// and broadcasting one candle_history envelope per interval.
// Uses file-based kline cache for persistence across restarts.
func (s *Server) runBinanceBackfill(ctx context.Context, symbol string) {
	intervals := s.cfg.BackfillIntervals
	if len(intervals) == 0 {
		intervals = []string{"1m"}
	}
	for _, interval := range intervals {
		if ctx.Err() != nil {
			return
		}
		candles := s.backfillIntervalWithCache(ctx, symbol, interval, "binance")
		if len(candles) == 0 {
			continue
		}
		envelope := s.engine.CandleHistory(symbol, interval, candles)
		raw, err := envelope.MarshalJSONBytes()
		if err != nil {
			continue
		}
		s.historyMu.Lock()
		s.historyRaw = append(s.historyRaw, raw)
		s.historyMu.Unlock()
		s.hub.Broadcast(raw)
		s.log.Infof("binance backfill symbol=%s interval=%s candles=%d", symbol, interval, len(candles))

		if interval == "1m" {
			s.cvd.broadcastInit()
		}
	}
}

// backfillIntervalWithCache returns candles for one symbol+interval, using
// the file cache to minimize Binance API calls.
//  1. Load cached candles from disk (or derive from 1m for higher TFs)
//  2. Determine what's missing (newest cached → now)
//  3. Fetch only the missing range from Binance
//  4. Merge, deduplicate by openTime, sort, save to cache
func (s *Server) backfillIntervalWithCache(ctx context.Context, symbol, interval, source string) []marketdata.Candle {
	// For non-1m intervals: try to derive from 1m data first
	if interval != "1m" {
		candles := s.deriveFromOneMin(ctx, symbol, interval)
		if candles != nil {
			return candles
		}
		// Derivation failed (1m cache insufficient) — fall through to direct fetch
	}

	// Below this point: 1m interval or derivation failed — do direct cache+fetch
	intervalMs := intervalMs(interval)
	now := time.Now().UnixMilli()

	// Calculate how many candles we need
	needed := s.cfg.BackfillBars
	if needed <= 0 {
		needed = 1000
	}
	if interval == "1m" {
		days := s.cfg.BackfillDays
		if days <= 0 {
			days = 30
		}
		needed = days * 24 * 60
	}

	// Load cached candles first
	cached, newestCached := s.klineCache.Load(symbol, interval)
	oldestNeeded := now - int64(needed)*intervalMs

	// If cache covers everything we need, return cached data
	if newestCached > 0 && len(cached) > 0 && cached[0].OpenTime <= oldestNeeded {
		if newestCached >= now-int64(2)*intervalMs {
			s.log.Infof("kline cache hit symbol=%s interval=%s cached=%d range=%d→%d",
				symbol, interval, len(cached), cached[0].OpenTime, newestCached)
			return cached
		}
		// Cache has old data but missing recent candles — fetch incremental
		fresh, err := binance.FetchKlines(ctx, s.cfg.BinanceRESTURL, symbol, interval, needed)
		if err != nil {
			s.log.Infof("backfill inc fetch failed, using cached: %v", err)
			return cached
		}
		merged := mergeCandleLists(cached, fresh)
		merged = s.trimKlinesByAge(symbol, interval, merged)
		s.klineCache.Save(symbol, interval, merged)
		s.log.Infof("kline cache incremental symbol=%s interval=%s cached=%d fresh=%d merged=%d",
			symbol, interval, len(cached), len(fresh), len(merged))
		return merged
	}

	// Cache miss or insufficient — fetch full from Binance
	s.log.Infof("kline cache miss symbol=%s interval=%s fetching %d candles",
		symbol, interval, needed)

	fresh, err := binance.FetchKlines(ctx, s.cfg.BinanceRESTURL, symbol, interval, needed)
	if err != nil {
		s.log.Errorf("binance backfill failed symbol=%s interval=%s err=%v", symbol, interval, err)
		if len(cached) > 0 {
			return cached
		}
		return nil
	}
	if len(fresh) == 0 {
		return cached
	}

	merged := mergeCandleLists(cached, fresh)
	merged = s.trimKlinesByAge(symbol, interval, merged)
	s.klineCache.Save(symbol, interval, merged)
	s.log.Infof("kline cache saved symbol=%s interval=%s candles=%d", symbol, interval, len(merged))
	return merged
}

// deriveFromOneMin tries to build `targetInterval` candles by aggregating
// from the 1m cache. Returns nil if 1m cache doesn't cover enough range.
func (s *Server) deriveFromOneMin(ctx context.Context, symbol, targetInterval string) []marketdata.Candle {
	// First, make sure 1m is loaded/available
	oneMin := s.backfillIntervalWithCache(ctx, symbol, "1m", "binance")
	if len(oneMin) < 2 {
		return nil
	}

	targetMs := intervalMs(targetInterval)
	daysNeeded := (s.cfg.BackfillBars * int(targetMs/60000)) / 1440
	if daysNeeded < 1 {
		daysNeeded = 1
	}
	if daysNeeded > s.cfg.BackfillDays {
		daysNeeded = s.cfg.BackfillDays
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
	candles = s.trimKlinesByAge(symbol, targetInterval, candles)
	s.klineCache.Save(symbol, targetInterval, candles)
	s.log.Infof("derived %s %s from 1m: %d candles (1m source: %d candles, range %d→%d)",
		symbol, targetInterval, len(candles), len(oneMin), oneMinOldest, oneMinNewest)
	return candles
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

// trimKlinesByAge removes candles older than KlineRetainDays from the slice.
// The input should be sorted by OpenTime ascending.
func (s *Server) trimKlinesByAge(symbol, interval string, candles []marketdata.Candle) []marketdata.Candle {
	retainDays := s.cfg.KlineRetainDays
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
	s.log.Infof("kline retain: trimmed %d old candles for %s/%s (retainDays=%d, kept=%d)",
		cutIdx, symbol, interval, retainDays, len(trimmed))
	return trimmed
}

// intervalMs converts a kline interval label (1m, 1h, 1d…) to milliseconds.
func intervalMs(iv string) int64 {
	if iv == "" {
		return 60_000
	}
	unit := iv[len(iv)-1]
	numStr := iv[:len(iv)-1]
	n, err := strconv.Atoi(numStr)
	if err != nil || n <= 0 {
		n = 1
	}
	switch unit {
	case 'm':
		return int64(n) * 60_000
	case 'h':
		return int64(n) * 3_600_000
	case 'd':
		return int64(n) * 86_400_000
	case 'w':
		return int64(n) * 604_800_000
	default:
		return int64(n) * 60_000
	}
}

// runBackfill fetches historical klines for ALL configured intervals once and
// caches/broadcasts each as a candle_history envelope, so the chart can render
// real history at any timeframe (the Go engine is the single source of truth).
func (s *Server) runBackfill(ctx context.Context, symbol string) {
	intervals := s.cfg.BackfillIntervals
	if len(intervals) == 0 {
		iv := s.cfg.BackfillInterval
		if iv == "" {
			iv = "1m"
		}
		intervals = []string{iv}
	}
	bars := s.cfg.BackfillBars
	if bars <= 0 {
		bars = 1000
	}

	for _, interval := range intervals {
		if ctx.Err() != nil {
			return
		}
		end := time.Now().UnixMilli()
		start := end - int64(bars)*intervalMs(interval)

		candles, err := hyperliquid.FetchCandles(ctx, s.cfg.HyperliquidHTTPURL, symbol, interval, start, end)
		if err != nil {
			s.engine.RecordError("backfill: " + err.Error())
			s.log.Errorf("hyperliquid backfill failed symbol=%s interval=%s err=%v", symbol, interval, err)
			continue
		}
		if len(candles) == 0 {
			s.log.Infof("hyperliquid backfill empty symbol=%s interval=%s", symbol, interval)
			continue
		}

		envelope := s.engine.CandleHistory(symbol, interval, candles)
		raw, err := envelope.MarshalJSONBytes()
		if err != nil {
			s.log.Errorf("marshal candle history envelope failed symbol=%s interval=%s err=%v", symbol, interval, err)
			continue
		}

		s.historyMu.Lock()
		s.historyRaw = append(s.historyRaw, raw)
		s.historyMu.Unlock()

		s.hub.Broadcast(raw)
		s.log.Infof("hyperliquid backfill symbol=%s interval=%s candles=%d", symbol, interval, len(candles))

		// Dès que les bougies 1m sont disponibles, on peut calculer et broadcast
		// le CVD historique (estimation OHLCV pour les périodes sans trades réels).
		if interval == "1m" {
			s.cvd.broadcastInit()
		}
	}
}

func (s *Server) throttledBookHandler(ctx context.Context, symbol string) func(marketdata.OrderBookSnapshot) {
	emitMs := s.cfg.BookEmitMs
	if emitMs < 0 {
		emitMs = 250
	}
	interval := time.Duration(emitMs) * time.Millisecond
	if interval <= 0 {
		interval = time.Millisecond
	}
	heatmapEmitMs := s.cfg.HeatmapEmitMs
	if heatmapEmitMs < 0 {
		heatmapEmitMs = 500
	}
	heatmapInterval := time.Duration(heatmapEmitMs) * time.Millisecond
	if heatmapInterval <= 0 {
		heatmapInterval = time.Millisecond
	}

	var mu sync.Mutex
	var latest marketdata.OrderBookSnapshot
	var hasBookPending bool
	var hasHeatmapPending bool

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if !s.cfg.BookEnabled {
					continue
				}
				mu.Lock()
				if !hasBookPending {
					mu.Unlock()
					continue
				}
				snapshot := latest
				hasBookPending = false
				mu.Unlock()

				envelope := s.engine.OrderBook(snapshot)
				s.engine.RecordOrderBookOut(snapshot, envelope.TsLocal)
				if raw, err := envelope.MarshalJSONBytes(); err == nil {
					s.hub.Broadcast(raw)
				} else {
					s.log.Errorf("marshal order book envelope failed symbol=%s err=%v", symbol, err)
				}
			}
		}
	}()

	go func() {
		ticker := time.NewTicker(heatmapInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if !s.cfg.HeatmapEnabled {
					continue
				}
				mu.Lock()
				if !hasHeatmapPending {
					mu.Unlock()
					continue
				}
				snapshot := latest
				hasHeatmapPending = false
				mu.Unlock()

				envelope := s.engine.HeatmapFrame(snapshot)
				frame, ok := envelope.Payload.(marketdata.HeatmapFrame)
				if !ok {
					s.log.Errorf("unexpected heatmap payload type symbol=%s", symbol)
					continue
				}
				s.engine.RecordHeatmapFrameOut(frame, envelope.TsLocal)
				if raw, err := envelope.MarshalJSONBytes(); err == nil {
					s.hub.Broadcast(raw)
				} else {
					s.log.Errorf("marshal heatmap frame envelope failed symbol=%s err=%v", symbol, err)
				}
			}
		}
	}()

	return func(snapshot marketdata.OrderBookSnapshot) {
		mu.Lock()
		latest = snapshot
		hasBookPending = true
		hasHeatmapPending = true
		mu.Unlock()
	}
}

type replayCommand struct {
	Action string  `json:"action"` // start | pause | resume | step | speed | stop | status
	Symbol string  `json:"symbol"`
	Date   string  `json:"date"`
	Speed  float64 `json:"speed"`
	Count  int     `json:"count"`
}

// handleReplay controls the backtest player. The browser POSTs JSON commands;
// progress is pushed back over the WS stream as replay_status envelopes.
func (s *Server) handleReplay(w http.ResponseWriter, r *http.Request) {
	// CORS + OPTIONS preflight are handled by the global middleware in Handler().
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var cmd replayCommand
	if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	switch cmd.Action {
	case "start":
		symbol := strings.ToUpper(strings.TrimSpace(cmd.Symbol))
		if symbol == "" {
			symbol = "BTCUSDT"
		}
		if strings.TrimSpace(cmd.Date) == "" {
			http.Error(w, "date required (YYYY-MM-DD)", http.StatusBadRequest)
			return
		}
		// speed<=0 means "as fast as possible" (UI "Max"); pass through as-is.
		s.player.Start(symbol, cmd.Date, cmd.Speed)
	case "pause":
		s.player.Pause()
	case "resume":
		s.player.Resume()
	case "step":
		s.player.Step(cmd.Count)
	case "speed":
		s.player.SetSpeed(cmd.Speed)
	case "stop":
		s.player.Stop()
	case "status":
		// fallthrough to response below
	default:
		http.Error(w, "unknown action", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, s.player.Status())
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.engine.Health())
}

func (s *Server) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.engine.Metrics())
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	if !isWebSocketRequest(r) {
		http.Error(w, "websocket upgrade required", http.StatusUpgradeRequired)
		return
	}

	key := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	if key == "" {
		http.Error(w, "missing Sec-WebSocket-Key", http.StatusBadRequest)
		return
	}

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijacking not supported", http.StatusInternalServerError)
		return
	}

	conn, rw, err := hijacker.Hijack()
	if err != nil {
		s.log.Errorf("websocket hijack failed: %v", err)
		return
	}

	if err := writeUpgradeResponse(rw, key); err != nil {
		_ = conn.Close()
		s.log.Errorf("websocket upgrade write failed: %v", err)
		return
	}

	client := newWSClient(conn)
	s.hub.Register(client)
	s.engine.SetStreamClients(s.hub.Count())
	s.log.Infof("stream client connected remote=%s clients=%d", conn.RemoteAddr(), s.hub.Count())
	go s.readUntilClose(client)
	go client.writeLoop()

	if raw, err := s.engine.Heartbeat().MarshalJSONBytes(); err == nil {
		_ = client.Send(raw)
	}

	// Send cvd_init on connect if historical trades are already available
	// (backfill completed before this client joined). If trades are empty,
	// the backfillTrades goroutine will broadcast cvd_init to everyone later.
	if s.trades.Len() > 0 {
		if raw, err := json.Marshal(CvdInitMessage{Type: "cvd_init", Payload: s.cvd.computeHistory("1m")}); err == nil {
			_ = client.Send(raw)
		}
	}

	// Replay cached historical candles to the newly-connected client.
	s.historyMu.RLock()
	history := make([][]byte, len(s.historyRaw))
	copy(history, s.historyRaw)
	s.historyMu.RUnlock()
	for _, raw := range history {
		_ = client.Send(raw)
	}
}

func (s *Server) mockLoop(ctx context.Context) {
	s.engine.SetConnected(true)
	defer s.engine.SetConnected(false)

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if s.hub.Count() == 0 {
				continue
			}
			if raw, err := s.engine.Heartbeat().MarshalJSONBytes(); err == nil {
				s.hub.Broadcast(raw)
			}
			if raw, err := s.engine.MockTrade().MarshalJSONBytes(); err == nil {
				s.hub.Broadcast(raw)
			}
		}
	}
}

func (s *Server) readUntilClose(client *wsClient) {
	defer func() {
		s.hub.Unregister(client)
		s.engine.SetStreamClients(s.hub.Count())
		s.log.Infof("stream client disconnected clients=%d", s.hub.Count())
	}()

	reader := bufio.NewReader(client.conn)
	for {
		head, err := reader.Peek(2)
		if err != nil {
			return
		}
		_, _ = reader.Discard(2)

		opcode := head[0] & 0x0F
		isMasked := (head[1] & 0x80) != 0
		length := int64(head[1] & 0x7F)

		if length == 126 {
			lenBytes, err := reader.Peek(2)
			if err != nil {
				return
			}
			_, _ = reader.Discard(2)
			length = int64(lenBytes[0])<<8 | int64(lenBytes[1])
		} else if length == 127 {
			lenBytes, err := reader.Peek(8)
			if err != nil {
				return
			}
			_, _ = reader.Discard(8)
			length = 0
			for i := 0; i < 8; i++ {
				length = (length << 8) | int64(lenBytes[i])
			}
		}

		var maskKey [4]byte
		if isMasked {
			maskBytes, err := reader.Peek(4)
			if err != nil {
				return
			}
			_, _ = reader.Discard(4)
			copy(maskKey[:], maskBytes)
		}

		payload := make([]byte, length)
		readBytes := int64(0)
		for readBytes < length {
			n, err := reader.Read(payload[readBytes:])
			if err != nil {
				return
			}
			readBytes += int64(n)
		}

		if isMasked {
			for i := int64(0); i < length; i++ {
				payload[i] ^= maskKey[i%4]
			}
		}

		switch opcode {
		case 0x8: // Close
			return
		case 0x1, 0x2: // Text or Binary
			s.handleClientMessage(client, payload)
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func isWebSocketRequest(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") &&
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}

func websocketAccept(key string) string {
	sum := sha1.Sum([]byte(key + websocketGUID))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func writeUpgradeResponse(rw *bufio.ReadWriter, key string) error {
	_, err := fmt.Fprintf(rw,
		"HTTP/1.1 101 Switching Protocols\r\n"+
			"Upgrade: websocket\r\n"+
			"Connection: Upgrade\r\n"+
			"Sec-WebSocket-Accept: %s\r\n\r\n",
		websocketAccept(key),
	)
	if err != nil {
		return err
	}
	return rw.Flush()
}

type wsClient struct {
	conn net.Conn
	send chan []byte
	done chan struct{}
	once sync.Once
}

func newWSClient(conn net.Conn) *wsClient {
	return &wsClient{
		conn: conn,
		send: make(chan []byte, streamSendBuffer),
		done: make(chan struct{}),
	}
}

func (c *wsClient) Send(message []byte) bool {
	select {
	case c.send <- message:
		return true
	case <-c.done:
		return false
	default:
		return false
	}
}

func (c *wsClient) Close() {
	c.once.Do(func() {
		close(c.done)
		_ = c.conn.Close()
	})
}

func (c *wsClient) writeLoop() {
	for {
		select {
		case <-c.done:
			return
		case message := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err := c.conn.Write(encodeTextFrame(message)); err != nil {
				c.Close()
				return
			}
		}
	}
}

func encodeTextFrame(payload []byte) []byte {
	header := []byte{0x81}
	length := len(payload)
	switch {
	case length < 126:
		header = append(header, byte(length))
	case length <= 65535:
		header = append(header, 126, byte(length>>8), byte(length))
	default:
		header = append(header, 127,
			byte(length>>56), byte(length>>48), byte(length>>40), byte(length>>32),
			byte(length>>24), byte(length>>16), byte(length>>8), byte(length),
		)
	}
	return append(header, payload...)
}

type clientMsg struct {
	Type      string `json:"type"`
	Timeframe string `json:"timeframe"`
	Source    string `json:"source"`
	Symbol    string `json:"symbol"`
	FromTs    int64  `json:"fromTs"`
	ToTs      int64  `json:"toTs"`
	// footprint_config: UI-seeded orderflow-signal thresholds.
	ImbalanceRatio     float64 `json:"imbalanceRatio"`
	ImbalanceStack     int     `json:"imbalanceStack"`
	ImbalanceMinVolume float64 `json:"imbalanceMinVolume"`
	ExhaustionFactor   float64 `json:"exhaustionFactor"`
}

func (s *Server) handleClientMessage(client *wsClient, payload []byte) {
	var msg clientMsg
	if err := json.Unmarshal(payload, &msg); err != nil {
		s.log.Errorf("failed to decode client WS message: %v", err)
		return
	}

	if msg.Type == "cvd_history_request" {
		tf := msg.Timeframe
		if tf == "" {
			tf = "1m"
		}
		s.log.Infof("client requested CVD history for timeframe: %s", tf)
		history := s.cvd.computeHistory(tf)
		respMsg := CvdInitMessage{
			Type:    "cvd_init",
			Payload: history,
		}
		raw, err := json.Marshal(respMsg)
		if err != nil {
			s.log.Errorf("failed to marshal cvd_init: %v", err)
			return
		}
		_ = client.Send(raw)
	} else if msg.Type == "source_switch" && s.rootCtx != nil {
		src := strings.ToLower(strings.TrimSpace(msg.Source))
		if src == config.ExchangeHyperliquid || src == config.ExchangeBinance {
			go s.switchExchange(s.rootCtx, src)
		} else {
			s.log.Infof("unknown source in source_switch: %s", src)
		}
	} else if msg.Type == "footprint_config" {
		// UI-seeded orderflow-signal thresholds; zero fields fall back to defaults.
		s.engine.SetFootprintSignalConfig(calc.FootprintSignalConfig{
			ImbalanceRatio:     msg.ImbalanceRatio,
			ImbalanceStack:     msg.ImbalanceStack,
			ImbalanceMinVolume: msg.ImbalanceMinVolume,
			ExhaustionFactor:   msg.ExhaustionFactor,
		})
	} else if msg.Type == "rebuild_footprint" && s.sqlDB != nil {
		symbol := strings.ToUpper(strings.TrimSpace(msg.Symbol))
		if symbol == "" {
			symbol = "BTCUSDT"
		}
		fromTs := msg.FromTs
		toTs := msg.ToTs
		if fromTs <= 0 || toTs <= 0 || toTs <= fromTs {
			_ = client.Send(s.rebuildReply("error", "fromTs and toTs required, toTs > fromTs"))
			return
		}
		go func() {
			_ = client.Send(s.rebuildReply("rebuild_started", "rebuilding footprint 1m"))
			count, err := s.RebuildFootprint1m(symbol, fromTs, toTs)
			if err != nil {
				_ = client.Send(s.rebuildReply("rebuild_error", err.Error()))
				return
			}
			_ = client.Send(s.rebuildReply("rebuild_complete", fmt.Sprintf("%d footprints created", count)))
		}()
	} else if msg.Type == "aggregate_tf" && s.sqlDB != nil {
		symbol := strings.ToUpper(strings.TrimSpace(msg.Symbol))
		if symbol == "" {
			symbol = "BTCUSDT"
		}
		tf := strings.TrimSpace(msg.Timeframe)
		if tf == "" {
			_ = client.Send(s.rebuildReply("error", "timeframe required (e.g. 5m, 15m, 1h)"))
			return
		}
		fromTs := msg.FromTs
		toTs := msg.ToTs
		if fromTs <= 0 || toTs <= 0 {
			// Default: aggregate all 1m footprints we have
			fromTs = 0
			toTs = storage.NowMs()
		}
		targetMs := intervalMs(tf)
		go func() {
			_ = client.Send(s.rebuildReply("aggregate_started", fmt.Sprintf("aggregating %s footprints", tf)))
			count, err := s.AggregateFootprintTF(symbol, tf, targetMs, fromTs, toTs)
			if err != nil {
				_ = client.Send(s.rebuildReply("aggregate_error", err.Error()))
				return
			}
			_ = client.Send(s.rebuildReply("aggregate_complete", fmt.Sprintf("%d %s candles created", count, tf)))
		}()
	}
}

// RebuildFootprint1m regenerates 1m footprints from stored trades. Public API
// retained for handleClientMessage and external callers; delegates to footprintStore.
func (s *Server) RebuildFootprint1m(symbol string, fromTs, toTs int64) (int, error) {
	return s.footprints.Rebuild1m(symbol, fromTs, toTs)
}

// AggregateFootprintTF aggregates 1m footprints into a higher timeframe.
func (s *Server) AggregateFootprintTF(symbol, timeframe string, targetMs int64, fromTs, toTs int64) (int, error) {
	return s.footprints.AggregateTF(symbol, timeframe, targetMs, fromTs, toTs)
}

// persistFootprintCandle writes a closed footprint candle to SQLite (delegates
// to footprintStore). Retained as a method for the live/replay persist path.
func (s *Server) persistFootprintCandle(candle marketdata.FootprintCandle) {
	s.footprints.Persist(candle)
}

// rebuildReply builds a JSON reply for footprint rebuild/aggregate commands.
func (s *Server) rebuildReply(event, message string) []byte {
	raw, _ := json.Marshal(map[string]string{
		"type":    event,
		"payload": message,
	})
	return raw
}
