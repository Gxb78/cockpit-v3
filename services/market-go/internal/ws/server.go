package ws

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/engine"
	"cockpit-v6-market-go/internal/exchange/binance"
	"cockpit-v6-market-go/internal/exchange/hyperliquid"
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
	"cockpit-v6-market-go/internal/replay"
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

	tradesMu sync.RWMutex
	trades   []marketdata.Trade

	// Exchange switching
	exchangeCancel context.CancelFunc
	exchangeMu     sync.Mutex
	rootCtx        context.Context // parent context for exchange switching
}

func NewServer(cfg config.Config, marketEngine *engine.Engine, logger *logx.Logger) *Server {
	s := &Server{
		cfg:    cfg,
		engine: marketEngine,
		hub:    NewHub(),
		log:    logger,
	}
	s.player = replay.NewPlayer(replay.NewBinanceSource(), s.replayEmit, s.replayStatus)
	return s
}

// replayEmit pushes a replayed trade through the SAME engine pipeline as live
// data, then broadcasts every derived envelope to all stream clients.
func (s *Server) replayEmit(trade marketdata.Trade) {
	s.recordTrade(trade)
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
	return mux
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
		return <-errCh
	case err := <-errCh:
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
				s.recordTrade(trade)
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

	switch s.cfg.Exchange {
	case config.ExchangeHyperliquid:
		go s.backfillTrades(ctx)
		s.startHyperliquid(ctx)
	case config.ExchangeBinance:
		go s.backfillTrades(ctx)
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
	s.tradesMu.Lock()
	s.trades = nil
	s.tradesMu.Unlock()

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

// tryBroadcastCvdInit computes and broadcasts a cvd_init envelope to all
// connected clients if there's enough data (trades + candle history).
// Called after trade backfill and after 1m candle backfill is stored.
func (s *Server) tryBroadcastCvdInit() {
	history := s.computeSizeCvdHistory("1m")
	total := 0
	for _, pts := range history.Series {
		total += len(pts)
	}
	if total == 0 && len(history.DeltaVol) == 0 {
		return // nothing to send yet
	}
	if raw, err := json.Marshal(CvdInitMessage{Type: "cvd_init", Payload: history}); err == nil {
		s.hub.Broadcast(raw)
		s.log.Infof("broadcast cvd_init: %d series points, %d delta points", total, len(history.DeltaVol))
	}
}

// runBinanceBackfill fetches REST klines for all configured intervals, caching
// and broadcasting one candle_history envelope per interval.
func (s *Server) runBinanceBackfill(ctx context.Context, symbol string) {
	intervals := s.cfg.BackfillIntervals
	if len(intervals) == 0 {
		intervals = []string{"1m"}
	}
	bars := s.cfg.BackfillBars
	if bars <= 0 {
		bars = 1000
	}
	for _, interval := range intervals {
		if ctx.Err() != nil {
			return
		}
		candles, err := binance.FetchKlines(ctx, s.cfg.BinanceRESTURL, symbol, interval, bars)
		if err != nil {
			s.engine.RecordError("binance backfill: " + err.Error())
			s.log.Errorf("binance backfill failed symbol=%s interval=%s err=%v", symbol, interval, err)
			continue
		}
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
			s.tryBroadcastCvdInit()
		}
	}
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
			s.tryBroadcastCvdInit()
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
	Action string  `json:"action"` // start | pause | resume | speed | stop | status
	Symbol string  `json:"symbol"`
	Date   string  `json:"date"`
	Speed  float64 `json:"speed"`
}

// handleReplay controls the backtest player. The browser POSTs JSON commands;
// progress is pushed back over the WS stream as replay_status envelopes.
func (s *Server) handleReplay(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
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
	s.tradesMu.RLock()
	hasTrades := len(s.trades) > 0
	s.tradesMu.RUnlock()
	if hasTrades {
		if raw, err := json.Marshal(CvdInitMessage{Type: "cvd_init", Payload: s.computeSizeCvdHistory("1m")}); err == nil {
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

func (s *Server) recordTrade(trade marketdata.Trade) {
	s.tradesMu.Lock()
	defer s.tradesMu.Unlock()
	s.trades = append(s.trades, trade)
	if len(s.trades) > 50000 {
		s.trades = s.trades[len(s.trades)-50000:]
	}
}

type clientMsg struct {
	Type      string `json:"type"`
	Timeframe string `json:"timeframe"`
	Source    string `json:"source"`
}

type CvdPoint struct {
	T int64   `json:"t"`
	V float64 `json:"v"`
}

type DeltaVolPoint struct {
	T     int64   `json:"t"`
	Delta float64 `json:"delta"`
}

type CvdHistoryPayload struct {
	Series   map[string][]CvdPoint `json:"series"`
	DeltaVol []DeltaVolPoint       `json:"deltaVol"`
	Cvd      map[string]float64    `json:"cvd"`
	// Metadata pour distinguer estimation vs trades réels
	Source         string `json:"cvdSource"`         // "ohlcv_estimate" | "real_trades" | "mixed"
	RealTradeCount int    `json:"realTradeCount"`     // nombre de trades réels utilisés
	EstimatedUntil int64  `json:"estimatedUntil"`     // timestamp ms jusqu'auquel c'est estimé (0 = tout réel)
}

type CvdInitMessage struct {
	Type    string            `json:"type"`
	Payload CvdHistoryPayload `json:"payload"`
}

func (s *Server) computeSizeCvdHistory(timeframe string) CvdHistoryPayload {
	intervalMs := intervalMs(timeframe)

	s.tradesMu.RLock()
	tradesCopy := make([]marketdata.Trade, len(s.trades))
	copy(tradesCopy, s.trades)
	s.tradesMu.RUnlock()

	// Bucket real trades by interval
	tradesByBucket := make(map[int64][]marketdata.Trade)
	for _, t := range tradesCopy {
		ts := t.TsExchange
		if ts <= 0 {
			ts = t.TsLocal
		}
		if ts <= 0 {
			continue
		}
		bucketStart := (ts / intervalMs) * intervalMs
		tradesByBucket[bucketStart] = append(tradesByBucket[bucketStart], t)
	}

	// Also try to read 1m candle history from the cache to estimate CVD
	// for periods with no real trades. Unmarshal the last cached envelope.
	type candlePayload struct {
		Symbol   string            `json:"symbol"`
		Interval string            `json:"interval"`
		Candles  []marketdata.Candle `json:"candles"`
	}
	type candleEnvelope struct {
		Type    string         `json:"type"`
		Payload candlePayload  `json:"payload"`
	}
	var historicalCandles []marketdata.Candle
	s.historyMu.RLock()
	for _, raw := range s.historyRaw {
		var env candleEnvelope
		if err := json.Unmarshal(raw, &env); err == nil && env.Type == "candle_history" && env.Payload.Interval == "1m" {
			historicalCandles = env.Payload.Candles
			break
		}
	}
	s.historyMu.RUnlock()

	// Build sorted timeline: union of trade buckets + candle timestamps
	timeline := make(map[int64]bool)
	for b := range tradesByBucket {
		timeline[b] = true
	}
	for _, c := range historicalCandles {
		bucketStart := (c.OpenTime / intervalMs) * intervalMs
		timeline[bucketStart] = true
	}

	var sortedBuckets []int64
	for b := range timeline {
		sortedBuckets = append(sortedBuckets, b)
	}
	sort.Slice(sortedBuckets, func(i, j int) bool {
		return sortedBuckets[i] < sortedBuckets[j]
	})

	var runningCvd float64
	var series []CvdPoint
	var deltaVol []DeltaVolPoint
	realBuckets := 0
	estimatedBuckets := 0
	var lastEstimatedTs int64

	for _, bStart := range sortedBuckets {
		bucketTrades := tradesByBucket[bStart]
		netDelta := 0.0

		if len(bucketTrades) > 0 {
			// Use real trade data (total delta, no size buckets)
			realBuckets++
			for _, t := range bucketTrades {
				signed := t.Qty
				if strings.ToLower(t.Side) == "sell" {
					signed = -t.Qty
				}
				netDelta += signed
			}
		} else if len(historicalCandles) > 0 {
			// Estimate from candle OHLCV data — marked as estimated
			estimatedBuckets++
			lastEstimatedTs = bStart + intervalMs
			for _, c := range historicalCandles {
				cbStart := (c.OpenTime / intervalMs) * intervalMs
				if cbStart == bStart {
					range_ := c.High - c.Low
					if range_ > 0 {
						ratio := (c.Close - c.Open) / range_
						if ratio > 0.5 {
							ratio = 0.5
						} else if ratio < -0.5 {
							ratio = -0.5
						}
						netDelta = c.Volume * ratio * 2
					}
					break
				}
			}
		} else {
			continue
		}

		runningCvd += netDelta
		series = append(series, CvdPoint{T: bStart, V: runningCvd})
		deltaVol = append(deltaVol, DeltaVolPoint{T: bStart, Delta: netDelta})
	}

	// Wrap series into a single "total" bucket for backward compat with frontend
	wSeries := map[string][]CvdPoint{"total": series}
	wCvd := map[string]float64{"total": runningCvd}

	// Compute metadata
	source := "real_trades"
	if estimatedBuckets > 0 && realBuckets > 0 {
		source = "mixed"
	} else if estimatedBuckets > 0 && realBuckets == 0 {
		source = "ohlcv_estimate"
	}

	return CvdHistoryPayload{
		Series:         wSeries,
		DeltaVol:       deltaVol,
		Cvd:            wCvd,
		Source:         source,
		RealTradeCount: len(tradesCopy),
		EstimatedUntil: lastEstimatedTs,
	}
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
		history := s.computeSizeCvdHistory(tf)
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

func (s *Server) fetchBinanceRecentTrades(ctx context.Context, symbol string) ([]marketdata.Trade, error) {
	url := fmt.Sprintf("%s/api/v3/aggTrades?symbol=%s&limit=1000", s.cfg.BinanceRESTURL, symbol)
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
	for _, t := range rawTrades {
		price, _ := strconv.ParseFloat(t.Price, 64)
		qty, _ := strconv.ParseFloat(t.Qty, 64)
		side := "buy"
		if t.IsBuyerMaker {
			side = "sell"
		}
		tradeID := fmt.Sprintf("%d", t.ID)
		out = append(out, marketdata.Trade{
			ID:         tradeID,
			TradeID:    tradeID,
			Exchange:   "binance",
			Symbol:     symbol,
			TsExchange: t.Time,
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

func (s *Server) fetchHyperliquidRecentTrades(ctx context.Context, symbol string) ([]marketdata.Trade, error) {
	coin := normalizeHlCoin(symbol)
	url := s.cfg.HyperliquidHTTPURL
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
	for _, t := range rawTrades {
		price, _ := strconv.ParseFloat(t.Px, 64)
		qty, _ := strconv.ParseFloat(t.Sz, 64)
		side := "buy"
		if strings.ToUpper(t.Side) == "A" || strings.ToUpper(t.Side) == "ASK" || strings.ToUpper(t.Side) == "SELL" {
			side = "sell"
		}
		tradeID := fmt.Sprintf("%d:%s:%d", t.Time, t.Coin, t.TID)
		out = append(out, marketdata.Trade{
			ID:         tradeID,
			TradeID:    tradeID,
			Exchange:   "hyperliquid",
			Symbol:     symbol,
			TsExchange: t.Time,
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

func (s *Server) backfillTrades(ctx context.Context) {
	symbols := s.cfg.Symbols
	if len(symbols) == 0 {
		if s.cfg.Exchange == config.ExchangeHyperliquid {
			symbols = []string{"BTC"}
		} else {
			symbols = []string{"BTCUSDT"}
		}
	}

	for _, symbol := range symbols {
		var fetched []marketdata.Trade
		var err error
		if s.cfg.Exchange == config.ExchangeBinance {
			fetched, err = s.fetchBinanceRecentTrades(ctx, symbol)
		} else if s.cfg.Exchange == config.ExchangeHyperliquid {
			fetched, err = s.fetchHyperliquidRecentTrades(ctx, symbol)
		}
		if err != nil {
			s.log.Errorf("failed to backfill trades for symbol=%s: %v", symbol, err)
			continue
		}
		s.log.Infof("backfilled %d historical trades for symbol=%s", len(fetched), symbol)
		s.tradesMu.Lock()
		s.trades = append(s.trades, fetched...)
		sort.Slice(s.trades, func(i, j int) bool {
			return s.trades[i].TsExchange < s.trades[j].TsExchange
		})
		if len(s.trades) > 50000 {
			s.trades = s.trades[len(s.trades)-50000:]
		}
		s.tradesMu.Unlock()
	}

	// Broadcast a fresh cvd_init after trade backfill, if enough data exists.
	// A second broadcast will fire when 1m candle backfill completes (which
	// provides OHLCV estimation for periods without real trades).
	s.tryBroadcastCvdInit()
}
