package config

import (
	"os"
	"strconv"
	"strings"
)

const (
	DefaultHost             = "127.0.0.1"
	DefaultPort             = 8765
	DefaultVersion          = "0.6.0-phase6"
	ExchangeMock            = "mock"
	ExchangeHyperliquid     = "hyperliquid"
	ExchangeBinance         = "binance"
	DefaultHyperliquidWSURL   = "wss://api.hyperliquid.xyz/ws"
	DefaultHyperliquidHTTPURL = "https://api.hyperliquid.xyz/info"
	DefaultBinanceWSURL       = "wss://stream.binance.com:9443/stream"
	DefaultBinanceRESTURL     = "https://api.binance.com"
	DefaultBinanceFuturesWSURL   = "wss://fstream.binance.com/stream"
	DefaultBinanceFuturesRESTURL = "https://fapi.binance.com"
	BinanceMarketSpot         = "spot"
	BinanceMarketFutures      = "futures"
	SessionResetUTCDay        = "utc_day"
)

type Config struct {
	Host                string
	Port                int
	Symbols             []string
	MockMode            bool
	Version             string
	Exchange            string
	HyperliquidWSURL    string
	DeltaIntervals      []int64
	SessionReset        string
	VWAPEnabled         bool
	VWAPSession         string
	VWAPEmitMs          int64
	BookEnabled         bool
	BookDepth           int
	BookEmitMs          int64
	HeatmapEnabled      bool
	HeatmapEmitMs       int64
	HeatmapDepth        int
	HeatmapTickSize     float64
	HeatmapMaxLevels    int
	FootprintEnabled    bool
	FootprintIntervalMs int64
	FootprintTickSize   float64
	FootprintEmitMs     int64
	FootprintMaxLevels  int
	HyperliquidHTTPURL  string
	BinanceWSURL        string
	BinanceRESTURL      string
	BinanceMarket       string
	BinanceSnapshotLimit int
	BackfillEnabled     bool
	BackfillInterval    string
	BackfillIntervals   []string
	BackfillBars        int
	BackfillDays        int   // how many days of 1m to backfill (default 30)
	BackfillLookbackMin int
	KlineRetainDays     int   // max days of klines to keep in cache (default = BackfillDays)
	TradeRetainDays     int   // max days of trades to keep in cache (default 365)
	Footprint1mRetainDays  int   // max days of 1m footprints (default 180)
	FootprintTFRetainDays  int   // max days of TF footprints (default 1825)
	DataDir             string // directory for persistent caches (klines, etc.)
	// AllowedOrigins is the CORS allowlist for the HTTP API. Empty (default)
	// means "loopback origins only" (localhost/127.0.0.1, any port). A single
	// "*" entry restores the permissive wildcard for trusted dev setups.
	AllowedOrigins []string
}

func Default() Config {
	return Config{
		Host:                DefaultHost,
		Port:                DefaultPort,
		Symbols:             []string{"BTCUSDT"},
		MockMode:            true,
		Version:             DefaultVersion,
		Exchange:            ExchangeMock,
		HyperliquidWSURL:    DefaultHyperliquidWSURL,
		DeltaIntervals:      []int64{1000, 5000, 60000},
		SessionReset:        SessionResetUTCDay,
		VWAPEnabled:         true,
		VWAPSession:         SessionResetUTCDay,
		VWAPEmitMs:          250,
		BookEnabled:         false,
		BookDepth:           5000,
		BookEmitMs:          100,
		HeatmapEnabled:      false,
		HeatmapEmitMs:       250,
		HeatmapDepth:        1000,
		HeatmapTickSize:     1,
		HeatmapMaxLevels:    1000,
		FootprintEnabled:    false,
		FootprintIntervalMs: 60000,
		FootprintTickSize:   1,
		FootprintEmitMs:     250,
		FootprintMaxLevels:  1000,
		HyperliquidHTTPURL:  DefaultHyperliquidHTTPURL,
		BinanceWSURL:        DefaultBinanceWSURL,
		BinanceRESTURL:      DefaultBinanceRESTURL,
		BinanceMarket:       BinanceMarketSpot,
		BinanceSnapshotLimit: 0, // 0 -> client clamps to venue max (spot 5000 / futures 1000)
		BackfillEnabled:     true,
		BackfillInterval:    "1m",
		BackfillIntervals:   []string{"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d"},
		BackfillBars:        10000,
		BackfillDays:        30,
		KlineRetainDays:     30,
		TradeRetainDays:     365,
		Footprint1mRetainDays: 180,
		FootprintTFRetainDays: 1825,
		BackfillLookbackMin: 10080,
	}
}

