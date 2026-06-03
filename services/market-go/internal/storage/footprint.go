package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// PriceLevel represents a single price level in a footprint profile.
type PriceLevel struct {
	Price      float64 `json:"p"`
	BuyVolume  float64 `json:"b"`
	SellVolume float64 `json:"s"`
}

// FootprintProfile is the volume profile at each price level for a minute.
type FootprintProfile struct {
	Levels []PriceLevel `json:"levels"`
}

// FootprintRecord is a 1m footprint stored in SQL.
type FootprintRecord struct {
	Symbol     string
	MinuteTs   int64
	Open       float64
	High       float64
	Low        float64
	Close      float64
	Volume     float64
	BuyVolume  float64
	SellVolume float64
	Delta      float64
	CVD        float64 // cumulative volume delta
	Profile    FootprintProfile
	// Derived metrics
	MaxImbalanceRatio        float64
	BuyImbalanceCount        int
	SellImbalanceCount       int
	StackedBuyImbalanceCount  int
	StackedSellImbalanceCount int
	HasBuyAbsorption         bool
	HasSellAbsorption        bool
	AbsorptionPriceBuy       float64
	AbsorptionPriceSell      float64
	IsExhaustionHigh         bool
	IsExhaustionLow          bool
	IsUnfinishedHigh         bool
	IsUnfinishedLow          bool
}

