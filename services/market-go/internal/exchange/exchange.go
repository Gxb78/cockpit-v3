package exchange

import (
	"context"

	"cockpit-v6-market-go/internal/marketdata"
)

type TradeHandler func(marketdata.Trade)
type OrderBookHandler func(marketdata.OrderBookSnapshot)

type Adapter interface {
	Name() string
	ConnectTrades(ctx context.Context, symbol string, handler TradeHandler) error
	Close() error
}
