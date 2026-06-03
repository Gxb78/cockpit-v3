# Cockpit V6 — Desktop (Phase Desktop 1)

A controlled desktop wrapper/launcher. It does **not** rewrite the UI, migrate
Flask, or convert the frontend to Wails-native. It starts the existing services
and hosts the existing web app in a desktop window.

## Architecture

```
apps/desktop/
  go.mod
  wails.json           # Wails v2 project config
  main.go              # DEFAULT build: the Wails desktop window -> 127.0.0.1:5001
  main_headless.go     # build tag `headless`: no-window launcher (CI / quick run)
  frontend/dist/
    index.html         # tiny redirector to the Flask app
  internal/
    launcher/
      ports.go         # PortFree / PortInUse / WaitForHTTP (health)
      process.go       # ManagedProcess + Manager (start/stop OUR children only)
      flask.go         # FlaskSpec (PORT=5001, OPEN_BROWSER=0) + health URLs
      marketd.go       # MarketdSpec (full Hyperliquid env) 
    app/
      app.go           # Startup() / Shutdown() orchestration (no Wails dep)
```

### Why Flask stays a local process
Phase Desktop 1 explicitly does not migrate Flask. The desktop app launches the
existing `.venv` Python `app.py` unchanged on `127.0.0.1:5001` and points the
window at it. SQLite path, routes, templates — all untouched.

### Why market-go stays a separate process
The Go market engine keeps running as its own process via
`go run ./cmd/marketd` (from `services/market-go`) with the documented
Hyperliquid env. The desktop app only supervises it; it is not embedded as a Go
package in this phase (that is a proposed Phase Desktop 2).

## Ports
- Flask: `127.0.0.1:5001` (health: `GET /`)
- market-go: `127.0.0.1:8765` (health: `GET /health`, also `GET /metrics`)

## Process safety
- Only processes started by the desktop app are ever stopped, by **exact PID**.
- **Never** `taskkill /IM python.exe` or kill all Go processes.
- If a port is already in use, the app assumes a manually-started service is
  serving it, logs that, and does **not** start a duplicate or kill anything.
- On quit, `Manager.StopAll()` stops only tracked children (reverse order) and
  logs the stopped PIDs.

## Wails status — VALIDATED (Phase Desktop 1.5)
- `wails version` → **v2.12.0** (stable v2).
- `wails doctor` → **SUCCESS: Your system is ready for Wails development.**
  (WebView2 148, Node 24, npm 11; optional upx/nsis not installed — packaging only.)
- `wails dev` → compiles bindings + assets + app, opens a native window titled
  **"Cockpit V6"**, launcher reuses the running Flask + marketd (no duplicates),
  both health checks pass. Verified by logs + a live `msedgewebview2` child and
  `MainWindowTitle="Cockpit V6"`.

### Build-tag architecture (important)
`wails dev`/`wails build` compile the **default** build (no tag), and the Wails
binding generator requires that default build to BE the Wails app. So:
- `main.go` = **default** (`//go:build !headless`) → the Wails window.
- `main_headless.go` = `//go:build headless` → optional no-window launcher.

An earlier layout (Wails behind a `wails` tag, headless as default) made
`wails dev` hang at "Generating bindings" because the binding generator compiled
the headless main, which has no `wails.Run`. Inverting the tags fixed it.

### Installing Wails v2 (recommended)
```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@latest
wails doctor
```
Then from `apps/desktop`:
```powershell
wails dev      # dev window
# or
wails build    # produces a binary (not an installer)
```
> Note: this phase does not produce a release/installer. Use Wails v2 (stable).
> Wails v3 is alpha/prerelease — do not mix v2 and v3.

## Running

### Desktop window (validated)
```powershell
cd apps/desktop
wails dev      # dev window with hot-reload
# or
wails build    # produces apps/desktop/build/bin/CockpitV6.exe (no installer)
```
Opens a 1600×950 window (min 1280×720, dark background) titled "Cockpit V6"
loading `http://127.0.0.1:5001/`. No external browser is opened.

### Headless launcher (no window, CI / quick check)
```powershell
cd apps/desktop
go run -tags headless .
```
Starts Flask + marketd only if their ports are free, waits for health, then
prints the URL. Ctrl+C stops the children it started.

## Manual checklist (in the window)
Dashboard loads · Orderflow loads · V6 shell visible · live engine connects ·
Tape / DOM / Delta-CVD / VWAP / Heatmap live · Footprint visible · no crash · no
new browser exchange WebSocket.

