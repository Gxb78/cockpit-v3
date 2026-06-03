package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"
)

const websocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

type envelope struct {
	Type    string          `json:"type"`
	Seq     uint64          `json:"seq"`
	TsLocal int64           `json:"tsLocal"`
	Payload json.RawMessage `json:"payload"`
}

type tradePayload struct {
	Exchange   string  `json:"exchange"`
	Symbol     string  `json:"symbol"`
	TradeID    string  `json:"tradeId"`
	TsExchange int64   `json:"tsExchange"`
	TsLocal    int64   `json:"tsLocal"`
	Price      float64 `json:"price"`
	Qty        float64 `json:"qty"`
	Side       string  `json:"side"`
}

type deltaBucketPayload struct {
	Exchange   string  `json:"exchange"`
	Symbol     string  `json:"symbol"`
	IntervalMs int64   `json:"intervalMs"`
	StartTime  int64   `json:"startTime"`
	EndTime    int64   `json:"endTime"`
	BuyVol     float64 `json:"buyVol"`
	SellVol    float64 `json:"sellVol"`
	Delta      float64 `json:"delta"`
	CVD        float64 `json:"cvd"`
	Closed     bool    `json:"closed"`
}

type vwapPayload struct {
	Exchange      string  `json:"exchange"`
	Symbol        string  `json:"symbol"`
	SessionID     string  `json:"sessionId"`
	SessionStart  int64   `json:"sessionStart"`
	CoverageStart int64   `json:"coverageStart"`
	LastUpdateTs  int64   `json:"lastUpdateTs"`
	CumPV         float64 `json:"cumPV"`
	CumVol        float64 `json:"cumVol"`
	Value         float64 `json:"value"`
	Source        string  `json:"source"`
	IsWarm        bool    `json:"isWarm"`
}

type orderBookPayload struct {
	Exchange   string  `json:"exchange"`
	Symbol     string  `json:"symbol"`
	TsExchange int64   `json:"tsExchange"`
	TsLocal    int64   `json:"tsLocal"`
	BestBid    float64 `json:"bestBid"`
	BestAsk    float64 `json:"bestAsk"`
	Spread     float64 `json:"spread"`
	Mid        float64 `json:"mid"`
	Depth      int     `json:"depth"`
	Source     string  `json:"source"`
}

type heatmapFramePayload struct {
	Exchange   string         `json:"exchange"`
	Symbol     string         `json:"symbol"`
	TsExchange int64          `json:"tsExchange"`
	TsLocal    int64          `json:"tsLocal"`
	Mid        float64        `json:"mid"`
	BestBid    float64        `json:"bestBid"`
	BestAsk    float64        `json:"bestAsk"`
	PriceMin   float64        `json:"priceMin"`
	PriceMax   float64        `json:"priceMax"`
	Levels     []heatmapLevel `json:"levels"`
	Source     string         `json:"source"`
	Depth      int            `json:"depth"`
}

type heatmapLevel struct {
	Intensity float64 `json:"intensity"`
}

type footprintPayload struct {
	Exchange   string  `json:"exchange"`
	Symbol     string  `json:"symbol"`
	IntervalMs int64   `json:"intervalMs"`
	Open       float64 `json:"open"`
	High       float64 `json:"high"`
	Low        float64 `json:"low"`
	Close      float64 `json:"close"`
	Volume     float64 `json:"volume"`
	Delta      float64 `json:"delta"`
	POC        float64 `json:"poc"`
	Closed     bool    `json:"closed"`
	Levels     []any   `json:"levels"`
	Source     string  `json:"source"`
}

func main() {
	addr := flag.String("addr", "ws://127.0.0.1:8765/stream", "local market-go stream URL")
	targetTrades := flag.Int("trades", 20, "number of trade envelopes to read before exiting")
	targetDeltaBuckets := flag.Int("delta-buckets", 1, "number of delta_bucket envelopes to read before exiting")
	targetVWAPs := flag.Int("vwaps", 1, "number of vwap envelopes to read before exiting")
	targetOrderBooks := flag.Int("order-books", 1, "number of order_book envelopes to read before exiting")
	targetHeatmapFrames := flag.Int("heatmap-frames", 1, "number of heatmap_frame envelopes to read before exiting")
	targetFootprintCandles := flag.Int("footprint-candles", 1, "number of footprint_candle envelopes to read before exiting")
	timeout := flag.Duration("timeout", 60*time.Second, "maximum read duration")
	flag.Parse()

	if err := run(*addr, *targetTrades, *targetDeltaBuckets, *targetVWAPs, *targetOrderBooks, *targetHeatmapFrames, *targetFootprintCandles, *timeout); err != nil {
		fmt.Fprintf(os.Stderr, "streamcheck failed: %v\n", err)
		os.Exit(1)
	}
}

