// Package app orchestrates the Cockpit V6 desktop launcher: it starts the
// existing Flask backend and Go market engine as managed child processes,
// waits for their health endpoints, and stops exactly those children on quit.
//
// This package has NO Wails dependency so it builds and tests without Wails
// installed. The Wails window lives in main (behind the `wails` build tag).
package app

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"cockpit-v6-desktop/internal/launcher"
)

const (
	WindowTitle  = "Cockpit V6"
	StartURL     = "http://127.0.0.1:5001/"
	WindowWidth  = 1600
	WindowHeight = 950
	MinWidth     = 1280
	MinHeight    = 720
)

// App holds runtime state for the desktop launcher.
type App struct {
	RepoRoot string
	GoBin    string
	Log      io.Writer
	mgr      *launcher.Manager
}

// New resolves the repo root (two levels up from apps/desktop) and prepares the
// process manager.
func New() (*App, error) {
	root, err := resolveRepoRoot()
	if err != nil {
		return nil, err
	}

	var logWriter io.Writer = os.Stdout

	// Resolve portable vs installed log path to prevent Python sidecar crashes
	// on closed/None stdout/stderr handles in Windows GUI subsystem.
	if execPath, err := os.Executable(); err == nil {
		execDir := filepath.Dir(execPath)
		var logDir string
		if _, err := os.Stat(filepath.Join(execDir, "portable.mode")); err == nil {
			// Portable mode -> log in executable's folder
			logDir = filepath.Join(execDir, "logs")
		} else {
			// Installed mode -> log in AppData folder
			if appData, err := os.UserConfigDir(); err == nil {
				logDir = filepath.Join(appData, "CockpitV6", "logs")
			}
		}

		if logDir != "" {
			if err := os.MkdirAll(logDir, 0755); err == nil {
				logFile := filepath.Join(logDir, "desktop.log")
				// Truncate previous log or create it
				if f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644); err == nil {
					logWriter = f
				}
			}
		}
	}

	return &App{
		RepoRoot: root,
		GoBin:    "go",
		Log:      logWriter,
		mgr:      launcher.NewManager(),
	}, nil
}

// resolveRepoRoot finds the repo root by walking up until app.py is found.
// In a standalone/portable environment where app.py is absent, it returns
// the current working directory as a safe fallback instead of erroring.
func resolveRepoRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir := wd
	for i := 0; i < 6; i++ {
		if _, err := os.Stat(filepath.Join(dir, "app.py")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	// Fallback to working directory for standalone portable execution.
	return wd, nil
}

func (a *App) logf(format string, args ...any) {
	if a.Log != nil {
		fmt.Fprintf(a.Log, "[desktop] "+format+"\n", args...)
	}
}

// Startup launches Flask + marketd if their ports are free, then waits for
// health. If a port is already in use it does NOT kill anything — it assumes a
// manually-started service is already serving and continues (matching the
// "manual workflow keeps working" rule).
func (a *App) Startup() error {
	a.logf("repo root: %s", a.RepoRoot)

	// Flask — also check common dev port 5000 in case the user ran
	// `python app.py` without setting PORT=5001.
	if launcher.PortInUse(launcher.FlaskPort) || launcher.PortInUse(5000) {
		a.logf("flask strategy: existing-port")
		a.logf("port %d (or 5000) already in use — assuming Flask is already running (not starting a new one)", launcher.FlaskPort)
	} else {
		spec, strategy, err := launcher.FlaskSpec(a.RepoRoot, a.Log)
		if err != nil {
			a.logf("WARNING: flask launcher spec error: %v", err)
		} else {
			a.logf("flask strategy: %s", strategy)
			a.logf("launch path: %s (args: %v, dir: %s)", spec.Bin, spec.Args, spec.Dir)
			proc, err := launcher.Start(spec)
			if err != nil {
				a.logf("WARNING: failed to start flask engine: %v", err)
			} else {
				a.mgr.Add(proc)
				a.logf("started flask pid=%d", proc.PID())
			}
		}
	}

	// marketd
	if launcher.PortInUse(launcher.MarketGoPort) {
		a.logf("marketd strategy: existing-port")
		a.logf("port %d already in use — assuming marketd is already running (not starting a new one)", launcher.MarketGoPort)
	} else {
		spec, strategy, err := launcher.MarketdSpec(a.RepoRoot, a.GoBin, a.Log)
		if err != nil {
			a.logf("WARNING: marketd launcher spec error: %v", err)
			a.logf("The app will continue in offline/mock mode.")
		} else {
			a.logf("marketd strategy: %s", strategy)
			a.logf("launch path: %s (args: %v, dir: %s)", spec.Bin, spec.Args, spec.Dir)
			proc, err := launcher.Start(spec)
			if err != nil {
				a.logf("WARNING: failed to start marketd engine: %v", err)
				a.logf("The app will continue in offline/mock mode.")
			} else {
				a.mgr.Add(proc)
				a.logf("started marketd pid=%d", proc.PID())
			}
		}
	}

	// Health waits — try the main port first, then fall back to 5000 (dev).
	flaskURL := launcher.FlaskHealth
	if launcher.PortFree(launcher.FlaskPort) && !launcher.PortFree(5000) {
		flaskURL = "http://127.0.0.1:5000/"
	}
	if err := launcher.WaitForHTTP(flaskURL, 40*time.Second); err != nil {
		return err
	}
	a.logf("flask healthy: %s", flaskURL)
	if err := launcher.WaitForHTTP(launcher.MarketGoHealth, 40*time.Second); err != nil {
		// marketd is allowed to be slow / optional; log but don't fail the window.
		a.logf("WARNING marketd health not confirmed: %v", err)
	} else {
		a.logf("marketd healthy: %s", launcher.MarketGoHealth)
	}
	return nil
}

// Shutdown stops only the children this app started.
func (a *App) Shutdown() {
	stopped := a.mgr.StopAll()
	if len(stopped) == 0 {
		a.logf("shutdown: no child processes to stop (services were external)")
		return
	}
	a.logf("shutdown: stopped child PIDs %v", stopped)
}

// ChildPIDs exposes the tracked children (for tests / diagnostics).
func (a *App) ChildPIDs() []int { return a.mgr.PIDs() }
