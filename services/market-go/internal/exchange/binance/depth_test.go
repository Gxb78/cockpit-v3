package binance

import (
	"strings"
	"testing"
)

func TestParseDepthSnapshotJSON(t *testing.T) {
	data := []byte(`{"lastUpdateId":12345,"bids":[["100.0","2"],["99.0","3"]],"asks":[["101.0","1"]]}`)
	s, err := ParseDepthSnapshotJSON(data)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if s.LastUpdateID != 12345 {
		t.Fatalf("bad lastUpdateId: %d", s.LastUpdateID)
	}
	if len(s.Bids) != 2 || len(s.Asks) != 1 {
		t.Fatalf("bad sides: %+v", s)
	}
}

func TestParseDepthSnapshotMissingID(t *testing.T) {
	if _, err := ParseDepthSnapshotJSON([]byte(`{"bids":[],"asks":[]}`)); err == nil {
		t.Fatalf("expected error for missing lastUpdateId")
	}
}

func TestDepthSnapshotPath(t *testing.T) {
	spot := depthSnapshotPath(MarketSpot, "", "btcusdt", 9999)
	if !strings.Contains(spot, "/api/v3/depth?symbol=BTCUSDT&limit=5000") {
		t.Fatalf("bad spot path (limit should clamp to 5000): %s", spot)
	}
	fut := depthSnapshotPath(MarketFutures, "", "btcusdt", 9999)
	if !strings.Contains(fut, "/fapi/v1/depth?symbol=BTCUSDT&limit=1000") {
		t.Fatalf("bad futures path (limit should clamp to 1000): %s", fut)
	}
	if !strings.HasPrefix(fut, DefaultFuturesRESTURL) {
		t.Fatalf("futures should default to futures host: %s", fut)
	}
}
