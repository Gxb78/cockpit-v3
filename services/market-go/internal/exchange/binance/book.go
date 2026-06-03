package binance

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"sync"

	"cockpit-v6-market-go/internal/marketdata"
	"cockpit-v6-market-go/pkg/protocol"
)

// Market selects the Binance venue. The two venues differ in REST/WS hosts and,
// crucially, in the local-order-book sequencing rules (see BookMaintainer).
type Market int

const (
	MarketSpot Market = iota
	MarketFutures
)

func (m Market) String() string {
	if m == MarketFutures {
		return "futures"
	}
	return "spot"
}

// ParseMarket maps a config string to a Market (defaults to spot).
func ParseMarket(raw string) Market {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "futures", "fut", "perp", "perpetual", "usdm", "usd-m":
		return MarketFutures
	default:
		return MarketSpot
	}
}

// DepthDiff is one diff-depth event from <symbol>@depth@100ms.
//
//	U  = first update id in the event
//	u  = final update id in the event
//	pu = final update id of the PREVIOUS event (futures only; absent on spot)
//	b  = bid levels [[price, qty], ...]   (absolute qty; "0" removes the level)
//	a  = ask levels
//
// NOTE: we deliberately do NOT decode the event time "E": Go's encoding/json is
// case-insensitive, so an "E" field would also capture the "e":"depthUpdate"
// event-type string and fail to unmarshal. TsLocal is used downstream instead.
// (U/u are safe because both have exact-case tags, so each resolves to its own
// field.)
type DepthDiff struct {
	Symbol  string
	FirstID int64
	FinalID int64
	PrevID  int64
	Bids    [][]string
	Asks    [][]string
}

type wsDepthDiff struct {
	Symbol  string     `json:"s"`
	FirstID int64      `json:"U"`
	FinalID int64      `json:"u"`
	PrevID  int64      `json:"pu"`
	Bids    [][]string `json:"b"`
	Asks    [][]string `json:"a"`
}

// ParseDepthDiff decodes a diff-depth event payload.
func ParseDepthDiff(data []byte) (DepthDiff, error) {
	var w wsDepthDiff
	if err := json.Unmarshal(data, &w); err != nil {
		return DepthDiff{}, err
	}
	return DepthDiff{
		Symbol:  strings.ToUpper(strings.TrimSpace(w.Symbol)),
		FirstID: w.FirstID,
		FinalID: w.FinalID,
		PrevID:  w.PrevID,
		Bids:    w.Bids,
		Asks:    w.Asks,
	}, nil
}

// LocalBook is a full L2 book kept as price->qty maps. Prices are kept as their
// canonical Binance strings so that add/update/remove match exactly regardless
// of float formatting; they are parsed to float64 only when emitting a snapshot.
type LocalBook struct {
	bids   map[string]float64
	asks   map[string]float64
	lastID int64
}

func newLocalBook() *LocalBook {
	return &LocalBook{
		bids: make(map[string]float64),
		asks: make(map[string]float64),
	}
}

// loadSnapshot replaces the book with a REST snapshot.
func (b *LocalBook) loadSnapshot(lastID int64, bids, asks [][]string) {
	b.bids = make(map[string]float64, len(bids))
	b.asks = make(map[string]float64, len(asks))
	b.applyLevels(b.bids, bids)
	b.applyLevels(b.asks, asks)
	b.lastID = lastID
}

// applyLevels applies absolute-quantity updates to one side. qty<=0 removes the
// level (per Binance semantics); a removal of a missing level is a no-op.
func (b *LocalBook) applyLevels(side map[string]float64, levels [][]string) {
	for _, lvl := range levels {
		if len(lvl) < 2 {
			continue
		}
		priceKey := strings.TrimSpace(lvl[0])
		if priceKey == "" {
			continue
		}
		qty, err := strconv.ParseFloat(strings.TrimSpace(lvl[1]), 64)
		if err != nil {
			continue
		}
		if qty <= 0 {
			delete(side, priceKey)
			continue
		}
		side[priceKey] = qty
	}
}

