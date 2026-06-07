package ws

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/engine"
	"cockpit-v6-market-go/internal/exchange/binance"
	"cockpit-v6-market-go/internal/exchange/hyperliquid"
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
)

// exchangeManager owns the live exchange lifecycle: starting the Hyperliquid or
// Binance adapter for the current cfg.Exchange, throttled order-book/heatmap
// emission, and switching exchanges at runtime. It drives the shared data sinks
// (tradeStore, klineBackfiller, engine, hub) and clears the stream history cache
// on switch via resetHistory. cfg is shared by pointer so Exchange/Symbols
// mutations on switch propagate to every component reading it.
type exchangeManager struct {
	cfg    *config.Config
	engine *engine.Engine
	hub    broadcaster
	log    *logx.Logger

	trades *tradeStore
	klines *klineBackfiller

	// emit is the shared trade pipeline (Server.replayEmit); the Binance adapter
	// pushes trades through it (the Hyperliquid handler is inlined below).
	emit func(marketdata.Trade)
	// resetHistory clears the stream's cached candle_history envelopes on switch.
	resetHistory func()

	mu     sync.Mutex
	cancel context.CancelFunc
}

func newExchangeManager(
	cfg *config.Config,
	eng *engine.Engine,
	hub broadcaster,
	log *logx.Logger,
	trades *tradeStore,
	klines *klineBackfiller,
	emit func(marketdata.Trade),
	resetHistory func(),
) *exchangeManager {
	return &exchangeManager{
		cfg:          cfg,
		engine:       eng,
		hub:          hub,
		log:          log,
		trades:       trades,
		klines:       klines,
		emit:         emit,
		resetHistory: resetHistory,
	}
}

// Start launches the adapter for the current cfg.Exchange and runs backfills. It
// uses a new derived context stored in cancel so a subsequent Switch can cancel
// it cleanly.
func (m *exchangeManager) Start(parent context.Context) {
	m.mu.Lock()
	if m.cancel != nil {
		m.cancel()
	}
	ctx, cancel := context.WithCancel(parent)
	m.cancel = cancel
	m.mu.Unlock()

	// Load persisted trades from cache to restore CVD history
	m.trades.LoadPersisted()

	// Purge old trade cache files (async, fire and forget)
	go m.trades.Purge()

	switch m.cfg.Exchange {
	case config.ExchangeHyperliquid:
		go m.trades.Backfill(ctx)
		m.startHyperliquid(ctx)
	case config.ExchangeBinance:
		go m.trades.Backfill(ctx)
		m.startBinance(ctx)
	default:
		m.log.Errorf("unknown exchange: %s", m.cfg.Exchange)
	}
}

// Switch stops the current exchange, clears all cached state, and starts the new
// one. Called when a WS client sends "source_switch".
func (m *exchangeManager) Switch(parent context.Context, exchangeName string) {
	m.log.Infof("switching exchange: %s -> %s", m.cfg.Exchange, exchangeName)

	// Cancel current exchange goroutines
	m.mu.Lock()
	if m.cancel != nil {
		m.cancel()
		m.cancel = nil
	}
	m.mu.Unlock()

	// Clear all server state
	m.trades.Reset()
	m.resetHistory()

	// Update config
	m.cfg.Exchange = exchangeName
	if exchangeName == config.ExchangeHyperliquid {
		m.cfg.Symbols = []string{"BTC"}
	} else {
		m.cfg.Symbols = []string{"BTCUSDT"}
	}

	// Reset engine calculators
	m.engine.Reset()

	// Broadcast reset to all connected clients so they clear their local state
	if raw, err := json.Marshal(map[string]string{"type": "source_switched", "source": exchangeName}); err == nil {
		m.hub.Broadcast(raw)
	}

	// Start the new exchange
	m.Start(parent)

	m.log.Infof("exchange switch complete: %s", exchangeName)
}

