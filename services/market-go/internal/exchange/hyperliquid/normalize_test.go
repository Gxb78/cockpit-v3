package hyperliquid

import (
	"errors"
	"testing"
)

func TestParseTradesMessage(t *testing.T) {
	raw := []byte(`{"channel":"trades","data":[{"coin":"BTC","side":"B","px":"100000.5","sz":"0.01","hash":"0xabc","time":1760000000000,"tid":123,"users":["0xbuyer","0xseller"]}]}`)

	trades, err := ParseTradesMessage(raw)
	if err != nil {
		t.Fatalf("parse trades: %v", err)
	}
	if len(trades) != 1 {
		t.Fatalf("unexpected trade count: %d", len(trades))
	}
	if trades[0].Coin != "BTC" || trades[0].Side != "B" || trades[0].Px != "100000.5" || trades[0].Sz != "0.01" {
		t.Fatalf("unexpected trade: %#v", trades[0])
	}
}

func TestParseIgnoresSubscriptionResponse(t *testing.T) {
	raw := []byte(`{"channel":"subscriptionResponse","data":{"method":"subscribe","subscription":{"type":"trades","coin":"BTC"}}}`)

	trades, err := ParseTradesMessage(raw)
	if err != nil {
		t.Fatalf("parse subscription response: %v", err)
	}
	if trades != nil {
		t.Fatalf("subscription response should be ignored: %#v", trades)
	}
}

func TestNormalizeTrade(t *testing.T) {
	trade, err := NormalizeTrade(WsTrade{
		Coin: "btc",
		Side: "B",
		Px:   "100000.5",
		Sz:   "0.01",
		Time: 1760000000000,
		TID:  123,
	}, 1760000000001)
	if err != nil {
		t.Fatalf("normalize trade: %v", err)
	}
	if trade.Exchange != ExchangeName {
		t.Fatalf("unexpected exchange: %s", trade.Exchange)
	}
	if trade.Symbol != "BTC" {
		t.Fatalf("unexpected symbol: %s", trade.Symbol)
	}
	if trade.TradeID != "1760000000000:BTC:123" {
		t.Fatalf("unexpected trade id: %s", trade.TradeID)
	}
	if trade.Price != 100000.5 || trade.Qty != 0.01 || trade.Notional != 1000.005 {
		t.Fatalf("unexpected numbers: %#v", trade)
	}
	if trade.Side != "buy" {
		t.Fatalf("unexpected side: %s", trade.Side)
	}
}

func TestNormalizeSide(t *testing.T) {
	cases := map[string]string{
		"B":     "buy",
		"b":     "buy",
		"Bid":   "buy",
		"BUY":   "buy",
		"A":     "sell",
		"a":     "sell",
		"Ask":   "sell",
		"SELL":  "sell",
		"Short": "sell",
	}
	for raw, want := range cases {
		got, err := NormalizeSide(raw)
		if err != nil {
			t.Fatalf("NormalizeSide(%q): %v", raw, err)
		}
		if got != want {
			t.Fatalf("NormalizeSide(%q): got %q want %q", raw, got, want)
		}
	}

	if _, err := NormalizeSide("M"); !errors.Is(err, ErrUnknownSide) {
		t.Fatalf("unknown side should return ErrUnknownSide: %v", err)
	}
}

func TestNormalizeTradeRejectsInvalidNumbers(t *testing.T) {
	_, err := NormalizeTrade(WsTrade{
		Coin: "BTC",
		Side: "B",
		Px:   "bad",
		Sz:   "0.01",
		Time: 1760000000000,
		TID:  123,
	}, 1760000000001)
	if !errors.Is(err, ErrInvalidTrade) {
		t.Fatalf("expected ErrInvalidTrade, got %v", err)
	}
}
