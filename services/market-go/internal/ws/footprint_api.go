package ws

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"cockpit-v6-market-go/internal/engine"
	"cockpit-v6-market-go/internal/storage"
)

// ─── GET /api/v1/footprint/1m ────────────────────────────────────────────

func (s *Server) handleGetFootprint1m(w http.ResponseWriter, r *http.Request) {
	if s.sqlDB == nil {
		http.Error(w, `{"error":"sqlite not available"}`, http.StatusServiceUnavailable)
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	if symbol == "" {
		http.Error(w, `{"error":"symbol required"}`, http.StatusBadRequest)
		return
	}

	from, _ := strconv.ParseInt(r.URL.Query().Get("from"), 10, 64)
	to, _ := strconv.ParseInt(r.URL.Query().Get("to"), 10, 64)
	if from <= 0 {
		from = time.Now().Add(-24 * time.Hour).UnixMilli()
	}
	if to <= 0 {
		to = time.Now().UnixMilli()
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	fps, err := s.sqlDB.GetFootprint1m(symbol, from, to)
	if err != nil {
		jsonError(w, fmt.Sprintf("query error: %v", err), http.StatusInternalServerError)
		return
	}

	// Apply offset + limit
	if offset > 0 && offset < len(fps) {
		fps = fps[offset:]
	}
	if limit > 0 && limit < len(fps) {
		fps = fps[:limit]
	}

	writeJSON(w, 200, map[string]any{
		"symbol":    symbol,
		"timeframe": "1m",
		"count":     len(fps),
		"candles":   encodeCandles(fps),
	})
}

// ─── GET /api/v1/footprint/tf ────────────────────────────────────────────

func (s *Server) handleGetFootprintTF(w http.ResponseWriter, r *http.Request) {
	if s.sqlDB == nil {
		http.Error(w, `{"error":"sqlite not available"}`, http.StatusServiceUnavailable)
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	if symbol == "" {
		http.Error(w, `{"error":"symbol required"}`, http.StatusBadRequest)
		return
	}

	tf := strings.TrimSpace(r.URL.Query().Get("tf"))
	if tf == "" {
		tf = "5m"
	}

	from, _ := strconv.ParseInt(r.URL.Query().Get("from"), 10, 64)
	to, _ := strconv.ParseInt(r.URL.Query().Get("to"), 10, 64)
	if from <= 0 {
		from = time.Now().Add(-7 * 24 * time.Hour).UnixMilli()
	}
	if to <= 0 {
		to = time.Now().UnixMilli()
	}

	fps, err := s.sqlDB.GetFootprintTF(symbol, tf, from, to)
	if err != nil {
		jsonError(w, fmt.Sprintf("query error: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, 200, map[string]any{
		"symbol":    symbol,
		"timeframe": tf,
		"count":     len(fps),
		"candles":   encodeCandles(fps),
	})
}

// ─── GET /api/v1/footprint/profile ───────────────────────────────────────

func (s *Server) handleGetFootprintProfile(w http.ResponseWriter, r *http.Request) {
	if s.sqlDB == nil {
		http.Error(w, `{"error":"sqlite not available"}`, http.StatusServiceUnavailable)
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	if symbol == "" {
		http.Error(w, `{"error":"symbol required"}`, http.StatusBadRequest)
		return
	}

	ts, _ := strconv.ParseInt(r.URL.Query().Get("ts"), 10, 64)
	if ts <= 0 {
		http.Error(w, `{"error":"ts (timestamp) required"}`, http.StatusBadRequest)
		return
	}

	tf := strings.TrimSpace(r.URL.Query().Get("tf"))
	var profile storage.FootprintProfile
	var fpTs int64

	if tf == "" || tf == "1m" {
		fps, err := s.sqlDB.GetFootprint1m(symbol, ts, ts+59999)
		if err != nil || len(fps) == 0 {
			jsonError(w, "candle not found", http.StatusNotFound)
			return
		}
		profile = fps[0].Profile
		fpTs = fps[0].MinuteTs
	} else {
		fps, err := s.sqlDB.GetFootprintTF(symbol, tf, ts, ts+intervalMs(tf)-1)
		if err != nil || len(fps) == 0 {
			jsonError(w, "candle not found", http.StatusNotFound)
			return
		}
		profile = fps[0].Profile
		fpTs = fps[0].MinuteTs
	}

	writeJSON(w, 200, map[string]any{
		"symbol":  symbol,
		"ts":      fpTs,
		"profile": encodeProfile(profile),
	})
}

// ─── GET /api/v1/footprint/latest ────────────────────────────────────────

func (s *Server) handleGetFootprintLatest(w http.ResponseWriter, r *http.Request) {
	if s.sqlDB == nil {
		http.Error(w, `{"error":"sqlite not available"}`, http.StatusServiceUnavailable)
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	if symbol == "" {
		http.Error(w, `{"error":"symbol required"}`, http.StatusBadRequest)
		return
	}

	tf := strings.TrimSpace(r.URL.Query().Get("tf"))
	if tf == "" {
		tf = "1m"
	}

	if tf == "1m" {
		lastFP, err := s.sqlDB.GetLastFootprint1mTs(symbol)
		if err != nil || lastFP == 0 {
			jsonError(w, "no footprints found", http.StatusNotFound)
			return
		}
		fps, err := s.sqlDB.GetFootprint1m(symbol, lastFP, lastFP+59999)
		if err != nil || len(fps) == 0 {
			jsonError(w, "candle not found", http.StatusNotFound)
			return
		}
		writeJSON(w, 200, map[string]any{
			"symbol": symbol,
			"tf":     "1m",
			"candle": encodeCandle(fps[0]),
		})
	} else {
		lastTF, err := s.sqlDB.GetLastFootprintTFTs(symbol, tf)
		if err != nil || lastTF == 0 {
			jsonError(w, "no tf footprints found", http.StatusNotFound)
			return
		}
		targetMs := intervalMs(tf)
		fps, err := s.sqlDB.GetFootprintTF(symbol, tf, lastTF, lastTF+targetMs-1)
		if err != nil || len(fps) == 0 {
			jsonError(w, "candle not found", http.StatusNotFound)
			return
		}
		writeJSON(w, 200, map[string]any{
			"symbol": symbol,
			"tf":     tf,
			"candle": encodeCandle(fps[0]),
		})
	}
}

// ─── GET /api/v1/footprint/stats ─────────────────────────────────────────

func (s *Server) handleGetFootprintStats(w http.ResponseWriter, r *http.Request) {
	if s.sqlDB == nil {
		http.Error(w, `{"error":"sqlite not available"}`, http.StatusServiceUnavailable)
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	if symbol == "" {
		symbol = "BTCUSDT"
	}

	// Trade count
	var tradeCount int64
	_ = s.sqlDB.QueryRow(
		"SELECT COUNT(*) FROM market_trades WHERE symbol = ?", symbol,
	).Scan(&tradeCount)

	// 1m footprint count
	var fp1mCount int64
	_ = s.sqlDB.QueryRow(
		"SELECT COUNT(*) FROM market_footprint_1m WHERE symbol = ?", symbol,
	).Scan(&fp1mCount)

	// TF counts
	tfCounts := make(map[string]int64)
	for _, tf := range []string{"5m", "15m", "1h", "4h", "1d"} {
		var n int64
		_ = s.sqlDB.QueryRow(
			"SELECT COUNT(*) FROM market_footprint_tf WHERE symbol = ? AND timeframe = ?",
			symbol, tf,
		).Scan(&n)
		if n > 0 {
			tfCounts[tf] = n
		}
	}

	// Last timestamps
	lastTrade, _ := s.sqlDB.GetLastTradeTs(symbol)
	lastFP, _ := s.sqlDB.GetLastFootprint1mTs(symbol)

	writeJSON(w, 200, map[string]any{
		"symbol":              symbol,
		"trades_count":        tradeCount,
		"footprint_1m_count":  fp1mCount,
		"footprint_tf_count":  tfCounts,
		"last_trade_ts":       lastTrade,
		"last_footprint_1m_ts": lastFP,
	})
}

// ─── Helpers ─────────────────────────────────────────────────────────────

type candleJSON struct {
	Ts         int64                `json:"ts"`
	Open       float64              `json:"open"`
	High       float64              `json:"high"`
	Low        float64              `json:"low"`
	Close      float64              `json:"close"`
	Volume     float64              `json:"volume"`
	BuyVolume  float64              `json:"buy_volume"`
	SellVolume float64              `json:"sell_volume"`
	Delta      float64              `json:"delta"`
	CVD        float64              `json:"cvd"`
	Profile    []storage.PriceLevel `json:"profile,omitempty"`
}

func encodeCandles(fps []storage.FootprintRecord) []candleJSON {
	out := make([]candleJSON, len(fps))
	for i, fp := range fps {
		out[i] = encodeCandle(fp)
	}
	return out
}

func encodeCandle(fp storage.FootprintRecord) candleJSON {
	return candleJSON{
		Ts:         fp.MinuteTs,
		Open:       fp.Open,
		High:       fp.High,
		Low:        fp.Low,
		Close:      fp.Close,
		Volume:     fp.Volume,
		BuyVolume:  fp.BuyVolume,
		SellVolume: fp.SellVolume,
		Delta:      fp.Delta,
		CVD:        fp.CVD,
		Profile:    fp.Profile.Levels,
	}
}

func encodeProfile(p storage.FootprintProfile) []storage.PriceLevel {
	if len(p.Levels) == 0 {
		return []storage.PriceLevel{}
	}
	return p.Levels
}

// ─── POST /api/v1/archive/rotate ────────────────────────────────────────

func (s *Server) handleArchiveRotate(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonError(w, "use POST", http.StatusMethodNotAllowed)
		return
	}
	if s.sqlDB == nil {
		jsonError(w, "sqlite not available", http.StatusServiceUnavailable)
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	if symbol == "" {
		symbol = "BTCUSDT"
	}

	arcSvc := engine.NewArchiveService(s.sqlDB, s.log, s.cfg.DataDir)
	if err := arcSvc.RotateLastMonth(symbol); err != nil {
		jsonError(w, fmt.Sprintf("rotate failed: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, 200, map[string]string{
		"status": "ok",
		"symbol": symbol,
		"action": "rotate_last_month",
	})
}

// ─── GET /footprint.html — UI minimal ───────────────────────────────────

func (s *Server) handleFootprintUI(w http.ResponseWriter, r *http.Request) {
	htmlPath := "internal/ws/static/footprint.html"
	// Also try relative to executable
	if _, err := os.Stat(htmlPath); err != nil {
		// Try alternate paths for different working directories
		alt := []string{
			"services/market-go/internal/ws/static/footprint.html",
			"static/footprint.html",
			"../static/footprint.html",
		}
		found := false
		for _, p := range alt {
			if _, err := os.Stat(p); err == nil {
				htmlPath = p
				found = true
				break
			}
		}
		if !found {
			http.Error(w, "footprint.html not found", http.StatusNotFound)
			return
		}
	}
	http.ServeFile(w, r, htmlPath)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
