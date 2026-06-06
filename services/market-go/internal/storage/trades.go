package storage

import (
	"fmt"
	"strings"
)

// TradeRecord is a simplified trade for SQL storage.
type TradeRecord struct {
	Symbol          string
	ExchangeTradeID string
	TimestampMs     int64
	Price           float64
	Qty             float64
	IsBuy           bool
}

// InsertTrade inserts a single trade, ignoring duplicates.
func (s *DB) InsertTrade(t TradeRecord) error {
	_, err := s.Exec(
		`INSERT OR IGNORE INTO market_trades (symbol, exchange_trade_id, timestamp_ms, price, qty, is_buy)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		t.Symbol, t.ExchangeTradeID, t.TimestampMs, t.Price, t.Qty, t.IsBuy,
	)
	return err
}

// InsertTradeBatch inserts multiple trades in a single transaction.
// Failed inserts (duplicates) are ignored.
func (s *DB) InsertTradeBatch(trades []TradeRecord) error {
	if len(trades) == 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(
		`INSERT OR IGNORE INTO market_trades (symbol, exchange_trade_id, timestamp_ms, price, qty, is_buy)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, t := range trades {
		if _, err := stmt.Exec(t.Symbol, t.ExchangeTradeID, t.TimestampMs, t.Price, t.Qty, t.IsBuy); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetTrades returns trades for a symbol within a time range, sorted ascending.
func (s *DB) GetTrades(symbol string, fromTs, toTs int64) ([]TradeRecord, error) {
	rows, err := s.Query(
		`SELECT symbol, exchange_trade_id, timestamp_ms, price, qty, is_buy
		 FROM market_trades
		 WHERE symbol = ? AND timestamp_ms >= ? AND timestamp_ms <= ?
		 ORDER BY timestamp_ms ASC`,
		symbol, fromTs, toTs,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []TradeRecord
	for rows.Next() {
		var t TradeRecord
		if err := rows.Scan(&t.Symbol, &t.ExchangeTradeID, &t.TimestampMs, &t.Price, &t.Qty, &t.IsBuy); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetTradesSince returns trades for a symbol since a given timestamp.
// limit <= 0 means no limit.
func (s *DB) GetTradesSince(symbol string, sinceMs int64, limit int) ([]TradeRecord, error) {
	var q strings.Builder
	q.WriteString(`SELECT symbol, exchange_trade_id, timestamp_ms, price, qty, is_buy
		FROM market_trades
		WHERE symbol = ? AND timestamp_ms >= ?
		ORDER BY timestamp_ms ASC`)
	if limit > 0 {
		q.WriteString(fmt.Sprintf(" LIMIT %d", limit))
	}

	rows, err := s.Query(q.String(), symbol, sinceMs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []TradeRecord
	for rows.Next() {
		var t TradeRecord
		if err := rows.Scan(&t.Symbol, &t.ExchangeTradeID, &t.TimestampMs, &t.Price, &t.Qty, &t.IsBuy); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteTradesBefore removes trades older than cutoff for a symbol.
// Pass symbol="" to delete for all symbols.
func (s *DB) DeleteTradesBefore(symbol string, cutoffMs int64) (int64, error) {
	if symbol != "" {
		res, err := s.Exec(`DELETE FROM market_trades WHERE symbol = ? AND timestamp_ms < ?`, symbol, cutoffMs)
		if err != nil {
			return 0, err
		}
		return res.RowsAffected()
	}
	res, err := s.Exec(`DELETE FROM market_trades WHERE timestamp_ms < ?`, cutoffMs)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// GetLastTradeTs returns the most recent trade timestamp for a symbol.
// Returns 0 if no trades exist.
func (s *DB) GetLastTradeTs(symbol string) (int64, error) {
	var ts int64
	err := s.QueryRow(`SELECT COALESCE(MAX(timestamp_ms), 0) FROM market_trades WHERE symbol = ?`, symbol).Scan(&ts)
	return ts, err
}

// DeleteTradesBeforeRange deletes trades in [fromTs, toTs] for a symbol.
func (s *DB) DeleteTradesBeforeRange(symbol string, fromTs, toTs int64) (int64, error) {
	res, err := s.Exec(
		`DELETE FROM market_trades WHERE symbol = ? AND timestamp_ms >= ? AND timestamp_ms <= ?`,
		symbol, fromTs, toTs,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