func FromEnv() Config {
	cfg := Default()

	if host := strings.TrimSpace(os.Getenv("MARKET_GO_HOST")); host != "" {
		cfg.Host = host
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_PORT")); raw != "" {
		if port, err := strconv.Atoi(raw); err == nil && port > 0 && port < 65536 {
			cfg.Port = port
		}
	}
	if exchange := strings.TrimSpace(os.Getenv("MARKET_GO_EXCHANGE")); exchange != "" {
		cfg.Exchange = strings.ToLower(exchange)
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_SYMBOLS")); raw != "" {
		cfg.Symbols = splitSymbols(raw)
	} else if cfg.Exchange == ExchangeHyperliquid {
		cfg.Symbols = []string{"BTC"}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_MOCK_MODE")); raw != "" {
		cfg.MockMode = parseBool(raw, cfg.MockMode)
	}
	if version := strings.TrimSpace(os.Getenv("MARKET_GO_VERSION")); version != "" {
		cfg.Version = version
	}
	if wsURL := strings.TrimSpace(os.Getenv("MARKET_GO_HL_WS_URL")); wsURL != "" {
		cfg.HyperliquidWSURL = wsURL
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_DELTA_INTERVALS")); raw != "" {
		cfg.DeltaIntervals = parseIntervals(raw, cfg.DeltaIntervals)
	}
	if reset := strings.TrimSpace(os.Getenv("MARKET_GO_SESSION_RESET")); reset != "" {
		cfg.SessionReset = strings.ToLower(reset)
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_VWAP_ENABLED")); raw != "" {
		cfg.VWAPEnabled = parseBool(raw, cfg.VWAPEnabled)
	}
	if session := strings.TrimSpace(os.Getenv("MARKET_GO_VWAP_SESSION")); session != "" {
		cfg.VWAPSession = strings.ToLower(session)
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_VWAP_EMIT_MS")); raw != "" {
		if emitMs, err := strconv.ParseInt(raw, 10, 64); err == nil && emitMs >= 0 {
			cfg.VWAPEmitMs = emitMs
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_BOOK_ENABLED")); raw != "" {
		cfg.BookEnabled = parseBool(raw, cfg.BookEnabled)
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_BOOK_DEPTH")); raw != "" {
		if depth, err := strconv.Atoi(raw); err == nil && depth > 0 {
			cfg.BookDepth = depth
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_BOOK_EMIT_MS")); raw != "" {
		if emitMs, err := strconv.ParseInt(raw, 10, 64); err == nil && emitMs >= 0 {
			cfg.BookEmitMs = emitMs
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_HEATMAP_ENABLED")); raw != "" {
		cfg.HeatmapEnabled = parseBool(raw, cfg.HeatmapEnabled)
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_HEATMAP_EMIT_MS")); raw != "" {
		if emitMs, err := strconv.ParseInt(raw, 10, 64); err == nil && emitMs >= 0 {
			cfg.HeatmapEmitMs = emitMs
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_HEATMAP_DEPTH")); raw != "" {
		if depth, err := strconv.Atoi(raw); err == nil && depth > 0 {
			cfg.HeatmapDepth = depth
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_HEATMAP_TICK_SIZE")); raw != "" {
		if tickSize, err := strconv.ParseFloat(raw, 64); err == nil && tickSize > 0 {
			cfg.HeatmapTickSize = tickSize
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_HEATMAP_MAX_LEVELS")); raw != "" {
		if maxLevels, err := strconv.Atoi(raw); err == nil && maxLevels > 0 {
			cfg.HeatmapMaxLevels = maxLevels
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_FOOTPRINT_ENABLED")); raw != "" {
		cfg.FootprintEnabled = parseBool(raw, cfg.FootprintEnabled)
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_FOOTPRINT_INTERVAL_MS")); raw != "" {
		if intervalMs, err := strconv.ParseInt(raw, 10, 64); err == nil && intervalMs > 0 {
			cfg.FootprintIntervalMs = intervalMs
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_FOOTPRINT_TICK_SIZE")); raw != "" {
		if tickSize, err := strconv.ParseFloat(raw, 64); err == nil && tickSize > 0 {
			cfg.FootprintTickSize = tickSize
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_FOOTPRINT_EMIT_MS")); raw != "" {
		if emitMs, err := strconv.ParseInt(raw, 10, 64); err == nil && emitMs >= 0 {
			cfg.FootprintEmitMs = emitMs
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_FOOTPRINT_MAX_LEVELS")); raw != "" {
		if maxLevels, err := strconv.Atoi(raw); err == nil && maxLevels > 0 {
			cfg.FootprintMaxLevels = maxLevels
		}
	}
	if httpURL := strings.TrimSpace(os.Getenv("MARKET_GO_HL_HTTP_URL")); httpURL != "" {
		cfg.HyperliquidHTTPURL = httpURL
	}
	wsURLSet := false
	if wsURL := strings.TrimSpace(os.Getenv("MARKET_GO_BINANCE_WS_URL")); wsURL != "" {
		cfg.BinanceWSURL = wsURL
		wsURLSet = true
	}
	restURLSet := false
	if restURL := strings.TrimSpace(os.Getenv("MARKET_GO_BINANCE_REST_URL")); restURL != "" {
		cfg.BinanceRESTURL = restURL
		restURLSet = true
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_BINANCE_MARKET")); raw != "" {
		switch strings.ToLower(raw) {
		case BinanceMarketFutures, "fut", "perp", "usdm", "usd-m":
			cfg.BinanceMarket = BinanceMarketFutures
		default:
			cfg.BinanceMarket = BinanceMarketSpot
		}
	}
	// When futures is selected and the endpoints weren't explicitly overridden,
	// switch the defaults to the futures hosts so the user only has to set the
	// market flag.
	if cfg.BinanceMarket == BinanceMarketFutures {
		if !wsURLSet {
			cfg.BinanceWSURL = DefaultBinanceFuturesWSURL
		}
		if !restURLSet {
			cfg.BinanceRESTURL = DefaultBinanceFuturesRESTURL
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_BINANCE_SNAPSHOT_LIMIT")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			cfg.BinanceSnapshotLimit = n
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_BACKFILL_ENABLED")); raw != "" {
		cfg.BackfillEnabled = parseBool(raw, cfg.BackfillEnabled)
	}
	if interval := strings.TrimSpace(os.Getenv("MARKET_GO_BACKFILL_INTERVAL")); interval != "" {
		cfg.BackfillInterval = interval
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_BACKFILL_INTERVALS")); raw != "" {
		parts := strings.Split(raw, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			if iv := strings.TrimSpace(p); iv != "" {
				out = append(out, iv)
			}
		}
		if len(out) > 0 {
			cfg.BackfillIntervals = out
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_BACKFILL_BARS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			cfg.BackfillBars = n
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_BACKFILL_DAYS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			cfg.BackfillDays = n
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_KLINES_RETAIN_DAYS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			cfg.KlineRetainDays = n
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_TRADE_RETAIN_DAYS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			cfg.TradeRetainDays = n
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_FP_1M_RETAIN_DAYS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			cfg.Footprint1mRetainDays = n
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_FP_TF_RETAIN_DAYS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			cfg.FootprintTFRetainDays = n
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_BACKFILL_LOOKBACK_MIN")); raw != "" {
		if mins, err := strconv.Atoi(raw); err == nil && mins > 0 {
			cfg.BackfillLookbackMin = mins
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_DATA_DIR")); raw != "" {
		cfg.DataDir = raw
	}
	if raw := strings.TrimSpace(os.Getenv("MARKET_GO_ALLOWED_ORIGINS")); raw != "" {
		cfg.AllowedOrigins = splitOrigins(raw)
	}

	return cfg
}

// splitOrigins parses a comma-separated CORS allowlist, trimming whitespace and
// any trailing slash so entries match the browser-sent Origin header exactly.
func splitOrigins(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		origin := strings.TrimRight(strings.TrimSpace(part), "/")
		if origin != "" {
			out = append(out, origin)
		}
	}
	return out
}

func (c Config) Addr() string {
	return c.Host + ":" + strconv.Itoa(c.Port)
}

func splitSymbols(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		symbol := strings.ToUpper(strings.TrimSpace(part))
		if symbol != "" {
			out = append(out, symbol)
		}
	}
	if len(out) == 0 {
		return Default().Symbols
	}
	return out
}

func parseIntervals(raw string, fallback []int64) []int64 {
	parts := strings.Split(raw, ",")
	out := make([]int64, 0, len(parts))
	seen := make(map[int64]struct{})
	for _, part := range parts {
		value, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil || value <= 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	if len(out) == 0 {
		return append([]int64(nil), fallback...)
	}
	return out
}

func parseBool(raw string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
