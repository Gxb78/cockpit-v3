package storage

import (
	"database/sql"
	"fmt"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// DB wraps the SQLite connection with thread safety.
type DB struct {
	mu  sync.RWMutex
	db  *sql.DB
	dsn string
}

// NewDB opens (or creates) the SQLite database at the given path.
// Creates tables on first use (lazy via ensureTables).
func NewDB(dbPath string) (*DB, error) {
	// Use WAL mode for concurrent reads
	dsn := fmt.Sprintf("file:%s?mode=rwc&_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("storage: open db: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite WAL supports one writer

	s := &DB{db: db, dsn: dsn}
	if err := s.ensureTables(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// Close closes the database.
func (s *DB) Close() error {
	return s.db.Close()
}

// ensureTables creates all tables and indexes if they don't exist.
func (s *DB) ensureTables() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmts := []string{
		`CREATE TABLE IF NOT EXISTS market_trades (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			symbol            TEXT NOT NULL,
			exchange_trade_id TEXT NOT NULL,
			timestamp_ms      INTEGER NOT NULL,
			price             REAL NOT NULL,
			qty               REAL NOT NULL,
			is_buy            BOOLEAN NOT NULL,
			UNIQUE(symbol, exchange_trade_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_market_trades_symbol_ts
		 ON market_trades(symbol, timestamp_ms)`,

		`CREATE TABLE IF NOT EXISTS market_footprint_1m (
			symbol      TEXT NOT NULL,
			minute_ts   INTEGER NOT NULL,
			open        REAL NOT NULL,
			high        REAL NOT NULL,
			low         REAL NOT NULL,
			close       REAL NOT NULL,
			volume      REAL NOT NULL,
			buy_volume  REAL NOT NULL,
			sell_volume REAL NOT NULL,
			delta       REAL NOT NULL DEFAULT 0,
			cvd         REAL NOT NULL DEFAULT 0,
			max_imbalance_ratio      REAL NOT NULL DEFAULT 0,
			buy_imbalance_count      INTEGER NOT NULL DEFAULT 0,
			sell_imbalance_count     INTEGER NOT NULL DEFAULT 0,
			stacked_buy_imb_count    INTEGER NOT NULL DEFAULT 0,
			stacked_sell_imb_count   INTEGER NOT NULL DEFAULT 0,
			has_buy_absorption       INTEGER NOT NULL DEFAULT 0,
			has_sell_absorption      INTEGER NOT NULL DEFAULT 0,
			absorption_price_buy     REAL,
			absorption_price_sell    REAL,
			is_exhaustion_high       INTEGER NOT NULL DEFAULT 0,
			is_exhaustion_low        INTEGER NOT NULL DEFAULT 0,
			is_unfinished_high       INTEGER NOT NULL DEFAULT 0,
			is_unfinished_low        INTEGER NOT NULL DEFAULT 0,
			profile_json TEXT,
			PRIMARY KEY(symbol, minute_ts)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_market_footprint_1m_symbol_ts
		 ON market_footprint_1m(symbol, minute_ts)`,

		`CREATE TABLE IF NOT EXISTS market_footprint_tf (
			symbol      TEXT NOT NULL,
			timeframe   TEXT NOT NULL,
			candle_ts   INTEGER NOT NULL,
			open        REAL NOT NULL,
			high        REAL NOT NULL,
			low         REAL NOT NULL,
			close       REAL NOT NULL,
			volume      REAL NOT NULL,
			buy_volume  REAL NOT NULL,
			sell_volume REAL NOT NULL,
			delta       REAL NOT NULL DEFAULT 0,
			cvd         REAL NOT NULL DEFAULT 0,
			max_imbalance_ratio      REAL NOT NULL DEFAULT 0,
			buy_imbalance_count      INTEGER NOT NULL DEFAULT 0,
			sell_imbalance_count     INTEGER NOT NULL DEFAULT 0,
			stacked_buy_imb_count    INTEGER NOT NULL DEFAULT 0,
			stacked_sell_imb_count   INTEGER NOT NULL DEFAULT 0,
			has_buy_absorption       INTEGER NOT NULL DEFAULT 0,
			has_sell_absorption      INTEGER NOT NULL DEFAULT 0,
			absorption_price_buy     REAL,
			absorption_price_sell    REAL,
			is_exhaustion_high       INTEGER NOT NULL DEFAULT 0,
			is_exhaustion_low        INTEGER NOT NULL DEFAULT 0,
			is_unfinished_high       INTEGER NOT NULL DEFAULT 0,
			is_unfinished_low        INTEGER NOT NULL DEFAULT 0,
			profile_json TEXT,
			PRIMARY KEY(symbol, timeframe, candle_ts)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_market_footprint_tf_lookup
		 ON market_footprint_tf(symbol, timeframe, candle_ts)`,

		`CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY
		)`,
	}

	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("storage: create table: %w", err)
		}
	}

	return tx.Commit()
}

// Exec runs a write query (INSERT, DELETE, etc.) under the write lock.
func (s *DB) Exec(query string, args ...any) (sql.Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.Exec(query, args...)
}

// Query runs a read query under the read lock.
func (s *DB) Query(query string, args ...any) (*sql.Rows, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.db.Query(query, args...)
}

// QueryRow runs a single-row read query.
func (s *DB) QueryRow(query string, args ...any) *sql.Row {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.db.QueryRow(query, args...)
}

// Vacuum reclaims disk space. Run periodically or after large deletes.
func (s *DB) Vacuum() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec("VACUUM")
	return err
}

// NowMs returns the current time in milliseconds (UTC).
func NowMs() int64 {
	return time.Now().UnixMilli()
}

// MinuteAlign rounds a timestamp down to the start of its minute.
func MinuteAlign(tsMs int64) int64 {
	return (tsMs / 60000) * 60000
}
