package engine

import (
	"container/heap"
	"fmt"
	"path/filepath"
	"time"

	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/storage"

	_ "modernc.org/sqlite"
)

// ─── Trade Reader (single source) ────────────────────────────────────────

// TradeReader reads trades from a single source (archive file or live DB).
type TradeReader struct {
	trades []storage.TradeRecord
	idx    int
}

// NewArchiveTradeReader opens an archive SQLite file and reads trades.
func NewArchiveTradeReader(path, symbol string, fromTs, toTs int64) (*TradeReader, error) {
	arcDB, err := storage.NewDB(path)
	if err != nil {
		return nil, fmt.Errorf("open archive %s: %w", path, err)
	}
	// We can't defer close here — the DB must stay open while reading.
	// TradeReader doesn't own the DB; the caller manages lifecycle.
	trades, err := arcDB.GetTrades(symbol, fromTs, toTs)
	arcDB.Close()
	if err != nil {
		return nil, fmt.Errorf("read archive %s: %w", path, err)
	}
	return &TradeReader{trades: trades}, nil
}

// NewLiveTradeReader reads trades from the live SQLite DB.
func NewLiveTradeReader(sqlDB *storage.DB, symbol string, fromTs, toTs int64) (*TradeReader, error) {
	trades, err := sqlDB.GetTrades(symbol, fromTs, toTs)
	if err != nil {
		return nil, fmt.Errorf("read live trades: %w", err)
	}
	return &TradeReader{trades: trades}, nil
}

// Next returns the next trade from this reader. ok=false when exhausted.
func (r *TradeReader) Next() (storage.TradeRecord, bool) {
	if r.idx >= len(r.trades) {
		return storage.TradeRecord{}, false
	}
	t := r.trades[r.idx]
	r.idx++
	return t, true
}

// ─── Min-Heap for merge sort ─────────────────────────────────────────────

type readerItem struct {
	trade storage.TradeRecord
	rid   int // reader index
}

type readerHeap []readerItem

func (h readerHeap) Len() int            { return len(h) }
func (h readerHeap) Less(i, j int) bool  { return h[i].trade.TimestampMs < h[j].trade.TimestampMs }
func (h readerHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *readerHeap) Push(x any)         { *h = append(*h, x.(readerItem)) }
func (h *readerHeap) Pop() any {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

// ─── Multi-Source Trade Loader ───────────────────────────────────────────

// srcReader pairs a reader with a label.
type srcReader struct {
	reader *TradeReader
	label  string
}

// MultiSourceLoader merges trades from archive files + live DB into a sorted stream.
type MultiSourceLoader struct {
	arcDir string
	sqlDB  *storage.DB
	log    *logx.Logger
}

// NewMultiSourceLoader creates a loader.
func NewMultiSourceLoader(sqlDB *storage.DB, logger *logx.Logger, dataDir string) *MultiSourceLoader {
	return &MultiSourceLoader{
		arcDir: filepath.Join(dataDir, "archive"),
		sqlDB:  sqlDB,
		log:    logger,
	}
}

// findArchiveFiles returns paths to archive files covering [fromTs, toTs].
func (l *MultiSourceLoader) findArchiveFiles(symbol, dataType string, fromTs, toTs int64) []string {
	var paths []string
	start := time.UnixMilli(fromTs).UTC()
	end := time.UnixMilli(toTs).UTC()

	// Iterate month by month
	for y := start.Year(); y <= end.Year(); y++ {
		startM := 1
		if y == start.Year() {
			startM = int(start.Month())
		}
		endM := 12
		if y == end.Year() {
			endM = int(end.Month())
		}
		for m := startM; m <= endM; m++ {
			dir := filepath.Join(l.arcDir, symbol)
			path := filepath.Join(dir, fmt.Sprintf("%s_%04d_%02d.db", dataType, y, m))
			paths = append(paths, path)
		}
	}
	return paths
}

// LoadTrades returns all trades from [fromTs, toTs] by merging archives + live DB.
// The trades are sorted by TimestampMs ascending.
func (l *MultiSourceLoader) LoadTrades(symbol string, fromTs, toTs int64) ([]storage.TradeRecord, error) {
	// Find archive files
	archivePaths := l.findArchiveFiles(symbol, "trades", fromTs, toTs)
	l.log.Infof("[loader] loading trades %s [%d, %d] from %d archive months + live",
		symbol, fromTs, toTs, len(archivePaths))

	// Create readers

	var readers []srcReader

	// Archive readers
	for _, path := range archivePaths {
		r, err := NewArchiveTradeReader(path, symbol, fromTs, toTs)
		if err != nil {
			l.log.Infof("[loader] skip archive %s: %v", path, err)
			continue
		}
		if len(r.trades) > 0 {
			readers = append(readers, srcReader{r, path})
		}
	}

	// Live reader
	liveR, err := NewLiveTradeReader(l.sqlDB, symbol, fromTs, toTs)
	if err == nil && len(liveR.trades) > 0 {
		readers = append(readers, srcReader{liveR, "live"})
	}

	if len(readers) == 0 {
		l.log.Infof("[loader] no trades found for %s [%d, %d]", symbol, fromTs, toTs)
		return nil, nil
	}

	// Merge sort using min-heap
	var h readerHeap
	heap.Init(&h)

	for i, sr := range readers {
		if t, ok := sr.reader.Next(); ok {
			heap.Push(&h, readerItem{trade: t, rid: i})
		}
	}

	out := make([]storage.TradeRecord, 0, estimateCount(readers))
	for h.Len() > 0 {
		item := heap.Pop(&h).(readerItem)
		out = append(out, item.trade)
		if t, ok := readers[item.rid].reader.Next(); ok {
			heap.Push(&h, readerItem{trade: t, rid: item.rid})
		}
	}

	l.log.Infof("[loader] loaded %d trades for %s [%d, %d]", len(out), symbol, fromTs, toTs)
	return out, nil
}

func estimateCount(readers []srcReader) int {
	n := 0
	for _, r := range readers {
		n += len(r.reader.trades)
	}
	return n
}

// ─── Find archived month ranges ──────────────────────────────────────────

// ArchivedMonths returns the list of (year, month) tuples that have archive
// files for a given symbol + dataType.
func (l *MultiSourceLoader) ArchivedMonths(symbol, dataType string) ([]string, error) {
	// This is a simplified check — we look for files matching the pattern.
	// A more robust implementation would use os.ReadDir and glob.
	// For now, we return the known pattern and let callers handle missing files.
	return l.findArchiveFiles(symbol, dataType, 0, time.Now().UnixMilli()), nil
}
