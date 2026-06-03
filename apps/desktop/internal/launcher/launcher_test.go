package launcher

import (
	"net"
	"runtime"
	"testing"
	"time"
)

func TestPortFreeAndInUse(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	if PortFree(port) {
		t.Fatalf("port %d should be in use", port)
	}
	if !PortInUse(port) {
		t.Fatalf("PortInUse should be true for %d", port)
	}

	ln.Close()
	// Give the OS a moment to release the port.
	time.Sleep(100 * time.Millisecond)
	if !PortFree(port) {
		t.Logf("port %d not immediately free after close (acceptable on some OSes)", port)
	}
}

func TestWaitForHTTPTimeout(t *testing.T) {
	// Nothing listening here -> should time out quickly.
	err := WaitForHTTP("http://127.0.0.1:1/", 600*time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestSpecsBuild(t *testing.T) {
	flask, strategy, err := FlaskSpec("C:/repo", nil)
	if err != nil {
		t.Fatalf("FlaskSpec failed: %v", err)
	}
	if strategy != "python-fallback" {
		t.Fatalf("expected python-fallback strategy, got %s", strategy)
	}
	if flask.Name != "flask" || flask.Args[0] != "app.py" {
		t.Fatalf("unexpected flask spec: %+v", flask)
	}
	foundPort := false
	for _, e := range flask.Env {
		if e == "PORT=5001" {
			foundPort = true
		}
	}
	if !foundPort {
		t.Fatalf("flask env missing PORT=5001: %v", flask.Env)
	}

	md, strategy, err := MarketdSpec("C:/repo", "go", nil)
	if err != nil {
		t.Fatalf("MarketdSpec failed: %v", err)
	}
	if strategy != "go-run-fallback" {
		t.Fatalf("expected fallback strategy, got %s", strategy)
	}
	if md.Name != "marketd" || md.Args[0] != "run" {
		t.Fatalf("unexpected marketd spec: %+v", md)
	}
	if len(md.Env) == 0 || md.Env[0] != "MARKET_GO_EXCHANGE=hyperliquid" {
		t.Fatalf("marketd env not set correctly: %v", md.Env)
	}
}

func TestManagerStartStop(t *testing.T) {
	// Start a harmless long-lived child and confirm we can stop exactly it.
	var spec Spec
	if runtime.GOOS == "windows" {
		spec = Spec{Name: "sleeper", Bin: "cmd", Args: []string{"/c", "ping -n 30 127.0.0.1 >NUL"}}
	} else {
		spec = Spec{Name: "sleeper", Bin: "sleep", Args: []string{"30"}}
	}
	proc, err := Start(spec)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	mgr := NewManager()
	mgr.Add(proc)

	if pid := proc.PID(); pid == 0 {
		t.Fatal("expected non-zero pid")
	}
	stopped := mgr.StopAll()
	if len(stopped) != 1 {
		t.Fatalf("expected 1 stopped pid, got %v", stopped)
	}
}
