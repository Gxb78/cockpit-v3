package launcher

import (
	"fmt"
	"net"
	"net/http"
	"time"
)

// PortFree reports whether a TCP port on 127.0.0.1 is available to bind.
func PortFree(port int) bool {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

// PortInUse is the inverse of PortFree.
func PortInUse(port int) bool { return !PortFree(port) }

// WaitForHTTP polls url until it returns any HTTP response (status ignored) or
// the timeout elapses. Returns nil on success.
func WaitForHTTP(url string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 2 * time.Second}
	var lastErr error
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			_ = resp.Body.Close()
			return nil
		}
		lastErr = err
		time.Sleep(300 * time.Millisecond)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("timeout waiting for %s", url)
	}
	return fmt.Errorf("health check failed for %s: %w", url, lastErr)
}
