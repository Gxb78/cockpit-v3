package calc

import (
	"math"
	"testing"
	"time"

	"cockpit-v6-market-go/internal/marketdata"
)

func TestVWAPFirstTradeInitializesCoverageStart(t *testing.T) {
	calc := NewVWAPCalculator(true, SessionResetUTCDay, 0)
	state, emitted := calc.UpdateTradeAt(vwapTrade("buy", 100, 2, ts("2026-05-29T12:00:00Z")), 1)
	if !emitted {
		t.Fatalf("expected first vwap update")
	}
	if state.CoverageStart != ts("2026-05-29T12:00:00Z") {
		t.Fatalf("unexpected coverage start: %d", state.CoverageStart)
	}
	if state.SessionStart != ts("2026-05-29T00:00:00Z") {
		t.Fatalf("unexpected session start: %d", state.SessionStart)
	}
	if state.Source != VWAPSourceLive || state.IsWarm {
		t.Fatalf("unexpected live-only flags: source=%s isWarm=%t", state.Source, state.IsWarm)
	}
}

func TestVWAPSideDoesNotAffectCalculation(t *testing.T) {
	buyCalc := NewVWAPCalculator(true, SessionResetUTCDay, 0)
	sellCalc := NewVWAPCalculator(true, SessionResetUTCDay, 0)

	buyState, _ := buyCalc.UpdateTradeAt(vwapTrade("buy", 100, 2, ts("2026-05-29T12:00:00Z")), 1)
	sellState, _ := sellCalc.UpdateTradeAt(vwapTrade("sell", 100, 2, ts("2026-05-29T12:00:00Z")), 1)

	if buyState.Value != sellState.Value || buyState.CumPV != sellState.CumPV || buyState.CumVol != sellState.CumVol {
		t.Fatalf("side should not affect vwap: buy=%#v sell=%#v", buyState, sellState)
	}
}

func TestVWAPCumPVVolValueAcrossTrades(t *testing.T) {
	calc := NewVWAPCalculator(true, SessionResetUTCDay, 0)
	calc.UpdateTradeAt(vwapTrade("buy", 100, 2, ts("2026-05-29T12:00:00Z")), 1)
	state, _ := calc.UpdateTradeAt(vwapTrade("sell", 110, 3, ts("2026-05-29T12:00:01Z")), 2)

	if state.CumPV != 530 {
		t.Fatalf("unexpected cumPV: %f", state.CumPV)
	}
	if state.CumVol != 5 {
		t.Fatalf("unexpected cumVol: %f", state.CumVol)
	}
	if state.Value != 106 {
		t.Fatalf("unexpected value: %f", state.Value)
	}
}

func TestVWAPInvalidQtyDoesNotPanicOrEmit(t *testing.T) {
	calc := NewVWAPCalculator(true, SessionResetUTCDay, 0)
	badTrades := []marketdata.Trade{
		vwapTrade("buy", 100, 0, ts("2026-05-29T12:00:00Z")),
		vwapTrade("buy", 100, -1, ts("2026-05-29T12:00:00Z")),
		vwapTrade("buy", 100, math.NaN(), ts("2026-05-29T12:00:00Z")),
	}
	for _, trade := range badTrades {
		if _, emitted := calc.UpdateTradeAt(trade, 1); emitted {
			t.Fatalf("invalid trade should not emit: %#v", trade)
		}
	}
	if got := calc.Snapshot().VWAPBySymbol["BTC"]; got != 0 {
		t.Fatalf("invalid trades should not update vwap, got %f", got)
	}
}

func TestVWAPCumVolZeroDoesNotProduceNaN(t *testing.T) {
	calc := NewVWAPCalculator(true, SessionResetUTCDay, 0)
	calc.UpdateTradeAt(vwapTrade("buy", 100, 0, ts("2026-05-29T12:00:00Z")), 1)

	got := calc.Snapshot().VWAPBySymbol["BTC"]
	if math.IsNaN(got) {
		t.Fatalf("vwap should not be NaN")
	}
}

func TestVWAPUTCDayResetClearsState(t *testing.T) {
	calc := NewVWAPCalculator(true, SessionResetUTCDay, 0)
	calc.UpdateTradeAt(vwapTrade("buy", 100, 2, ts("2026-05-29T23:59:59Z")), 1)
	state, _ := calc.UpdateTradeAt(vwapTrade("buy", 120, 1, ts("2026-05-30T00:00:01Z")), 2)

	if state.SessionID != "utc_day:2026-05-30" {
		t.Fatalf("unexpected session id: %s", state.SessionID)
	}
	if state.CumPV != 120 || state.CumVol != 1 || state.Value != 120 {
		t.Fatalf("state should reset on new day: %#v", state)
	}
}

func TestVWAPCoverageStartChangesAfterSessionReset(t *testing.T) {
	calc := NewVWAPCalculator(true, SessionResetUTCDay, 0)
	first := ts("2026-05-29T23:59:59Z")
	second := ts("2026-05-30T00:00:01Z")
	calc.UpdateTradeAt(vwapTrade("buy", 100, 2, first), 1)
	state, _ := calc.UpdateTradeAt(vwapTrade("buy", 120, 1, second), 2)

	if state.CoverageStart != second {
		t.Fatalf("coverageStart should reset to first observed trade in new session: %d", state.CoverageStart)
	}
}

func TestVWAPThrottleDoesNotBlockInternalUpdate(t *testing.T) {
	calc := NewVWAPCalculator(true, SessionResetUTCDay, 250*time.Millisecond)
	if _, emitted := calc.UpdateTradeAt(vwapTrade("buy", 100, 1, ts("2026-05-29T12:00:00Z")), 1000); !emitted {
		t.Fatalf("first update should emit")
	}
	if _, emitted := calc.UpdateTradeAt(vwapTrade("buy", 200, 1, ts("2026-05-29T12:00:01Z")), 1100); emitted {
		t.Fatalf("second update should be throttled")
	}

	got := calc.Snapshot().VWAPBySymbol["BTC"]
	if got != 150 {
		t.Fatalf("state should still update behind throttle, got %f", got)
	}
}

func TestVWAPIsWarmFalseByDefaultLiveOnly(t *testing.T) {
	calc := NewVWAPCalculator(true, SessionResetUTCDay, 0)
	state, _ := calc.UpdateTradeAt(vwapTrade("buy", 100, 1, ts("2026-05-29T12:00:00Z")), 1)
	if state.IsWarm {
		t.Fatalf("live-only vwap should not be warm without backfill")
	}
}

func TestVWAPDisabledDoesNotEmit(t *testing.T) {
	calc := NewVWAPCalculator(false, SessionResetUTCDay, 0)
	if _, emitted := calc.UpdateTradeAt(vwapTrade("buy", 100, 1, ts("2026-05-29T12:00:00Z")), 1); emitted {
		t.Fatalf("disabled vwap should not emit")
	}
}

func vwapTrade(side string, price float64, qty float64, tsMillis int64) marketdata.Trade {
	return marketdata.Trade{
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: tsMillis,
		TsLocal:    tsMillis + 1,
		Price:      price,
		Qty:        qty,
		Side:       side,
	}
}

func ts(value string) int64 {
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return t.UnixMilli()
}
