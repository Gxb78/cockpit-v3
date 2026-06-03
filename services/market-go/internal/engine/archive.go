package engine

import (
	"fmt"
	"path/filepath"
	"time"

	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/storage"

	_ "modernc.org/sqlite"
)

// ArchiveService handles monthly rotation of trades and footprints
// from the live DB into per-symbol, per-month archive SQLite files.
type ArchiveService struct {
	sqlDB  *storage.DB
	log    *logx.Logger
	arcDir string // e.g. <dataDir>/archive
}

// NewArchiveService creates a new archive service.
func NewArchiveService(sqlDB *storage.DB, logger *logx.Logger, dataDir string) *ArchiveService {
	return &ArchiveService{
		sqlDB:  sqlDB,
		log:    logger,
		arcDir: filepath.Join(dataDir, "archive"),
	}
}

// monthBounds returns (fromTs, toTs) in milliseconds for a given year/month.
func monthBounds(year, month int) (int64, int64) {
	start := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0) // first day of next month
	return start.UnixMilli(), end.UnixMilli() - 1
}

// archivePath returns the file path for an archive.
func (a *ArchiveService) archivePath(symbol, dataType string, year, month int) string {
	dir := filepath.Join(a.arcDir, symbol)
	return filepath.Join(dir, fmt.Sprintf("%s_%04d_%02d.db", dataType, year, month))
}

// ExportTrades copies trades from the live DB into a dedicated SQLite archive file.
// The archive file is created with the same table schema.
func (a *ArchiveService) ExportTrades(symbol string, fromTs, toTs int64, dstPath string) error {
	trades, err := a.sqlDB.GetTrades(symbol, fromTs, toTs)
	if err != nil {
		return fmt.Errorf("read trades: %w", err)
	}
	if len(trades) == 0 {
		a.log.Infof("[archive] no trades to export for %s [%d, %d]", symbol, fromTs, toTs)
		return nil
	}

	arcDB, err := storage.NewDB(dstPath)
	if err != nil {
		return fmt.Errorf("create archive db: %w", err)
	}
	defer arcDB.Close()

	if err := arcDB.InsertTradeBatch(trades); err != nil {
		return fmt.Errorf("insert archive trades: %w", err)
	}

	a.log.Infof("[archive] exported %d trades to %s", len(trades), dstPath)
	return nil
}

// ExportFootprint1m copies 1m footprints from the live DB into an archive file.
func (a *ArchiveService) ExportFootprint1m(symbol string, fromTs, toTs int64, dstPath string) error {
	fps, err := a.sqlDB.GetFootprint1m(symbol, fromTs, toTs)
	if err != nil {
		return fmt.Errorf("read footprints: %w", err)
	}
	if len(fps) == 0 {
		a.log.Infof("[archive] no footprints to export for %s [%d, %d]", symbol, fromTs, toTs)
		return nil
	}

	arcDB, err := storage.NewDB(dstPath)
	if err != nil {
		return fmt.Errorf("create archive db: %w", err)
	}
	defer arcDB.Close()

	if err := arcDB.InsertFootprint1mBatch(fps); err != nil {
		return fmt.Errorf("insert archive footprints: %w", err)
	}

	a.log.Infof("[archive] exported %d footprints to %s", len(fps), dstPath)
	return nil
}

// RotateMonthly exports data for a given month, then deletes it from the live DB.
func (a *ArchiveService) RotateMonthly(symbol string, year, month int) error {
	fromTs, toTs := monthBounds(year, month)

	// Check if data exists
	tradesCount, _ := a.countTrades(symbol, fromTs, toTs)
	fpCount, _ := a.countFootprints(symbol, fromTs, toTs)
	if tradesCount == 0 && fpCount == 0 {
		a.log.Infof("[archive] nothing to rotate for %s %04d-%02d", symbol, year, month)
		return nil
	}

	a.log.Infof("[archive] rotating %s %04d-%02d (%d trades, %d footprints)",
		symbol, year, month, tradesCount, fpCount)

	// Export trades
	if tradesCount > 0 {
		tradesPath := a.archivePath(symbol, "trades", year, month)
		if err := a.ExportTrades(symbol, fromTs, toTs, tradesPath); err != nil {
			return fmt.Errorf("export trades: %w", err)
		}
		if _, err := a.sqlDB.DeleteTradesBeforeRange(symbol, fromTs, toTs); err != nil {
			return fmt.Errorf("delete trades: %w", err)
		}
	}

	// Export footprints
	if fpCount > 0 {
		fpPath := a.archivePath(symbol, "footprint_1m", year, month)
		if err := a.ExportFootprint1m(symbol, fromTs, toTs, fpPath); err != nil {
			return fmt.Errorf("export footprints: %w", err)
		}
		if err := a.sqlDB.DeleteFootprint1mRange(symbol, fromTs, toTs); err != nil {
			return fmt.Errorf("delete footprints: %w", err)
		}
	}

	// Vacuum live DB
	if err := a.sqlDB.Vacuum(); err != nil {
		a.log.Infof("[archive] vacuum: %v", err)
	}

	a.log.Infof("[archive] rotation complete for %s %04d-%02d", symbol, year, month)
	return nil
}

// RotateLastMonth is a convenience method — rotates the previous calendar month.
func (a *ArchiveService) RotateLastMonth(symbol string) error {
	now := time.Now().UTC()
	prev := now.AddDate(0, -1, 0)
	return a.RotateMonthly(symbol, prev.Year(), int(prev.Month()))
}

// RotateAllSymbols rotates last month for all configured symbols.
func (a *ArchiveService) RotateAllSymbols(symbols []string) error {
	for _, sym := range symbols {
		if err := a.RotateLastMonth(sym); err != nil {
			a.log.Infof("[archive] rotate %s: %v", sym, err)
		}
	}
	return nil
}

// countTrades returns the number of trades in a time range.
func (a *ArchiveService) countTrades(symbol string, fromTs, toTs int64) (int64, error) {
	var n int64
	err := a.sqlDB.QueryRow(
		"SELECT COUNT(*) FROM market_trades WHERE symbol = ? AND timestamp_ms >= ? AND timestamp_ms <= ?",
		symbol, fromTs, toTs,
	).Scan(&n)
	return n, err
}

// countFootprints returns the number of 1m footprints in a time range.
func (a *ArchiveService) countFootprints(symbol string, fromTs, toTs int64) (int64, error) {
	var n int64
	err := a.sqlDB.QueryRow(
		"SELECT COUNT(*) FROM market_footprint_1m WHERE symbol = ? AND minute_ts >= ? AND minute_ts <= ?",
		symbol, fromTs, toTs,
	).Scan(&n)
	return n, err
}
