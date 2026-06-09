package ws

import (
	"encoding/json"
	"net/http"
	"strings"

	"cockpit-v6-market-go/internal/engine"
	"cockpit-v6-market-go/internal/marketdata"
	"cockpit-v6-market-go/internal/replay"
)

// replayController owns the backtest player and its HTTP control endpoint. The
// player feeds replayed trades into the shared engine pipeline through the
// injected emit callback (Server.replayEmit, also used by the live exchange),
// and pushes progress back as replay_status envelopes via status.
type replayController struct {
	player *replay.Player
	engine *engine.Engine
	hub    broadcaster
}

func newReplayController(eng *engine.Engine, hub broadcaster, emit func(marketdata.Trade)) *replayController {
	c := &replayController{engine: eng, hub: hub}
	c.player = replay.NewPlayer(replay.NewBinanceSource(), emit, c.status)
	return c
}

// status broadcasts a replay_status envelope to all stream clients.
func (c *replayController) status(st replay.Status) {
	env := c.engine.ReplayStatus(st)
	if raw, err := env.MarshalJSONBytes(); err == nil {
		c.hub.Broadcast(raw)
	}
}

type replayCommand struct {
	Action string  `json:"action"` // start | pause | resume | step | speed | stop | status
	Symbol string  `json:"symbol"`
	Date   string  `json:"date"`
	Speed  float64 `json:"speed"`
	Count  int     `json:"count"`
}

// handleReplay controls the backtest player. The browser POSTs JSON commands;
// progress is pushed back over the WS stream as replay_status envelopes.
func (c *replayController) handleReplay(w http.ResponseWriter, r *http.Request) {
	// CORS + OPTIONS preflight are handled by the global middleware in Handler().
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var cmd replayCommand
	if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	switch cmd.Action {
	case "start":
		symbol := strings.ToUpper(strings.TrimSpace(cmd.Symbol))
		if symbol == "" {
			symbol = "BTCUSDT"
		}
		if strings.TrimSpace(cmd.Date) == "" {
			http.Error(w, "date required (YYYY-MM-DD)", http.StatusBadRequest)
			return
		}
		// speed<=0 means "as fast as possible" (UI "Max"); pass through as-is.
		c.player.Start(symbol, cmd.Date, cmd.Speed)
	case "pause":
		c.player.Pause()
	case "resume":
		c.player.Resume()
	case "step":
		c.player.Step(cmd.Count)
	case "speed":
		c.player.SetSpeed(cmd.Speed)
	case "stop":
		c.player.Stop()
	case "status":
		// fallthrough to response below
	default:
		http.Error(w, "unknown action", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, c.player.Status())
}
