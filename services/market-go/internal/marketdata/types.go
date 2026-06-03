package marketdata

type Trade struct {
	ID         string  `json:"id,omitempty"`
	TradeID    string  `json:"tradeId,omitempty"`
	Exchange   string  `json:"exchange"`
	Symbol     string  `json:"symbol"`
	TsExchange int64   `json:"tsExchange"`
	TsLocal    int64   `json:"tsLocal"`
	Price      float64 `json:"price"`
	Qty        float64 `json:"qty"`
	Side       string  `json:"side"`
	Notional   float64 `json:"notional"`
}

type OrderBookLevel struct {
	Price      float64 `json:"price"`
	Size       float64 `json:"size"`
	Orders     int     `json:"orders,omitempty"`
	Cumulative float64 `json:"cumulative"`
}

type OrderBookSnapshot struct {
	Exchange   string           `json:"exchange"`
	Symbol     string           `json:"symbol"`
	TsExchange int64            `json:"tsExchange"`
	TsLocal    int64            `json:"tsLocal"`
	Bids       []OrderBookLevel `json:"bids"`
	Asks       []OrderBookLevel `json:"asks"`
	BestBid    float64          `json:"bestBid"`
	BestAsk    float64          `json:"bestAsk"`
	Spread     float64          `json:"spread"`
	Mid        float64          `json:"mid"`
	Depth      int              `json:"depth"`
	Source     string           `json:"source"`
}

type Candle struct {
	Symbol    string  `json:"symbol"`
	Timeframe string  `json:"timeframe"`
	OpenTime  int64   `json:"openTime"`
	CloseTime int64   `json:"closeTime"`
	Open      float64 `json:"open"`
	High      float64 `json:"high"`
	Low       float64 `json:"low"`
	Close     float64 `json:"close"`
	Volume    float64 `json:"volume"`
	Delta     float64 `json:"delta"`
}

type DeltaBucket struct {
	Exchange   string  `json:"exchange,omitempty"`
	Symbol     string  `json:"symbol"`
	Timeframe  string  `json:"timeframe,omitempty"`
	IntervalMs int64   `json:"intervalMs"`
	StartTime  int64   `json:"startTime"`
	EndTime    int64   `json:"endTime"`
	BuyVol     float64 `json:"buyVol"`
	SellVol    float64 `json:"sellVol"`
	Delta      float64 `json:"delta"`
	CVD        float64 `json:"cvd"`
	Closed     bool    `json:"closed"`
}

type VWAPState struct {
	Exchange      string  `json:"exchange,omitempty"`
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

type FootprintLevel struct {
	Price    float64 `json:"price"`
	BuyVol   float64 `json:"buyVol"`
	SellVol  float64 `json:"sellVol"`
	Delta    float64 `json:"delta"`
	TotalVol float64 `json:"totalVol"`
	Trades   int     `json:"trades"`
}

type FootprintCandle struct {
	Exchange   string           `json:"exchange"`
	Symbol     string           `json:"symbol"`
	IntervalMs int64            `json:"intervalMs"`
	OpenTime   int64            `json:"openTime"`
	CloseTime  int64            `json:"closeTime"`
	Open       float64          `json:"open"`
	High       float64          `json:"high"`
	Low        float64          `json:"low"`
	Close      float64          `json:"close"`
	Volume     float64          `json:"volume"`
	BuyVol     float64          `json:"buyVol"`
	SellVol    float64          `json:"sellVol"`
	Delta      float64          `json:"delta"`
	POC        float64          `json:"poc"`
	Closed     bool             `json:"closed"`
	Levels     []FootprintLevel `json:"levels"`
	Source     string           `json:"source"`
}

type HeatmapLevel struct {
	Price     float64 `json:"price"`
	BidSize   float64 `json:"bidSize"`
	AskSize   float64 `json:"askSize"`
	TotalSize float64 `json:"totalSize"`
	Intensity float64 `json:"intensity"`
}

type HeatmapFrame struct {
	Exchange   string         `json:"exchange"`
	Symbol     string         `json:"symbol"`
	TsExchange int64          `json:"tsExchange"`
	TsLocal    int64          `json:"tsLocal"`
	Mid        float64        `json:"mid"`
	BestBid    float64        `json:"bestBid"`
	BestAsk    float64        `json:"bestAsk"`
	PriceMin   float64        `json:"priceMin"`
	PriceMax   float64        `json:"priceMax"`
	TickSize   float64        `json:"tickSize"`
	Levels     []HeatmapLevel `json:"levels"`
	Source     string         `json:"source"`
	Depth      int            `json:"depth"`
}
