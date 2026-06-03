package binance

import (
	"bufio"
	"context"
	crand "crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/marketdata"
	"cockpit-v6-market-go/pkg/protocol"
)

// DefaultWSURL is Binance public combined-stream endpoint (no key required).
const DefaultWSURL = "wss://stream.binance.com:9443/stream"
const maxFrameBytes = 1 << 20
const websocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// Events mirrors the hyperliquid client's callback surface so the server can
// wire both adapters the same way.
type Events struct {
	OnConnected    func()
	OnSubscribed   func(symbol string)
	OnMessage      func()
	OnTrade        func(symbol string)
	OnBook         func(symbol string)
	OnDisconnected func(error)
	OnReconnect    func(attempt int, delay time.Duration, err error)
	OnError        func(error)
}

type TradeHandler func(marketdata.Trade)
type BookHandler func(marketdata.OrderBookSnapshot)

type Client struct {
	wsURL         string
	restURL       string
	market        Market
	snapshotLimit int
	log           *logx.Logger
	events        Events

	connMu sync.Mutex
	conn   net.Conn
}

// ClientConfig configures the venue (spot/futures), endpoints, and snapshot
// depth used to maintain a full local order book.
type ClientConfig struct {
	Market        Market
	WSURL         string
	RESTURL       string
	SnapshotLimit int
}

// NewClient builds a market client for the configured venue. Empty WS/REST URLs
// fall back to the venue defaults.
func NewClient(cfg ClientConfig, logger *logx.Logger, events Events) *Client {
	wsURL := strings.TrimSpace(cfg.WSURL)
	restURL := strings.TrimSpace(cfg.RESTURL)
	if cfg.Market == MarketFutures {
		if wsURL == "" {
			wsURL = DefaultFuturesWSURL
		}
		if restURL == "" {
			restURL = DefaultFuturesRESTURL
		}
	} else {
		if wsURL == "" {
			wsURL = DefaultSpotWSURL
		}
		if restURL == "" {
			restURL = DefaultSpotRESTURL
		}
	}
	return &Client{
		wsURL:         wsURL,
		restURL:       restURL,
		market:        cfg.Market,
		snapshotLimit: cfg.SnapshotLimit,
		log:           logger,
		events:        events,
	}
}

// NewWithEvents builds a spot client (backward-compatible constructor).
func NewWithEvents(wsURL string, logger *logx.Logger, events Events) *Client {
	return NewClient(ClientConfig{Market: MarketSpot, WSURL: wsURL}, logger, events)
}

func (c *Client) Name() string { return ExchangeName }

