package calc

import (
	"strings"
	"time"
)

const SessionResetUTCDay = "utc_day"

type SessionInfo struct {
	ID    string
	Start int64
}

func SessionFor(tsMillis int64, reset string) SessionInfo {
	switch strings.ToLower(strings.TrimSpace(reset)) {
	case "", SessionResetUTCDay:
		return UTCDaySession(tsMillis)
	default:
		return UTCDaySession(tsMillis)
	}
}

func UTCDaySession(tsMillis int64) SessionInfo {
	t := time.UnixMilli(tsMillis).UTC()
	start := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return SessionInfo{
		ID:    "utc_day:" + start.Format("2006-01-02"),
		Start: start.UnixMilli(),
	}
}
