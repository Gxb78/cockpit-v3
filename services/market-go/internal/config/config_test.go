package config

import "testing"

func TestDefaultConfig(t *testing.T) {
	cfg := Default()
	if cfg.Addr() != "127.0.0.1:8765" {
		t.Fatalf("unexpected default addr: %s", cfg.Addr())
	}
	if !cfg.MockMode {
		t.Fatalf("mock mode should be enabled by default")
	}
	if len(cfg.Symbols) != 1 || cfg.Symbols[0] != "BTCUSDT" {
		t.Fatalf("unexpected default symbols: %#v", cfg.Symbols)
	}
	if cfg.Exchange != ExchangeMock {
		t.Fatalf("unexpected default exchange: %s", cfg.Exchange)
	}
	if cfg.HyperliquidWSURL != DefaultHyperliquidWSURL {
		t.Fatalf("unexpected default hyperliquid ws url: %s", cfg.HyperliquidWSURL)
	}
	if got := cfg.DeltaIntervals; len(got) != 3 || got[0] != 1000 || got[1] != 5000 || got[2] != 60000 {
		t.Fatalf("unexpected default delta intervals: %#v", got)
	}
	if cfg.SessionReset != SessionResetUTCDay {
		t.Fatalf("unexpected session reset: %s", cfg.SessionReset)
	}
	if !cfg.VWAPEnabled {
		t.Fatalf("vwap should be enabled by default")
	}
	if cfg.VWAPSession != SessionResetUTCDay {
		t.Fatalf("unexpected vwap session: %s", cfg.VWAPSession)
	}
	if cfg.VWAPEmitMs != 250 {
		t.Fatalf("unexpected vwap emit ms: %d", cfg.VWAPEmitMs)
	}
	if cfg.BookEnabled {
		t.Fatalf("book should be disabled by default")
	}
	if cfg.BookDepth != 5000 {
		t.Fatalf("unexpected default book depth: %d", cfg.BookDepth)
	}
	if cfg.BookEmitMs != 100 {
		t.Fatalf("unexpected default book emit ms: %d", cfg.BookEmitMs)
	}
	if cfg.HeatmapEnabled {
		t.Fatalf("heatmap should be disabled by default")
	}
	if cfg.HeatmapEmitMs != 250 {
		t.Fatalf("unexpected default heatmap emit ms: %d", cfg.HeatmapEmitMs)
	}
	if cfg.HeatmapDepth != 1000 {
		t.Fatalf("unexpected default heatmap depth: %d", cfg.HeatmapDepth)
	}
	if cfg.HeatmapTickSize != 1 {
		t.Fatalf("unexpected default heatmap tick size: %f", cfg.HeatmapTickSize)
	}
	if cfg.HeatmapMaxLevels != 1000 {
		t.Fatalf("unexpected default heatmap max levels: %d", cfg.HeatmapMaxLevels)
	}
	if cfg.FootprintEnabled {
		t.Fatalf("footprint should be disabled by default")
	}
	if cfg.FootprintIntervalMs != 60000 {
		t.Fatalf("unexpected default footprint interval: %d", cfg.FootprintIntervalMs)
	}
	if cfg.FootprintTickSize != 1 {
		t.Fatalf("unexpected default footprint tick size: %f", cfg.FootprintTickSize)
	}
	if cfg.FootprintEmitMs != 250 {
		t.Fatalf("unexpected default footprint emit ms: %d", cfg.FootprintEmitMs)
	}
	if cfg.FootprintMaxLevels != 1000 {
		t.Fatalf("unexpected default footprint max levels: %d", cfg.FootprintMaxLevels)
	}
}

