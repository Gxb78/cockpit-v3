package ws

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/engine"
	"cockpit-v6-market-go/internal/logx"
)

func newCORSTestServer(t *testing.T, allowed []string) *httptest.Server {
	t.Helper()
	cfg := config.Default()
	cfg.DataDir = t.TempDir()
	cfg.AllowedOrigins = allowed
	srv := NewServer(cfg, engine.New(cfg, logx.New(testWriter{t})), logx.New(testWriter{t}))
	if srv.sqlDB != nil {
		t.Cleanup(func() { srv.sqlDB.Close() })
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts
}

func acao(t *testing.T, ts *httptest.Server, method, path, origin string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(method, ts.URL+path, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res, res.Header.Get("Access-Control-Allow-Origin")
}

func TestCORS_DefaultPolicyLoopbackOnly(t *testing.T) {
	ts := newCORSTestServer(t, nil)

	// Loopback origins are echoed.
	for _, origin := range []string{"http://localhost:5001", "http://127.0.0.1:5001", "https://localhost"} {
		if _, got := acao(t, ts, "GET", "/health", origin); got != origin {
			t.Errorf("origin %q: ACAO = %q, want %q", origin, got, origin)
		}
	}

	// Non-loopback cross-origins get no CORS header.
	for _, origin := range []string{"https://evil.com", "http://example.org"} {
		if _, got := acao(t, ts, "GET", "/health", origin); got != "" {
			t.Errorf("origin %q: ACAO = %q, want empty (rejected)", origin, got)
		}
	}
}

func TestCORS_LocalhostPrefixSpoofRejected(t *testing.T) {
	ts := newCORSTestServer(t, nil)
	// A prefix check would wrongly allow this; url.Parse host match must reject it.
	if _, got := acao(t, ts, "GET", "/health", "http://localhost.attacker.com"); got != "" {
		t.Errorf("spoofed origin allowed: ACAO = %q, want empty", got)
	}
}

func TestCORS_NoOriginNoHeader(t *testing.T) {
	ts := newCORSTestServer(t, nil)
	if _, got := acao(t, ts, "GET", "/health", ""); got != "" {
		t.Errorf("no Origin: ACAO = %q, want empty (no CORS header)", got)
	}
}

func TestCORS_ExplicitAllowlist(t *testing.T) {
	ts := newCORSTestServer(t, []string{"https://api.engine.local:8443"})

	if _, got := acao(t, ts, "GET", "/health", "https://api.engine.local:8443"); got != "https://api.engine.local:8443" {
		t.Errorf("allowlisted origin: ACAO = %q, want the origin", got)
	}
	// A loopback origin NOT in the explicit list is rejected (list overrides default).
	if _, got := acao(t, ts, "GET", "/health", "http://localhost:5001"); got != "" {
		t.Errorf("non-listed loopback: ACAO = %q, want empty", got)
	}
}

func TestCORS_WildcardOptIn(t *testing.T) {
	ts := newCORSTestServer(t, []string{"*"})
	if _, got := acao(t, ts, "GET", "/health", "https://anything.example"); got != "*" {
		t.Errorf("wildcard opt-in: ACAO = %q, want *", got)
	}
}

func TestCORS_PreflightOptionsNoContent(t *testing.T) {
	ts := newCORSTestServer(t, nil)
	res, got := acao(t, ts, "OPTIONS", "/api/v1/footprint/1m", "http://localhost:5001")
	if res.StatusCode != http.StatusNoContent {
		t.Errorf("OPTIONS status = %d, want 204", res.StatusCode)
	}
	if got != "http://localhost:5001" {
		t.Errorf("OPTIONS ACAO = %q, want the loopback origin", got)
	}
}
