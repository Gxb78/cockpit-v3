package binance

import (
	"testing"

	"cockpit-v6-market-go/internal/marketdata"
)

// ---- DepthDiff parsing ----

func TestParseDepthDiff(t *testing.T) {
	// Spot/futures diff payload: U/u (and pu for futures), b/a sides.
	data := []byte(`{"e":"depthUpdate","E":1748390400123,"s":"BTCUSDT","U":100,"u":120,"pu":99,"b":[["71000.0","1.5"],["70999.0","0"]],"a":[["71001.0","0.5"]]}`)
	d, err := ParseDepthDiff(data)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if d.Symbol != "BTCUSDT" {
		t.Fatalf("bad symbol: %q", d.Symbol)
	}
	if d.FirstID != 100 || d.FinalID != 120 || d.PrevID != 99 {
		t.Fatalf("bad ids: U=%d u=%d pu=%d", d.FirstID, d.FinalID, d.PrevID)
	}
	if len(d.Bids) != 2 || len(d.Asks) != 1 {
		t.Fatalf("bad sides: bids=%d asks=%d", len(d.Bids), len(d.Asks))
	}
}

// ---- LocalBook snapshot + emit (full book, sorted) ----

func TestLocalBookSnapshotEmit(t *testing.T) {
	b := newLocalBook()
	b.loadSnapshot(50,
		[][]string{{"100.0", "2"}, {"99.0", "3"}, {"98.0", "1"}},
		[][]string{{"101.0", "1"}, {"102.0", "4"}, {"103.0", "2"}},
	)
	snap := b.snapshot("BTCUSDT", 1234)
	// Bids sorted descending, asks ascending.
	if snap.Bids[0].Price != 100.0 || snap.Bids[1].Price != 99.0 || snap.Bids[2].Price != 98.0 {
		t.Fatalf("bids not sorted desc: %+v", snap.Bids)
	}
	if snap.Asks[0].Price != 101.0 || snap.Asks[1].Price != 102.0 || snap.Asks[2].Price != 103.0 {
		t.Fatalf("asks not sorted asc: %+v", snap.Asks)
	}
	if snap.BestBid != 100.0 || snap.BestAsk != 101.0 {
		t.Fatalf("bad best bid/ask: %+v", snap)
	}
	if snap.Mid != 100.5 || snap.Spread != 1.0 {
		t.Fatalf("bad mid/spread: %+v", snap)
	}
	// Full book = all levels (no top-N truncation).
	if len(snap.Bids) != 3 || len(snap.Asks) != 3 {
		t.Fatalf("expected full book, got bids=%d asks=%d", len(snap.Bids), len(snap.Asks))
	}
	// Cumulative accumulates from best outward.
	if snap.Bids[2].Cumulative != 6 {
		t.Fatalf("bad bid cumulative: %v", snap.Bids[2].Cumulative)
	}
	if snap.Source != "book" {
		t.Fatalf("bad source: %q", snap.Source)
	}
}

func TestLocalBookApplyRemovesZeroQty(t *testing.T) {
	b := newLocalBook()
	b.loadSnapshot(10, [][]string{{"100.0", "2"}, {"99.0", "3"}}, [][]string{{"101.0", "1"}})
	// qty 0 removes the 99.0 level; updates 100.0.
	b.applyLevels(b.bids, [][]string{{"99.0", "0"}, {"100.0", "5"}})
	snap := b.snapshot("X", 1)
	if len(snap.Bids) != 1 || snap.Bids[0].Price != 100.0 || snap.Bids[0].Size != 5 {
		t.Fatalf("bad apply: %+v", snap.Bids)
	}
}

// ---- Sequence validation: SPOT ----