// apply applies a validated diff to the book and advances lastID.
func (b *LocalBook) apply(d DepthDiff) {
	b.applyLevels(b.bids, d.Bids)
	b.applyLevels(b.asks, d.Asks)
	b.lastID = d.FinalID
}

// snapshot emits the full maintained book, sorted (bids desc, asks asc), with
// cumulative sizes accumulated outward from the best price.
func (b *LocalBook) snapshot(symbol string, tsLocal int64) marketdata.OrderBookSnapshot {
	bids := sortedLevels(b.bids, true)
	asks := sortedLevels(b.asks, false)
	snap := marketdata.OrderBookSnapshot{
		Exchange:   ExchangeName,
		Symbol:     symbol,
		TsExchange: tsLocal,
		TsLocal:    tsLocal,
		Bids:       bids,
		Asks:       asks,
		Depth:      min(len(bids), len(asks)),
		Source:     "book",
	}
	if len(bids) > 0 {
		snap.BestBid = bids[0].Price
	}
	if len(asks) > 0 {
		snap.BestAsk = asks[0].Price
	}
	if snap.BestBid > 0 && snap.BestAsk > 0 {
		snap.Spread = snap.BestAsk - snap.BestBid
		snap.Mid = (snap.BestBid + snap.BestAsk) / 2
	}
	return snap
}

func sortedLevels(side map[string]float64, descending bool) []marketdata.OrderBookLevel {
	out := make([]marketdata.OrderBookLevel, 0, len(side))
	for priceStr, qty := range side {
		price, err := strconv.ParseFloat(priceStr, 64)
		if err != nil || price <= 0 || qty <= 0 {
			continue
		}
		out = append(out, marketdata.OrderBookLevel{Price: price, Size: qty})
	}
	sort.Slice(out, func(i, j int) bool {
		if descending {
			return out[i].Price > out[j].Price
		}
		return out[i].Price < out[j].Price
	})
	var cumulative float64
	for i := range out {
		cumulative += out[i].Size
		out[i].Cumulative = cumulative
	}
	return out
}

// BookCallbacks are the hooks the maintainer invokes. All are optional.
type BookCallbacks struct {
	// OnBook fires with the full maintained book after every applied update.
	OnBook func(marketdata.OrderBookSnapshot)
	// OnResync fires when a sequence gap is detected and a fresh REST snapshot
	// must be fetched. The caller is responsible for re-fetching and calling
	// ApplySnapshot again.
	OnResync func()
	// OnError reports non-fatal parse/sequence problems.
	OnError func(error)
}

// maxBufferedDiffs caps the pre-snapshot buffer so a slow/failed snapshot fetch
// cannot grow memory without bound. The oldest events are dropped first.
const maxBufferedDiffs = 4096

// BookMaintainer keeps a single symbol's full L2 book in sync from a diff stream
// plus a REST snapshot, enforcing Binance's documented sequencing rules. It is
// safe for concurrent use: the read loop calls HandleDiff while a separate
// goroutine delivers the REST snapshot via ApplySnapshot.
type BookMaintainer struct {
	market    Market
	symbol    string
	callbacks BookCallbacks

	mu        sync.Mutex
	book      *LocalBook
	buffer    []DepthDiff
	synced    bool
	firstDone bool // whether the first post-snapshot event has been applied
}

func NewBookMaintainer(market Market, symbol string, cb BookCallbacks) *BookMaintainer {
	return &BookMaintainer{
		market:    market,
		symbol:    strings.ToUpper(strings.TrimSpace(symbol)),
		callbacks: cb,
		book:      newLocalBook(),
	}
}

