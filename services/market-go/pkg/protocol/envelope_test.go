package protocol

import (
	"encoding/json"
	"testing"
)

func TestEnvelopeMarshal(t *testing.T) {
	env := NewEnvelope("heartbeat", 7, map[string]string{"service": "market-go"})
	raw, err := env.MarshalJSONBytes()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded["type"] != "heartbeat" {
		t.Fatalf("unexpected type: %#v", decoded["type"])
	}
	if decoded["seq"].(float64) != 7 {
		t.Fatalf("unexpected seq: %#v", decoded["seq"])
	}
}
