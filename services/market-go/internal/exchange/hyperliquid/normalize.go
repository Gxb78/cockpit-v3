package hyperliquid

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"cockpit-v6-market-go/internal/marketdata"
)

var (
	ErrUnknownSide  = errors.New("unknown hyperliquid trade side")
	ErrInvalidTrade = errors.New("invalid hyperliquid trade")
)

func ParseTradesMessage(raw []byte) ([]WsTrade, error) {
	var msg streamMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return nil, err
	}
	if msg.Channel != "trades" {
		return nil, nil
	}
	if len(msg.Data) == 0 || string(msg.Data) == "null" {
		return nil, nil
	}

	var trades []WsTrade
	if err := json.Unmarshal(msg.Data, &trades); err != nil {
		return nil, err
	}
	return trades, nil
}

// NormalizeSide maps Hyperliquid v0 side notation to the V6 orderflow side.
// Official notation: B = Bid = Buy, A = Ask = Short; for trades this is the
// aggressing side. V6 uses buy/sell, so B becomes buy and A becomes sell.
func NormalizeSide(raw string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "B", "BID", "BUY":
		return "buy", nil
	case "A", "ASK", "S", "SELL", "SHORT":
		return "sell", nil
	default:
		return "", fmt.Errorf("%w: %q", ErrUnknownSide, raw)
	}
}

func NormalizeTrade(raw WsTrade, tsLocal int64) (marketdata.Trade, error) {
	symbol := strings.ToUpper(strings.TrimSpace(raw.Coin))
	if symbol == "" {
		return marketdata.Trade{}, fmt.Errorf("%w: missing coin", ErrInvalidTrade)
	}
	price, err := parsePositiveFloat(raw.Px, "px")
	if err != nil {
		return marketdata.Trade{}, err
	}
	qty, err := parsePositiveFloat(raw.Sz, "sz")
	if err != nil {
		return marketdata.Trade{}, err
	}
	if raw.Time <= 0 {
		return marketdata.Trade{}, fmt.Errorf("%w: missing time", ErrInvalidTrade)
	}
	side, err := NormalizeSide(raw.Side)
	if err != nil {
		return marketdata.Trade{}, err
	}

	tradeID := tradeID(raw, symbol)
	return marketdata.Trade{
		ID:         tradeID,
		TradeID:    tradeID,
		Exchange:   ExchangeName,
		Symbol:     symbol,
		TsExchange: raw.Time,
		TsLocal:    tsLocal,
		Price:      price,
		Qty:        qty,
		Side:       side,
		Notional:   price * qty,
	}, nil
}

func parsePositiveFloat(raw string, field string) (float64, error) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
		return 0, fmt.Errorf("%w: invalid %s %q", ErrInvalidTrade, field, raw)
	}
	return value, nil
}

func tradeID(raw WsTrade, symbol string) string {
	if raw.TID != 0 {
		return fmt.Sprintf("%d:%s:%d", raw.Time, symbol, raw.TID)
	}
	hash := strings.TrimSpace(raw.Hash)
	if hash != "" {
		return fmt.Sprintf("%d:%s:%s", raw.Time, symbol, hash)
	}
	return fmt.Sprintf("%d:%s", raw.Time, symbol)
}