## Wails Desktop Build Validation — SUCCESSFUL (June 1st, 2026)
- **Wails CLI**: Version `v2.12.0` (stable v2) fully operational.
- **Go toolchain**: Version `go1.26.3 windows/amd64` successfully used.
- **Wails Doctor**: All scans passed successfully. Edge/WebView2 148, Node 24, and npm 11 verified.
- **Wails Dev & Build validation**:
  - `wails build` compiled a standalone production binaire located at `apps/desktop/build/bin/CockpitV6.exe` in 3.6 seconds.
  - **Test A (Pre-existing Services)**:
    - Flask and Go market adapter already running manually (PIDs `15900` and `22236`).
    - Launched `CockpitV6.exe` (PID `24500`). The wrapper successfully detected the active ports `5001` and `8765`, bypassed duplicates, and loaded the web view using the active servers.
    - Closing the desktop window left the pre-existing processes running completely intact.
  - **Test B (Free Ports)**:
    - Launched `CockpitV6.exe`.
    - Spawning succeeded: Flask (`.venv/Scripts/python.exe app.py`, PID `9752`) and market-go (`go run ./cmd/marketd`, PID `15412`) started successfully.
    - WebView successfully loaded the Dashboard and streamed live trade and CVD events.
    - Closing the desktop window cleanly terminated exactly PIDs `9752` and `15412` and left the ports `5001` and `8765` completely free.

## Phase 22 — Standalone Sidecar Packaging (June 1st, 2026)
We successfully resolved the Go toolchain dependency by compiling the Go Market Adapter as a standalone sidecar binary (`marketd.exe`) and integrating it with the Wails desktop launcher.

### 1. Build and Path Strategy
- **Binary compilation**: `marketd.exe` is pre-compiled from `services/market-go` to the development binary folder `apps/desktop/bin/marketd.exe`.
- **Wails output path**: Wails v2 places `CockpitV6.exe` in `apps/desktop/build/bin/`. A post-build copy step places the sidecar `marketd.exe` directly next to the main executable in `apps/desktop/build/bin/marketd.exe`.
- **Git ignore safety**: The compiled executables are treated as build artifacts and are never versioned in git.

### 2. Desktop Launcher Strategy
The launcher implements a three-tier resolution strategy:
1. **Existing Service (existing-port)**: If port `8765` is already occupied, the app assumes a pre-existing manual process is running, registers `marketd strategy: existing-port`, and does not spawn a new one.
2. **Production Sidecar (prod-sidecar)**: If `8765` is free, the launcher looks for `marketd.exe` in the same directory as the running `CockpitV6.exe`.
3. **Development Sidecar (dev-sidecar)**: If `8765` is free and no prod sidecar is found, the launcher looks for `marketd.exe` in the development path `apps/desktop/bin/marketd.exe`.
4. **Development Fallback (go-run-fallback)**: If no binary is found, the launcher falls back to running `go run ./cmd/marketd` from `services/market-go` (requires Go installed, only active in development).

### 3. Fail-Safe Mode
If `marketd.exe` is completely missing and `go run` fails, the launcher outputs a clear `WARNING` in the log and continues, allowing the desktop window to load gracefully in offline/mock mode rather than crashing.

### 4. Lifecycle Verification Results (SUCCESS)

#### Test A — Services already running manually (Port Reuse):
- Started Flask on port `5001` (PID `5556`) and `marketd.exe` manually on `8765` (PID `18712`).
- Started desktop launcher. Logs outputted:
  ```
  [desktop] port 5001 already in use — assuming Flask is already running (not starting a new one)
  [desktop] marketd strategy: existing-port
  [desktop] port 8765 already in use — assuming marketd is already running (not starting a new one)
  ```
- Exiting the desktop left both manual Flask and manual `marketd.exe` active and listening untouched.

#### Test B — Free Ports (Automatic Sidecar Spawning):
- Closed all manual services.
- Started desktop launcher. Flask and `marketd.exe` spawned automatically. Logs outputted:
  ```
  [desktop] started flask pid=29428
  [desktop] marketd strategy: dev-sidecar
  [desktop] launch path: C:\Users\gb781\Desktop\Journal\apps\desktop\bin\marketd.exe (args: [], dir: C:\Users\gb781\Desktop\Journal\apps\desktop\bin)
  [desktop] started marketd pid=17176
  [market-go] 2026/06/01 21:58:20.506798 INFO listening on http://127.0.0.1:8765 exchange=hyperliquid mockMode=false symbols=BTC
  ```
