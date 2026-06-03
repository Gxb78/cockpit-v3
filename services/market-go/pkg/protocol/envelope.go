package protocol

import (
	"encoding/json"
	"time"
)

type Envelope struct {
	Type    string `json:"type"`
	Seq     uint64 `json:"seq"`
	TsLocal int64  `json:"tsLocal"`
	Payload any    `json:"payload"`
}

func NewEnvelope(eventType string, seq uint64, payload any) Envelope {
	return Envelope{
		Type:    eventType,
		Seq:     seq,
		TsLocal: NowMillis(),
		Payload: payload,
	}
}

func NowMillis() int64 {
	return time.Now().UnixMilli()
}

func (e Envelope) MarshalJSONBytes() ([]byte, error) {
	return json.Marshal(e)
}
