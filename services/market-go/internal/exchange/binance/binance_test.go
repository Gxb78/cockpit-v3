package binance

import "testing"

func TestNormalizeAggTrade(t *testing.T) {
	// isBuyerMaker=false -> aggressor buyer -> buy
	data := []byte(`{"e":"aggTrade","s":"BTCUSDT","p":"71000.5","q":"0.250","T":1748390400236,"m":false,"a":123}`)
	tr, err := NormalizeAggTrade(data, 999)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if tr.Symbol != "BTCUSDT" || tr.Exchange != "binance" {
		t.Fatalf("bad sym/exch: %+v", tr)
	}
	if tr.Price != 71000.5 || tr.Qty != 0.25 {
		t.Fatalf("bad px/qty: %+v", tr)
	}
	if tr.Side != "buy" {
		t.Fatalf("expected buy, got %s", tr.Side)
	}
	if tr.TsExchange != 1748390400236 || tr.TsLocal != 999 {
		t.Fatalf("bad ts: %+v", tr)
	}
	if tr.Notional <= 0 {
		t.Fatalf("bad notional: %+v", tr)
	}

	// isBuyerMaker=true -> sell
	sell, _ := NormalizeAggTrade([]byte(`{"s":"BTCUSDT","p":"1","q":"1","T":1,"m":true,"a":1}`), 1)
	if sell.Side != "sell" {
		t.Fatalf("expected sell, got %s", sell.Side)
	}
}

func TestNormalizeDepth(t *testing.T) {
	data := []byte(`{"e":"depthUpdate","E":1748390400000,"s":"BTCUSDT","bids":[["71000.0","1.5"],["70999.0","2.0"]],"asks":[["71001.0","0.5"],["71002.0","3.0"]]}`)
	snap, err := NormalizeDepth(data, "BTCUSDT", 5, 20)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if snap.BestBid != 71000.0 || snap.BestAsk != 71001.0 {
		t.Fatalf("bad best bid/ask: %+v", snap)
	}
	if snap.Spread != 1.0 || snap.Mid != 71000.5 {
		t.Fatalf("bad spread/mid: %+v", snap)
	}
	if len(snap.Bids) != 2 || len(snap.Asks) != 2 {
		t.Fatalf("bad depth: %+v", snap)
	}
	if snap.Bids[1].Cumulative != 3.5 {
		t.Fatalf("bad cumulative: %v", snap.Bids[1].Cumulative)
	}
}

func TestParseCombined(t *testing.T) {
	stream, data, err := ParseCombined([]byte(`{"stream":"btcusdt@aggTrade","data":{"p":"1"}}`))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if stream != "btcusdt@aggTrade" || string(data) != `{"p":"1"}` {
		t.Fatalf("bad parse: %s / %s", stream, data)
	}
}

func TestParseKlinesJSON(t *testing.T) {
	data := []byte(`[[1748390400000,"71000.0","71050.0","70990.0","71010.0","12.5",1748390459999,"888000.0",100,"6.0","426000.0","0"]]`)
	candles, err := ParseKlinesJSON(data, "BTCUSDT", "1m")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(candles) != 1 {
		t.Fatalf("expected 1 candle, got %d", len(candles))
	}
	c := candles[0]
	if c.OpenTime != 1748390400000 || c.CloseTime != 1748390459999 {
		t.Fatalf("bad times: %+v", c)
	}
	if c.Open != 71000 || c.High != 71050 || c.Low != 70990 || c.Close != 71010 || c.Volume != 12.5 {
		t.Fatalf("bad OHLCV: %+v", c)
	}
	if c.Symbol != "BTCUSDT" || c.Timeframe != "1m" {
		t.Fatalf("bad sym/tf: %+v", c)
	}
}
