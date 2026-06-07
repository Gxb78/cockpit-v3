package ws

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const websocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const streamSendBuffer = 2048

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

// wsClient is a single connected stream client with a buffered send channel and
// a write loop that frames outbound messages as WebSocket text frames.
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