// ConnectMarket subscribes to aggTrade (+ optional partial depth) for symbol,
// reconnecting with backoff until ctx is cancelled.
func (c *Client) ConnectMarket(ctx context.Context, symbol string, tradeHandler TradeHandler, bookHandler BookHandler, bookDepth int) error {
	symbol = strings.ToLower(strings.TrimSpace(symbol))
	if symbol == "" {
		symbol = "btcusdt"
	}
	attempt := 0
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		err := c.connectOnce(ctx, symbol, tradeHandler, bookHandler, bookDepth)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		c.emitDisconnected(err)
		attempt++
		delay := reconnectDelay(attempt)
		c.emitReconnect(attempt, delay, err)
		if c.log != nil {
			c.log.Errorf("binance disconnected symbol=%s err=%v reconnectIn=%s", symbol, err, delay)
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func (c *Client) Close() error {
	c.connMu.Lock()
	defer c.connMu.Unlock()
	if c.conn == nil {
		return nil
	}
	err := c.conn.Close()
	c.conn = nil
	return err
}

func (c *Client) connectOnce(ctx context.Context, symbol string, tradeHandler TradeHandler, bookHandler BookHandler, bookDepth int) error {
	// Build the combined stream path. For the book we subscribe to the diff
	// depth stream (@depth@100ms) and maintain a full local order book from a
	// REST snapshot + validated diffs — NOT the partial @depthN stream (capped
	// at 20 levels), so walls far from the mid stay reliable.
	useBook := bookHandler != nil
	streams := []string{symbol + "@aggTrade"}
	if useBook {
		streams = append(streams, symbol+"@depth@100ms")
	}
	fullURL := c.wsURL + "?streams=" + strings.Join(streams, "/")

	conn, reader, err := c.dial(ctx, fullURL)
	if err != nil {
		return err
	}
	c.setConn(conn)
	defer func() {
		c.clearConn(conn)
		_ = conn.Close()
	}()

	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-done:
		}
	}()
	defer close(done)

	c.emitSubscribed(symbol)
	upSym := strings.ToUpper(symbol)

	// Order-book maintainer. The WS is already connected (buffering diffs); we
	// then fetch the REST snapshot and drain the buffer through Binance's
	// documented sequencing rules. A sequence gap requests a fresh snapshot.
	var maintainer *BookMaintainer
	var fetching atomic.Bool
	if useBook {
		startSync := func() {
			if !fetching.CompareAndSwap(false, true) {
				return // a snapshot fetch is already in flight
			}
			go func() {
				defer fetching.Store(false)
				for attempt := 0; ; attempt++ {
					if ctx.Err() != nil {
						return
					}
					snap, err := FetchDepthSnapshot(ctx, c.market, c.restURL, symbol, c.snapshotLimit)
					if err == nil {
						maintainer.ApplySnapshot(snap.LastUpdateID, snap.Bids, snap.Asks)
						if c.log != nil {
							c.log.Infof("binance book snapshot applied symbol=%s market=%s lastUpdateId=%d bids=%d asks=%d",
								upSym, c.market, snap.LastUpdateID, len(snap.Bids), len(snap.Asks))
						}
						return
					}
					c.emitError(err)
					select {
					case <-ctx.Done():
						return
					case <-time.After(snapshotRetryDelay(attempt)):
					}
				}
			}()
		}
		maintainer = NewBookMaintainer(c.market, upSym, BookCallbacks{
			OnBook: func(s marketdata.OrderBookSnapshot) {
				c.emitBook(upSym)
				bookHandler(s)
			},
			OnResync: startSync,
			OnError:  c.emitError,
		})
		startSync()
	}

	for {
		payload, err := readNextTextPayload(conn, reader)
		if err != nil {
			return err
		}
		c.emitMessage()
		stream, data, err := ParseCombined(payload)
		if err != nil || len(data) == 0 {
			continue
		}
		switch {
		case strings.HasSuffix(stream, "@aggTrade"):
			if tradeHandler == nil {
				continue
			}
			trade, err := NormalizeAggTrade(data, protocol.NowMillis())
			if err != nil {
				c.emitError(err)
				continue
			}
			c.emitTrade(upSym)
			tradeHandler(trade)
		case strings.Contains(stream, "@depth"):
			if maintainer == nil {
				continue
			}
			diff, err := ParseDepthDiff(data)
			if err != nil {
				c.emitError(err)
				continue
			}
			maintainer.HandleDiff(diff)
		}
	}
}

// snapshotRetryDelay backs off REST snapshot retries: 250ms, 500ms, 1s, 2s,
// capped at 5s.
func snapshotRetryDelay(attempt int) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	shift := attempt
	if shift > 4 {
		shift = 4
	}
	delay := 250 * time.Millisecond * time.Duration(1<<shift)
	if delay > 5*time.Second {
		return 5 * time.Second
	}
	return delay
}

// ---- WebSocket transport (stdlib only, mirrors the hyperliquid client) ----

func (c *Client) dial(ctx context.Context, wsURL string) (net.Conn, *bufio.Reader, error) {
	u, err := url.Parse(wsURL)
	if err != nil {
		return nil, nil, err
	}
	if u.Scheme != "wss" && u.Scheme != "ws" {
		return nil, nil, fmt.Errorf("unsupported websocket scheme: %s", u.Scheme)
	}
	addr := websocketAddr(u)
	var conn net.Conn
	if u.Scheme == "wss" {
		dialer := tls.Dialer{
			NetDialer: &net.Dialer{Timeout: 10 * time.Second},
			Config:    &tls.Config{ServerName: u.Hostname(), MinVersion: tls.VersionTLS12},
		}
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	} else {
		dialer := net.Dialer{Timeout: 10 * time.Second}
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return nil, nil, err
	}
	key, err := websocketKey()
	if err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	path := u.RequestURI()
	if path == "" {
		path = "/"
	}
	req := "GET " + path + " HTTP/1.1\r\n" +
		"Host: " + u.Host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"User-Agent: CockpitV6-MarketGo/0.8\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	reader := bufio.NewReader(conn)
	res, err := http.ReadResponse(reader, &http.Request{Method: http.MethodGet})
	if err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	if res.StatusCode != http.StatusSwitchingProtocols {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("websocket upgrade failed: %s", res.Status)
	}
	if got, want := res.Header.Get("Sec-WebSocket-Accept"), websocketAccept(key); got != want {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("websocket accept mismatch")
	}
	if c.log != nil {
		c.log.Infof("binance websocket connected url=%s", wsURL)
	}
	c.emitConnected()
	return conn, reader, nil
}