// SerializeProfile converts a FootprintProfile to compact JSON.
func SerializeProfile(p FootprintProfile) (string, error) {
	data, err := json.Marshal(p.Levels)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// DeserializeProfile parses a JSON profile string.
func DeserializeProfile(jsonStr string) (FootprintProfile, error) {
	var levels []PriceLevel
	if jsonStr == "" {
		return FootprintProfile{}, nil
	}
	if err := json.Unmarshal([]byte(jsonStr), &levels); err != nil {
		return FootprintProfile{}, err
	}
	return FootprintProfile{Levels: levels}, nil
}

// fpCols is the full column list for market_footprint_1m INSERT/SELECT.
const fpCols = `symbol, minute_ts, open, high, low, close, volume,
	buy_volume, sell_volume, delta, cvd,
	max_imbalance_ratio, buy_imbalance_count, sell_imbalance_count,
	stacked_buy_imb_count, stacked_sell_imb_count,
	has_buy_absorption, has_sell_absorption,
	absorption_price_buy, absorption_price_sell,
	is_exhaustion_high, is_exhaustion_low,
	is_unfinished_high, is_unfinished_low,
	profile_json`

// InsertFootprint1m inserts or replaces a 1m footprint row.
func (s *DB) InsertFootprint1m(fp FootprintRecord) error {
	profileJSON, err := SerializeProfile(fp.Profile)
	if err != nil {
		return err
	}
	buyAbs := 0
	if fp.HasBuyAbsorption {
		buyAbs = 1
	}
	sellAbs := 0
	if fp.HasSellAbsorption {
		sellAbs = 1
	}
	exH := 0
	if fp.IsExhaustionHigh {
		exH = 1
	}
	exL := 0
	if fp.IsExhaustionLow {
		exL = 1
	}
	unfH := 0
	if fp.IsUnfinishedHigh {
		unfH = 1
	}
	unfL := 0
	if fp.IsUnfinishedLow {
		unfL = 1
	}

	_, err = s.Exec(
		`INSERT OR REPLACE INTO market_footprint_1m (`+fpCols+`)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
		         ?, ?, ?, ?, ?, ?, ?, ?, ?,
		         ?, ?, ?, ?, ?)`,
		fp.Symbol, fp.MinuteTs, fp.Open, fp.High, fp.Low, fp.Close,
		fp.Volume, fp.BuyVolume, fp.SellVolume, fp.Delta, fp.CVD,
		fp.MaxImbalanceRatio, fp.BuyImbalanceCount, fp.SellImbalanceCount,
		fp.StackedBuyImbalanceCount, fp.StackedSellImbalanceCount,
		buyAbs, sellAbs, fp.AbsorptionPriceBuy, fp.AbsorptionPriceSell,
		exH, exL, unfH, unfL, profileJSON,
	)
	return err
}

// InsertFootprint1mBatch inserts multiple footprints in a transaction.
func (s *DB) InsertFootprint1mBatch(fps []FootprintRecord) error {
	if len(fps) == 0 {
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
		`INSERT OR REPLACE INTO market_footprint_1m
		 (symbol, minute_ts, open, high, low, close, volume, buy_volume, sell_volume, delta, cvd, profile_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, fp := range fps {
		profileJSON, serr := SerializeProfile(fp.Profile)
		if serr != nil {
			return serr
		}
		if _, err := stmt.Exec(fp.Symbol, fp.MinuteTs, fp.Open, fp.High, fp.Low, fp.Close,
			fp.Volume, fp.BuyVolume, fp.SellVolume, fp.Delta, fp.CVD, profileJSON); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetFootprint1m returns footprints for a symbol within a time range.
func (s *DB) GetFootprint1m(symbol string, fromTs, toTs int64) ([]FootprintRecord, error) {
	rows, err := s.Query(
		`SELECT `+fpCols+` FROM market_footprint_1m
		 WHERE symbol = ? AND minute_ts >= ? AND minute_ts <= ?
		 ORDER BY minute_ts ASC`,
		symbol, fromTs, toTs,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanFootprints(rows)
}

// GetFootprint1mSince returns footprints since a given timestamp.
func (s *DB) GetFootprint1mSince(symbol string, sinceMs int64, limit int) ([]FootprintRecord, error) {
	var q strings.Builder
	q.WriteString(`SELECT ` + fpCols + ` FROM market_footprint_1m
		WHERE symbol = ? AND minute_ts >= ?
		ORDER BY minute_ts ASC`)
	if limit > 0 {
		q.WriteString(fmt.Sprintf(" LIMIT %d", limit))
	}

	rows, err := s.Query(q.String(), symbol, sinceMs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanFootprints(rows)
}

func scanFootprints(rows *sql.Rows) ([]FootprintRecord, error) {
	var out []FootprintRecord
	for rows.Next() {
		var fp FootprintRecord
		var profileJSON string
		var buyAbs, sellAbs, exH, exL, unfH, unfL int
		if err := rows.Scan(&fp.Symbol, &fp.MinuteTs, &fp.Open, &fp.High, &fp.Low, &fp.Close,
			&fp.Volume, &fp.BuyVolume, &fp.SellVolume, &fp.Delta, &fp.CVD,
			&fp.MaxImbalanceRatio, &fp.BuyImbalanceCount, &fp.SellImbalanceCount,
			&fp.StackedBuyImbalanceCount, &fp.StackedSellImbalanceCount,
			&buyAbs, &sellAbs, &fp.AbsorptionPriceBuy, &fp.AbsorptionPriceSell,
			&exH, &exL, &unfH, &unfL, &profileJSON); err != nil {
			return nil, err
		}
		profile, err := DeserializeProfile(profileJSON)
		if err != nil {
			return nil, err
		}
		fp.Profile = profile
		fp.HasBuyAbsorption = buyAbs != 0
		fp.HasSellAbsorption = sellAbs != 0
		fp.IsExhaustionHigh = exH != 0
		fp.IsExhaustionLow = exL != 0
		fp.IsUnfinishedHigh = unfH != 0
		fp.IsUnfinishedLow = unfL != 0
		out = append(out, fp)
	}
	return out, rows.Err()
}

// DeleteFootprint1mBefore removes footprints older than cutoff.
func (s *DB) DeleteFootprint1mBefore(symbol string, cutoffMs int64) (int64, error) {
	if symbol != "" {
		res, err := s.Exec(`DELETE FROM market_footprint_1m WHERE symbol = ? AND minute_ts < ?`, symbol, cutoffMs)
		if err != nil {
			return 0, err
		}
		return res.RowsAffected()
	}
	res, err := s.Exec(`DELETE FROM market_footprint_1m WHERE minute_ts < ?`, cutoffMs)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// InsertFootprintTF inserts a multi-timeframe footprint.
func (s *DB) InsertFootprintTF(fp FootprintRecord, timeframe string) error {
	profileJSON, err := SerializeProfile(fp.Profile)
	if err != nil {
		return err
	}
	buyAbs := 0
	if fp.HasBuyAbsorption {
		buyAbs = 1
	}
	sellAbs := 0
	if fp.HasSellAbsorption {
		sellAbs = 1
	}
	exH := 0
	if fp.IsExhaustionHigh {
		exH = 1
	}
	exL := 0
	if fp.IsExhaustionLow {
		exL = 1
	}
	unfH := 0
	if fp.IsUnfinishedHigh {
		unfH = 1
	}
	unfL := 0
	if fp.IsUnfinishedLow {
		unfL = 1
	}
	_, err = s.Exec(
		`INSERT OR REPLACE INTO market_footprint_tf
		 (symbol, timeframe, candle_ts, open, high, low, close, volume,
		  buy_volume, sell_volume, delta, cvd,
		  max_imbalance_ratio, buy_imbalance_count, sell_imbalance_count,
		  stacked_buy_imb_count, stacked_sell_imb_count,
		  has_buy_absorption, has_sell_absorption,
		  absorption_price_buy, absorption_price_sell,
		  is_exhaustion_high, is_exhaustion_low,
		  is_unfinished_high, is_unfinished_low, profile_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
		         ?, ?, ?, ?, ?, ?, ?, ?, ?,
		         ?, ?, ?, ?, ?)`,
		fp.Symbol, timeframe, fp.MinuteTs, fp.Open, fp.High, fp.Low, fp.Close,
		fp.Volume, fp.BuyVolume, fp.SellVolume, fp.Delta, fp.CVD,
		fp.MaxImbalanceRatio, fp.BuyImbalanceCount, fp.SellImbalanceCount,
		fp.StackedBuyImbalanceCount, fp.StackedSellImbalanceCount,
		buyAbs, sellAbs, fp.AbsorptionPriceBuy, fp.AbsorptionPriceSell,
		exH, exL, unfH, unfL, profileJSON,
	)
	return err
}

// GetFootprintTF returns aggregated footprints for a symbol+timeframe.
func (s *DB) GetFootprintTF(symbol, timeframe string, fromTs, toTs int64) ([]FootprintRecord, error) {
	rows, err := s.Query(
		`SELECT symbol, candle_ts, open, high, low, close, volume, buy_volume, sell_volume, delta, cvd,
		 max_imbalance_ratio, buy_imbalance_count, sell_imbalance_count,
		 stacked_buy_imb_count, stacked_sell_imb_count,
		 has_buy_absorption, has_sell_absorption,
		 absorption_price_buy, absorption_price_sell,
		 is_exhaustion_high, is_exhaustion_low,
		 is_unfinished_high, is_unfinished_low, profile_json
		 FROM market_footprint_tf
		 WHERE symbol = ? AND timeframe = ? AND candle_ts >= ? AND candle_ts <= ?
		 ORDER BY candle_ts ASC`,
		symbol, timeframe, fromTs, toTs,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out, err := scanFootprints(rows)
	// Rename MinuteTs -> candle_ts for TF records
	for i := range out {
		out[i].MinuteTs = out[i].MinuteTs // already correct from scan
	}
	return out, err
}

// DeleteFootprintTFBefore removes TF footprints older than cutoff.
func (s *DB) DeleteFootprintTFBefore(symbol, timeframe string, cutoffMs int64) (int64, error) {
	query := `DELETE FROM market_footprint_tf WHERE symbol = ? AND timeframe = ? AND candle_ts < ?`
	res, err := s.Exec(query, symbol, timeframe, cutoffMs)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// DeleteFootprint1mRange deletes footprints in a time range (for rebuild).
func (s *DB) DeleteFootprint1mRange(symbol string, fromTs, toTs int64) error {
	_, err := s.Exec(
		`DELETE FROM market_footprint_1m WHERE symbol = ? AND minute_ts >= ? AND minute_ts <= ?`,
		symbol, fromTs, toTs,
	)
	return err
}

// DeleteFootprintTFRange deletes TF footprints in a range (for rebuild).
func (s *DB) DeleteFootprintTFRange(symbol, timeframe string, fromTs, toTs int64) error {
	_, err := s.Exec(
		`DELETE FROM market_footprint_tf WHERE symbol = ? AND timeframe = ? AND candle_ts >= ? AND candle_ts <= ?`,
		symbol, timeframe, fromTs, toTs,
	)
	return err
}

// GetLastFootprint1mTs returns the most recent minute_ts for a symbol.
// Returns 0 if no footprints exist.
func (s *DB) GetLastFootprint1mTs(symbol string) (int64, error) {
	var ts int64
	err := s.QueryRow(`SELECT COALESCE(MAX(minute_ts), 0) FROM market_footprint_1m WHERE symbol = ?`, symbol).Scan(&ts)
	return ts, err
}

// GetLastFootprintTFTs returns the most recent candle_ts for a symbol+timeframe.
// Returns 0 if no TF footprints exist.
func (s *DB) GetLastFootprintTFTs(symbol, timeframe string) (int64, error) {
	var ts int64
	err := s.QueryRow(`SELECT COALESCE(MAX(candle_ts), 0) FROM market_footprint_tf WHERE symbol = ? AND timeframe = ?`, symbol, timeframe).Scan(&ts)
	return ts, err
}

// GetLastCVD returns the CVD value of the most recent 1m footprint for a symbol.
// Returns 0 if no footprints exist.
func (s *DB) GetLastCVD(symbol string) (float64, error) {
	var cvd float64
	err := s.QueryRow(`SELECT COALESCE(cvd, 0) FROM market_footprint_1m WHERE symbol = ? ORDER BY minute_ts DESC LIMIT 1`, symbol).Scan(&cvd)
	return cvd, err
}
