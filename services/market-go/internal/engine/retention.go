package engine

import (
	"fmt"
	"time"

	"cockpit-v6-market-go/internal/logx"
	"cockpit-v6-market-go/internal/storage"
)

// RetentionConfig holds retention policy for each data type.
type RetentionConfig struct {
	TradesDays       int // trades raw
	Footprint1mDays  int // 1m footprints
	FootprintTFDays  int // aggregated TF footprints
	PurgeIntervalMin int // how often to run purge (default 60)
}

// RetentionService manages periodic purge of old data from SQLite.
type RetentionService struct {
	cfg    RetentionConfig
	sqlDB  *storage.DB
	log    *logx.Logger
	dryRun bool       // when true, only logs what would be deleted
	symbols []string // symbols to purge (empty = all)
}

// NewRetentionService creates a new retention service.
func NewRetentionService(cfg RetentionConfig, sqlDB *storage.DB, logger *logx.Logger, symbols []string) *RetentionService {
	if cfg.PurgeIntervalMin <= 0 {
		cfg.PurgeIntervalMin = 60
	}
	return &RetentionService{
		cfg:     cfg,
		sqlDB:   sqlDB,
		log:     logger,
		symbols: symbols,
	}
}

// SetDryRun enables/disables dry-run mode (log only, no DELETE).
func (s *RetentionService) SetDryRun(dry bool) {
	s.dryRun = dry
}

// PurgeOnce executes a single purge cycle for all configured data types.
func (s *RetentionService) PurgeOnce() {
	if s.sqlDB == nil {
		return
	}

	now := time.Now().UnixMilli()
	symbols := s.symbols
	if len(symbols) == 0 {
		symbols = []string{""} // empty = all symbols
	}

	for _, sym := range symbols {
		s.purgeTrades(sym, now)
		s.purgeFootprint1m(sym, now)
		s.purgeFootprintTF(sym, now)
	}
}

// purgeTrades deletes trades older than the configured retention.
func (s *RetentionService) purgeTrades(symbol string, nowMs int64) {
	if s.cfg.TradesDays <= 0 {
		return
	}
	cutoff := nowMs - int64(s.cfg.TradesDays)*24*60*60*1000

	if s.dryRun {
		s.log.Infof("[retention] dry-run: would delete trades symbol=%q cutoff=%d (retain=%dd)", symbol, cutoff, s.cfg.TradesDays)
		return
	}

	removed, err := s.sqlDB.DeleteTradesBefore(symbol, cutoff)
	if err != nil {
		s.log.Infof("[retention] trades purge error: %v", err)
	} else if removed > 0 {
		s.log.Infof("[retention] purged %d trades symbol=%q retain=%dd cutoff=%d", removed, symbol, s.cfg.TradesDays, cutoff)
	}
}

// purgeFootprint1m deletes 1m footprints older than configured retention.
func (s *RetentionService) purgeFootprint1m(symbol string, nowMs int64) {
	if s.cfg.Footprint1mDays <= 0 {
		return
	}
	cutoff := nowMs - int64(s.cfg.Footprint1mDays)*24*60*60*1000

	if s.dryRun {
		s.log.Infof("[retention] dry-run: would delete fp1m symbol=%q cutoff=%d (retain=%dd)", symbol, cutoff, s.cfg.Footprint1mDays)
		return
	}

	removed, err := s.sqlDB.DeleteFootprint1mBefore(symbol, cutoff)
	if err != nil {
		s.log.Infof("[retention] fp1m purge error: %v", err)
	} else if removed > 0 {
		s.log.Infof("[retention] purged %d fp1m symbol=%q retain=%dd cutoff=%d", removed, symbol, s.cfg.Footprint1mDays, cutoff)
	}
}

// purgeFootprintTF deletes TF footprints older than configured retention.
func (s *RetentionService) purgeFootprintTF(symbol string, nowMs int64) {
	if s.cfg.FootprintTFDays <= 0 {
		return
	}
	cutoff := nowMs - int64(s.cfg.FootprintTFDays)*24*60*60*1000

	if s.dryRun {
		s.log.Infof("[retention] dry-run: would delete fpTF symbol=%q cutoff=%d (retain=%dd)", symbol, cutoff, s.cfg.FootprintTFDays)
		return
	}

	// Purge all timeframes at once
	for _, tf := range []string{"5m", "15m", "1h", "4h", "1d"} {
		removed, err := s.sqlDB.DeleteFootprintTFBefore(symbol, tf, cutoff)
		if err != nil {
			s.log.Infof("[retention] fpTF %s purge error: %v", tf, err)
		} else if removed > 0 {
			s.log.Infof("[retention] purged %d fpTF %s symbol=%q retain=%dd", removed, tf, symbol, s.cfg.FootprintTFDays)
		}
	}
}

// Run starts the periodic purge loop. Blocks until ctx is cancelled.
func (s *RetentionService) Run(stop <-chan struct{}) {
	interval := time.Duration(s.cfg.PurgeIntervalMin) * time.Minute
	s.log.Infof("[retention] starting periodic purge every %v (dryRun=%v)", interval, s.dryRun)
	s.log.Infof("[retention] config: trades=%dd fp1m=%dd fpTF=%dd",
		s.cfg.TradesDays, s.cfg.Footprint1mDays, s.cfg.FootprintTFDays)

	// Run once immediately
	s.PurgeOnce()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-stop:
			s.log.Infof("[retention] stopped")
			return
		case <-ticker.C:
			s.PurgeOnce()
			s.vacuumIfNeeded()
		}
	}
}

var vacuumCounter int

// vacuumIfNeeded runs VACUUM every 12 purges (~12h with 60min interval).
func (s *RetentionService) vacuumIfNeeded() {
	vacuumCounter++
	if vacuumCounter >= 12 {
		vacuumCounter = 0
		if s.sqlDB != nil {
			start := time.Now()
			if err := s.sqlDB.Vacuum(); err != nil {
				s.log.Infof("[retention] vacuum error: %v", err)
			} else {
				s.log.Infof("[retention] vacuum completed in %v", time.Since(start).Round(time.Millisecond))
			}
		}
	}
}

// Stats returns a human-readable summary of the retention config.
func (s *RetentionService) Stats() string {
	return fmt.Sprintf("trades=%dd fp1m=%dd fpTF=%dd interval=%dm dryRun=%v",
		s.cfg.TradesDays, s.cfg.Footprint1mDays, s.cfg.FootprintTFDays,
		s.cfg.PurgeIntervalMin, s.dryRun)
}
