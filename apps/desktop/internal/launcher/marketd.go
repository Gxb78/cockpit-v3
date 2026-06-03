package launcher

import (
	"io"
	"os"
	"path/filepath"
)

// MarketdEnv is the full env set for marketd in desktop mode (matches the
// documented manual launch: Hyperliquid live, book/heatmap/footprint enabled).
var MarketdEnv = []string{
	"MARKET_GO_EXCHANGE=hyperliquid",
	"MARKET_GO_SYMBOLS=BTC",
	"MARKET_GO_MOCK_MODE=false",
	"MARKET_GO_DELTA_INTERVALS=1000,5000,60000",
	"MARKET_GO_VWAP_ENABLED=true",
	"MARKET_GO_VWAP_SESSION=utc_day",
	"MARKET_GO_BOOK_ENABLED=true",
	"MARKET_GO_BOOK_DEPTH=1000",
	"MARKET_GO_BOOK_EMIT_MS=100",
	"MARKET_GO_HEATMAP_ENABLED=true",
	"MARKET_GO_HEATMAP_EMIT_MS=250",
	"MARKET_GO_HEATMAP_DEPTH=500",
	"MARKET_GO_HEATMAP_TICK_SIZE=1",
	"MARKET_GO_HEATMAP_MAX_LEVELS=500",
	"MARKET_GO_FOOTPRINT_ENABLED=true",
	"MARKET_GO_FOOTPRINT_INTERVAL_MS=60000",
	"MARKET_GO_FOOTPRINT_TICK_SIZE=1",
	"MARKET_GO_FOOTPRINT_EMIT_MS=250",
	"MARKET_GO_FOOTPRINT_MAX_LEVELS=500",
}

// MarketdSpec resolves the launch strategy for marketd.
// 1. Check next to running executable (production/wails sidecar path)
// 2. Check apps/desktop/bin/marketd.exe (development binary path)
// 3. Fallback to `go run ./cmd/marketd` in services/market-go (dev fallback)
func MarketdSpec(repoRoot, goBin string, log io.Writer) (Spec, string, error) {
	// 1. Try next to running executable (Wails production sidecar)
	if execPath, err := os.Executable(); err == nil {
		execDir := filepath.Dir(execPath)
		prodPath := filepath.Join(execDir, "marketd.exe")
		if _, err := os.Stat(prodPath); err == nil {
			return Spec{
				Name: "marketd",
				Bin:  prodPath,
				Args: []string{},
				Dir:  execDir,
				Env:  MarketdEnv,
				Log:  log,
			}, "prod-sidecar", nil
		}
	}

	// 2. Try development path: apps/desktop/bin/marketd.exe
	devPath := filepath.Join(repoRoot, "apps", "desktop", "bin", "marketd.exe")
	if _, err := os.Stat(devPath); err == nil {
		return Spec{
			Name: "marketd",
			Bin:  devPath,
			Args: []string{},
			Dir:  filepath.Join(repoRoot, "apps", "desktop", "bin"),
			Env:  MarketdEnv,
			Log:  log,
		}, "dev-sidecar", nil
	}

	// 3. Fallback to go run
	if goBin == "" {
		goBin = "go"
	}
	return Spec{
		Name: "marketd",
		Bin:  goBin,
		Args: []string{"run", "./cmd/marketd"},
		Dir:  filepath.Join(repoRoot, "services", "market-go"),
		Env:  MarketdEnv,
		Log:  log,
	}, "go-run-fallback", nil
}
