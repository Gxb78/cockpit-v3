package calc

import (
	"testing"
	"time"

	"cockpit-v6-market-go/internal/marketdata"
)

func TestFootprintFirstTradeCreatesCandle(t *testing.T) {
	calc := NewFootprintCalculator(FootprintConfig{Enabled: true, IntervalMs: 60000, TickSize: 1, EmitEvery: 0, MaxLevels: 200})

	out := calc.UpdateTradeAt(fpTrade(1760000000123, 73500, 1, "buy"), 1)
	if len(out) != 1 {
		t.Fatalf("expected one live candle, got %d", len(out))
	}
	candle := out[0]
	if candle.Exchange != "hyperliquid" || candle.Symbol != "BTC" || candle.IntervalMs != 60000 {
		t.Fatalf("unexpected identity: %#v", candle)
	}
	if candle.OpenTime != 1759999980000 || candle.CloseTime != 1760000040000 {
		t.Fatalf("unexpected candle time: %#v", candle)
	}
	if candle.Open != 73500 || candle.High != 73500 || candle.Low != 73500 || candle.Close != 73500 {
		t.Fatalf("unexpected ohlc: %#v", candle)
	}
	if candle.Volume != 1 || candle.BuyVol != 1 || candle.SellVol != 0 || candle.Delta != 1 {
		t.Fatalf("unexpected volume: %#v", candle)
	}
	if candle.POC != 73500 || len(candle.Levels) != 1 || candle.Levels[0].Trades != 1 {
		t.Fatalf("unexpected levels: %#v", candle)
	}
	if candle.Closed {
		t.Fatalf("first live candle should not be closed")
	}
}

func TestFootprintOHLCUpdatesAcrossTrades(t *testing.T) {
	calc := NewFootprintCalculator(FootprintConfig{Enabled: true, IntervalMs: 60000, TickSize: 1, EmitEvery: 0, MaxLevels: 200})

	_ = calc.UpdateTradeAt(fpTrade(1760000000000, 73500, 1, "buy"), 1)
	_ = calc.UpdateTradeAt(fpTrade(1760000001000, 73520, 2, "sell"), 2)
	out := calc.UpdateTradeAt(fpTrade(1760000002000, 73490, 3, "buy"), 3)

	candle := out[len(out)-1]
	if candle.Open != 73500 || candle.High != 73520 || candle.Low != 73490 || candle.Close != 73490 {
		t.Fatalf("unexpected ohlc: %#v", candle)
	}
	if candle.Volume != 6 {
		t.Fatalf("unexpected volume: %f", candle.Volume)
	}
}

func TestFootprintBuySellDelta(t *testing.T) {
	calc := NewFootprintCalculator(FootprintConfig{Enabled: true, IntervalMs: 60000, TickSize: 1, EmitEvery: 0, MaxLevels: 200})

	_ = calc.UpdateTradeAt(fpTrade(1760000000000, 73500, 3, "buy"), 1)
	out := calc.UpdateTradeAt(fpTrade(1760000001000, 73500, 1.25, "sell"), 2)

	candle := out[len(out)-1]
	if candle.BuyVol != 3 || candle.SellVol != 1.25 || candle.Delta != 1.75 {
		t.Fatalf("unexpected candle delta: %#v", candle)
	}
	if len(candle.Levels) != 1 || candle.Levels[0].BuyVol != 3 || candle.Levels[0].SellVol != 1.25 || candle.Levels[0].Delta != 1.75 {
		t.Fatalf("unexpected level delta: %#v", candle.Levels)
	}
}

func TestFootprintGroupsByTickSize(t *testing.T) {
	calc := NewFootprintCalculator(FootprintConfig{Enabled: true, IntervalMs: 60000, TickSize: 5, EmitEvery: 0, MaxLevels: 200})

	_ = calc.UpdateTradeAt(fpTrade(1760000000000, 73501, 1, "buy"), 1)
	out := calc.UpdateTradeAt(fpTrade(1760000001000, 73502, 2, "sell"), 2)

	candle := out[len(out)-1]
	if len(candle.Levels) != 1 {
		t.Fatalf("expected one grouped level, got %#v", candle.Levels)
	}
	if candle.Levels[0].Price != 73500 || candle.Levels[0].TotalVol != 3 || candle.Levels[0].Trades != 2 {
		t.Fatalf("unexpected grouped level: %#v", candle.Levels[0])
	}
}

func TestFootprintPOCUsesLargestTotalVolume(t *testing.T) {
	calc := NewFootprintCalculator(FootprintConfig{Enabled: true, IntervalMs: 60000, TickSize: 1, EmitEvery: 0, MaxLevels: 200})

	_ = calc.UpdateTradeAt(fpTrade(1760000000000, 73500, 1, "buy"), 1)
	_ = calc.UpdateTradeAt(fpTrade(1760000001000, 73501, 4, "sell"), 2)
	out := calc.UpdateTradeAt(fpTrade(1760000002000, 73502, 2, "buy"), 3)

	if got := out[len(out)-1].POC; got != 73501 {
		t.Fatalf("unexpected poc: %f", got)
	}
}