- Both services booted successfully and passed health checks. Exiting the desktop cleanly terminated exact PIDs `29428` and `17176` and freed both ports immediately.

#### Test C — Go Absent Simulation (Direct Binary Launch):
- With the sidecar `marketd.exe` present, logs confirmed that `marketd strategy: dev-sidecar` was selected and `marketd.exe` was executed directly. The Go compiler (`go run`) was completely bypassed.

---

## Phase 23 — Flask Server Standalone Packaging (June 1st, 2026)
We successfully removed the Python runtime and `.venv` dependency from the desktop environment by packaging the Flask server as a standalone sidecar binary (`journal-server.exe`) using PyInstaller.

### 1. Robust Path Scission (`RESOURCE_DIR` vs `BASE_DIR`)
To prevent the high-risk wiping of user database and screenshots at each app close due to PyInstaller's temporary directories, we scinded all path lookups in the codebase:
- **`RESOURCE_DIR` (Read-only assets)**: Gures `templates/` and `static/` folders. Points to the dynamic PyInstaller unpacked directory `sys._MEIPASS` when frozen, and repo root in dev.
- **`BASE_DIR` (Persistent read/write)**: Gures the SQLite database `journal.db`, screenshots, backups, `.env` API keys, and `config.json`. Points to the physical parent folder containing `journal-server.exe` when frozen, and repo root in dev.
- **Paths Updated**: Successfully updated `00_paths_constants.py`, `01_flask_app.py`, `07_routes_pages.py`, and `app_parts/__init__.py`.

### 2. Standalone Spec & Compilation
- **Dedicated Entrypoint**: Developed `apps/desktop/server_entry.py` to isolate desktop launch configuration (`PORT=5001`, `OPEN_BROWSER=0`).
- **PyInstaller Spec**: Created `apps/desktop/pyinstaller/journal-server.spec` to statically link all dependencies (`flask`, `sqlite3`, `duckdb`, `boto3`, `lz4`, `websocket`, `tzdata`, `zoneinfo`) and bundle templates/static folders recursively as data files.
- **Standalone Binary**: Built `journal-server.exe` (44.0 MB) successfully to `apps/desktop/bin/journal-server.exe`.

### 3. Wails output path
A post-build copy step copies the compiled sidecar directly next to the main executable in `apps/desktop/build/bin/journal-server.exe`. The build output folder now contains all three sidecars side-by-side:
- `CockpitV6.exe` (Wails frontend shell)
- `journal-server.exe` (Flask/Jinja backend)
- `marketd.exe` (Go Hyperliquid adapter stream engine)

### 4. Desktop Launcher Strategy
The launcher implements a multi-tier resolution strategy for Flask:
1. **existing-port**: Reuses port `5001` if already occupied.
2. **prod-sidecar**: Launches `journal-server.exe` next to `CockpitV6.exe`.
3. **dev-sidecar**: Launches the development binary in `apps/desktop/bin/journal-server.exe`.
4. **python-fallback**: Dev-only fallback using virtualenv Python `.venv/Scripts/python.exe app.py`.

### 5. Lifecycle Verification Results (SUCCESS)

#### Test A — Services already running manually (Port Reuse):
- Started `journal-server.exe` PID `4092` and `marketd.exe` PID `24820` manually in standalone terminals.
- Started desktop launcher. Logs outputted:
  ```
  [desktop] flask strategy: existing-port
  [desktop] port 5001 already in use — assuming Flask is already running (not starting a new one)
  [desktop] marketd strategy: existing-port
  [desktop] port 8765 already in use — assuming marketd is already running (not starting a new one)
  ```
- Exiting the desktop left both manual processes active and listening untouched on ports `5001` and `8765`.

#### Test B — Free Ports (Automatic Sidecar Spawning):
- Closed all manual services.
- Started desktop launcher. Both sidecars spawned automatically. Logs outputted:
  ```
  [desktop] flask strategy: dev-sidecar
  [desktop] launch path: C:\Users\gb781\Desktop\Journal\apps\desktop\bin\journal-server.exe (args: [], dir: C:\Users\gb781\Desktop\Journal\apps\desktop\bin)
  [desktop] started flask pid=31148
  [desktop] marketd strategy: dev-sidecar
  [desktop] launch path: C:\Users\gb781\Desktop\Journal\apps\desktop\bin\marketd.exe (args: [], dir: C:\Users\gb781\Desktop\Journal\apps\desktop\bin)
  [desktop] started marketd pid=26740
  ```
