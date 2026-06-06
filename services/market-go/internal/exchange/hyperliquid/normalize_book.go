package hyperliquid

import (
	"encoding/json"
	"fmt"
	"strings"

	"cockpit-v6-market-go/internal/marketdata"
)

const BookSourceL2 = "l2Book"

// ContractSize for Hyperliquid perps: order sizes are denominated in the base
// coin, so one "contract" is one base unit.
const ContractSize = 1.0

func ParseBookMessage(raw []byte) (*WsBook, error) {
	var msg streamMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return nil, err
	}
	if msg.Channel != "l2Book" {
		return nil, nil
	}
	if len(msg.Data) == 0 || string(msg.Data) == "null" {
		return nil, nil
	}

	var book WsBook
	if err := json.Unmarshal(msg.Data, &book); err != nil {
		return nil, err
	}
	return &book, nil
}

func NormalizeBook(raw WsBook, tsLocal int64, depth int) (marketdata.OrderBookSnapshot, error) {
	symbol := strings.ToUpper(strings.TrimSpace(raw.Coin))
	if symbol == "" {
		return marketdata.OrderBookSnapshot{}, fmt.Errorf("%w: missing coin", ErrInvalidTrade)
	}
	if depth <= 0 {
		depth = 20
	}

	bids := normalizeBookSide(raw.Levels[0], depth)
	asks := normalizeBookSide(raw.Levels[1], depth)
	snapshot := marketdata.OrderBookSnapshot{
		Exchange:     ExchangeName,
		Symbol:       symbol,
		TsExchange:   raw.Time,
		TsLocal:      tsLocal,
		Bids:         bids,
		Asks:         asks,
		Depth:        min(len(bids), len(asks)),
		Source:       BookSourceL2,
		ContractSize: ContractSize,
	}
	if len(bids) > 0 {
		snapshot.BestBid = bids[0].Price
	}
	if len(asks) > 0 {
		snapshot.BestAsk = asks[0].Price
	}
	if snapshot.BestBid > 0 && snapshot.BestAsk > 0 {
		snapshot.Spread = snapshot.BestAsk - snapshot.BestBid
		snapshot.Mid = (snapshot.BestBid + snapshot.BestAsk) / 2
	}
	return snapshot, nil
}

func normalizeBookSide(levels []WsLevel, depth int) []marketdata.OrderBookLevel {
	out := make([]marketdata.OrderBookLevel, 0, min(len(levels), depth))
	var cumulative float64
	for _, level := range levels {
		if len(out) >= depth {
			break
		}
		price, err := parsePositiveFloat(level.Px, "px")
		if err != nil {
			continue
		}
		size, err := parsePositiveFloat(level.Sz, "sz")
		if err != nil {
			continue
		}
		cumulative += size
		out = append(out, marketdata.OrderBookLevel{
			Price:      price,
			Size:       size,
			Orders:     level.N,
			Cumulative: cumulative,
		})
	}
	return out
}
