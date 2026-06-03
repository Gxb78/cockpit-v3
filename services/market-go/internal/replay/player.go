package replay

import (
	"context"
	"sync"
	"time"

	"cockpit-v6-market-go/internal/marketdata"
)

// Emit is called for each replayed trade, in order. The server wires this to
// the same engine pipeline + hub broadcast used by live data.
type Emit func(trade marketdata.Trade)

// StatusFn receives periodic progress updates for the UI.
type StatusFn func(Status)

type Status struct {
	State    string  `json:"state"`    // idle | loading | playing | paused | done | error
	Symbol   string  `json:"symbol"`
	Date     string  `json:"date"`
	Speed    float64 `json:"speed"`
	Total    int     `json:"total"`
	Index    int     `json:"index"`
	Progress float64 `json:"progress"` // 0..1
	ClockMs  int64   `json:"clockMs"`  // current replay timestamp
	Error    string  `json:"error,omitempty"`
}

// Player streams a loaded day of trades through Emit at a controllable speed.
// Speed is a wall-clock multiplier; speed<=0 means "as fast as possible".
type Player struct {
	source Source
	emit   Emit
	status StatusFn

	mu      sync.Mutex
	trades  []marketdata.Trade
	idx     int
	state   string
	symbol  string
	date    string
	speed   float64
	cancel  context.CancelFunc
	resume  chan struct{} // closed/recreated to unpause
	paused  bool
}

func NewPlayer(src Source, emit Emit, status StatusFn) *Player {
	return &Player{source: src, emit: emit, status: status, state: "idle", speed: 10}
}

func (p *Player) snapshot() Status {
	total := len(p.trades)
	prog := 0.0
	var clock int64
	if total > 0 {
		prog = float64(p.idx) / float64(total)
		if p.idx > 0 && p.idx <= total {
			clock = p.trades[p.idx-1].TsExchange
		}
	}
	return Status{
		State: p.state, Symbol: p.symbol, Date: p.date, Speed: p.speed,
		Total: total, Index: p.idx, Progress: prog, ClockMs: clock,
	}
}

func (p *Player) emitStatus() {
	if p.status != nil {
		p.status(p.snapshot())
	}
}

// Start loads the day and begins streaming. Any previous run is stopped.
func (p *Player) Start(symbol, date string, speed float64) {
	p.Stop()
	p.mu.Lock()
	p.symbol, p.date, p.speed = symbol, date, speed
	p.state = "loading"
	p.idx = 0
	p.paused = false
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	p.mu.Unlock()
	p.emitStatus()

	go p.run(ctx)
}

func (p *Player) run(ctx context.Context) {
	trades, err := p.source.LoadDay(ctx, p.symbol, p.date)
	if err != nil {
		p.mu.Lock()
		p.state = "error"
		p.mu.Unlock()
		if p.status != nil {
			st := p.snapshot()
			st.Error = err.Error()
			p.status(st)
		}
		return
	}

	p.mu.Lock()
	p.trades = trades
	p.state = "playing"
	p.mu.Unlock()
	p.emitStatus()

	var prevTs int64
	statusEvery := 2000
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		p.mu.Lock()
		if p.paused {
			p.mu.Unlock()
			time.Sleep(60 * time.Millisecond)
			continue
		}
		if p.idx >= len(p.trades) {
			p.state = "done"
			p.mu.Unlock()
			p.emitStatus()
			return
		}
		t := p.trades[p.idx]
		speed := p.speed
		p.idx++
		idx := p.idx
		p.mu.Unlock()

		// Inter-trade pacing (wall-clock scaled by speed). speed<=0 = max speed.
		if speed > 0 && prevTs > 0 {
			gap := t.TsExchange - prevTs
			if gap > 0 {
				d := time.Duration(float64(gap)/speed) * time.Millisecond
				if d > 250*time.Millisecond {
					d = 250 * time.Millisecond // cap idle gaps
				}
				if d > 0 {
					timer := time.NewTimer(d)
					select {
					case <-ctx.Done():
						timer.Stop()
						return
					case <-timer.C:
					}
				}
			}
		}
		prevTs = t.TsExchange

		if p.emit != nil {
			p.emit(t)
		}
		if idx%statusEvery == 0 {
			p.emitStatus()
		}
	}
}

func (p *Player) Pause() {
	p.mu.Lock()
	if p.state == "playing" {
		p.paused = true
		p.state = "paused"
	}
	p.mu.Unlock()
	p.emitStatus()
}

func (p *Player) Resume() {
	p.mu.Lock()
	if p.state == "paused" {
		p.paused = false
		p.state = "playing"
	}
	p.mu.Unlock()
	p.emitStatus()
}

func (p *Player) SetSpeed(speed float64) {
	p.mu.Lock()
	p.speed = speed
	p.mu.Unlock()
	p.emitStatus()
}

func (p *Player) Stop() {
	p.mu.Lock()
	if p.cancel != nil {
		p.cancel()
		p.cancel = nil
	}
	p.state = "idle"
	p.paused = false
	p.mu.Unlock()
}

func (p *Player) Status() Status {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.snapshot()
}