func (m *exchangeManager) startHyperliquid(ctx context.Context) {
	symbols := m.cfg.Symbols
	if len(symbols) == 0 {
		symbols = []string{"BTC"}
	}
	for _, symbol := range symbols {
		symbol := symbol
		if m.cfg.BackfillEnabled {
			go m.klines.RunHyperliquid(ctx, symbol)
		}
		client := hyperliquid.NewWithEvents(m.cfg.HyperliquidWSURL, m.log, hyperliquid.Events{
			OnConnected: func() {
				m.engine.SetConnected(true)
				m.log.Infof("hyperliquid connected symbol=%s", symbol)
			},
			OnSubscribed: func(subscribedSymbol string) {
				m.log.Infof("hyperliquid subscribed trades symbol=%s", subscribedSymbol)
			},
			OnMessage: func() {
				m.engine.RecordMessageIn()
			},
			OnTrade: func(tradeSymbol string) {
				count := m.engine.Metrics().TotalTradesOut + 1
				if count == 1 || count%100 == 0 {
					m.log.Infof("hyperliquid trade received symbol=%s totalTradesOut=%d", tradeSymbol, count)
				}
			},
			OnBook: func(bookSymbol string) {
				count := m.engine.Metrics().TotalOrderBookOut + 1
				if count == 1 || count%100 == 0 {
					m.log.Infof("hyperliquid l2Book received symbol=%s totalOrderBookOut=%d", bookSymbol, count)
				}
			},
			OnDisconnected: func(err error) {
				m.engine.SetConnected(false)
				if err != nil {
					m.engine.RecordError(err.Error())
				}
				m.log.Errorf("hyperliquid disconnected symbol=%s err=%v", symbol, err)
			},
			OnReconnect: func(attempt int, delay time.Duration, err error) {
				count := m.engine.RecordReconnect()
				m.log.Errorf("hyperliquid reconnect scheduled symbol=%s attempt=%d reconnectCount=%d delay=%s err=%v", symbol, attempt, count, delay, err)
			},
			OnError: func(err error) {
				if err != nil {
					m.engine.RecordError(err.Error())
				}
			},
		})
		go func() {
			var bookHandler func(marketdata.OrderBookSnapshot)
			if m.cfg.BookEnabled || m.cfg.HeatmapEnabled {
				bookHandler = m.throttledBookHandler(ctx, symbol)
			}
			err := client.ConnectMarket(ctx, symbol, func(trade marketdata.Trade) {
				m.trades.Record(trade)
				if raw, err := m.engine.Trade(trade).MarshalJSONBytes(); err == nil {
					m.hub.Broadcast(raw)
				} else {
					m.log.Errorf("marshal trade envelope failed symbol=%s err=%v", symbol, err)
				}
				for _, envelope := range m.engine.DeltaBuckets(trade) {
					if raw, err := envelope.MarshalJSONBytes(); err == nil {
						m.hub.Broadcast(raw)
					} else {
						m.log.Errorf("marshal delta bucket envelope failed symbol=%s err=%v", symbol, err)
					}
				}
				if envelope, ok := m.engine.VWAP(trade); ok {
					if raw, err := envelope.MarshalJSONBytes(); err == nil {
						m.hub.Broadcast(raw)
					} else {
						m.log.Errorf("marshal vwap envelope failed symbol=%s err=%v", symbol, err)
					}
				}
				for _, envelope := range m.engine.FootprintCandles(trade) {
					if raw, err := envelope.MarshalJSONBytes(); err == nil {
						m.hub.Broadcast(raw)
					} else {
						m.log.Errorf("marshal footprint candle envelope failed symbol=%s err=%v", symbol, err)
					}
				}
			}, bookHandler, m.cfg.BookDepth)
			if err != nil && ctx.Err() == nil {
				m.log.Errorf("hyperliquid adapter stopped symbol=%s err=%v", symbol, err)
			}
		}()
	}
}

