package hyperliquid

import "encoding/json"

const (
	ExchangeName = "hyperliquid"
	DefaultWSURL = "wss://api.hyperliquid.xyz/ws"
)

type subscribeMessage struct {
	Method       string       `json:"method"`
	Subscription subscription `json:"subscription"`
}

type subscription struct {
	Type string `json:"type"`
	Coin string `json:"coin"`
}

type streamMessage struct {
	Channel string          `json:"channel"`
	Data    json.RawMessage `json:"data"`
}

type WsTrade struct {
	Coin  string   `json:"coin"`
	Side  string   `json:"side"`
	Px    string   `json:"px"`
	Sz    string   `json:"sz"`
	Hash  string   `json:"hash"`
	Time  int64    `json:"time"`
	TID   int64    `json:"tid"`
	Users []string `json:"users"`
}

type WsLevel struct {
	Px string `json:"px"`
	Sz string `json:"sz"`
	N  int    `json:"n"`
}

type WsBook struct {
	Coin   string       `json:"coin"`
	Levels [2][]WsLevel `json:"levels"`
	Time   int64        `json:"time"`
}
