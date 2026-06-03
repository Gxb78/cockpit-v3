package calc

import (
	"testing"

	"cockpit-v6-market-go/internal/marketdata"
)

func TestBuildHeatmapFrameFromOrderBook(t *testing.T) {
	book := sampleBook()
	frame := BuildHeatmapFrame(book, HeatmapConfig{Depth: 20, TickSize: 1, MaxLevels: 100})

	if frame.Exchange != "hyperliquid" || frame.Symbol != "BTC" {
		t.Fatalf("unexpected identity: %#v", frame)
	}
	if frame.BestBid != 73500 || frame.BestAsk != 73501 || frame.Mid != 73500.5 {
		t.Fatalf("unexpected top of book: %#v", frame)
	}
	if frame.PriceMin != 73500 || frame.PriceMax != 73502 {
		t.Fatalf("unexpected price range: min=%f max=%f", frame.PriceMin, frame.PriceMax)
	}
	if len(frame.Levels) != 3 {
		t.Fatalf("expected 3 levels, got %d", len(frame.Levels))
	}
}

func TestBuildHeatmapFrameMergesBidAskByPrice(t *testing.T) {
	book := sampleBook()
	book.Asks = append(book.Asks, marketdata.OrderBookLevel{Price: 73500, Size: 0.25})

	frame := BuildHeatmapFrame(book, HeatmapConfig{Depth: 20, TickSize: 1, MaxLevels: 100})
	level := findHeatmapLevel(t, frame, 73500)

	if level.BidSize != 1.25 {
		t.Fatalf("unexpected bid size: %f", level.BidSize)
	}
	if level.AskSize != 0.25 {
		t.Fatalf("unexpected ask size: %f", level.AskSize)
	}
	if level.TotalSize != 1.5 {
		t.Fatalf("unexpected total size: %f", level.TotalSize)
	}
}

func TestBuildHeatmapFrameIntensityClamped(t *testing.T) {
	frame := BuildHeatmapFrame(sampleBook(), HeatmapConfig{Depth: 20, TickSize: 1, MaxLevels: 100})
	for _, level := range frame.Levels {
		if level.Intensity < 0 || level.Intensity > 1 {
			t.Fatalf("intensity out of range: %#v", level)
		}
	}
	if got := findHeatmapLevel(t, frame, 73502).Intensity; got != 1 {
		t.Fatalf("largest visible level should have intensity 1, got %f", got)
	}
}

func TestBuildHeatmapFrameAppliesDepthAndMaxLevels(t *testing.T) {
	book := marketdata.OrderBookSnapshot{Exchange: "hyperliquid", Symbol: "BTC", Source: "l2Book"}
	for i := 0; i < 10; i++ {
		book.Bids = append(book.Bids, marketdata.OrderBookLevel{Price: 73500 - float64(i), Size: 1})
		book.Asks = append(book.Asks, marketdata.OrderBookLevel{Price: 73501 + float64(i), Size: 1})
	}

	frame := BuildHeatmapFrame(book, HeatmapConfig{Depth: 3, TickSize: 1, MaxLevels: 4})
	if len(frame.Levels) != 4 {
		t.Fatalf("expected max levels to cap output at 4, got %d", len(frame.Levels))
	}
}

func TestBuildHeatmapFrameEmptyBookDoesNotPanic(t *testing.T) {
	frame := BuildHeatmapFrame(marketdata.OrderBookSnapshot{Exchange: "hyperliquid", Symbol: "BTC"}, HeatmapConfig{})
	if len(frame.Levels) != 0 {
		t.Fatalf("expected empty levels, got %#v", frame.Levels)
	}
	if frame.PriceMin != 0 || frame.PriceMax != 0 {
		t.Fatalf("empty frame should have zero price range: %#v", frame)
	}
}

func TestBuildHeatmapFrameBidOnly(t *testing.T) {
	book := sampleBook()
	book.Asks = nil

	frame := BuildHeatmapFrame(book, HeatmapConfig{Depth: 20, TickSize: 1, MaxLevels: 100})
	level := findHeatmapLevel(t, frame, 73500)
	if level.BidSize <= 0 || level.AskSize != 0 {
		t.Fatalf("unexpected bid-only level: %#v", level)
	}
}

func TestBuildHeatmapFrameAskOnly(t *testing.T) {
	book := sampleBook()
	book.Bids = nil

	frame := BuildHeatmapFrame(book, HeatmapConfig{Depth: 20, TickSize: 1, MaxLevels: 100})
	level := findHeatmapLevel(t, frame, 73501)
	if level.AskSize <= 0 || level.BidSize != 0 {
		t.Fatalf("unexpected ask-only level: %#v", level)
	}
}

func TestBuildHeatmapFrameInvalidTickSizeFallsBack(t *testing.T) {
	frame := BuildHeatmapFrame(sampleBook(), HeatmapConfig{Depth: 20, TickSize: -2, MaxLevels: 100})
	if frame.TickSize != DefaultHeatmapTickSize {
		t.Fatalf("unexpected fallback tick size: %f", frame.TickSize)
	}
}

func sampleBook() marketdata.OrderBookSnapshot {
	return marketdata.OrderBookSnapshot{
		Exchange:   "hyperliquid",
		Symbol:     "BTC",
		TsExchange: 1760000000000,
		TsLocal:    1760000000001,
		Bids: []marketdata.OrderBookLevel{
			{Price: 73500, Size: 1.25},
		},
		Asks: []marketdata.OrderBookLevel{
			{Price: 73501, Size: 0.75},
			{Price: 73502, Size: 2.5},
		},
		BestBid: 73500,
		BestAsk: 73501,
		Spread:  1,
		Mid:     73500.5,
		Depth:   2,
		Source:  "l2Book",
	}
}

func findHeatmapLevel(t *testing.T, frame marketdata.HeatmapFrame, price float64) marketdata.HeatmapLevel {
	t.Helper()
	for _, level := range frame.Levels {
		if level.Price == price {
			return level
		}
	}
	t.Fatalf("missing heatmap level: %f in %#v", price, frame.Levels)
	return marketdata.HeatmapLevel{}
}