func (c *Client) setConn(conn net.Conn) {
	c.connMu.Lock()
	defer c.connMu.Unlock()
	c.conn = conn
}

func (c *Client) clearConn(conn net.Conn) {
	c.connMu.Lock()
	defer c.connMu.Unlock()
	if c.conn == conn {
		c.conn = nil
	}
}

func (c *Client) emitConnected()         { if c.events.OnConnected != nil { c.events.OnConnected() } }
func (c *Client) emitSubscribed(s string) { if c.events.OnSubscribed != nil { c.events.OnSubscribed(s) } }
func (c *Client) emitMessage()           { if c.events.OnMessage != nil { c.events.OnMessage() } }
func (c *Client) emitTrade(s string)     { if c.events.OnTrade != nil { c.events.OnTrade(s) } }
func (c *Client) emitBook(s string)      { if c.events.OnBook != nil { c.events.OnBook(s) } }
func (c *Client) emitDisconnected(e error) { if c.events.OnDisconnected != nil { c.events.OnDisconnected(e) } }
func (c *Client) emitReconnect(a int, d time.Duration, e error) {
	if c.events.OnReconnect != nil {
		c.events.OnReconnect(a, d, e)
	}
}
func (c *Client) emitError(e error) { if c.events.OnError != nil { c.events.OnError(e) } }

func reconnectDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	shift := attempt - 1
	if shift > 4 {
		shift = 4
	}
	delay := time.Duration(1<<shift) * time.Second
	if delay > 15*time.Second {
		return 15 * time.Second
	}
	return delay
}

func websocketAddr(u *url.URL) string {
	if _, _, err := net.SplitHostPort(u.Host); err == nil {
		return u.Host
	}
	if u.Scheme == "wss" {
		return net.JoinHostPort(u.Host, "443")
	}
	return net.JoinHostPort(u.Host, "80")
}

func websocketKey() (string, error) {
	var raw [16]byte
	if _, err := crand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(raw[:]), nil
}

func websocketAccept(key string) string {
	sum := sha1.Sum([]byte(key + websocketGUID))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func readNextTextPayload(conn net.Conn, reader *bufio.Reader) ([]byte, error) {
	for {
		opcode, payload, err := readFrame(reader)
		if err != nil {
			return nil, err
		}
		switch opcode {
		case 0x1, 0x2:
			return payload, nil
		case 0x8:
			return nil, io.EOF
		case 0x9: // ping -> pong
			if err := writeClientFrame(conn, 0xA, payload); err != nil {
				return nil, err
			}
		case 0xA:
			continue
		default:
			continue
		}
	}
}

func readFrame(reader *bufio.Reader) (byte, []byte, error) {
	first, err := reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	second, err := reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	opcode := first & 0x0f
	masked := second&0x80 != 0
	length := uint64(second & 0x7f)
	switch length {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(reader, ext[:]); err != nil {
			return 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(reader, ext[:]); err != nil {
			return 0, nil, err
		}
		length = binary.BigEndian.Uint64(ext[:])
	}
	if length > maxFrameBytes {
		return 0, nil, fmt.Errorf("websocket frame too large: %d", length)
	}
	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(reader, mask[:]); err != nil {
			return 0, nil, err
		}
	}
	payload := make([]byte, int(length))
	if _, err := io.ReadFull(reader, payload); err != nil {
		return 0, nil, err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return opcode, payload, nil
}

func writeClientFrame(conn net.Conn, opcode byte, payload []byte) error {
	if len(payload) > maxFrameBytes {
		return fmt.Errorf("websocket frame too large: %d", len(payload))
	}
	header := []byte{0x80 | opcode}
	length := len(payload)
	switch {
	case length < 126:
		header = append(header, 0x80|byte(length))
	case length <= 65535:
		header = append(header, 0x80|126, byte(length>>8), byte(length))
	default:
		header = append(header, 0x80|127,
			byte(uint64(length)>>56), byte(uint64(length)>>48), byte(uint64(length)>>40), byte(uint64(length)>>32),
			byte(uint64(length)>>24), byte(uint64(length)>>16), byte(uint64(length)>>8), byte(uint64(length)))
	}
	var mask [4]byte
	if _, err := crand.Read(mask[:]); err != nil {
		return err
	}
	masked := make([]byte, len(payload))
	copy(masked, payload)
	for i := range masked {
		masked[i] ^= mask[i%4]
	}
	if _, err := conn.Write(header); err != nil {
		return err
	}
	if _, err := conn.Write(mask[:]); err != nil {
		return err
	}
	_, err := conn.Write(masked)
	return err
}