func TestFromEnv(t *testing.T) {
	t.Setenv("MARKET_GO_HOST", "0.0.0.0")
	t.Setenv("MARKET_GO_PORT", "9999")
	t.Setenv("MARKET_GO_SYMBOLS", "btcusdt, ethusdt")
	t.Setenv("MARKET_GO_MOCK_MODE", "false")
	t.Setenv("MARKET_GO_EXCHANGE", "hyperliquid")
	t.Setenv("MARKET_GO_HL_WS_URL", "wss://example.invalid/ws")
	t.Setenv("MARKET_GO_DELTA_INTERVALS", "1000, 5000,60000,5000,bad")
	t.Setenv("MARKET_GO_SESSION_RESET", "UTC_DAY")
	t.Setenv("MARKET_GO_VWAP_ENABLED", "false")
	t.Setenv("MARKET_GO_VWAP_SESSION", "UTC_DAY")
	t.Setenv("MARKET_GO_VWAP_EMIT_MS", "500")
	t.Setenv("MARKET_GO_BOOK_ENABLED", "true")
	t.Setenv("MARKET_GO_BOOK_DEPTH", "40")
	t.Setenv("MARKET_GO_BOOK_EMIT_MS", "125")
	t.Setenv("MARKET_GO_HEATMAP_ENABLED", "true")
	t.Setenv("MARKET_GO_HEATMAP_EMIT_MS", "500")
	t.Setenv("MARKET_GO_HEATMAP_DEPTH", "30")
	t.Setenv("MARKET_GO_HEATMAP_TICK_SIZE", "0.5")
	t.Setenv("MARKET_GO_HEATMAP_MAX_LEVELS", "80")
	t.Setenv("MARKET_GO_FOOTPRINT_ENABLED", "true")
	t.Setenv("MARKET_GO_FOOTPRINT_INTERVAL_MS", "30000")
	t.Setenv("MARKET_GO_FOOTPRINT_TICK_SIZE", "0.5")
	t.Setenv("MARKET_GO_FOOTPRINT_EMIT_MS", "250")
	t.Setenv("MARKET_GO_FOOTPRINT_MAX_LEVELS", "120")

	cfg := FromEnv()
	if cfg.Addr() != "0.0.0.0:9999" {
		t.Fatalf("unexpected addr: %s", cfg.Addr())
	}
	if cfg.MockMode {
		t.Fatalf("mock mode should be disabled")
	}
	if got := cfg.Symbols; len(got) != 2 || got[0] != "BTCUSDT" || got[1] != "ETHUSDT" {
		t.Fatalf("unexpected symbols: %#v", got)
	}
	if cfg.Exchange != ExchangeHyperliquid {
		t.Fatalf("unexpected exchange: %s", cfg.Exchange)
	}
	if cfg.HyperliquidWSURL != "wss://example.invalid/ws" {
		t.Fatalf("unexpected hyperliquid ws url: %s", cfg.HyperliquidWSURL)
	}
	if got := cfg.DeltaIntervals; len(got) != 3 || got[0] != 1000 || got[1] != 5000 || got[2] != 60000 {
		t.Fatalf("unexpected delta intervals: %#v", got)
	}
	if cfg.SessionReset != SessionResetUTCDay {
		t.Fatalf("unexpected session reset: %s", cfg.SessionReset)
	}
	if cfg.VWAPEnabled {
		t.Fatalf("vwap should be disabled by env")
	}
	if cfg.VWAPSession != SessionResetUTCDay {
		t.Fatalf("unexpected vwap session: %s", cfg.VWAPSession)
	}
	if cfg.VWAPEmitMs != 500 {
		t.Fatalf("unexpected vwap emit ms: %d", cfg.VWAPEmitMs)
	}
	if !cfg.BookEnabled {
		t.Fatalf("book should be enabled by env")
	}
	if cfg.BookDepth != 40 {
		t.Fatalf("unexpected book depth: %d", cfg.BookDepth)
	}
	if cfg.BookEmitMs != 125 {
		t.Fatalf("unexpected book emit ms: %d", cfg.BookEmitMs)
	}
	if !cfg.HeatmapEnabled {
		t.Fatalf("heatmap should be enabled by env")
	}
	if cfg.HeatmapEmitMs != 500 {
		t.Fatalf("unexpected heatmap emit ms: %d", cfg.HeatmapEmitMs)
	}
	if cfg.HeatmapDepth != 30 {
		t.Fatalf("unexpected heatmap depth: %d", cfg.HeatmapDepth)
	}
	if cfg.HeatmapTickSize != 0.5 {
		t.Fatalf("unexpected heatmap tick size: %f", cfg.HeatmapTickSize)
	}
	if cfg.HeatmapMaxLevels != 80 {
		t.Fatalf("unexpected heatmap max levels: %d", cfg.HeatmapMaxLevels)
	}
	if !cfg.FootprintEnabled {
		t.Fatalf("footprint should be enabled by env")
	}
	if cfg.FootprintIntervalMs != 30000 {
		t.Fatalf("unexpected footprint interval: %d", cfg.FootprintIntervalMs)
	}
	if cfg.FootprintTickSize != 0.5 {
		t.Fatalf("unexpected footprint tick size: %f", cfg.FootprintTickSize)
	}
	if cfg.FootprintEmitMs != 250 {
		t.Fatalf("unexpected footprint emit ms: %d", cfg.FootprintEmitMs)
	}
	if cfg.FootprintMaxLevels != 120 {
		t.Fatalf("unexpected footprint max levels: %d", cfg.FootprintMaxLevels)
	}
}

func TestVWAPConfigKeepsFallbacksForInvalidValues(t *testing.T) {
	t.Setenv("MARKET_GO_VWAP_ENABLED", "not-a-bool")
	t.Setenv("MARKET_GO_VWAP_EMIT_MS", "-1")

	cfg := FromEnv()
	if !cfg.VWAPEnabled {
		t.Fatalf("invalid bool should keep default vwap enabled")
	}
	if cfg.VWAPEmitMs != 250 {
		t.Fatalf("invalid emit ms should keep default, got %d", cfg.VWAPEmitMs)
	}
}

