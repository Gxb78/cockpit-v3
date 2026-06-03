package replay

import (
	"strings"
	"testing"
)

func TestParseAggTradesCSV(t *testing.T) {
	// Real Binance aggTrades format (µs timestamps), no header.
	csv := strings.Join([]string{
		"3583051592,108938.17000000,0.00149000,4960877671,4960877671,1748390400236231,False,True",
		"3583051593,108938.10000000,0.01000000,4960877672,4960877672,1748390400576499,True,True",
		"",
		"badrow,x,y",
	}, "\n")

	trades, err := ParseAggTradesCSV(strings.NewReader(csv), "btcusdt")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(trades) != 2 {
		t.Fatalf("expected 2 trades, got %d", len(trades))
	}

	a := trades[0]
	if a.Symbol != "BTCUSDT" || a.Exchange != "binance" {
		t.Fatalf("unexpected symbol/exchange: %+v", a)
	}
	if a.Price != 108938.17 || a.Qty != 0.00149 {
		t.Fatalf("unexpected price/qty: %+v", a)
	}
	// isBuyerMaker=False -> aggressor buyer -> buy
	if a.Side != "buy" {
		t.Fatalf("expected buy, got %s", a.Side)
	}
	// µs -> ms
	if a.TsExchange != 1748390400236 {
		t.Fatalf("expected ts 1748390400236, got %d", a.TsExchange)
	}
	if a.Notional <= 0 {
		t.Fatalf("expected positive notional, got %f", a.Notional)
	}

	b := trades[1]
	// isBuyerMaker=True -> aggressor seller -> sell
	if b.Side != "sell" {
		t.Fatalf("expected sell, got %s", b.Side)
	}
}

func TestBinanceURL(t *testing.T) {
	s := NewBinanceSource()
	got := s.url("btcusdt", "2025-05-28")
	want := "https://data.binance.vision/data/spot/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2025-05-28.zip"
	if got != want {
		t.Fatalf("url mismatch:\n got=%s\nwant=%s", got, want)
	}
}

func TestNormalizeTsMillis(t *testing.T) {
	cases := map[int64]int64{
		1748390400236:       1748390400236, // ms stays
		1748390400236231:    1748390400236, // µs -> ms
		1748390400236231000: 1748390400236, // ns -> ms
	}
	for in, want := range cases {
		if got := normalizeTsMillis(in); got != want {
			t.Fatalf("normalizeTsMillis(%d)=%d want %d", in, got, want)
		}
	}
}