func run(addr string, targetTrades int, targetDeltaBuckets int, targetVWAPs int, targetOrderBooks int, targetHeatmapFrames int, targetFootprintCandles int, timeout time.Duration) error {
	if targetTrades <= 0 {
		targetTrades = 0
	}
	if targetDeltaBuckets < 0 {
		targetDeltaBuckets = 0
	}
	if targetVWAPs < 0 {
		targetVWAPs = 0
	}
	if targetOrderBooks < 0 {
		targetOrderBooks = 0
	}
	if targetHeatmapFrames < 0 {
		targetHeatmapFrames = 0
	}
	if targetFootprintCandles < 0 {
		targetFootprintCandles = 0
	}
	if targetTrades == 0 && targetDeltaBuckets == 0 && targetVWAPs == 0 && targetOrderBooks == 0 && targetHeatmapFrames == 0 && targetFootprintCandles == 0 {
		targetTrades = 1
	}
	u, err := url.Parse(addr)
	if err != nil {
		return err
	}
	if u.Scheme != "ws" {
		return fmt.Errorf("only local ws:// URLs are supported, got %s", u.Scheme)
	}

	conn, reader, err := dial(u, timeout)
	if err != nil {
		return err
	}
	defer conn.Close()

	deadline := time.Now().Add(timeout)
	_ = conn.SetReadDeadline(deadline)

	start := time.Now()
	messages := 0
	trades := 0
	deltaBuckets := 0
	vwaps := 0
	orderBooks := 0
	heatmapFrames := 0
	footprintCandles := 0
	var last tradePayload
	var lastDelta deltaBucketPayload
	var lastVWAP vwapPayload
	var lastBook orderBookPayload
	var lastHeatmap heatmapFramePayload
	var lastFootprint footprintPayload

	for trades < targetTrades || deltaBuckets < targetDeltaBuckets || vwaps < targetVWAPs || orderBooks < targetOrderBooks || heatmapFrames < targetHeatmapFrames || footprintCandles < targetFootprintCandles {
		payload, err := readNextTextPayload(reader)
		if err != nil {
			return err
		}
		messages++

		var env envelope
		if err := json.Unmarshal(payload, &env); err != nil {
			continue
		}
		switch env.Type {
		case "trade":
			var trade tradePayload
			if err := json.Unmarshal(env.Payload, &trade); err != nil {
				return err
			}
			trades++
			last = trade
		case "delta_bucket":
			var bucket deltaBucketPayload
			if err := json.Unmarshal(env.Payload, &bucket); err != nil {
				return err
			}
			deltaBuckets++
			lastDelta = bucket
		case "vwap":
			var vwap vwapPayload
			if err := json.Unmarshal(env.Payload, &vwap); err != nil {
				return err
			}
			vwaps++
			lastVWAP = vwap
		case "order_book":
			var book orderBookPayload
			if err := json.Unmarshal(env.Payload, &book); err != nil {
				return err
			}
			orderBooks++
			lastBook = book
		case "heatmap_frame":
			var heatmap heatmapFramePayload
			if err := json.Unmarshal(env.Payload, &heatmap); err != nil {
				return err
			}
			heatmapFrames++
			lastHeatmap = heatmap
		case "footprint_candle":
			var footprint footprintPayload
			if err := json.Unmarshal(env.Payload, &footprint); err != nil {
				return err
			}
			footprintCandles++
			lastFootprint = footprint
		}
	}

	elapsed := time.Since(start).Round(time.Millisecond)
	fmt.Printf("streamcheck ok addr=%s messages=%d trades=%d deltaBuckets=%d vwaps=%d orderBooks=%d heatmapFrames=%d footprintCandles=%d elapsed=%s lastTrade=%s %s %.8f @ %.2f side=%s lastDelta=%s %s intervalMs=%d delta=%.8f cvd=%.8f closed=%t lastVWAP=%s %s value=%.8f coverageStart=%d isWarm=%t cumPV=%.8f cumVol=%.8f lastBook=%s %s bestBid=%.2f bestAsk=%.2f spread=%.2f depth=%d source=%s lastHeatmap=%s %s levels=%d priceMin=%.2f priceMax=%.2f mid=%.2f maxIntensity=%.2f lastFootprint=%s %s intervalMs=%d ohlc=%.2f/%.2f/%.2f/%.2f volume=%.8f delta=%.8f poc=%.2f levels=%d closed=%t source=%s\n",
		addr, messages, trades, deltaBuckets, vwaps, orderBooks, heatmapFrames, footprintCandles, elapsed,
		last.Exchange, last.Symbol, last.Qty, last.Price, last.Side,
		lastDelta.Exchange, lastDelta.Symbol, lastDelta.IntervalMs, lastDelta.Delta, lastDelta.CVD, lastDelta.Closed,
		lastVWAP.Exchange, lastVWAP.Symbol, lastVWAP.Value, lastVWAP.CoverageStart, lastVWAP.IsWarm, lastVWAP.CumPV, lastVWAP.CumVol,
		lastBook.Exchange, lastBook.Symbol, lastBook.BestBid, lastBook.BestAsk, lastBook.Spread, lastBook.Depth, lastBook.Source,
		lastHeatmap.Exchange, lastHeatmap.Symbol, len(lastHeatmap.Levels), lastHeatmap.PriceMin, lastHeatmap.PriceMax, lastHeatmap.Mid, maxIntensity(lastHeatmap.Levels),
		lastFootprint.Exchange, lastFootprint.Symbol, lastFootprint.IntervalMs, lastFootprint.Open, lastFootprint.High, lastFootprint.Low, lastFootprint.Close, lastFootprint.Volume, lastFootprint.Delta, lastFootprint.POC, len(lastFootprint.Levels), lastFootprint.Closed, lastFootprint.Source)
	return nil
}

