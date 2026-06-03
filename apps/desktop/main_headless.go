//go:build headless

// Headless build (`go run -tags headless .`): a launcher with NO window, for
// servers/CI or quick checks without Wails. It starts Flask + marketd, waits for
// health, prints the URL, and stays up until Ctrl+C — then stops the child
// processes cleanly. The default build (main.go) is the Wails desktop window.
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"cockpit-v6-desktop/internal/app"
)

func main() {
	a, err := app.New()
	if err != nil {
		fmt.Fprintln(os.Stderr, "desktop init error:", err)
		os.Exit(1)
	}

	fmt.Println("Cockpit V6 desktop launcher (headless mode — Wails not built in).")
	if err := a.Startup(); err != nil {
		fmt.Fprintln(os.Stderr, "startup error:", err)
		a.Shutdown()
		os.Exit(1)
	}
	fmt.Printf("Ready. Open %s in a browser, or build with -tags wails for the desktop window.\n", app.StartURL)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	fmt.Println("\nShutting down…")
	a.Shutdown()
}