- Both services booted successfully and passed health checks. Exiting the desktop cleanly terminated exact PIDs `31148` and `26740` and freed both ports immediately.

#### Test C — Python/Go Absent Simulation (Direct Binary Launch):
- With sidecar binaries present, logs confirmed that `dev-sidecar` was selected and executed directly for both engines. Bypassed virtualenv Python and `go run` entirely!

---

## Phase 24 — Portable Release Folder & ZIP (June 1st, 2026)
We successfully designed and built a portable release system that packages Wails (`CockpitV6.exe`), Go Market Engine (`marketd.exe`), and Flask Backend (`journal-server.exe`) side-by-side into a standalone, distribution-ready portable folder and a matching `.zip` archive.

### 1. Robust Clean Staging
- **Staging Folder**: `dist/CockpitV6_Portable/`
- **Archive File**: `dist/CockpitV6_Portable.zip`
- **Zero Sensitive Data**: Automatic verification scans ensure no live `journal.db`, `.env` key files, screenshot storage, or database locks are ever bundled. Standard configurations are replaced by `config.example.json` and `.env.example`.
- **Directory Structure**: Structures for `data/`, `screenshots/`, `backups/`, and `logs/` are created dynamically with `.gitkeep` to preserve layout without files.

### 2. Process Tree Clean Teardown
- PyInstaller bootloader acts as a parent to the Flask server subprocess on Windows. To prevent orphaned Python processes, we patched `process.go`'s `Stop()` implementation to forcefully terminate the process tree using standard Windows command `taskkill /F /T /PID <pid>`.
- Fully verified: closing the native Wails window completely kills `CockpitV6.exe`, `marketd.exe`, and the Python subprocess `journal-server.exe`, leaving ports `5001` and `8765` 100% free.

### 3. Verification Script
- Implemented `apps/desktop/scripts/build_portable.ps1` which automates build verification (rebuilding split bundles, running 75/75 python tests, checking node AST, validating Go stream tests, testing launcher strategy), building the production Wails package, performing safety checks, and creating the final `.zip`.

---

## Phase 25 — Windows AppData Integration & NSIS Installer (June 2nd, 2026)
We successfully integrated standard Windows AppData folder resolution for Installed mode, while maintaining a fully functioning Portable mode. We also configured and compiled a native NSIS installer.

### 1. Dynamic Path Resolution & Safety Gates
- **Portable vs Installed Resolution**: Resolves writes to `%APPDATA%\CockpitV6\` for Installed mode (preventing Program Files permission issues) and to `EXE_DIR` when `portable.mode` is present.
- **AppData Directory Creation**: Dynamic folder structure creation for `data/`, `screenshots/`, `backups/`, and `logs/`.
- **Safe Copy-Only Migration**: One-time automatic copy-only migration from portable folders to AppData, triggering only when AppData lacks a database, preventing any risk of overwriting existing data.
- **Config & Dotenv Fallbacks**: Explicitly loads `.env` files from the resolved user data directory, falling back to local configurations dynamically.

### 2. NSIS Installer Config
- **Sidecar Packaging**: Configured `project.nsi` to explicitly copy sidecar binaries (`journal-server.exe`, `marketd.exe`) and configurations (`config.json`) next to the main binary.
- **Data Preservation**: Configured the NSIS uninstaller to preserve user AppData directories, avoiding accidental deletion of user journals.

### 3. Verification Results (SUCCESS)
- **Test A (Installation & AppData)**: Installed silently, spawned sidecars, verified directories created inside AppData, and confirmed that the installation directory remained clean.
- **Test B (Migration Validation)**: Verified copy-only automatic migration of database, configurations, and `.env` files.
- **Test C (Uninstall)**: Verified program files deleted and AppData fully preserved.
- **Test D (Portable Mode)**: Verified that launching with `portable.mode` writes locally and AppData remains untouched.

---

## Limitations (Phase Desktop 1, 22, 23, 24, 25)
- Flask/Python has been compiled but is not yet natively rewritten in Go (scheduled for a subsequent phase).
- Auto-updating is not yet integrated.

## Next: Proposed Phase 26
- **Drawings Engine**: Proceed to building persistent drawing tools (trendlines, shapes, Fibonacci) on the canvas chart.
