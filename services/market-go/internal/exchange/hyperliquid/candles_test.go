package hyperliquid

import "testing"

func TestParseCandlesJSON(t *testing.T) {
	data := []byte(`[
		{"t":1681923600000,"T":1681923659999,"s":"BTC","i":"1m","o":"30000.0","c":"30010.0","h":"30020.0","l":"29990.0","v":"12.34","n":120},
		{"t":1681923660000,"T":1681923719999,"s":"BTC","i":"1m","o":"30010.0","c":"30005.0","h":"30015.0","l":"30000.0","v":"8.0","n":80}
	]`)

	candles, err := ParseCandlesJSON(data, "BTC", "1m")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(candles) != 2 {
		t.Fatalf("expected 2 candles, got %d", len(candles))
	}
	c := candles[0]
	if c.Symbol != "BTC" || c.Timeframe != "1m" {
		t.Fatalf("unexpected symbol/timeframe: %+v", c)
	}
	if c.OpenTime != 1681923600000 || c.CloseTime != 1681923659999 {
		t.Fatalf("unexpected times: %+v", c)
	}
	if c.Open != 30000 || c.High != 30020 || c.Low != 29990 || c.Close != 30010 || c.Volume != 12.34 {
		t.Fatalf("unexpected OHLCV: %+v", c)
	}
}

func TestParseCandlesJSONSkipsInvalid(t *testing.T) {
	data := []byte(`[
		{"t":0,"o":"1","c":"1","h":"1","l":"1","v":"1"},
		{"t":1681923600000,"o":"0","c":"1","h":"1","l":"1","v":"1"},
		{"t":1681923660000,"o":"30010.0","c":"30005.0","h":"30015.0","l":"30000.0","v":"8.0"}
	]`)
	candles, err := ParseCandlesJSON(data, "BTC", "1m")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(candles) != 1 {
		t.Fatalf("expected 1 valid candle, got %d", len(candles))
	}
}