// Reset returns the maintainer to the pre-snapshot state (e.g. on reconnect),
// clearing the book and buffer so the next ApplySnapshot starts clean.
func (m *BookMaintainer) Reset() {
	m.mu.Lock()
	m.book = newLocalBook()
	m.buffer = nil
	m.synced = false
	m.firstDone = false
	m.mu.Unlock()
}

func (m *BookMaintainer) Synced() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.synced
}

func (m *BookMaintainer) LastID() int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.book.lastID
}

// HandleDiff ingests one diff event. Before the snapshot is applied the event is
// buffered. After sync it is validated and applied. Returns true if the event
// was applied to the live book.
func (m *BookMaintainer) HandleDiff(d DepthDiff) bool {
	m.mu.Lock()
	if !m.synced {
		m.buffer = append(m.buffer, d)
		if len(m.buffer) > maxBufferedDiffs {
			m.buffer = m.buffer[len(m.buffer)-maxBufferedDiffs:]
		}
		m.mu.Unlock()
		return false
	}
	applied, gap := m.applyLocked(d)
	emit := applied
	var snap marketdata.OrderBookSnapshot
	if emit {
		snap = m.book.snapshot(m.symbol, protocol.NowMillis())
	}
	m.mu.Unlock()

	if gap {
		m.triggerResync()
		return false
	}
	if emit && m.callbacks.OnBook != nil {
		m.callbacks.OnBook(snap)
	}
	return applied
}

// ApplySnapshot installs a REST snapshot and drains any buffered diffs through
// the validation rules, leaving the maintainer synced (or requesting another
// resync if the buffer reveals a gap).
func (m *BookMaintainer) ApplySnapshot(lastID int64, bids, asks [][]string) {
	m.mu.Lock()
	m.book.loadSnapshot(lastID, bids, asks)
	m.firstDone = false
	m.synced = true

	gap := false
	for _, d := range m.buffer {
		applied, isGap := m.applyLocked(d)
		_ = applied
		if isGap {
			gap = true
			break
		}
	}
	m.buffer = nil

	var snap marketdata.OrderBookSnapshot
	emit := !gap
	if emit {
		snap = m.book.snapshot(m.symbol, protocol.NowMillis())
	}
	m.mu.Unlock()

	if gap {
		m.triggerResync()
		return
	}
	if m.callbacks.OnBook != nil {
		m.callbacks.OnBook(snap)
	}
}

// applyLocked validates one diff against the current lastID and applies it.
// Caller must hold m.mu. Returns (applied, gap). On gap it marks the maintainer
// unsynced so subsequent events buffer until the next snapshot.
func (m *BookMaintainer) applyLocked(d DepthDiff) (applied bool, gap bool) {
	lastID := m.book.lastID

	// Drop stale events that predate the snapshot.
	if m.market == MarketFutures {
		if d.FinalID < lastID {
			return false, false
		}
	} else {
		if d.FinalID <= lastID {
			return false, false
		}
	}

	if !m.firstDone {
		// First-event gate after a snapshot.
		var ok bool
		if m.market == MarketFutures {
			// U <= lastId <= u
			ok = d.FirstID <= lastID && d.FinalID >= lastID
		} else {
			// U <= lastId+1 <= u
			ok = d.FirstID <= lastID+1 && d.FinalID >= lastID+1
		}
		if !ok {
			// The earliest non-stale event is already past the snapshot window:
			// we missed events -> resync.
			m.synced = false
			return false, true
		}
		m.book.apply(d)
		m.firstDone = true
		return true, false
	}

	// Steady-state continuity.
	var continuous bool
	if m.market == MarketFutures {
		continuous = d.PrevID == lastID
	} else {
		continuous = d.FirstID == lastID+1
	}
	if !continuous {
		m.synced = false
		return false, true
	}
	m.book.apply(d)
	return true, false
}

func (m *BookMaintainer) triggerResync() {
	if m.callbacks.OnResync != nil {
		m.callbacks.OnResync()
	}
}
