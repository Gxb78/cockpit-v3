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
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
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

	replayer *replayController // backtest player + /replay control

	trades *tradeStore // live trade buffer + cache/SQLite persistence + backfill

	klines *klineBackfiller // historical kline backfill + file cache

	sqlDB *storage.DB // SQLite for trades + footprints

	cvd        *cvdTracker      // running CVD-per-symbol + cvd_init history/broadcast
	footprints *footprintStore  // footprint persist / rebuild / aggregate
	exchanges  *exchangeManager // live exchange lifecycle + switching

	rootCtx context.Context // parent context for exchange switching
}

func NewServer(cfg config.Config, marketEngine *engine.Engine, logger *logx.Logger) *Server {
	dataDir := cfg.DataDir
	if dataDir == "" {
		dataDir = "data"
	}
	s := &Server{
		cfg:    cfg,
		engine: marketEngine,
		hub:    NewHub(),
		log:    logger,
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
	s.trades = newTradeStore(&s.cfg, NewTradeCache(dataDir, cfg.TradeRetainDays), s.sqlDB, s.log, s.cvd.broadcastInit)
	s.footprints = newFootprintStore(s.sqlDB, s.cvd, s.engine, cfg, s.log)
	s.klines = newKlineBackfiller(cfg, NewKlineCache(dataDir), s.engine, s.log, s.publishHistory, s.cvd.broadcastInit)
	s.exchanges = newExchangeManager(&s.cfg, s.engine, s.hub, s.log, s.trades, s.klines, s.replayEmit, s.resetHistory)

	s.replayer = newReplayController(s.engine, s.hub, s.replayEmit)
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

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/metrics", s.handleMetrics)
	mux.HandleFunc("/stream", s.handleStream)
	mux.HandleFunc("/replay", s.replayer.handleReplay)
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
		s.exchanges.Start(ctx)
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

// publishHistory caches a candle_history envelope (replayed to new stream
// clients) and broadcasts it to current ones. Injected into klineBackfiller so
// it owns neither the history cache nor the hub.
func (s *Server) publishHistory(raw []byte) {
	s.historyMu.Lock()
	s.historyRaw = append(s.historyRaw, raw)
	s.historyMu.Unlock()
	s.hub.Broadcast(raw)
}

// resetHistory clears the cached candle_history envelopes. Injected into
// exchangeManager so the stream history is dropped on an exchange switch.
func (s *Server) resetHistory() {
	s.historyMu.Lock()
	s.historyRaw = nil
	s.historyMu.Unlock()
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
			go s.exchanges.Switch(s.rootCtx, src)
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