func maxIntensity(levels []heatmapLevel) float64 {
	max := 0.0
	for _, level := range levels {
		if level.Intensity > max {
			max = level.Intensity
		}
	}
	return max
}

func dial(u *url.URL, timeout time.Duration) (net.Conn, *bufio.Reader, error) {
	dialer := net.Dialer{Timeout: timeout}
	conn, err := dialer.Dial("tcp", websocketAddr(u))
	if err != nil {
		return nil, nil, err
	}

	key, err := websocketKey()
	if err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	path := u.RequestURI()
	if path == "" {
		path = "/"
	}
	req := "GET " + path + " HTTP/1.1\r\n" +
		"Host: " + u.Host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}

	reader := bufio.NewReader(conn)
	res, err := http.ReadResponse(reader, &http.Request{Method: http.MethodGet})
	if err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	if res.StatusCode != http.StatusSwitchingProtocols {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("websocket upgrade failed: %s", res.Status)
	}
	if got, want := res.Header.Get("Sec-WebSocket-Accept"), websocketAccept(key); got != want {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("websocket accept mismatch")
	}
	return conn, reader, nil
}

func websocketAddr(u *url.URL) string {
	if _, _, err := net.SplitHostPort(u.Host); err == nil {
		return u.Host
	}
	return net.JoinHostPort(u.Host, "80")
}

func websocketKey() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(raw[:]), nil
}

func websocketAccept(key string) string {
	sum := sha1.Sum([]byte(key + websocketGUID))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func readNextTextPayload(reader *bufio.Reader) ([]byte, error) {
	for {
		opcode, payload, err := readFrame(reader)
		if err != nil {
			return nil, err
		}
		switch opcode {
		case 0x1:
			return payload, nil
		case 0x8:
			return nil, io.EOF
		default:
			continue
		}
	}
}

func readFrame(reader *bufio.Reader) (byte, []byte, error) {
	first, err := reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	second, err := reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}

	opcode := first & 0x0f
	masked := second&0x80 != 0
	length := uint64(second & 0x7f)
	switch length {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(reader, ext[:]); err != nil {
			return 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(reader, ext[:]); err != nil {
			return 0, nil, err
		}
		length = binary.BigEndian.Uint64(ext[:])
	}

	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(reader, mask[:]); err != nil {
			return 0, nil, err
		}
	}

	payload := make([]byte, int(length))
	if _, err := io.ReadFull(reader, payload); err != nil {
		return 0, nil, err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return opcode, payload, nil
}