func TestFootprintIntervalChangeClosesPreviousCandle(t *testing.T) {
	calc := NewFootprintCalculator(FootprintConfig{Enabled: true, IntervalMs: 1000, TickSize: 1, EmitEvery: 0, MaxLevels: 200})

	_ = calc.UpdateTradeAt(fpTrade(1760000000100, 73500, 1, "buy"), 1)
	out := calc.UpdateTradeAt(fpTrade(1760000001100, 73501, 2, "sell"), 2)

	if len(out) != 2 {
		t.Fatalf("expected closed previous and live current, got %d", len(out))
	}
	if !out[0].Closed {
		t.Fatalf("previous candle should be closed: %#v", out[0])
	}
	if out[1].Closed {
		t.Fatalf("new current candle should be live: %#v", out[1])
	}
	if out[0].Close != 73500 || out[1].Open != 73501 {
		t.Fatalf("unexpected candle handoff: %#v", out)
	}
}

func TestFootprintInvalidTickSizeFallsBack(t *testing.T) {
	calc := NewFootprintCalculator(FootprintConfig{Enabled: true, IntervalMs: 60000, TickSize: -1, EmitEvery: 0, MaxLevels: 200})

	out := calc.UpdateTradeAt(fpTrade(1760000000000, 73500.4, 1, "buy"), 1)
	if got := out[0].Levels[0].Price; got != 73500 {
		t.Fatalf("expected tick size fallback to 1, got %f", got)
	}
	if calc.TickSize() != 1 {
		t.Fatalf("unexpected calculator tick size: %f", calc.TickSize())
	}
}

func TestFootprintIgnoresUnknownSide(t *testing.T) {
	calc := NewFootprintCalculator(FootprintConfig{Enabled: true, IntervalMs: 60000, TickSize: 1, EmitEvery: 0, MaxLevels: 200})

	if out := calc.UpdateTradeAt(fpTrade(1760000000000, 73500, 1, "hold"), 1); len(out) != 0 {
		t.Fatalf("unknown side should be ignored, got %#v", out)
	}
}

func TestFootprintIgnoresZeroOrNegativeQty(t *testing.T) {
	calc := NewFootprintCalculator(FootprintConfig{Enabled: true, IntervalMs: 60000, TickSize: 1, EmitEvery: 0, MaxLevels: 200})

	if out := calc.UpdateTradeAt(fpTrade(1760000000000, 73500, 0, "buy"), 1); len(out) != 0 {
		t.Fatalf("zero qty should be ignored, got %#v", out)
	}
	if out := calc.UpdateTradeAt(fpTrade(1760000000000, 73500, -1, "sell"), 1); len(out) != 0 {
		t.Fatalf("negative qty should be ignored, got %#v", out)
	}
}

func TestFootprintMaxLevelsApplied(t *testing.T) {
	calc := NewFootprintCalculator(FootprintConfig{Enabled: true, IntervalMs: 60000, TickSize: 1, EmitEvery: 0, MaxLevels: 2})

	_ = calc.UpdateTradeAt(fpTrade(1760000000000, 73502, 1, "buy"), 1)
	_ = calc.UpdateTradeAt(fpTrade(1760000001000, 73500, 2, "buy"), 2)
	out := calc.UpdateTradeAt(fpTrade(1760000002000, 73501, 3, "buy"), 3)

	candle := out[len(out)-1]
	if len(candle.Levels) != 2 {
		t.Fatalf("expected max two levels, got %#v", candle.Levels)
	}
	if candle.Levels[0].Price != 73500 || candle.Levels[1].Price != 73501 {
		t.Fatalf("expected sorted price-limited levels, got %#v", candle.Levels)
	}
	if candle.POC != 73501 {
		t.Fatalf("poc should be computed before max-level truncation, got %f", candle.POC)
	}
}

func TestFootprintThrottleDoesNotBlockInternalUpdates(t *testing.T) {
	calc := NewFootprintCalculator(FootprintConfig{Enabled: true, IntervalMs: 60000, TickSize: 1, EmitEvery: time.Second, MaxLevels: 200})

	first := calc.UpdateTradeAt(fpTrade(1760000000000, 73500, 1, "buy"), 1000)
	if len(first) != 1 {
		t.Fatalf("expected first emit, got %d", len(first))
	}
	second := calc.UpdateTradeAt(fpTrade(1760000001000, 73501, 2, "buy"), 1100)
	if len(second) != 0 {
		t.Fatalf("expected throttled live update, got %#v", second)
	}
	third := calc.UpdateTradeAt(fpTrade(1760000002000, 73502, 3, "buy"), 2000)
	if len(third) != 1 {
		t.Fatalf("expected emit after throttle, got %#v", third)
	}
	if third[0].Volume != 6 || third[0].Close != 73502 {
		t.Fatalf("throttle should not block internal updates: %#v", third[0])
	}
}

func fpTrade(ts int64, price float64, qty float64, side string) marketdata.Trade {
	return marketdata.Trade{
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: ts,
		TsLocal:    ts + 1,
		Price:      price,
		Qty:        qty,
		Side:       side,
		Notional:   price * qty,
	}
}
