// Package replay provides historical market-data sources for backtesting.
// Trades are replayed through the same engine pipeline as live data, so
// footprint / delta / CVD / heatmap stay identical to the live behaviour.
package replay

import (
	"context"

	"cockpit-v6-market-go/internal/marketdata"
)

// Source loads historical trades for a symbol/day, sorted by timestamp ascending.
type Source interface {
	Name() string
	// LoadDay returns all trades for the given symbol and UTC date (YYYY-MM-DD).
	LoadDay(ctx context.Context, symbol, date string) ([]marketdata.Trade, error)
}
