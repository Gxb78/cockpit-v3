package calc

import (
	"testing"

	"cockpit-v6-market-go/internal/marketdata"
)

func TestTradeBuyIncreasesBuyVol(t *testing.T) {
	calc := NewDeltaCalculator([]int64{1000}, SessionResetUTCDay, 0)
	out := calc.UpdateTradeAt(testTrade("buy", 2, 1760000000123), 1760000000200)
	if len(out) != 1 {
		t.Fatalf("expected one bucket, got %d", len(out))
	}
	if out[0].BuyVol != 2 || out[0].SellVol != 0 {
		t.Fatalf("unexpected volumes: %#v", out[0])
	}
}

func TestTradeSellIncreasesSellVol(t *testing.T) {
	calc := NewDeltaCalculator([]int64{1000}, SessionResetUTCDay, 0)
	out := calc.UpdateTradeAt(testTrade("sell", 1.5, 1760000000123), 1760000000200)
	if len(out) != 1 {
		t.Fatalf("expected one bucket, got %d", len(out))
	}
	if out[0].SellVol != 1.5 || out[0].BuyVol != 0 {
		t.Fatalf("unexpected volumes: %#v", out[0])
	}
}

func TestDeltaEqualsBuyMinusSell(t *testing.T) {
	calc := NewDeltaCalculator([]int64{1000}, SessionResetUTCDay, 0)
	calc.UpdateTradeAt(testTrade("buy", 2, 1760000000123), 1760000000200)
	out := calc.UpdateTradeAt(testTrade("sell", 0.75, 1760000000456), 1760000000500)
	got := out[len(out)-1]
	if got.Delta != 1.25 {
		t.Fatalf("unexpected delta: %#v", got)
	}
}

func TestCVDCumulatesAcrossBuckets(t *testing.T) {
	calc := NewDeltaCalculator([]int64{1000}, SessionResetUTCDay, 0)
	calc.UpdateTradeAt(testTrade("buy", 2, 1760000000123), 1760000000200)
	out := calc.UpdateTradeAt(testTrade("sell", 0.5, 1760000001123), 1760000001200)

	if len(out) != 2 {
		t.Fatalf("expected closed and live buckets, got %d: %#v", len(out), out)
	}
	if !out[0].Closed {
		t.Fatalf("first bucket should be closed: %#v", out[0])
	}
	if out[1].CVD != 1.5 {
		t.Fatalf("unexpected live CVD: %#v", out[1])
	}
}

func TestBucketChangeClosesPreviousBucket(t *testing.T) {
	calc := NewDeltaCalculator([]int64{1000}, SessionResetUTCDay, 0)
	calc.UpdateTradeAt(testTrade("buy", 1, 1760000000123), 1760000000200)
	out := calc.UpdateTradeAt(testTrade("buy", 1, 1760000001123), 1760000001200)

	if len(out) != 2 {
		t.Fatalf("expected two buckets, got %d", len(out))
	}
	if !out[0].Closed {
		t.Fatalf("previous bucket should be closed: %#v", out[0])
	}
	if out[0].StartTime != 1760000000000 || out[0].EndTime != 1760000001000 {
		t.Fatalf("unexpected closed bucket window: %#v", out[0])
	}
	if out[1].Closed {
		t.Fatalf("new bucket should be live: %#v", out[1])
	}
}

func TestUTCDayResetClearsCVD(t *testing.T) {
	calc := NewDeltaCalculator([]int64{1000}, SessionResetUTCDay, 0)
	calc.UpdateTradeAt(testTrade("buy", 3, 1760054399500), 1760054399600)         // 2025-10-09 UTC
	out := calc.UpdateTradeAt(testTrade("sell", 1, 1760054400500), 1760054400600) // 2025-10-10 UTC

	if len(out) != 1 {
		t.Fatalf("expected only new session live bucket, got %d: %#v", len(out), out)
	}
	if out[0].CVD != -1 {
		t.Fatalf("CVD should reset on UTC day boundary: %#v", out[0])
	}
	snap := calc.Snapshot()
	if snap.CurrentSessionID != "utc_day:2025-10-10" {
		t.Fatalf("unexpected session id: %#v", snap)
	}
}

func TestUnknownSideIgnored(t *testing.T) {
	calc := NewDeltaCalculator([]int64{1000}, SessionResetUTCDay, 0)
	out := calc.UpdateTradeAt(testTrade("unknown", 1, 1760000000123), 1760000000200)
	if len(out) != 0 {
		t.Fatalf("unknown side should be ignored: %#v", out)
	}
}

func TestNormalizeIntervals(t *testing.T) {
	calc := NewDeltaCalculator([]int64{60000, 1000, 5000, 1000, -1}, SessionResetUTCDay, 0)
	got := calc.Intervals()
	if len(got) != 3 || got[0] != 1000 || got[1] != 5000 || got[2] != 60000 {
		t.Fatalf("unexpected intervals: %#v", got)
	}
}

func TestThrottleLiveBuckets(t *testing.T) {
	calc := NewDeltaCalculator([]int64{1000}, SessionResetUTCDay, 250000000)
	first := calc.UpdateTradeAt(testTrade("buy", 1, 1760000000123), 1000)
	second := calc.UpdateTradeAt(testTrade("buy", 1, 1760000000456), 1100)
	third := calc.UpdateTradeAt(testTrade("buy", 1, 1760000000789), 1300)

	if len(first) != 1 {
		t.Fatalf("first update should emit: %#v", first)
	}
	if len(second) != 0 {
		t.Fatalf("second update should be throttled: %#v", second)
	}
	if len(third) != 1 {
		t.Fatalf("third update should emit after throttle: %#v", third)
	}
}

func testTrade(side string, qty float64, ts int64) marketdata.Trade {
	return marketdata.Trade{
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: ts,
		TsLocal:    ts + 1,
		Qty:        qty,
		Side:       side,
		Price:      100000,
	}
}