func TestBookConfigKeepsFallbacksForInvalidValues(t *testing.T) {
	t.Setenv("MARKET_GO_BOOK_ENABLED", "not-a-bool")
	t.Setenv("MARKET_GO_BOOK_DEPTH", "-2")
	t.Setenv("MARKET_GO_BOOK_EMIT_MS", "-1")

	cfg := FromEnv()
	if cfg.BookEnabled {
		t.Fatalf("invalid bool should keep default book disabled")
	}
	if cfg.BookDepth != 5000 {
		t.Fatalf("invalid depth should keep default, got %d", cfg.BookDepth)
	}
	if cfg.BookEmitMs != 100 {
		t.Fatalf("invalid emit ms should keep default, got %d", cfg.BookEmitMs)
	}
}

func TestHeatmapConfigKeepsFallbacksForInvalidValues(t *testing.T) {
	t.Setenv("MARKET_GO_HEATMAP_ENABLED", "not-a-bool")
	t.Setenv("MARKET_GO_HEATMAP_EMIT_MS", "-1")
	t.Setenv("MARKET_GO_HEATMAP_DEPTH", "0")
	t.Setenv("MARKET_GO_HEATMAP_TICK_SIZE", "-1")
	t.Setenv("MARKET_GO_HEATMAP_MAX_LEVELS", "0")

	cfg := FromEnv()
	if cfg.HeatmapEnabled {
		t.Fatalf("invalid bool should keep default heatmap disabled")
	}
	if cfg.HeatmapEmitMs != 250 {
		t.Fatalf("invalid emit ms should keep default, got %d", cfg.HeatmapEmitMs)
	}
	if cfg.HeatmapDepth != 1000 {
		t.Fatalf("invalid depth should keep default, got %d", cfg.HeatmapDepth)
	}
	if cfg.HeatmapTickSize != 1 {
		t.Fatalf("invalid tick size should keep default, got %f", cfg.HeatmapTickSize)
	}
	if cfg.HeatmapMaxLevels != 1000 {
		t.Fatalf("invalid max levels should keep default, got %d", cfg.HeatmapMaxLevels)
	}
}

func TestFootprintConfigKeepsFallbacksForInvalidValues(t *testing.T) {
	t.Setenv("MARKET_GO_FOOTPRINT_ENABLED", "not-a-bool")
	t.Setenv("MARKET_GO_FOOTPRINT_INTERVAL_MS", "0")
	t.Setenv("MARKET_GO_FOOTPRINT_TICK_SIZE", "-1")
	t.Setenv("MARKET_GO_FOOTPRINT_EMIT_MS", "-1")
	t.Setenv("MARKET_GO_FOOTPRINT_MAX_LEVELS", "0")

	cfg := FromEnv()
	if cfg.FootprintEnabled {
		t.Fatalf("invalid bool should keep default footprint disabled")
	}
	if cfg.FootprintIntervalMs != 60000 {
		t.Fatalf("invalid interval should keep default, got %d", cfg.FootprintIntervalMs)
	}
	if cfg.FootprintTickSize != 1 {
		t.Fatalf("invalid tick size should keep default, got %f", cfg.FootprintTickSize)
	}
	if cfg.FootprintEmitMs != 250 {
		t.Fatalf("invalid emit ms should keep default, got %d", cfg.FootprintEmitMs)
	}
	if cfg.FootprintMaxLevels != 1000 {
		t.Fatalf("invalid max levels should keep default, got %d", cfg.FootprintMaxLevels)
	}
}

func TestHyperliquidDefaultsToCoinSymbol(t *testing.T) {
	t.Setenv("MARKET_GO_EXCHANGE", "hyperliquid")

	cfg := FromEnv()
	if got := cfg.Symbols; len(got) != 1 || got[0] != "BTC" {
		t.Fatalf("unexpected hyperliquid symbols: %#v", got)
	}
}

func TestFromEnvAllowedOriginsDefaultsEmpty(t *testing.T) {
	if got := FromEnv().AllowedOrigins; len(got) != 0 {
		t.Fatalf("AllowedOrigins should default empty (loopback-only policy), got %#v", got)
	}
}

func TestFromEnvAllowedOriginsParsed(t *testing.T) {
	t.Setenv("MARKET_GO_ALLOWED_ORIGINS", " https://api.engine.local:8443/ , http://localhost:5001 ,, ")
	got := FromEnv().AllowedOrigins
	want := []string{"https://api.engine.local:8443", "http://localhost:5001"}
	if len(got) != len(want) {
		t.Fatalf("AllowedOrigins = %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("AllowedOrigins[%d] = %q, want %q (trimmed, no trailing slash)", i, got[i], want[i])
		}
	}
}
