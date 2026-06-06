package binance

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"cockpit-v6-market-go/internal/marketdata"
)

const ExchangeName = "binance"

// ContractSize for Binance spot / USDT-margined futures: order sizes are
// denominated in the base asset, so one "contract" is one base unit.
const ContractSize = 1.0

var ErrInvalid = errors.New("invalid binance payload")

// combinedMessage is the envelope Binance sends on combined streams:
//
//	{"stream":"btcusdt@aggTrade","data":{...}}
type combinedMessage struct {
	Stream string          `json:"stream"`
	Data   json.RawMessage `json:"data"`
}

// wsAggTrade mirrors Binance aggTrade payload.
//
//	e=event, E=eventTime, s=symbol, p=price, q=qty, T=tradeTime,
//	m=isBuyerMaker (true => aggressor is the SELLER), a=aggTradeId
type wsAggTrade struct {
	Symbol string `json:"s"`
	Price  string `json:"p"`
	Qty    string `json:"q"`
	TradeT int64  `json:"T"`
	Maker  bool   `json:"m"`
	AggID  int64  `json:"a"`
}

// wsDepth mirrors Binance partial book depth (depthN@100ms) payload.
//
//	b=bids [[price,qty],...], a=asks, E=eventTime
type wsDepth struct {
	// NOTE: Go's encoding/json is case-insensitive, so a "E"/"e" tag would also
	// capture the event-type string and break. We don't need exchange time here
	// (TsLocal is used), so no E field.
	Symbol string     `json:"s"`
	Bids   [][]string `json:"bids"`
	Asks   [][]string `json:"asks"`
}

// ParseCombined splits the combined-stream envelope into (stream, data).
func ParseCombined(raw []byte) (string, json.RawMessage, error) {
	var msg combinedMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return "", nil, err
	}
	return msg.Stream, msg.Data, nil
}

// NormalizeAggTrade converts a Binance aggTrade JSON to marketdata.Trade.
func NormalizeAggTrade(data []byte, tsLocal int64) (marketdata.Trade, error) {
	var t wsAggTrade
	if err := json.Unmarshal(data, &t); err != nil {
		return marketdata.Trade{}, err
	}
	symbol := strings.ToUpper(strings.TrimSpace(t.Symbol))
	if symbol == "" {
		return marketdata.Trade{}, fmt.Errorf("%w: missing symbol", ErrInvalid)
	}
	price, err := parsePositiveFloat(t.Price)
	if err != nil {
		return marketdata.Trade{}, err
	}
	qty, err := parsePositiveFloat(t.Qty)
	if err != nil {
		return marketdata.Trade{}, err
	}
	if t.TradeT <= 0 {
		return marketdata.Trade{}, fmt.Errorf("%w: missing time", ErrInvalid)
	}
	// isBuyerMaker true => aggressor sold into the bid => sell.
	side := "buy"
	if t.Maker {
		side = "sell"
	}
	id := fmt.Sprintf("%d:%s:%d", t.TradeT, symbol, t.AggID)
	return marketdata.Trade{
		ID:         id,
		TradeID:    id,
		Exchange:   ExchangeName,
		Symbol:     symbol,
		TsExchange: t.TradeT,
		TsLocal:    tsLocal,
		Price:      price,
		Qty:        qty,
		Side:       side,
		Notional:   price * qty,
	}, nil
}

// NormalizeDepth converts a Binance partial-depth JSON to an OrderBookSnapshot.
func NormalizeDepth(data []byte, symbolFallback string, tsLocal int64, depth int) (marketdata.OrderBookSnapshot, error) {
	var d wsDepth
	if err := json.Unmarshal(data, &d); err != nil {
		return marketdata.OrderBookSnapshot{}, err
	}
	if depth <= 0 {
		depth = 20
	}
	symbol := strings.ToUpper(strings.TrimSpace(d.Symbol))
	if symbol == "" {
		symbol = strings.ToUpper(strings.TrimSpace(symbolFallback))
	}
	bids := normalizeDepthSide(d.Bids, depth)
	asks := normalizeDepthSide(d.Asks, depth)
	snap := marketdata.OrderBookSnapshot{
		Exchange:     ExchangeName,
		Symbol:       symbol,
		TsExchange:   tsLocal,
		TsLocal:      tsLocal,
		Bids:         bids,
		Asks:         asks,
		Depth:        min(len(bids), len(asks)),
		Source:       "depth",
		ContractSize: ContractSize,
	}
	if len(bids) > 0 {
		snap.BestBid = bids[0].Price
	}
	if len(asks) > 0 {
		snap.BestAsk = asks[0].Price
	}
	if snap.BestBid > 0 && snap.BestAsk > 0 {
		snap.Spread = snap.BestAsk - snap.BestBid
		snap.Mid = (snap.BestBid + snap.BestAsk) / 2
	}
	return snap, nil
}

func normalizeDepthSide(levels [][]string, depth int) []marketdata.OrderBookLevel {
	out := make([]marketdata.OrderBookLevel, 0, depth)
	var cumulative float64
	for _, lvl := range levels {
		if len(out) >= depth || len(lvl) < 2 {
			continue
		}
		price, err := parsePositiveFloat(lvl[0])
		if err != nil {
			continue
		}
		size, err := strconv.ParseFloat(strings.TrimSpace(lvl[1]), 64)
		if err != nil || size < 0 {
			continue
		}
		if size == 0 {
			continue
		}
		cumulative += size
		out = append(out, marketdata.OrderBookLevel{
			Price:      price,
			Size:       size,
			Cumulative: cumulative,
		})
	}
	return out
}

func parsePositiveFloat(raw string) (float64, error) {
	v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
		return 0, fmt.Errorf("%w: invalid number %q", ErrInvalid, raw)
	}
	return v, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
