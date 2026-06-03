//go:build !headless

// Default build: the Wails desktop app. `wails dev` / `wails build` compile this
// (no special tag needed), which is what the Wails binding generator expects.
//
// Strategy: start Flask + marketd via the launcher, then open a Wails window
// whose embedded asset is a tiny redirector to http://127.0.0.1:5001/. We don't
// migrate the frontend into Wails — the window simply hosts the existing app.
package main

import (
	"context"
	"embed"
	"fmt"
	"os"

	"cockpit-v6-desktop/internal/app"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed frontend/dist
var assets embed.FS

type bridge struct {
	app *app.App
	ctx context.Context
}

func (b *bridge) startup(ctx context.Context) {
	b.ctx = ctx
	if err := b.app.Startup(); err != nil {
		fmt.Fprintln(os.Stderr, "startup error:", err)
	}
}

func (b *bridge) shutdown(ctx context.Context) {
	b.app.Shutdown()
}

func main() {
	a, err := app.New()
	if err != nil {
		fmt.Fprintln(os.Stderr, "desktop init error:", err)
		os.Exit(1)
	}
	b := &bridge{app: a}

	err = wails.Run(&options.App{
		Title:     app.WindowTitle,
		Width:     app.WindowWidth,
		Height:    app.WindowHeight,
		MinWidth:  app.MinWidth,
		MinHeight: app.MinHeight,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 6, G: 8, B: 12, A: 1},
		OnStartup:        b.startup,
		OnShutdown:       b.shutdown,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "wails run error:", err)
		os.Exit(1)
	}
}
