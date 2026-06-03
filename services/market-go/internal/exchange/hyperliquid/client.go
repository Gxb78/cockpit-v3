package hyperliquid

import (
	"bufio"
	"context"
	crand "crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"cockpit-v6-market-go/internal/exchange"
	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/pkg/protocol"
)

const websocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const maxFrameBytes = 1 << 20

type Client struct {
	wsURL  string
	log    *logx.Logger
	events Events

	connMu sync.Mutex
	conn   net.Conn
}

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

func New(wsURL string, logger *logx.Logger) *Client {
	return NewWithEvents(wsURL, logger, Events{})
}

func NewWithEvents(wsURL string, logger *logx.Logger, events Events) *Client {
	if strings.TrimSpace(wsURL) == "" {
		wsURL = DefaultWSURL
	}
	return &Client{wsURL: wsURL, log: logger, events: events}
}

func (c *Client) Name() string {
	return ExchangeName
}

func (c *Client) ConnectTrades(ctx context.Context, symbol string, handler exchange.TradeHandler) error {
	return c.ConnectMarket(ctx, symbol, handler, nil, 20)
}

func (c *Client) ConnectMarket(ctx context.Context, symbol string, tradeHandler exchange.TradeHandler, bookHandler exchange.OrderBookHandler, bookDepth int) error {
	symbol = normalizeCoin(symbol)
	if symbol == "" {
		symbol = "BTC"
	}

	attempt := 0
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		err := c.connectMarketOnce(ctx, symbol, tradeHandler, bookHandler, bookDepth)
		if ctx.Err() != nil {
			return ctx.Err()
		}

		c.emitDisconnected(err)
		attempt++
		delay := reconnectDelay(attempt)
		c.emitReconnect(attempt, delay, err)
		c.log.Errorf("hyperliquid trades disconnected symbol=%s err=%v reconnectIn=%s", symbol, err, delay)
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

func (c *Client) connectMarketOnce(ctx context.Context, symbol string, tradeHandler exchange.TradeHandler, bookHandler exchange.OrderBookHandler, bookDepth int) error {
	conn, reader, err := c.dial(ctx)
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

	if tradeHandler != nil {
		sub, err := subscribePayload(symbol)
		if err != nil {
			return err
		}
		if err := writeClientFrame(conn, 0x1, sub); err != nil {
			return err
		}
		c.emitSubscribed(symbol)
		c.log.Infof("hyperliquid subscribed trades symbol=%s url=%s", symbol, c.wsURL)
	}
	if bookHandler != nil {
		sub, err := subscribeBookPayload(symbol)
		if err != nil {
			return err
		}
		if err := writeClientFrame(conn, 0x1, sub); err != nil {
			return err
		}
		c.emitSubscribed(symbol)
		c.log.Infof("hyperliquid subscribed l2Book symbol=%s url=%s", symbol, c.wsURL)
	}
	if tradeHandler == nil && bookHandler == nil {
		return fmt.Errorf("no hyperliquid handlers configured")
	}

	for {
		payload, err := readNextTextPayload(conn, reader)
		if err != nil {
			return err
		}
		c.emitMessage()
		if tradeHandler != nil {
			trades, err := ParseTradesMessage(payload)
			if err != nil {
				c.emitError(err)
				c.log.Errorf("hyperliquid parse trades failed symbol=%s err=%v", symbol, err)
				continue
			}
			for _, raw := range trades {
				trade, err := NormalizeTrade(raw, protocol.NowMillis())
				if err != nil {
					c.emitError(err)
					c.log.Errorf("hyperliquid normalize trade failed symbol=%s err=%v", symbol, err)
					continue
				}
				c.emitTrade(symbol)
				tradeHandler(trade)
			}
		}
		if bookHandler != nil {
			book, err := ParseBookMessage(payload)
			if err != nil {
				c.emitError(err)
				c.log.Errorf("hyperliquid parse l2Book failed symbol=%s err=%v", symbol, err)
				continue
			}
			if book != nil {
				snapshot, err := NormalizeBook(*book, protocol.NowMillis(), bookDepth)
				if err != nil {
					c.emitError(err)
					c.log.Errorf("hyperliquid normalize l2Book failed symbol=%s err=%v", symbol, err)
					continue
				}
				c.emitBook(symbol)
				bookHandler(snapshot)
			}
		}
	}
}

func (c *Client) dial(ctx context.Context) (net.Conn, *bufio.Reader, error) {
	u, err := url.Parse(c.wsURL)
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
		"User-Agent: CockpitV6-MarketGo/0.4\r\n\r\n"

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

	c.log.Infof("hyperliquid websocket connected url=%s", c.wsURL)
	c.emitConnected()
	return conn, reader, nil
}

func (c *Client) emitConnected() {
	if c.events.OnConnected != nil {
		c.events.OnConnected()
	}
}

func (c *Client) emitSubscribed(symbol string) {
	if c.events.OnSubscribed != nil {
		c.events.OnSubscribed(symbol)
	}
}

func (c *Client) emitMessage() {
	if c.events.OnMessage != nil {
		c.events.OnMessage()
	}
}

func (c *Client) emitTrade(symbol string) {
	if c.events.OnTrade != nil {
		c.events.OnTrade(symbol)
	}
}

func (c *Client) emitBook(symbol string) {
	if c.events.OnBook != nil {
		c.events.OnBook(symbol)
	}
}

func (c *Client) emitDisconnected(err error) {
	if c.events.OnDisconnected != nil {
		c.events.OnDisconnected(err)
	}
}

func (c *Client) emitReconnect(attempt int, delay time.Duration, err error) {
	if c.events.OnReconnect != nil {
		c.events.OnReconnect(attempt, delay, err)
	}
}

func (c *Client) emitError(err error) {
	if c.events.OnError != nil {
		c.events.OnError(err)
	}
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

func subscribePayload(symbol string) ([]byte, error) {
	return json.Marshal(subscribeMessage{
		Method: "subscribe",
		Subscription: subscription{
			Type: "trades",
			Coin: normalizeCoin(symbol),
		},
	})
}

func subscribeBookPayload(symbol string) ([]byte, error) {
	return json.Marshal(subscribeMessage{
		Method: "subscribe",
		Subscription: subscription{
			Type: "l2Book",
			Coin: normalizeCoin(symbol),
		},
	})
}

func normalizeCoin(symbol string) string {
	return strings.ToUpper(strings.TrimSpace(symbol))
}

func reconnectDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := time.Duration(1<<min(attempt-1, 4)) * time.Second
	if delay > 15*time.Second {
		return 15 * time.Second
	}
	return delay
}

func websocketAddr(u *url.URL) string {
	if _, _, err := net.SplitHostPort(u.Host); err == nil {
		return u.Host
	}
	port := "80"
	if u.Scheme == "wss" {
		port = "443"
	}
	return net.JoinHostPort(u.Host, port)
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
		case 0x9:
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
			byte(uint64(length)>>24), byte(uint64(length)>>16), byte(uint64(length)>>8), byte(uint64(length)),
		)
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

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

var _ exchange.Adapter = (*Client)(nil)
