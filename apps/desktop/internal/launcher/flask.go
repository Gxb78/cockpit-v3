package launcher

import (
	"io"
	"os"
	"path/filepath"
	"runtime"
)

const (
	FlaskPort     = 5001
	FlaskHealth   = "http://127.0.0.1:5001/"
	MarketGoPort  = 8765
	MarketGoHealth = "http://127.0.0.1:8765/health"
)

// venvPython returns the path to the project's virtualenv python.
func venvPython(repoRoot string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(repoRoot, ".venv", "Scripts", "python.exe")
	}
	return filepath.Join(repoRoot, ".venv", "bin", "python")
}

// FlaskSpec resolves the launch strategy for Flask backend.
// 1. Check next to running executable (production/wails sidecar path)
// 2. Check apps/desktop/bin/journal-server.exe (development binary path)
// 3. Fallback to virtualenv Python `app.py` in repo root
func FlaskSpec(repoRoot string, log io.Writer) (Spec, string, error) {
	// 1. Try next to running executable (Wails production sidecar)
	if execPath, err := os.Executable(); err == nil {
		execDir := filepath.Dir(execPath)
		prodPath := filepath.Join(execDir, "journal-server.exe")
		if _, err := os.Stat(prodPath); err == nil {
			return Spec{
				Name: "flask",
				Bin:  prodPath,
				Args: []string{},
				Dir:  execDir,
				Env: []string{
					"PORT=5001",
					"OPEN_BROWSER=0",
				},
				Log: log,
			}, "prod-sidecar", nil
		}
	}

	// 2. Try development path: apps/desktop/bin/journal-server.exe
	devPath := filepath.Join(repoRoot, "apps", "desktop", "bin", "journal-server.exe")
	if _, err := os.Stat(devPath); err == nil {
		return Spec{
			Name: "flask",
			Bin:  devPath,
			Args: []string{},
			Dir:  filepath.Join(repoRoot, "apps", "desktop", "bin"),
			Env: []string{
				"PORT=5001",
				"OPEN_BROWSER=0",
			},
			Log: log,
		}, "dev-sidecar", nil
	}

	// 3. Fallback to python app.py
	return Spec{
		Name: "flask",
		Bin:  venvPython(repoRoot),
		Args: []string{"app.py"},
		Dir:  repoRoot,
		Env: []string{
			"PORT=5001",
			"OPEN_BROWSER=0",
		},
		Log: log,
	}, "python-fallback", nil
}
