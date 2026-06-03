package hyperliquid

import (
	"encoding/json"
	"testing"
	"time"
)

func TestSubscribePayload(t *testing.T) {
	raw, err := subscribePayload("btc")
	if err != nil {
		t.Fatalf("subscribe payload: %v", err)
	}

	var decoded subscribeMessage
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("decode subscribe payload: %v", err)
	}
	if decoded.Method != "subscribe" {
		t.Fatalf("unexpected method: %s", decoded.Method)
	}
	if decoded.Subscription.Type != "trades" {
		t.Fatalf("unexpected subscription type: %s", decoded.Subscription.Type)
	}
	if decoded.Subscription.Coin != "BTC" {
		t.Fatalf("unexpected coin: %s", decoded.Subscription.Coin)
	}
}

func TestSubscribeBookPayload(t *testing.T) {
	raw, err := subscribeBookPayload("btc")
	if err != nil {
		t.Fatalf("subscribe book payload: %v", err)
	}

	var decoded subscribeMessage
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("decode subscribe book payload: %v", err)
	}
	if decoded.Method != "subscribe" {
		t.Fatalf("unexpected method: %s", decoded.Method)
	}
	if decoded.Subscription.Type != "l2Book" {
		t.Fatalf("unexpected subscription type: %s", decoded.Subscription.Type)
	}
	if decoded.Subscription.Coin != "BTC" {
		t.Fatalf("unexpected coin: %s", decoded.Subscription.Coin)
	}
}

func TestReconnectDelayCaps(t *testing.T) {
	if got := reconnectDelay(1); got != time.Second {
		t.Fatalf("unexpected first delay: %s", got)
	}
	if got := reconnectDelay(10); got != 15*time.Second {
		t.Fatalf("unexpected capped delay: %s", got)
	}
}

func TestWebsocketAccept(t *testing.T) {
	got := websocketAccept("dGhlIHNhbXBsZSBub25jZQ==")
	want := "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
	if got != want {
		t.Fatalf("unexpected accept: got %q want %q", got, want)
	}
}