func TestMaintainerSpotHappyPath(t *testing.T) {
	var emitted int
	m := NewBookMaintainer(MarketSpot, "BTCUSDT", BookCallbacks{
		OnBook: func(_ marketdata.OrderBookSnapshot) { emitted++ },
	})
	// Buffer two diffs that arrive before the snapshot.
	m.HandleDiff(DepthDiff{FirstID: 11, FinalID: 12, Bids: [][]string{{"100", "1"}}})
	m.HandleDiff(DepthDiff{FirstID: 13, FinalID: 15, Asks: [][]string{{"101", "1"}}})
	// Snapshot lastUpdateId=10: first applied event must satisfy U<=11<=u.
	m.ApplySnapshot(10, [][]string{{"100", "9"}}, [][]string{{"101", "9"}})
	if !m.Synced() {
		t.Fatalf("expected synced after snapshot drain")
	}
	if m.LastID() != 15 {
		t.Fatalf("expected lastID=15, got %d", m.LastID())
	}
	// A continuous next event (U == prev_u+1 == 16).
	if !m.HandleDiff(DepthDiff{FirstID: 16, FinalID: 18, Bids: [][]string{{"99", "2"}}}) {
		t.Fatalf("expected continuous event to apply")
	}
	if m.LastID() != 18 {
		t.Fatalf("expected lastID=18, got %d", m.LastID())
	}
}

func TestMaintainerSpotDropsStale(t *testing.T) {
	m := NewBookMaintainer(MarketSpot, "X", BookCallbacks{})
	// u <= lastUpdateId(10) must be dropped during drain.
	m.HandleDiff(DepthDiff{FirstID: 5, FinalID: 9, Bids: [][]string{{"1", "1"}}})  // stale
	m.HandleDiff(DepthDiff{FirstID: 8, FinalID: 11, Bids: [][]string{{"2", "1"}}}) // first valid (U<=11<=u)
	m.ApplySnapshot(10, nil, nil)
	if m.LastID() != 11 {
		t.Fatalf("expected lastID=11 after dropping stale, got %d", m.LastID())
	}
}

func TestMaintainerSpotGapTriggersResync(t *testing.T) {
	var resyncs int
	m := NewBookMaintainer(MarketSpot, "X", BookCallbacks{
		OnResync: func() { resyncs++ },
	})
	m.ApplySnapshot(10, nil, nil)
	// First valid event after snapshot: U<=11<=u.
	m.HandleDiff(DepthDiff{FirstID: 11, FinalID: 12})
	// Gap: next U should be 13, but is 20 -> resync.
	applied := m.HandleDiff(DepthDiff{FirstID: 20, FinalID: 22})
	if applied {
		t.Fatalf("expected gap event to be rejected")
	}
	if resyncs != 1 {
		t.Fatalf("expected 1 resync, got %d", resyncs)
	}
	if m.Synced() {
		t.Fatalf("expected unsynced after gap")
	}
}

// ---- Sequence validation: FUTURES ----

func TestMaintainerFuturesUsesPrevID(t *testing.T) {
	m := NewBookMaintainer(MarketFutures, "BTCUSDT", BookCallbacks{})
	// Futures first-event rule: U <= lastId <= u.
	m.ApplySnapshot(100, [][]string{{"100", "1"}}, [][]string{{"101", "1"}})
	// First event: U<=100<=u.
	if !m.HandleDiff(DepthDiff{FirstID: 90, FinalID: 105, PrevID: 80, Bids: [][]string{{"100", "2"}}}) {
		t.Fatalf("expected first futures event to apply")
	}
	if m.LastID() != 105 {
		t.Fatalf("expected lastID=105, got %d", m.LastID())
	}
	// Continuity by pu == prev u (105).
	if !m.HandleDiff(DepthDiff{FirstID: 106, FinalID: 110, PrevID: 105, Asks: [][]string{{"101", "3"}}}) {
		t.Fatalf("expected pu-continuous event to apply")
	}
	// pu mismatch -> gap.
	if m.HandleDiff(DepthDiff{FirstID: 111, FinalID: 115, PrevID: 999}) {
		t.Fatalf("expected pu-mismatch to be rejected")
	}
	if m.Synced() {
		t.Fatalf("expected unsynced after pu gap")
	}
}

func TestMaintainerFuturesDropRule(t *testing.T) {
	m := NewBookMaintainer(MarketFutures, "X", BookCallbacks{})
	// Futures drop rule: u < lastUpdateId. u == lastUpdateId is the boundary first event.
	m.HandleDiff(DepthDiff{FirstID: 1, FinalID: 99, PrevID: 0})  // stale (u<100)
	m.HandleDiff(DepthDiff{FirstID: 50, FinalID: 100, PrevID: 1}) // first valid (U<=100<=u)
	m.ApplySnapshot(100, nil, nil)
	if m.LastID() != 100 {
		t.Fatalf("expected lastID=100, got %d", m.LastID())
	}
}