// startBinance connects the Binance adapter (live aggTrade + depth) and pushes
// trades through the SAME engine pipeline as Hyperliquid, plus a REST backfill.
func (m *exchangeManager) startBinance(ctx context.Context) {
	symbols := m.cfg.Symbols
	if len(symbols) == 0 {
		symbols = []string{"BTCUSDT"}
	}
	for _, symbol := range symbols {
		symbol := symbol
		if m.cfg.BackfillEnabled {
			go m.klines.RunBinance(ctx, symbol)
		}
		client := binance.NewClient(binance.ClientConfig{
			Market:        binance.ParseMarket(m.cfg.BinanceMarket),
			WSURL:         m.cfg.BinanceWSURL,
			RESTURL:       m.cfg.BinanceRESTURL,
			SnapshotLimit: m.cfg.BinanceSnapshotLimit,
		}, m.log, binance.Events{
			OnConnected:  func() { m.engine.SetConnected(true); m.log.Infof("binance connected symbol=%s", symbol) },
			OnSubscribed: func(sym string) { m.log.Infof("binance subscribed symbol=%s", sym) },
			OnMessage:    func() { m.engine.RecordMessageIn() },
			OnTrade: func(sym string) {
				count := m.engine.Metrics().TotalTradesOut + 1
				if count == 1 || count%100 == 0 {
					m.log.Infof("binance trade received symbol=%s totalTradesOut=%d", sym, count)
				}
			},
			OnBook: func(sym string) {
				count := m.engine.Metrics().TotalOrderBookOut + 1
				if count == 1 || count%100 == 0 {
					m.log.Infof("binance depth received symbol=%s totalOrderBookOut=%d", sym, count)
				}
			},
			OnDisconnected: func(err error) {
				m.engine.SetConnected(false)
				if err != nil {
					m.engine.RecordError(err.Error())
				}
				m.log.Errorf("binance disconnected symbol=%s err=%v", symbol, err)
			},
			OnReconnect: func(attempt int, delay time.Duration, err error) {
				count := m.engine.RecordReconnect()
				m.log.Errorf("binance reconnect symbol=%s attempt=%d reconnectCount=%d delay=%s err=%v", symbol, attempt, count, delay, err)
			},
			OnError: func(err error) {
				if err != nil {
					m.engine.RecordError(err.Error())
				}
			},
		})
		go func() {
			var bookHandler func(marketdata.OrderBookSnapshot)
			if m.cfg.BookEnabled || m.cfg.HeatmapEnabled {
				bookHandler = m.throttledBookHandler(ctx, symbol)
			}
			err := client.ConnectMarket(ctx, symbol, m.emit, bookHandler, m.cfg.BookDepth)
			if err != nil && ctx.Err() == nil {
				m.log.Errorf("binance adapter stopped symbol=%s err=%v", symbol, err)
			}
		}()
	}
}

func (m *exchangeManager) throttledBookHandler(ctx context.Context, symbol string) func(marketdata.OrderBookSnapshot) {
	emitMs := m.cfg.BookEmitMs
	if emitMs < 0 {
		emitMs = 250
	}
	interval := time.Duration(emitMs) * time.Millisecond
	if interval <= 0 {
		interval = time.Millisecond
	}
	heatmapEmitMs := m.cfg.HeatmapEmitMs
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
				if !m.cfg.BookEnabled {
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

				envelope := m.engine.OrderBook(snapshot)
				m.engine.RecordOrderBookOut(snapshot, envelope.TsLocal)
				if raw, err := envelope.MarshalJSONBytes(); err == nil {
					m.hub.Broadcast(raw)
				} else {
					m.log.Errorf("marshal order book envelope failed symbol=%s err=%v", symbol, err)
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
				if !m.cfg.HeatmapEnabled {
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

				envelope := m.engine.HeatmapFrame(snapshot)
				frame, ok := envelope.Payload.(marketdata.HeatmapFrame)
				if !ok {
					m.log.Errorf("unexpected heatmap payload type symbol=%s", symbol)
					continue
				}
				m.engine.RecordHeatmapFrameOut(frame, envelope.TsLocal)
				if raw, err := envelope.MarshalJSONBytes(); err == nil {
					m.hub.Broadcast(raw)
				} else {
					m.log.Errorf("marshal heatmap frame envelope failed symbol=%s err=%v", symbol, err)
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
