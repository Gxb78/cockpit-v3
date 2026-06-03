package hyperliquid

import "testing"

func TestParseBookMessage(t *testing.T) {
	raw := []byte(`{"channel":"l2Book","data":{"coin":"BTC","levels":[[{"px":"73500","sz":"1.23","n":4}],[{"px":"73501","sz":"0.82","n":3}]],"time":1760000000000}}`)

	book, err := ParseBookMessage(raw)
	if err != nil {
		t.Fatalf("parse book: %v", err)
	}
	if book == nil {
		t.Fatalf("expected book")
	}
	if book.Coin != "BTC" || book.Levels[0][0].Px != "73500" || book.Levels[1][0].Sz != "0.82" || book.Time != 1760000000000 {
		t.Fatalf("unexpected book: %#v", book)
	}
}

func TestParseBookIgnoresOtherChannels(t *testing.T) {
	book, err := ParseBookMessage([]byte(`{"channel":"subscriptionResponse","data":{"method":"subscribe"}}`))
	if err != nil {
		t.Fatalf("parse non-book: %v", err)
	}
	if book != nil {
		t.Fatalf("expected nil book, got %#v", book)
	}
}

func TestNormalizeBook(t *testing.T) {
	snapshot, err := NormalizeBook(WsBook{
		Coin: "btc",
		Levels: [2][]WsLevel{
			{
				{Px: "73500", Sz: "1.23", N: 4},
				{Px: "73499", Sz: "2", N: 5},
			},
			{
				{Px: "73501", Sz: "0.82", N: 3},
				{Px: "73502", Sz: "1", N: 2},
			},
		},
		Time: 1760000000000,
	}, 1760000000001, 20)
	if err != nil {
		t.Fatalf("normalize book: %v", err)
	}
	if snapshot.Exchange != ExchangeName || snapshot.Symbol != "BTC" || snapshot.Source != BookSourceL2 {
		t.Fatalf("unexpected identifiers: %#v", snapshot)
	}
	if len(snapshot.Bids) != 2 || len(snapshot.Asks) != 2 {
		t.Fatalf("unexpected levels: %#v", snapshot)
	}
	if snapshot.Bids[0].Price != 73500 || snapshot.Bids[0].Size != 1.23 || snapshot.Bids[0].Orders != 4 {
		t.Fatalf("unexpected bid: %#v", snapshot.Bids[0])
	}
	if snapshot.BestBid != 73500 || snapshot.BestAsk != 73501 || snapshot.Spread != 1 || snapshot.Mid != 73500.5 {
		t.Fatalf("unexpected top of book: %#v", snapshot)
	}
	if snapshot.Depth != 2 {
		t.Fatalf("unexpected depth: %d", snapshot.Depth)
	}
}

func TestNormalizeBookAppliesDepth(t *testing.T) {
	snapshot, err := NormalizeBook(WsBook{
		Coin: "BTC",
		Levels: [2][]WsLevel{
			{{Px: "10", Sz: "1", N: 1}, {Px: "9", Sz: "1", N: 1}},
			{{Px: "11", Sz: "1", N: 1}, {Px: "12", Sz: "1", N: 1}},
		},
		Time: 1,
	}, 2, 1)
	if err != nil {
		t.Fatalf("normalize book: %v", err)
	}
	if len(snapshot.Bids) != 1 || len(snapshot.Asks) != 1 || snapshot.Depth != 1 {
		t.Fatalf("depth not applied: %#v", snapshot)
	}
}

func TestNormalizeBookHandlesEmptySides(t *testing.T) {
	snapshot, err := NormalizeBook(WsBook{
		Coin:   "BTC",
		Levels: [2][]WsLevel{nil, nil},
		Time:   1,
	}, 2, 20)
	if err != nil {
		t.Fatalf("normalize empty book: %v", err)
	}
	if len(snapshot.Bids) != 0 || len(snapshot.Asks) != 0 || snapshot.BestBid != 0 || snapshot.BestAsk != 0 {
		t.Fatalf("unexpected empty snapshot: %#v", snapshot)
	}
}

func TestNormalizeBookSkipsInvalidLevels(t *testing.T) {
	snapshot, err := NormalizeBook(WsBook{
		Coin: "BTC",
		Levels: [2][]WsLevel{
			{{Px: "bad", Sz: "1", N: 1}, {Px: "10", Sz: "2", N: 2}},
			{{Px: "11", Sz: "bad", N: 1}, {Px: "12", Sz: "3", N: 2}},
		},
		Time: 1,
	}, 2, 20)
	if err != nil {
		t.Fatalf("normalize with invalid levels: %v", err)
	}
	if len(snapshot.Bids) != 1 || snapshot.Bids[0].Price != 10 {
		t.Fatalf("invalid bid handling failed: %#v", snapshot.Bids)
	}
	if len(snapshot.Asks) != 1 || snapshot.Asks[0].Price != 12 {
		t.Fatalf("invalid ask handling failed: %#v", snapshot.Asks)
	}
}
