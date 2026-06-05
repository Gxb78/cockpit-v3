package ws

import (
	"bufio"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/engine"
	"cockpit-v6-market-go/internal/logx"
)

func TestHealthEndpoint(t *testing.T) {
	cfg := config.Default()
	server := NewServer(cfg, engine.New(cfg, logx.New(testWriter{t})), logx.New(testWriter{t}))
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()

	res, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", res.StatusCode)
	}
	var payload map[string]any
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["ok"] != true {
		t.Fatalf("health ok should be true: %#v", payload)
	}
	if payload["service"] != engine.ServiceName {
		t.Fatalf("unexpected service: %#v", payload["service"])
	}
}

func TestMetricsEndpoint(t *testing.T) {
	cfg := config.Default()
	marketEngine := engine.New(cfg, logx.New(testWriter{t}))
	marketEngine.SetConnected(true)
	marketEngine.RecordMessageIn()
	marketEngine.SetStreamClients(2)

	server := NewServer(cfg, marketEngine, logx.New(testWriter{t}))
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()

	res, err := http.Get(ts.URL + "/metrics")
	if err != nil {
		t.Fatalf("GET /metrics: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", res.StatusCode)
	}
	var payload map[string]any
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["service"] != engine.ServiceName {
		t.Fatalf("unexpected service: %#v", payload["service"])
	}
	if payload["connected"] != true {
		t.Fatalf("connected should be true: %#v", payload)
	}
	if payload["totalMessagesIn"].(float64) != 1 {
		t.Fatalf("unexpected totalMessagesIn: %#v", payload["totalMessagesIn"])
	}
	if payload["totalStreamClients"].(float64) != 2 {
		t.Fatalf("unexpected totalStreamClients: %#v", payload["totalStreamClients"])
	}
}

func TestWebsocketAccept(t *testing.T) {
	got := websocketAccept("dGhlIHNhbXBsZSBub25jZQ==")
	want := "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
	if got != want {
		t.Fatalf("unexpected accept: got %q want %q", got, want)
	}
}

func TestReplayStepEndpoint(t *testing.T) {
	cfg := config.Default()
	server := NewServer(cfg, engine.New(cfg, logx.New(testWriter{t})), logx.New(testWriter{t}))
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()

	res, err := http.Post(ts.URL+"/replay", "application/json", strings.NewReader(`{"action":"step","count":1}`))
	if err != nil {
		t.Fatalf("POST /replay: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", res.StatusCode)
	}
	var payload map[string]any
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["state"] != "idle" {
		t.Fatalf("unexpected replay state: %#v", payload["state"])
	}
}

func TestStreamEndpointUpgrades(t *testing.T) {
	cfg := config.Default()
	server := NewServer(cfg, engine.New(cfg, logx.New(testWriter{t})), logx.New(testWriter{t}))
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()

	u, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}

	conn, err := net.Dial("tcp", u.Host)
	if err != nil {
		t.Fatalf("dial test server: %v", err)
	}
	defer conn.Close()

	key := "dGhlIHNhbXBsZSBub25jZQ=="
	req := "GET /stream HTTP/1.1\r\n" +
		"Host: " + u.Host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n"

	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatalf("write upgrade request: %v", err)
	}

	res, err := http.ReadResponse(bufio.NewReader(conn), &http.Request{Method: http.MethodGet})
	if err != nil {
		t.Fatalf("read upgrade response: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("unexpected upgrade status: %d", res.StatusCode)
	}
	if got, want := res.Header.Get("Sec-WebSocket-Accept"), websocketAccept(key); got != want {
		t.Fatalf("unexpected accept header: got %q want %q", got, want)
	}
}

type testWriter struct {
	t *testing.T
}

func (w testWriter) Write(p []byte) (int, error) {
	w.t.Log(string(p))
	return len(p), nil
}
