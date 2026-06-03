package calc

import "testing"

func TestUTCDaySession(t *testing.T) {
	info := UTCDaySession(1760054399999) // 2025-10-09T23:59:59.999Z
	if info.ID != "utc_day:2025-10-09" {
		t.Fatalf("unexpected session id: %s", info.ID)
	}
	if info.Start != 1759968000000 {
		t.Fatalf("unexpected session start: %d", info.Start)
	}
}

func TestSessionForDefaultsToUTCDay(t *testing.T) {
	info := SessionFor(1760054400000, "manual")
	if info.ID != "utc_day:2025-10-10" {
		t.Fatalf("unexpected fallback session id: %s", info.ID)
	}
}
