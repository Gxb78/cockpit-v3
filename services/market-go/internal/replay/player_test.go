package replay

import (
	"testing"

	"cockpit-v6-market-go/internal/marketdata"
)

func TestPlayerStepEmitsPausedTrades(t *testing.T) {
	var emitted []marketdata.Trade
	var statuses []Status
	p := NewPlayer(nil, func(trade marketdata.Trade) {
		emitted = append(emitted, trade)
	}, func(status Status) {
		statuses = append(statuses, status)
	})
	p.trades = []marketdata.Trade{
		{Symbol: "BTCUSDT", TsExchange: 1000, Price: 100, Qty: 1, Side: "buy"},
		{Symbol: "BTCUSDT", TsExchange: 2000, Price: 101, Qty: 1, Side: "sell"},
	}
	p.state = "paused"
	p.paused = true
	p.symbol = "BTCUSDT"
	p.date = "2026-06-02"

	p.Step(1)
	if len(emitted) != 1 {
		t.Fatalf("expected 1 emitted trade, got %d", len(emitted))
	}
	st := p.Status()
	if st.Index != 1 || st.State != "paused" {
		t.Fatalf("unexpected status after first step: %+v", st)
	}

	p.Step(2)
	if len(emitted) != 2 {
		t.Fatalf("expected 2 emitted trades, got %d", len(emitted))
	}
	st = p.Status()
	if st.Index != 2 || st.State != "done" {
		t.Fatalf("unexpected status after final step: %+v", st)
	}
	if len(statuses) < 2 {
		t.Fatalf("expected status callbacks, got %d", len(statuses))
	}
}
