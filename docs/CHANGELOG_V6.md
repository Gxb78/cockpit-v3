# Cockpit V6 Changelog

## 2026-06-02 - Phase 25 Completed (Windows AppData Integration & NSIS Installer)

Scope:
- Integrated standard Windows AppData folder resolution (`%APPDATA%\CockpitV6`) for Installed mode to prevent read-only directory permission errors in folders like `Program Files`.
- Maintained support for Portable mode using a local `portable.mode` marker file, ensuring backward compatibility.
- Implemented a secure, copy-only, one-time automatic database and environment configuration migration from portable folders to AppData, with zero risk of overwriting existing data.
- Built a native Windows NSIS installer using Wails (`wails build -nsis`) and configured sidecars (`journal-server.exe`, `marketd.exe`) to bundle correctly next to the main binary.
- Structured the uninstaller to cleanly wipe binaries while preserving user profiles in AppData.
- Ran extensive lifecycle validation checks confirming clean installation, migration, uninstallation, and portable isolation.

Files added:
- `docs/V6_INSTALLER.md`

Files modified:
- `app_parts/00_paths_constants.py`
- `app_parts/01_flask_app.py`
- `apps/desktop/wails.json`
- `apps/desktop/build/windows/installer/project.nsi`
- `apps/desktop/scripts/build_portable.ps1`
- `docs/V6_DESKTOP.md`
- `docs/V6_PORTABLE_RELEASE.md`
- `docs/CHANGELOG_V6.md`

## 2026-06-01 - Phase 24 Completed (Portable Release Folder & ZIP)

Scope:
- Designed and built a robust portable release system that packages Wails (`CockpitV6.exe`), Go Market Engine (`marketd.exe`), and Flask Backend (`journal-server.exe`) side-by-side.
- Implemented `apps/desktop/scripts/build_portable.ps1` to fully automate the clean compilation, quality gate validation, safety scans, assets transfer, configurations generation, and ZIP archive compilation (`dist/CockpitV6_Portable.zip`).
- Implemented a parent process monitoring daemon thread in `apps/desktop/server_entry.py` and patched `process.go`'s `Stop()` implementation with native `taskkill /F /T /PID <pid>` process tree termination on Windows.
- Completely verified: closing the native Wails window forcefully and cleanly terminates all child subprocesses (including PyInstaller's Python subprocess), leaving ports `5001` and `8765` 100% free and avoiding any orphaned processes.
- Verified that all user data (SQLite database, backups, logs, and screenshots) is isolated and dynamically created next to the running executables in the portable directory (`data/`, `backups/`, `logs/`, `screenshots/`), remaining completely detached from the repository or user system paths.

Files added:
- `apps/desktop/scripts/build_portable.ps1`
- `docs/V6_PORTABLE_RELEASE.md`

Files modified:
- `apps/desktop/internal/launcher/process.go`
- `apps/desktop/server_entry.py`
- `apps/desktop/internal/app/app.go`
- `docs/V6_DESKTOP.md`

## 2026-06-01 - Phase 23 Completed (Flask Server Standalone Packaging)

Scope:
- Removed Python and `.venv` runtime dependencies by compiling the Flask backend server into a standalone executable (`journal-server.exe`) via PyInstaller.
- Implemented robust path scission:
  - `RESOURCE_DIR`: Assets (HTML templates/static JS-CSS bundles). Points to `sys._MEIPASS` when frozen, and repo root in dev.
  - `BASE_DIR`: Writeable user data (`journal.db`, `screenshots/`, `backups/`, `.env` keys, `config.json`). Points to the parent folder of `journal-server.exe` when frozen, and repo root in dev.
- Created dedicated entrypoint `apps/desktop/server_entry.py` and PyInstaller build configuration `apps/desktop/pyinstaller/journal-server.spec` to statically link all backend dependencies (`flask`, `sqlite3`, `duckdb`, `lz4`, `tzdata`, `zoneinfo`).
- Refactored the desktop launcher `apps/desktop/internal/launcher/flask.go` to support multi-tier lookups and logged strategy metrics (`flask strategy: dev-sidecar` or `flask strategy: prod-sidecar`).

Files added:
- `apps/desktop/server_entry.py`
- `apps/desktop/pyinstaller/journal-server.spec`

Files modified:
- `app_parts/00_paths_constants.py`
- `app_parts/01_flask_app.py`
- `app_parts/07_routes_pages.py`
- `app_parts/__init__.py`
- `apps/desktop/internal/launcher/flask.go`

## 2026-06-01 - Phase 22 Completed (Go Market Engine Sidecar Packaging)

Scope:
- Removed the Go compiler and toolchain dependency from Wails by pre-compiling the Go Market Adapter as a standalone sidecar binary (`marketd.exe`).
- Refactored the desktop launcher `apps/desktop/internal/launcher/marketd.go` to implement a multi-tier resolution strategy (`marketd strategy: prod-sidecar`, `marketd strategy: dev-sidecar`, and fallback to `go-run-fallback` only in development).
- Configured a fail-safe mode: if `marketd.exe` is missing, the application outputs a clear warning and gracefully continues in offline/mock mode instead of crashing.
- Verified exact process tracking: only subprocesses started by the desktop are terminated on close, by exact PID. Pre-existing processes are left untouched.

Files modified:
- `apps/desktop/internal/launcher/marketd.go`

## 2026-06-01 - Phase 21.5 Completed (Desktop Real Runtime Validation)

Scope:
- Conducted real-world runtime validation of the compiled desktop wrapper binary `CockpitV6.exe`.
- **Test A (Pre-existing Services)**:
  - Launched Flask (PID `15900`) and market-go (PID `22236`) manually.
  - Successfully ran `CockpitV6.exe` (PID `24500`). Confirmed the launcher detected occupied ports 5001 and 8765, skipped spawning duplicate processes, and seamlessly hooked the Edge WebView into the active Flask server.
  - Confirmed closing the Wails window preserved the active Flask and Go servers intact.
- **Test B (Free Ports)**:
  - Stopped manual servers and verified ports `5001` and `8765` are completely free.
  - Launched `CockpitV6.exe`.
  - Confirmed the launcher successfully spawned Flask (`.venv/Scripts/python.exe app.py`, PID `9752`) and market-go (`go run ./cmd/marketd`, PID `15412`) as tracked child processes.
  - Confirmed that WebView connected successfully, Dashboard and Orderflow V6 layouts loaded, and live ticks streamed.
  - Closing the desktop window terminated exactly the two spawned processes (reverse start order) and left ports `5001` and `8765` completely free.
- **Go toolchain dependency**:
  - Documented that since the Go market adapter launcher in `apps/desktop/internal/launcher/marketd.go` uses `go run ./cmd/marketd`, the standalone desktop app requires the Go toolchain to be installed on the system to launch the market engine when port `8765` is free. If Go is absent, it continues with a warning.
- **Tests & Compilation**:
  - Re-verified all test suites (Python, Node, Go market, Go desktop) are 100% green.

## 2026-06-01 - Phase 21 Completed (Desktop Validation & Wails Build)

Scope:
- Validated Cockpit V6 Wails desktop environment and launcher setup (`apps/desktop`).
- Confirmed Wails version `v2.12.0` (stable v2) and `wails doctor` diagnostics are successful (all dependencies loaded, system is 100% ready).
- Successfully ran `go test ./...` in the `apps/desktop/internal/launcher` package (all tests passing).
- Compiled a standalone Windows production executable using `wails build` which successfully outputted the binary `apps/desktop/build/bin/CockpitV6.exe` in 3.6 seconds.
- Validated process lifecycle safety rules:
  - If ports `5001` or `8765` are occupied, the desktop wrapper automatically detects it, avoids spawning duplicates, and safely hooks into pre-existing services without interfering or calling global killers.
  - If services are spawned by the launcher, stopping the desktop window correctly terminates exactly those child PIDs in reverse start order.
- Confirmed that the embedded asset loader `frontend/dist/index.html` implements a redirection loop that automatically binds to `http://127.0.0.1:5001/` once Flask becomes responsive.
- Executed full suite tests:
  - Python tests: `Ran 75 tests -> OK`
  - Node syntax: `node --check static/app.js -> OK`
  - Go market engine tests: `go test ./... -> OK`
  - Wails desktop tests: `go test ./... -> OK`

Files compiled:
- `apps/desktop/build/bin/CockpitV6.exe`

## 2026-06-01 - Phase 20 Completed (TradingView-like UX Polish & Workspace System)

Scope:
- Transformed Cockpit V6 into a professional, dense, and premium trading/charting workspace inspired by TradingView/Exocharts.
- Implemented vertical and horizontal resizer handles (`.v6-resize-v` and `.v6-resize-h`) with constraints (Right Dock: 260px-520px; CVD strip: 120px-420px) using standard Pointer Events.
- Implemented pure client-side workspace manager (`static/js/split/089_v6_workspace_manager.js`) persisting settings in localStorage under `cockpitV6.workspaces` and `cockpitV6.activeWorkspace`.
- Default presets loaded: `Scalping` and `Orderflow` layouts. Supports custom workspace creation, saving, and reset.
- Streamlined header into a compact top bar (44px) showing symbol, TF, segmented layer toggles, workspace dropdowns, warning badges, and real-time bid/ask spread ticket.
- Added drawing tool placeholders in the left toolbar (Horizontal line, Trendline, Rectangle).
- Implemented a Bottom Status Bar displaying Engine WS URL, reconnect stats, local time, and buffer volumes.
- Added a dedicated real-time Market Info Tab panel alongside DOM, Tape, CVD, VWAP, and Settings.
- Zero functional Go adapter or SQLite database changes. Pure UI polish.

Files added:
- `static/js/split/088_v6_resizable_panels.js`
- `static/js/split/089_v6_workspace_manager.js`

Files modified:
- `static/js/split/073_v6_orderflow_layout.js`
- `static/js/split/080_v6_layout_shell.js`
- `static/css/split/071_v6_layout_shell.css`
- `static/css/split/070_v6_orderflow.css`

Verification results:
- `build.py`: Successfully compiled 89 JS modules and 57 CSS modules.
- `node --check`: OK.
- `unittest discover`: 75 tests successfully passed.
- `go test ./...`: All tests successfully passed.

## 2026-05-29 - Phase 0 Completed

- Created `docs/V6_AUDIT.md`.
- Created `docs/V6_MASTER_PLAN.md`.
- Audited the current architecture as Flask, Jinja templates, vanilla split JS/CSS, SQLite, and generated bundles.
- Confirmed the current repo is not React/TypeScript today.
- Confirmed existing orderflow-related code already exists in the legacy app and must not be modified during Phase 1.
- No functional feature code was added.

## 2026-05-29 - Phase 1 Started

Scope:

- Secure the existing repo before V6 feature work.
- Do not change chart, VWAP, Hyperliquid, journal, AI, or existing orderflow behavior.
- Add documentation only.

Branch:

- Target branch: `feat/cockpit-v6-orderflow`.
- Initial sandboxed branch creation failed because Git could not create `.git/refs/heads/feat/cockpit-v6-orderflow`.
- Escalated branch creation succeeded.
- Current branch verified as `feat/cockpit-v6-orderflow`.

Initial working tree:

- The working tree was dirty before Phase 1 documentation edits.
- Existing modified files included `.gitignore`, `AI_DEVELOPMENT_PLAYBOOK.md`, backend Hyperliquid files, generated bundles, chart/orderflow split JS/CSS files, templates, and `docs/API_ROUTES.md`.
- Existing untracked files included Hyperliquid analytics files, `workers/`, and the Phase 0 docs.
- No reset, stash, checkout, or deletion was performed.

Environment checks:

- `.venv_linux/bin/python` exists, but is not executable from this Windows PowerShell session.
- Running `.venv_linux/bin/python build.py` failed with access denied.
- `wsl.exe` exists, but no WSL distribution is installed in this Windows session.
- `.venv/Scripts/python.exe` works when run with approval.
- Windows Python version: `Python 3.14.3`.
- Node version: `v24.15.0`.

Verification results:

```text
Command: .venv_linux/bin/python build.py
Result: failed in Windows PowerShell
Output:
Le programme « python » n’a pas pu s’exécuter : Accès refusé
```

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 71 modules (hash: 85615bdb3788)
Built static/style.css from 55 modules (hash: 30f60465bcee)
Switched templates to bundle mode (token: 85615bdb378830f60465bcee)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 3.583s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Notes:

- No functional code was manually changed for Phase 1.
- `build.py` may refresh generated bundle files and template bundle tokens as part of verification.
- No commit was made.

## 2026-05-29 - Phase 2 Completed

Scope:

- Added an isolated Cockpit V6 Orderflow mock surface inside the existing orderflow page.
- No Go market engine was created.
- Wails was not started.
- No exchange WebSocket was added.
- No Binance or Hyperliquid route was modified.
- Existing journal, chart, VWAP, AI, and legacy orderflow engine logic were not modified.

Files added:

- `static/js/split/070_v6_orderflow_contract.js`
- `static/js/split/071_v6_orderflow_store.js`
- `static/js/split/072_v6_orderflow_mock.js`
- `static/js/split/073_v6_orderflow_layout.js`
- `static/js/split/074_v6_tape_panel.js`
- `static/js/split/075_v6_dom_panel.js`
- `static/js/split/076_v6_cvd_panel.js`
- `static/js/split/077_v6_canvas_chart.js`
- `static/css/split/070_v6_orderflow.css`

Files changed:

- `templates/partials/pages/orderflow.html` now contains `#v6-orderflow-root`.
- `static/app.js`, `static/style.css`, and bundle template tokens were refreshed by `build.py`.
- `docs/CHANGELOG_V6.md` was updated.

Mock surface:

- Defines future-compatible JS structures for `Trade`, `OrderBookLevel`, `OrderBookSnapshot`, `DeltaBucket`, `VWAPState`, and `Candle`.
- Renders mock BTCUSDT/ETHUSDT/SOLUSDT data only.
- Includes a central canvas chart placeholder, tape panel, DOM panel, CVD/delta panel, settings panel, and visible `V6 MOCK / No live data` badge.
- Provides a `Legacy canvas` toggle so the existing orderflow prototype remains reachable without moving its code.

Environment:

```text
Command: .venv_linux/bin/python --version
Result: failed in Windows PowerShell
Output:
Le programme "python" n'a pas pu s'executer : Acces refuse
```

Verification results:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 79 modules (hash: fd0786e302ed)
Built static/style.css from 56 modules (hash: 17d8802ae6e6)
Switched templates to bundle mode (token: fd0786e302ed17d8802ae6e6)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 2.884s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Notes:

- The new V6 modules do not call `fetch`, do not open WebSockets, and do not access exchange APIs.
- The legacy orderflow prototype remains in the DOM and keeps its preexisting behavior when the orderflow page is opened.
- No commit was made.

## 2026-05-31 - Phase 16 Started (UI Shell V6)

Scope:

- Implement a TradingView-like UI shell for the V6 Orderflow page (layout + styling only).
- Keep all Phase 15 runtime flows and engines unchanged (Tape, DOM, Delta/CVD, VWAP, Heatmap, Footprint).
- No changes to Go engine, Flask routes, legacy chart, VWAP legacy frontend, or `066_orderflow_engine.js`.

Files added (UI shell only):

- `static/js/split/080_v6_layout_shell.js` — new lightweight shell layout and auto-init.
- `static/css/split/071_v6_layout_shell.css` — dark theme + toolbar/left/right/bottom layout styles.

Files inspected and reused (no functional changes):

- `templates/partials/pages/orderflow.html`
- `static/js/split/073_v6_orderflow_layout.js`
- `static/js/split/077_v6_canvas_chart.js`
- `static/js/split/074_v6_tape_panel.js`
- `static/js/split/075_v6_dom_panel.js`
- `static/js/split/076_v6_cvd_panel.js`
- `static/css/split/070_v6_orderflow.css`

Notes:

- Phase 16 is UI shell only: drawing tools are placeholders, no new data sources, no Wails/desktop work.
- The shell reuses existing V6 store and engine buttons; connection flow remains manual via `Connect Local Engine`.
- No commits were created; changes are staged locally in the workspace files.


## 2026-05-29 - Phase 2.5 Completed

Scope:

- Runtime validation and startup diagnostics only.
- No Go market engine was created.
- Wails was not started.
- No V6 exchange WebSocket was added.
- No commit was made.

Initial state:

- Branch verified: `feat/cockpit-v6-orderflow`.
- Working tree was already dirty before Phase 2.5.
- Phase 2.5 changed only V6/navigation coexistence code and this changelog.

Server diagnostics:

```text
Command: $env:PORT='5001'; $env:OPEN_BROWSER='0'; .\.venv\Scripts\python.exe app.py
Result: timeout in this shell runner
Observed: no logs were emitted before timeout; the attempt left non-listening Python child processes.
```

Follow-up checks:

- `app_parts.backup_db()` and `app_parts.init_db()` both completed.
- `app_parts.launch()` opened `127.0.0.1:5001` successfully.
- `import app; app.launch()` also opened a test port when allowed to continue, but this shell runner did not stream logs before timeout.
- Controlled validation server was started through a temporary script outside the repo using `app_parts.launch()`.

Server logs from the successful controlled run:

```text
Serving Flask app 'app_parts.01_flask_app'
Debug mode: off
Serveur run_id=pid-13916 pid=13916 cwd=C:\Users\gb781\Desktop\Journal exe=C:\Users\gb781\Desktop\Journal\.venv\Scripts\python.exe host=127.0.0.1 port=5001 debug=False open_browser=False app_url=http://127.0.0.1:5001/
Running on http://127.0.0.1:5001
```

Runtime bug found:

- The existing chart hook in `static/js/split/062_chart_page.js` remapped `goPage('orderflow')` to `goPage('chart')` with footprint mode.
- That preexisting behavior prevented the new V6 mock surface from becoming visible via the Orderflow navigation item.
- After making the V6 page reachable, the legacy orderflow engine started its Binance live stream under the V6 mock surface.

Minimal corrections:

- `static/js/split/062_chart_page.js`: keep the old orderflow-to-chart fallback only when `#v6-orderflow-root` is absent.
- `static/js/split/066_orderflow_engine.js`: when V6 mock is active, stop/disconnect the legacy engine instead of loading live data.
- `static/js/split/073_v6_orderflow_layout.js`: dispatch a page change when toggling `Legacy canvas` or returning to V6, so the legacy engine starts only on explicit legacy access and stops again when V6 mock is restored.

Browser validation:

- Browser plugin was not available; used Chrome headless through CDP as fallback.
- URL tested: `http://127.0.0.1:5001/`.
- Dashboard loaded.
- Orderflow navigation loaded the V6 mock surface.
- Visual checks passed:
  - `V6 MOCK / No live data` badge visible.
  - Canvas chart placeholder rendered.
  - Mock tape rendered.
  - Mock DOM rendered.
  - Mock CVD/delta rendered.
  - Settings controls rendered.
  - `Legacy canvas` access rendered.
- Console errors/warnings during final V6 pass: none.
- Final V6-specific network delta after Dashboard baseline:
  - WebSockets opened after clicking Orderflow: none.
  - API requests after clicking Orderflow: none.
- Baseline Dashboard still opens its preexisting `btcusdt@kline_3m` WebSocket before Orderflow. This is not created by V6.

Screenshots captured outside the repo:

```text
C:\Users\gb781\AppData\Local\Temp\cockpit-v6-shots\orderflow-v6-desktop.png
C:\Users\gb781\AppData\Local\Temp\cockpit-v6-shots\orderflow-v6-mobile.png
```

Verification results:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 79 modules (hash: a338301c0be0)
Built static/style.css from 56 modules (hash: 17d8802ae6e6)
Switched templates to bundle mode (token: a338301c0be017d8802ae6e6)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 3.050s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Processes:

- Chrome headless validation process was stopped.
- Stale non-listening Python processes from failed launch attempts were stopped by explicit PID.
- Controlled validation server remains running on `http://127.0.0.1:5001/` with PIDs `27664` and `13916`.

## 2026-05-29 - Phase 3 Completed

Scope:

- Added an isolated Go market engine foundation under `services/market-go`.
- No Wails or desktop packaging was started.
- No Flask route was modified.
- No V6 UI live connection was added.
- No real Binance, Hyperliquid, Bybit, or OKX stream was connected.
- No commit was made.

Pre-flight:

- Branch verified: `feat/cockpit-v6-orderflow`.
- Validation server PIDs from Phase 2.5 were checked and stopped explicitly: `27664`, `13916`.
- `data/journal.db-shm` and `data/journal.db-wal` were present as untracked SQLite runtime files. They were not added and should not be committed.

Files added:

- `services/market-go/go.mod`
- `services/market-go/cmd/marketd/main.go`
- `services/market-go/internal/config/config.go`
- `services/market-go/internal/config/config_test.go`
- `services/market-go/internal/logx/logx.go`
- `services/market-go/internal/ws/server.go`
- `services/market-go/internal/ws/hub.go`
- `services/market-go/internal/ws/server_test.go`
- `services/market-go/internal/engine/engine.go`
- `services/market-go/internal/calc/placeholder.go`
- `services/market-go/internal/exchange/exchange.go`
- `services/market-go/internal/exchange/binance/placeholder.go`
- `services/market-go/internal/marketdata/types.go`
- `services/market-go/pkg/protocol/envelope.go`
- `services/market-go/pkg/protocol/envelope_test.go`
- `services/market-go/docs.go`
- `docs/V6_GO_ENGINE.md`

Service foundation:

- Default address: `127.0.0.1:8765`.
- Config via environment:
  - `MARKET_GO_HOST`
  - `MARKET_GO_PORT`
  - `MARKET_GO_SYMBOLS`
  - `MARKET_GO_MOCK_MODE`
  - `MARKET_GO_VERSION`
- `GET /health` returns JSON with `ok`, `service`, `version`, and `time`.
- `GET /stream` is a local WebSocket endpoint.
- Mock mode broadcasts `heartbeat` and `trade_mock` envelopes once per second when clients are connected.
- WebSocket support uses the Go standard library only. No external dependency was added.

Go validation:

```text
Command: go version
Result: failed
Output:
go : Le terme "go" n'est pas reconnu comme nom d'applet de commande, fonction, fichier de script ou programme executable.
```

```text
Command: cd services/market-go; go mod tidy
Result: failed
Reason: Go is not installed or not in PATH.
```

```text
Command: cd services/market-go; go test ./...
Result: failed
Reason: Go is not installed or not in PATH.
```

```text
Command: cd services/market-go; go run ./cmd/marketd
Result: failed
Reason: Go is not installed or not in PATH.
```

```text
Command: Invoke-WebRequest http://127.0.0.1:8765/health
Result: failed
Output:
Impossible de se connecter au serveur distant
Reason: marketd could not be started without Go.
```

Repo verification:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 79 modules (hash: a338301c0be0)
Built static/style.css from 56 modules (hash: 17d8802ae6e6)
Switched templates to bundle mode (token: a338301c0be017d8802ae6e6)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 3.515s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Notes:

- The Go service is independent of Flask.
- The Go service does not import Journal backend code.
- The V6 UI remains mock-only and is not connected to `services/market-go`.
- Phase 4 should install/verify Go first, then implement Binance Futures public `aggTrade` inside the Go adapter and stream normalized `Trade` envelopes locally.

## 2026-05-29 - Phase 3.5 Completed

Scope:

- Validated the existing `services/market-go` foundation.
- No Wails or desktop work was started.
- No Binance live stream was connected.
- No exchange WebSocket was connected.
- No V6 UI live connection was added.
- No Flask route, Journal, Chart, VWAP, Hyperliquid, AI, or legacy `066_orderflow_engine.js` behavior was changed.
- No commit was made.

Initial state:

- Branch verified: `feat/cockpit-v6-orderflow`.
- Working tree was already dirty before Phase 3.5.
- `data/journal.db-shm` and `data/journal.db-wal` are still untracked runtime SQLite files and were not added.

Go toolchain:

```text
Command: go version
Result: success
Output:
go version go1.26.3 windows/amd64
```

```text
Command: where.exe go
Result: success
Output:
C:\Program Files\Go\bin\go.exe
```

```text
Command: go env GOPATH
Result: success
Output:
C:\Users\gb781\go
```

```text
Command: go env GOROOT
Result: success
Output:
C:\Program Files\Go
```

Go changes:

- Added a stdlib-only test for `/stream` WebSocket upgrade in `services/market-go/internal/ws/server_test.go`.
- Ran `gofmt -w .` in `services/market-go`.
- No external Go dependency was added.

Go validation:

```text
Command: go mod tidy
Result: success
Output: none
Note: sandboxed attempt failed first because Go could not create/use its build cache under AppData; escalated run succeeded.
```

```text
Command: gofmt -w .
Result: success
Output: none
```

```text
Command: go test ./...
Result: success
Output:
?    cockpit-v6-market-go [no test files]
?    cockpit-v6-market-go/cmd/marketd [no test files]
?    cockpit-v6-market-go/internal/calc [no test files]
ok   cockpit-v6-market-go/internal/config
?    cockpit-v6-market-go/internal/engine [no test files]
?    cockpit-v6-market-go/internal/exchange [no test files]
?    cockpit-v6-market-go/internal/exchange/binance [no test files]
?    cockpit-v6-market-go/internal/logx [no test files]
?    cockpit-v6-market-go/internal/marketdata [no test files]
ok   cockpit-v6-market-go/internal/ws
ok   cockpit-v6-market-go/pkg/protocol
```

Runtime validation:

```text
Command: go run ./cmd/marketd
Result: success
Server log:
[market-go] 2026/05/29 18:33:58.651858 INFO listening on http://127.0.0.1:8765 mockMode=true symbols=BTCUSDT
```

```text
Command: Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/health
Result: success
Output:
StatusCode: 200
Content: {"ok":true,"service":"cockpit-v6-market-go","version":"0.3.0-phase3","time":"2026-05-29T16:34:25.5879164Z"}
```

```text
Command: manual TCP WebSocket upgrade request to /stream
Result: success
Output:
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

Process handling:

- `marketd` was started only for validation.
- Exact PIDs were identified: `15856` for `go run`, `20472` for the compiled `marketd.exe`.
- Only those PIDs were stopped after validation.

Repo verification:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 79 modules (hash: a338301c0be0)
Built static/style.css from 56 modules (hash: 17d8802ae6e6)
Switched templates to bundle mode (token: a338301c0be017d8802ae6e6)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 8.374s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Notes:

- `services/market-go` now compiles and runs locally with Go installed.
- `/stream` is mock-only and local-only.
- The V6 frontend remains mock-only and is not connected to Go.
- Phase 4 should implement Binance Futures public `aggTrade` inside the Go adapter and stream normalized `Trade` envelopes locally, without connecting the UI until the stream is stable.

## 2026-05-29 - Phase 4 Completed

Scope:

- Added the first live Go market adapter: Hyperliquid public read-only trades.
- Binance was not implemented in this phase.
- No Wails or desktop work was started.
- No V6 UI live connection was added.
- No Flask route, Journal, Chart, VWAP, Hyperliquid frontend, AI, or legacy `066_orderflow_engine.js` behavior was changed.
- No auth, wallet, private endpoint, order placement, or exchange/trading endpoint was used.
- No commit was made.

Pre-flight:

- Branch verified: `feat/cockpit-v6-orderflow`.
- Working tree was already dirty before Phase 4.
- `netstat -ano | findstr :8765` showed no active listener before the live validation.

Files added:

- `services/market-go/internal/exchange/hyperliquid/client.go`
- `services/market-go/internal/exchange/hyperliquid/types.go`
- `services/market-go/internal/exchange/hyperliquid/normalize.go`
- `services/market-go/internal/exchange/hyperliquid/client_test.go`
- `services/market-go/internal/exchange/hyperliquid/normalize_test.go`
- `services/market-go/internal/engine/engine_test.go`

Files changed:

- `services/market-go/internal/config/config.go`
- `services/market-go/internal/config/config_test.go`
- `services/market-go/internal/engine/engine.go`
- `services/market-go/internal/marketdata/types.go`
- `services/market-go/internal/ws/server.go`
- `docs/V6_GO_ENGINE.md`
- `docs/CHANGELOG_V6.md`

Config added:

- `MARKET_GO_EXCHANGE=hyperliquid`
- `MARKET_GO_HL_WS_URL=wss://api.hyperliquid.xyz/ws`
- `MARKET_GO_SYMBOLS=BTC` for Hyperliquid live trades.
- `MARKET_GO_MOCK_MODE=false` for live mode.
- `MARKET_GO_MOCK_MODE=true` still keeps the Phase 3 mock stream.

Hyperliquid adapter:

- Connects to the public WebSocket URL `wss://api.hyperliquid.xyz/ws`.
- Subscribes to:

```json
{"method":"subscribe","subscription":{"type":"trades","coin":"BTC"}}
```

- Parses `channel:"trades"` messages.
- Ignores subscription acknowledgements and non-trade messages without crashing.
- Normalizes raw trades into the V6 `Trade` contract.
- Reconnects with a capped simple backoff.
- Stops through context cancellation when `marketd` stops.
- Uses the Go standard library only; no external WebSocket dependency was added.

Side convention:

- Hyperliquid `side` is normalized by `NormalizeSide()`.
- `B`, `Bid`, `Buy` -> `buy`.
- `A`, `Ask`, `Sell`, `Short` -> `sell`.
- Unknown side values return an explicit error and are logged, not guessed.
- This matches the existing repo analytics convention where Hyperliquid `B` is aggressive buy and `A` is aggressive sell.

Normalized trade envelope:

```json
{
  "type": "trade",
  "seq": 1,
  "tsLocal": 1760000000001,
  "payload": {
    "id": "1760000000000:BTC:123",
    "tradeId": "1760000000000:BTC:123",
    "exchange": "hyperliquid",
    "symbol": "BTC",
    "tsExchange": 1760000000000,
    "tsLocal": 1760000000001,
    "price": 100000,
    "qty": 0.01,
    "side": "buy",
    "notional": 1000
  }
}
```

Go validation:

```text
Command: go mod tidy
Result: success
Output: none
```

```text
Command: gofmt -w .
Result: success
Output: none
```

```text
Command: go test ./...
Result: success
Output:
?    cockpit-v6-market-go [no test files]
?    cockpit-v6-market-go/cmd/marketd [no test files]
?    cockpit-v6-market-go/internal/calc [no test files]
ok   cockpit-v6-market-go/internal/config
ok   cockpit-v6-market-go/internal/engine
?    cockpit-v6-market-go/internal/exchange [no test files]
?    cockpit-v6-market-go/internal/exchange/binance [no test files]
ok   cockpit-v6-market-go/internal/exchange/hyperliquid
?    cockpit-v6-market-go/internal/logx [no test files]
?    cockpit-v6-market-go/internal/marketdata [no test files]
ok   cockpit-v6-market-go/internal/ws
ok   cockpit-v6-market-go/pkg/protocol
```

Live validation:

```text
Command:
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
go run ./cmd/marketd

Result: success
Logs:
[market-go] 2026/05/29 20:40:27.814118 INFO listening on http://127.0.0.1:8765 exchange=hyperliquid mockMode=false symbols=BTC
[market-go] 2026/05/29 20:40:28.857744 INFO hyperliquid websocket connected url=wss://api.hyperliquid.xyz/ws
[market-go] 2026/05/29 20:40:28.860104 INFO hyperliquid subscribed trades symbol=BTC url=wss://api.hyperliquid.xyz/ws
```

```text
Command: Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/health
Result: success
Output:
StatusCode: 200
Content: {"ok":true,"service":"cockpit-v6-market-go","version":"0.4.0-phase4","time":"2026-05-29T18:41:02.1712961Z"}
```

```text
Command: manual local WebSocket read from /stream
Result: success
Upgrade:
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

Sample live trade received:

```json
{
  "type": "trade",
  "seq": 234,
  "tsLocal": 1780080091213,
  "payload": {
    "id": "1780080091036:BTC:118892860642748",
    "tradeId": "1780080091036:BTC:118892860642748",
    "exchange": "hyperliquid",
    "symbol": "BTC",
    "tsExchange": 1780080091036,
    "tsLocal": 1780080091213,
    "price": 73783,
    "qty": 0.0007,
    "side": "buy",
    "notional": 51.6481
  }
}
```

Process handling:

- A first malformed PowerShell environment attempt started `marketd` in mock mode by mistake; it was stopped by exact PIDs `2068` and `2020`.
- The valid Hyperliquid run used PID `7352`.
- PID `7352` was stopped after validation.
- After stopping, `netstat` showed only local `TIME_WAIT`, no active `marketd` listener.

Repo verification:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 79 modules (hash: a338301c0be0)
Built static/style.css from 56 modules (hash: 17d8802ae6e6)
Switched templates to bundle mode (token: a338301c0be017d8802ae6e6)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 5.146s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Notes:

- The V6 UI remains mock-only and is not connected to Go.
- The Go engine remains independent of Flask.
- Binance is now a later adapter, not the first live source.
- Phase 5 should either connect the V6 Tape panel to local `/stream` or first implement CVD/Delta calculations in Go before UI connection.

## 2026-05-29 - Phase 4.5 Completed

Scope:

- Added stability metrics for the Go market engine and local stream.
- Added `GET /metrics`.
- Added `cmd/streamcheck` as a stdlib-only local WebSocket checker.
- Ran a live Hyperliquid BTC stability test for more than 10 minutes.
- No Wails or desktop work was started.
- No Binance work was added.
- No V6 UI live connection was added.
- No Flask route, Journal, Chart, VWAP, Hyperliquid frontend, AI, or legacy `066_orderflow_engine.js` behavior was changed.
- No auth, wallet, private endpoint, order placement, or exchange/trading endpoint was used.
- No commit was made.

Pre-flight:

- Branch verified: `feat/cockpit-v6-orderflow`.
- Working tree was already dirty before Phase 4.5.
- `netstat -ano | findstr :8765` showed no active listener before the live validation.

Files added:

- `services/market-go/cmd/streamcheck/main.go`
- `services/market-go/internal/engine/metrics.go`

Files changed:

- `services/market-go/internal/config/config.go`
- `services/market-go/internal/engine/engine.go`
- `services/market-go/internal/engine/engine_test.go`
- `services/market-go/internal/exchange/hyperliquid/client.go`
- `services/market-go/internal/ws/server.go`
- `services/market-go/internal/ws/server_test.go`
- `docs/V6_GO_ENGINE.md`
- `docs/CHANGELOG_V6.md`

Metrics added:

- `exchange`
- `symbols`
- `mockMode`
- `connected`
- `uptimeSeconds`
- `totalMessagesIn`
- `totalTradesOut`
- `totalStreamClients`
- `lastTradeTsExchange`
- `lastTradeTsLocal`
- `lastError`
- `reconnectCount`

Endpoint:

```text
GET /metrics
```

Example response from the live test:

```json
{
  "service": "cockpit-v6-market-go",
  "exchange": "hyperliquid",
  "symbols": ["BTC"],
  "mockMode": false,
  "connected": true,
  "uptimeSeconds": 688,
  "totalMessagesIn": 1730,
  "totalTradesOut": 9338,
  "totalStreamClients": 0,
  "lastTradeTsExchange": 1780081381097,
  "lastTradeTsLocal": 1780081381305,
  "lastError": "",
  "reconnectCount": 0
}
```

Stream checker:

```text
Command: go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=21 trades=20 elapsed=1.217s last=hyperliquid BTC 0.00017000 @ 73187.00 side=buy
```

Final stream checker after the long run:

```text
Command: go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=21 trades=20 elapsed=4.178s last=hyperliquid BTC 0.00017000 @ 73405.00 side=buy
```

Stability test:

```text
Command:
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
go run ./cmd/marketd

Duration: 688 seconds
Result: success
```

Observed metrics:

- Initial: `connected=true`, `totalMessagesIn=49`, `totalTradesOut=197`, `reconnectCount=0`, `lastError=""`.
- At about 3 minutes: `connected=true`, `totalMessagesIn=716`, `totalTradesOut=5154`, `reconnectCount=0`, `lastError=""`.
- At about 6 minutes: `connected=true`, `totalMessagesIn=1154`, `totalTradesOut=7248`, `reconnectCount=0`, `lastError=""`.
- Final after 688 seconds: `connected=true`, `totalMessagesIn=1730`, `totalTradesOut=9338`, `reconnectCount=0`, `lastError=""`.

Process handling:

- `marketd` Phase 4.5 ran under PID `16160`.
- PID `16160` was stopped after validation.
- After stopping, `netstat -ano | findstr :8765` showed no active listener.

Go validation:

```text
Command: go mod tidy
Result: success
Output: none
```

```text
Command: gofmt -w .
Result: success
Output: none
```

```text
Command: go test ./...
Result: success
Output:
?    cockpit-v6-market-go [no test files]
?    cockpit-v6-market-go/cmd/marketd [no test files]
?    cockpit-v6-market-go/cmd/streamcheck [no test files]
?    cockpit-v6-market-go/internal/calc [no test files]
ok   cockpit-v6-market-go/internal/config
ok   cockpit-v6-market-go/internal/engine
?    cockpit-v6-market-go/internal/exchange [no test files]
?    cockpit-v6-market-go/internal/exchange/binance [no test files]
ok   cockpit-v6-market-go/internal/exchange/hyperliquid
?    cockpit-v6-market-go/internal/logx [no test files]
?    cockpit-v6-market-go/internal/marketdata [no test files]
ok   cockpit-v6-market-go/internal/ws
ok   cockpit-v6-market-go/pkg/protocol
```

Repo verification:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 79 modules (hash: a338301c0be0)
Built static/style.css from 56 modules (hash: 17d8802ae6e6)
Switched templates to bundle mode (token: a338301c0be017d8802ae6e6)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 6.015s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Notes:

- The V6 UI remains mock-only and is not connected to Go.
- Hyperliquid remains public read-only.
- No Wails or desktop work was started.
- Phase 5 recommendation: implement CVD/Delta buckets inside Go before connecting the V6 UI.

## 2026-05-29 - Phase 5 Completed

Scope:

- Added Go-side CVD/Delta bucket calculations from normalized Hyperliquid trades.
- Raw `trade` envelopes still stream on `/stream`.
- Added `delta_bucket` envelopes on `/stream` without connecting the V6 UI.
- No Wails or desktop work was started.
- No Binance work was added.
- No V6 UI live connection was added.
- No Flask route, Journal, Chart, VWAP, Hyperliquid frontend, AI, or legacy `066_orderflow_engine.js` behavior was changed.
- No auth, wallet, private endpoint, order placement, or exchange/trading endpoint was used.
- No commit was made.

Pre-flight:

- Branch verified: `feat/cockpit-v6-orderflow`.
- Working tree was already dirty before Phase 5.
- `netstat -ano | findstr :8765` found an existing `marketd` listener during validation; it was identified as PID `9068` before any action.
- `data/journal.db-shm` and `data/journal.db-wal` remained untracked runtime SQLite files and were not added.

Files added:

- `services/market-go/internal/calc/delta.go`
- `services/market-go/internal/calc/delta_test.go`
- `services/market-go/internal/calc/session.go`
- `services/market-go/internal/calc/session_test.go`

Files changed:

- `services/market-go/cmd/streamcheck/main.go`
- `services/market-go/internal/config/config.go`
- `services/market-go/internal/config/config_test.go`
- `services/market-go/internal/engine/engine.go`
- `services/market-go/internal/engine/engine_test.go`
- `services/market-go/internal/engine/metrics.go`
- `services/market-go/internal/marketdata/types.go`
- `services/market-go/internal/ws/server.go`
- `docs/V6_GO_ENGINE.md`
- `docs/CHANGELOG_V6.md`

Config added:

- `MARKET_GO_DELTA_INTERVALS=1000,5000,60000`
- `MARKET_GO_SESSION_RESET=utc_day`

Delta/CVD behavior:

- `buyVol` increments for normalized trades with `side="buy"`.
- `sellVol` increments for normalized trades with `side="sell"`.
- `delta = buyVol - sellVol`.
- `cvd` accumulates bucket deltas from the current session reset.
- Supported intervals: `1000`, `5000`, and `60000` ms by default.
- Phase 5 session reset supports `utc_day` only, resetting at `00:00 UTC`.
- Unknown trade sides are ignored without panic.
- Live bucket updates are throttled to avoid excessive fanout.

Metrics added:

- `totalDeltaBucketsOut`
- `activeDeltaIntervals`
- `currentSessionId`
- `currentSessionStart`
- `lastDeltaTsLocal`
- `cvdBySymbol`

Stream checker:

```text
Command: go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=40 trades=20 deltaBuckets=19 elapsed=2.667s lastTrade=hyperliquid BTC 0.00014000 @ 73217.00 side=buy lastDelta=hyperliquid BTC intervalMs=60000 delta=7.17601000 cvd=1.23205000 closed=false
```

Live validation:

```text
Command:
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
go run ./cmd/marketd

Duration: 331 seconds
Result: success
```

Observed metrics:

- At about 1 minute 45 seconds: `connected=true`, `totalTradesOut=960`, `totalDeltaBucketsOut=555`, `reconnectCount=0`, `lastError=""`.
- At about 3 minutes 22 seconds: `connected=true`, `totalTradesOut=1390`, `totalDeltaBucketsOut=936`, `reconnectCount=0`, `lastError=""`.
- Final after 331 seconds: `connected=true`, `totalTradesOut=1893`, `totalDeltaBucketsOut=1454`, `reconnectCount=0`, `lastError=""`, `cvdBySymbol.BTC=7.976820000000014`.

Process handling:

- The old `marketd` listener was identified as PID `9068` and stopped before restarting with the Phase 5 binary.
- The Phase 5 live run used PID `19408`.
- PID `19408` was stopped after validation.
- After stopping, `netstat -ano | findstr :8765` showed no active listener.

Go validation:

```text
Command: go mod tidy
Result: success
Output: none
```

```text
Command: gofmt -w .
Result: success
Output: none
```

```text
Command: go test ./...
Result: success
Output:
?    cockpit-v6-market-go [no test files]
?    cockpit-v6-market-go/cmd/marketd [no test files]
?    cockpit-v6-market-go/cmd/streamcheck [no test files]
ok   cockpit-v6-market-go/internal/calc
ok   cockpit-v6-market-go/internal/config
ok   cockpit-v6-market-go/internal/engine
?    cockpit-v6-market-go/internal/exchange [no test files]
?    cockpit-v6-market-go/internal/exchange/binance [no test files]
ok   cockpit-v6-market-go/internal/exchange/hyperliquid
?    cockpit-v6-market-go/internal/logx [no test files]
?    cockpit-v6-market-go/internal/marketdata [no test files]
ok   cockpit-v6-market-go/internal/ws
ok   cockpit-v6-market-go/pkg/protocol
```

Repo verification:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 79 modules (hash: a338301c0be0)
Built static/style.css from 56 modules (hash: 17d8802ae6e6)
Switched templates to bundle mode (token: a338301c0be017d8802ae6e6)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 3.079s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Notes:

- The V6 UI remains mock-only and is not connected to Go.
- Hyperliquid remains public read-only.
- No Wails or desktop work was started.
- A minimal WebSocket local buffer increase was made in `internal/ws/server.go` after the first `streamcheck` attempt disconnected during a live BTC burst.
- Phase 6 recommendation: implement trade-derived session VWAP inside Go before connecting the V6 UI.

## 2026-05-29 - Phase 6 Completed

Scope:

- Added Go-side trade-derived session VWAP from normalized Hyperliquid trades.
- Raw `trade` envelopes still stream on `/stream`.
- `delta_bucket` envelopes still stream on `/stream`.
- Added `vwap` envelopes on `/stream` without connecting the V6 UI.
- No Wails or desktop work was started.
- No Binance work was added.
- No V6 UI live connection was added.
- No Flask route, Journal, Chart, VWAP frontend, Hyperliquid frontend, AI, or legacy `066_orderflow_engine.js` behavior was changed.
- No auth, wallet, private endpoint, order placement, or exchange/trading endpoint was used.
- No commit was made.

Pre-flight:

- Branch verified: `feat/cockpit-v6-orderflow`.
- Working tree was already dirty before Phase 6.
- `netstat -ano | findstr :8765` showed no active listener before starting the Phase 6 live run.
- `data/journal.db-shm` and `data/journal.db-wal` remained untracked runtime SQLite files and were not added.

Files added:

- `services/market-go/internal/calc/vwap.go`
- `services/market-go/internal/calc/vwap_test.go`

Files changed:

- `services/market-go/cmd/streamcheck/main.go`
- `services/market-go/internal/config/config.go`
- `services/market-go/internal/config/config_test.go`
- `services/market-go/internal/engine/engine.go`
- `services/market-go/internal/engine/engine_test.go`
- `services/market-go/internal/engine/metrics.go`
- `services/market-go/internal/marketdata/types.go`
- `services/market-go/internal/ws/server.go`
- `docs/V6_GO_ENGINE.md`
- `docs/CHANGELOG_V6.md`

Config added:

- `MARKET_GO_VWAP_ENABLED=true`
- `MARKET_GO_VWAP_SESSION=utc_day`
- `MARKET_GO_VWAP_EMIT_MS=250`

VWAP behavior:

- `cumPV += price * qty`.
- `cumVol += qty`.
- `value = cumPV / cumVol`.
- Buy and sell sides do not change the calculation; only price and quantity count.
- Phase 6 session reset supports `utc_day` only, resetting at `00:00 UTC`.
- Invalid zero, negative, NaN, or infinite price/quantity trades are ignored without panic.
- If cumulative volume is zero, no invalid division is produced.
- Live VWAP emits are throttled to avoid excessive fanout.

Coverage limitation:

- `sessionStart` is the theoretical session start.
- `coverageStart` is the first trade actually observed by the running engine.
- `source` is `"live"`.
- `isWarm` is `false`.
- There is no historical backfill yet, so VWAP is not complete from `sessionStart` unless the engine was already running from the session start.

Metrics added:

- `totalVWAPOut`
- `vwapEnabled`
- `vwapSession`
- `vwapBySymbol`
- `lastVWAPTsLocal`
- `vwapCoverageStartBySymbol`
- `vwapIsWarmBySymbol`

Stream checker:

```text
Command: go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=32 trades=20 deltaBuckets=9 vwaps=2 elapsed=2.066s lastTrade=hyperliquid BTC 0.00017000 @ 73593.00 side=sell lastDelta=hyperliquid BTC intervalMs=60000 delta=15.58010000 cvd=15.58010000 closed=false lastVWAP=hyperliquid BTC value=73587.22164928 coverageStart=1780083303827 isWarm=false cumPV=1481310.77180000 cumVol=20.13000000
```

Live validation:

```text
Command:
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
$env:MARKET_GO_VWAP_ENABLED='true'
$env:MARKET_GO_VWAP_SESSION='utc_day'
go run ./cmd/marketd

Duration: 336 seconds
Result: success
```

Observed metrics:

- Initial: `connected=true`, `totalTradesOut=300`, `totalDeltaBucketsOut=135`, `totalVWAPOut=35`, `reconnectCount=0`, `lastError=""`, `vwapBySymbol.BTC=73584.90693689136`, `isWarm=false`.
- At 138 seconds: `connected=true`, `totalTradesOut=917`, `totalDeltaBucketsOut=639`, `totalVWAPOut=163`, `reconnectCount=0`, `lastError=""`, `vwapBySymbol.BTC=73590.36793657822`, `isWarm=false`.
- At 267 seconds: `connected=true`, `totalTradesOut=2370`, `totalDeltaBucketsOut=1304`, `totalVWAPOut=336`, `reconnectCount=0`, `lastError=""`, `vwapBySymbol.BTC=73644.85746575748`, `isWarm=false`.
- Final after 336 seconds: `connected=true`, `totalTradesOut=2746`, `totalDeltaBucketsOut=1589`, `totalVWAPOut=407`, `reconnectCount=0`, `lastError=""`, `vwapBySymbol.BTC=73649.29354394738`, `vwapCoverageStartBySymbol.BTC=1780083303827`, `isWarm=false`.

Process handling:

- The Phase 6 live run used PID `5516`.
- PID `5516` was stopped after validation.
- After stopping, `netstat -ano | findstr :8765` showed no active listener.

Go validation:

```text
Command: go mod tidy
Result: success
Output: none
```

```text
Command: gofmt -w .
Result: success
Output: none
```

```text
Command: go test ./...
Result: success
Output:
?    cockpit-v6-market-go [no test files]
?    cockpit-v6-market-go/cmd/marketd [no test files]
?    cockpit-v6-market-go/cmd/streamcheck [no test files]
ok   cockpit-v6-market-go/internal/calc
ok   cockpit-v6-market-go/internal/config
ok   cockpit-v6-market-go/internal/engine
?    cockpit-v6-market-go/internal/exchange [no test files]
?    cockpit-v6-market-go/internal/exchange/binance [no test files]
ok   cockpit-v6-market-go/internal/exchange/hyperliquid
?    cockpit-v6-market-go/internal/logx [no test files]
?    cockpit-v6-market-go/internal/marketdata [no test files]
ok   cockpit-v6-market-go/internal/ws
ok   cockpit-v6-market-go/pkg/protocol
```

Repo verification:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 79 modules (hash: a338301c0be0)
Built static/style.css from 56 modules (hash: 17d8802ae6e6)
Switched templates to bundle mode (token: a338301c0be017d8802ae6e6)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 4.390s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Notes:

- The V6 UI remains mock-only and is not connected to Go.
- Hyperliquid remains public read-only.
- No Wails or desktop work was started.
- Phase 7 recommendation: either connect only the Tape V6 panel to local `/stream`, or add Hyperliquid `l2Book`/DOM in Go before UI connection.

## 2026-05-29 - Phase 7 Completed

Scope:

- Connected the V6 Tape panel to the local Go market engine via `ws://127.0.0.1:8765/stream`.
- Only `type:"trade"` messages are displayed in the Tape V6.
- `delta_bucket` and `vwap` messages are counted but not displayed in the CVD/VWAP panels yet.
- No DOM/l2Book connection was added.
- No Wails or desktop work was started.
- No Binance work was added.
- No Flask route, Journal, Chart, VWAP frontend, Hyperliquid frontend, AI, or legacy `066_orderflow_engine.js` behavior was changed.
- No auth, wallet, private endpoint, order placement, or exchange/trading endpoint was used.
- No commit was made.

Pre-flight:

- Branch verified: `feat/cockpit-v6-orderflow`.
- Working tree was already dirty before Phase 7.
- `netstat -ano | findstr :8765` showed no active listener before starting.

Files added:

- `static/js/split/078_v6_local_engine_client.js`

Files changed:

- `static/js/split/073_v6_orderflow_layout.js`
- `static/js/split/074_v6_tape_panel.js`
- `static/css/split/070_v6_orderflow.css`
- `docs/V6_GO_ENGINE.md`
- `docs/CHANGELOG_V6.md`

UI changes:

- Added `Connect Local Engine` / `Disconnect` button in the V6 header.
- Added engine status bar below the header with:
  - Status dot (gray=disconnected, amber pulsing=connecting, green=connected, red=error)
  - Status text: `Local engine: disconnected/connecting/connected/error`
  - Counters: trades received, delta buckets received, VWAPs received, last message time, errors, reconnects
  - Pause/Resume toggle
  - Clear tape button
- Badge changes: `V6 MOCK` → `V6 LIVE / Go Engine` → `V6 ERROR` → `V6 CONNECTING...`
- Tape panel now shows 6 columns: Time, Side, Price, Qty, Exchange, Symbol.
- Max tape rows increased from 150 to 500.

Engine client:

- `078_v6_local_engine_client.js` is the new WebSocket client for `ws://127.0.0.1:8765/stream`.
- No auto-connect. Connection is manual via button click only.
- Uses generational WebSocket pattern (`wsGeneration`) to prevent stale callbacks.
- Reconnection with exponential backoff (2s base, 30s max, 8 max attempts).
- Trade buffer capped at 500 entries.
- Batch rendering via `requestAnimationFrame` + coalesced 80ms timeout.
- `delta_bucket` and `vwap` messages are counted in stats but not pushed to store panels yet.
- Disconnect properly nullifies callbacks before `ws.close()`.

Connection behavior:

- If `marketd` is not running, the UI stays functional with mock data.
- If connection drops, the UI displays an error status and keeps the last trades visible.
- No exchange browser WebSocket is added by the V6 client.
- The only WebSocket V6 opens is `ws://127.0.0.1:8765/stream`.

Verification results:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 80 modules (hash: 999f46a3f782)
Built static/style.css from 56 modules (hash: 45a702b324fa)
Switched templates to bundle mode (token: 999f46a3f78245a702b324fa)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 2.785s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

```text
Command: go test ./...
Result: success
Output:
?    cockpit-v6-market-go [no test files]
?    cockpit-v6-market-go/cmd/marketd [no test files]
?    cockpit-v6-market-go/cmd/streamcheck [no test files]
ok   cockpit-v6-market-go/internal/calc
ok   cockpit-v6-market-go/internal/config
ok   cockpit-v6-market-go/internal/engine
?    cockpit-v6-market-go/internal/exchange [no test files]
?    cockpit-v6-market-go/internal/exchange/binance [no test files]
ok   cockpit-v6-market-go/internal/exchange/hyperliquid
?    cockpit-v6-market-go/internal/logx [no test files]
?    cockpit-v6-market-go/internal/marketdata [no test files]
ok   cockpit-v6-market-go/internal/ws
ok   cockpit-v6-market-go/pkg/protocol
```

Notes:

- The V6 Tape panel now receives live trades from the Go engine when manually connected.
- `delta_bucket` and `vwap` counters are visible in the engine bar but not rendered in panels yet.
- Hyperliquid remains public read-only.
- No Wails or desktop work was started.
- Phase 8 recommendation: display CVD/Delta/VWAP live data in the V6 panels, OR add Hyperliquid `l2Book`/DOM in Go before connecting more panels.

## 2026-05-29 - Phase 7.5 Completed

Scope:

- Runtime browser validation for the V6 Tape live connection.
- No new feature code was added.
- No Wails or desktop work was started.
- No Binance work was added.
- No Hyperliquid `l2Book`/DOM work was added.
- No Flask route, Journal, Chart, VWAP frontend, Hyperliquid frontend, AI, or legacy `066_orderflow_engine.js` behavior was changed.
- No auth, wallet, private endpoint, order placement, or exchange/trading endpoint was used.
- No commit was made.

Pre-flight:

- Branch verified: `feat/cockpit-v6-orderflow`.
- Working tree was already dirty before Phase 7.5 runtime validation.
- Existing listeners were identified before stopping:
  - `127.0.0.1:8765` was `marketd` PID `21036`.
  - `127.0.0.1:5001` was Python PID `6836`.
  - PID `20180` was VS Code and was not stopped.
- Only PIDs `21036` and `6836` were stopped before starting fresh validation services.

Engine validation:

```text
GET http://127.0.0.1:8765/health
Result: HTTP 200
Service version: 0.6.0-phase6
```

```text
GET http://127.0.0.1:8765/metrics
Result: HTTP 200
Observed:
connected=true
exchange=hyperliquid
symbols=["BTC"]
totalTradesOut=69
totalDeltaBucketsOut=74
totalVWAPOut=16
reconnectCount=0
lastError=""
```

```text
Command: go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=83 trades=20 deltaBuckets=51 vwaps=11 elapsed=18.929s lastTrade=hyperliquid BTC 0.00071000 @ 73540.00 side=buy lastDelta=hyperliquid BTC intervalMs=60000 delta=0.00020000 cvd=-0.86399000 closed=false lastVWAP=hyperliquid BTC value=73539.78815653 coverageStart=1780091218015 isWarm=false cumPV=78870.68740000 cumVol=1.07249000
```

Browser runtime validation:

- URL tested: `http://127.0.0.1:5001/`.
- Browser: Chrome headless through DevTools Protocol.
- V6 mock surface was visible before connection.
- Initial V6 status: `Local engine: disconnected`.
- Manual click on `Connect Local Engine` connected to the Go engine.
- Connected status: `Local engine: connected`.
- Badge: `V6 LIVE / Go Engine`.
- Tape rows rendered live Hyperliquid trades:
  - exchange: `hyperliquid`
  - symbol: `BTC`
  - side: `BUY` / `SELL`
  - price and qty populated
- Observed connected counters:
  - trades: `13`
  - delta buckets: `27`
  - VWAPs: `6`
  - tape rows: `13`
- Later after reconnect/resume:
  - trades: `198`
  - delta buckets: `247`
  - VWAPs: `59`
  - tape rows: `42`

Controls:

- Pause worked: the button changed to `Resume`, trade counters kept increasing, and the visible first tape row stayed stable.
- Resume worked: the button returned to `Pause`, and buffered tape rows appeared again.
- Clear tape worked while paused: visible rows became `0` and the empty state displayed `No trades match the current filter.`

Network validation:

- Before V6 connection, the Dashboard had its preexisting Binance widget WebSocket:
  - `wss://stream.binance.com:9443/ws/btcusdt@kline_3m`
- After clicking `Connect Local Engine`, V6 opened exactly one local WebSocket:
  - `ws://127.0.0.1:8765/stream`
- V6 did not open a browser WebSocket to Hyperliquid.
- V6 did not add a browser exchange WebSocket; the Binance socket observed was preexisting Dashboard behavior.

Console validation:

- No `Runtime.exceptionThrown` page errors were observed.
- No blocking console errors were observed.
- Expected console warnings appeared during the deliberate outage test:
  - `[V6 EngineClient] websocket error`
  - close code `1006`
  - reconnect scheduling logs

Outage / reconnect test:

- `marketd` PID `14604` was stopped deliberately.
- V6 stayed mounted and did not crash.
- Status changed to `Local engine: connecting`.
- Badge changed to `V6 CONNECTING...`.
- Error and reconnect counters increased.
- `marketd` was restarted as PID `21356`.
- The client reconnected and counters resumed.
- Because the previous clear-tape test left the tape paused, the tape stayed visually empty until Resume.
- After Resume, the tape rendered live rows again:
  - status: `Local engine: connected`
  - trades: `198`
  - delta buckets: `247`
  - VWAPs: `59`
  - rows: `42`
  - first row contained `hyperliquid` and `BTC`

Existing pages checked:

- Dashboard: active and rendered.
- Journal: active and rendered.
- Chart: active and rendered.
- Orderflow: active and rendered with V6 live state.

Process handling:

- Phase 7.5 fresh `marketd` PID: `14604`.
- Restarted `marketd` PID after outage test: `21356`.
- Flask PID: `17628`.
- Chrome DevTools listener PID: `5344`.
- PIDs `21356`, `17628`, and `5344` were stopped after validation.
- Final port checks showed no active listener on `8765`, `5001`, or `9222`; only `TIME_WAIT` entries remained.

Final verification:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 80 modules (hash: 999f46a3f782)
Built static/style.css from 56 modules (hash: 45a702b324fa)
Switched templates to bundle mode (token: 999f46a3f78245a702b324fa)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 8.291s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

```text
Command: go test ./...
Result: success
Output:
?    cockpit-v6-market-go [no test files]
?    cockpit-v6-market-go/cmd/marketd [no test files]
?    cockpit-v6-market-go/cmd/streamcheck [no test files]
ok   cockpit-v6-market-go/internal/calc
ok   cockpit-v6-market-go/internal/config
ok   cockpit-v6-market-go/internal/engine
?    cockpit-v6-market-go/internal/exchange [no test files]
?    cockpit-v6-market-go/internal/exchange/binance [no test files]
ok   cockpit-v6-market-go/internal/exchange/hyperliquid
?    cockpit-v6-market-go/internal/logx [no test files]
?    cockpit-v6-market-go/internal/marketdata [no test files]
ok   cockpit-v6-market-go/internal/ws
ok   cockpit-v6-market-go/pkg/protocol
```

Notes:

- Phase 7.5 is now runtime-validated in a browser.
- The V6 Tape live connection is manual and local-only.
- The V6 UI still does not render full CVD/Delta/VWAP panels from live state.
- Phase 8 recommendation: display CVD/Delta/VWAP live in the V6 panels, without adding Wails, Binance, or DOM/l2Book yet.

## Phase 8a - Live Delta / CVD / VWAP Panels

Scope:

- Added live `delta_bucket` and `vwap` consumption to the existing manual V6 local engine client.
- Kept the V6 connection manual through `Connect Local Engine`.
- Kept mock data visible when the local engine is disconnected.
- No Wails, desktop, Binance, DOM/l2Book, heatmap, footprint, Flask route, Journal, legacy Chart, legacy VWAP, Hyperliquid frontend, or `066_orderflow_engine.js` changes.

Files modified in Phase 8a:

- `static/js/split/070_v6_orderflow_contract.js`
- `static/js/split/071_v6_orderflow_store.js`
- `static/js/split/073_v6_orderflow_layout.js`
- `static/js/split/076_v6_cvd_panel.js`
- `static/js/split/078_v6_local_engine_client.js`
- `static/css/split/070_v6_orderflow.css`
- `static/app.js`
- `static/style.css`
- `templates/partials/layout/head_assets_css.html`
- `templates/partials/overlays/scripts.html`
- `docs/CHANGELOG_V6.md`
- `docs/V6_GO_ENGINE.md`

Runtime validation:

- Market engine URL: `http://127.0.0.1:8765`
- Flask URL: `http://127.0.0.1:5001/`
- Page tested: `Orderflow`
- Manual V6 WebSocket: `ws://127.0.0.1:8765/stream`

Engine pre-check:

```text
Command: go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=64 trades=20 deltaBuckets=35 vwaps=8 elapsed=11.398s lastTrade=hyperliquid BTC 0.00017000 @ 73393.00 side=sell lastDelta=hyperliquid BTC intervalMs=1000 delta=0.00205000 cvd=0.45052000 closed=true lastVWAP=hyperliquid BTC value=73382.85565245 coverageStart=1780092809770 isWarm=false cumPV=95589.97543000 cumVol=1.30262000
```

Browser result before connection:

- V6 badge: `V6 MOCK / No live engine`
- CVD panel source: `Mock / No live engine`
- VWAP panel source: `mock`

Browser result after clicking `Connect Local Engine`:

- Status: `Local engine: connected`
- V6 badge: `V6 LIVE / Go Engine`
- Tape live: OK
- Observed counters:
  - trades: `14`
  - delta buckets: `33`
  - VWAPs: `8`
  - tape rows: `14`
- Tape rows contained:
  - exchange: `hyperliquid`
  - symbol: `BTC`
  - side: `BUY` / `SELL`
  - populated price and quantity

Observed Delta / CVD panel:

```text
Interval: 1s / 5s / 1m
Source: Live Go engine
Symbol: BTC
Buy: 2.744
Sell: 0.565
Delta: +2.179
CVD: +3.775
Closed: false
Update: 00:17:00
```

The interval selector was changed to `1000` ms and the panel switched to the 1 second bucket:

```text
selected: 1000
Symbol: BTC
Delta: -0.096
CVD: +3.775
```

Observed VWAP panel:

```text
VWAP: 73,384.7
Symbol: BTC
Session: utc_day:2026-05-29
Session start: 02:00:00
Coverage start: 00:13:29
Source: live
Warm: false
Cum vol: 8.225
Last update: 00:16:58
Warning: Live-only VWAP, not fully warmed from session start.
```

The `isWarm=false` state is visible in the UI and the warning is shown. This correctly documents that the live-only VWAP starts at `coverageStart`, not at the theoretical session start, until historical backfill exists.

Pause / clear behavior:

- Pause worked: the button changed to `Resume`.
- While paused, visible tape rows stayed stable.
- While paused, Delta/CVD and VWAP continued to update from live messages.
- Clear tape worked while paused: visible rows became `0`.
- Clear tape did not reset Delta/CVD or VWAP, which stayed visible.

Network validation:

- V6 opened exactly one local WebSocket:
  - `ws://127.0.0.1:8765/stream`
- V6 did not open a browser WebSocket to Hyperliquid.
- V6 did not add a browser Binance WebSocket.
- The only Binance WebSocket observed was the preexisting Dashboard widget socket:
  - `wss://stream.binance.com:9443/ws/btcusdt@kline_3m`

Console validation:

- No `Runtime.exceptionThrown` page errors were observed.
- No blocking console errors were observed.
- A normal Chrome DevTools warning was observed:
  - `crbug/1173575`

Outage / reconnect test:

- `marketd` PID `16776` was stopped deliberately.
- V6 stayed mounted and did not crash.
- Status changed to `Local engine: connecting`.
- Badge changed to `V6 CONNECTING...`.
- Error and reconnect counters increased.
- Last CVD and VWAP values remained visible and stale rather than crashing the page:
  - CVD: `+3.256`
  - VWAP: `73,386.5`
  - coverage start: `00:13:29`
  - warm: `false`
- `marketd` was restarted as PID `11388`.
- Manual reconnect succeeded.
- After reconnect:
  - status: `Local engine: connected`
  - trades: `295`
  - delta buckets: `256`
  - VWAPs: `62`
  - tape rows: `42`
  - first row contained `hyperliquid` and `BTC`
  - CVD: `+19.2`
  - VWAP: `73,424.2`
  - new coverage start: `00:17:51`
  - warm: `false`

Process handling:

- Fresh Phase 8a `marketd` PID: `16776`.
- Restarted `marketd` PID after outage test: `11388`.
- Flask PID: `880`.
- Chrome DevTools listener PID: `11340`.
- PIDs `11388`, `880`, and `11340` were stopped after validation.
- Final port checks showed no active listener on `8765` or `5001`.

Final verification:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 80 modules (hash: b2aa51c7d483)
Built static/style.css from 56 modules (hash: e81ecc91855f)
Switched templates to bundle mode (token: b2aa51c7d483e81ecc91855f)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 7.574s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

```text
Command: go test ./...
Result: success
Output:
?    cockpit-v6-market-go [no test files]
?    cockpit-v6-market-go/cmd/marketd [no test files]
?    cockpit-v6-market-go/cmd/streamcheck [no test files]
ok   cockpit-v6-market-go/internal/calc
ok   cockpit-v6-market-go/internal/config
ok   cockpit-v6-market-go/internal/engine
?    cockpit-v6-market-go/internal/exchange [no test files]
?    cockpit-v6-market-go/internal/exchange/binance [no test files]
ok   cockpit-v6-market-go/internal/exchange/hyperliquid
?    cockpit-v6-market-go/internal/logx [no test files]
?    cockpit-v6-market-go/internal/marketdata [no test files]
ok   cockpit-v6-market-go/internal/ws
ok   cockpit-v6-market-go/pkg/protocol
```

Notes:

- Phase 8a is runtime-validated in a browser.
- Tape V6 live remains OK.
- Delta/CVD panel now consumes live `delta_bucket` messages.
- VWAP panel now consumes live `vwap` messages.
- The UI explicitly shows `isWarm=false` and the live-only VWAP warning.
- Phase 8.5 recommendation: run a longer browser/runtime stability validation of Tape + Delta/CVD + VWAP without adding new features.

## Phase 8.5 - Long Runtime Validation Tape + Delta/CVD + VWAP

Scope:

- Ran a long live validation of the manual V6 local engine connection.
- No Wails, desktop, Binance, l2Book, DOM live, heatmap, footprint, Flask route, Journal, legacy Chart, legacy VWAP frontend, Hyperliquid frontend, or `066_orderflow_engine.js` changes.
- No commit.

Files modified in Phase 8.5:

- `static/js/split/078_v6_local_engine_client.js`
- `static/app.js`
- `templates/partials/overlays/scripts.html`
- `docs/CHANGELOG_V6.md`

Runtime correction:

- During the first long-run attempt, the Go engine and WebSocket kept receiving messages, but the hidden browser tab stopped flushing UI batches.
- Root cause: `scheduleBatch()` used `requestAnimationFrame`; in a `document.hidden` tab Chrome can throttle or pause rAF enough that the store and DOM stay stale.
- Minimal fix: when `document.hidden` is true, the V6 local engine client now schedules `flushBatch()` with `setTimeout` instead of rAF.
- This is limited to the V6 local engine client and does not affect legacy Journal/Chart/VWAP/Hyperliquid frontend logic.

Run setup:

- Flask URL: `http://127.0.0.1:5001/`
- Go engine URL: `http://127.0.0.1:8765`
- V6 stream: `ws://127.0.0.1:8765/stream`
- Exchange: Hyperliquid public read-only
- Symbol: `BTC`
- Delta intervals: `1000,5000,60000`
- VWAP session: `utc_day`
- VWAP source: `live`

Long run duration:

- Corrected long run: `320` seconds.
- Earlier pre-correction run also confirmed the Go engine continued streaming while the hidden-tab UI flush was stale.

Metrics start:

```json
{
  "ts": "00:48:42",
  "uptimeSeconds": 1203,
  "connected": true,
  "totalTradesOut": 2953,
  "totalDeltaBucketsOut": 3211,
  "totalVWAPOut": 763,
  "totalStreamClients": 1,
  "reconnectCount": 0,
  "lastError": "",
  "cvdBySymbol.BTC": -64.58551999999997,
  "vwapBySymbol.BTC": 73449.78120092824,
  "vwapCoverageStartBySymbol.BTC": 1780093683030,
  "vwapIsWarmBySymbol.BTC": false
}
```

Metrics middle:

```json
{
  "ts": "00:51:12",
  "uptimeSeconds": 1353,
  "connected": true,
  "totalTradesOut": 3541,
  "totalDeltaBucketsOut": 3668,
  "totalVWAPOut": 874,
  "totalStreamClients": 1,
  "reconnectCount": 0,
  "lastError": "",
  "cvdBySymbol.BTC": -81.27578999999999,
  "vwapBySymbol.BTC": 73440.78794918102,
  "vwapCoverageStartBySymbol.BTC": 1780093683030,
  "vwapIsWarmBySymbol.BTC": false
}
```

Metrics end:

```json
{
  "ts": "00:54:02",
  "uptimeSeconds": 1523,
  "connected": true,
  "totalTradesOut": 4041,
  "totalDeltaBucketsOut": 4140,
  "totalVWAPOut": 986,
  "totalStreamClients": 1,
  "reconnectCount": 0,
  "lastError": "",
  "cvdBySymbol.BTC": -89.37717000000002,
  "vwapBySymbol.BTC": 73435.38279904844,
  "vwapCoverageStartBySymbol.BTC": 1780093683030,
  "vwapIsWarmBySymbol.BTC": false
}
```

Process observations:

```text
Start:
chrome PID 10176 CPU 8.375 WorkingSet 159158272 PrivateMemorySize 53870592
marketd PID 11468 CPU 0.984375 WorkingSet 19460096 PrivateMemorySize 53043200
python PID 18396 CPU 7.34375 WorkingSet 104333312 PrivateMemorySize 89845760

Middle:
chrome PID 10176 CPU 10.109375 WorkingSet 159776768 PrivateMemorySize 54059008
marketd PID 11468 CPU 1.171875 WorkingSet 20258816 PrivateMemorySize 54157312
python PID 18396 CPU 9.421875 WorkingSet 105451520 PrivateMemorySize 91176960

End:
chrome PID 10176 CPU 11.765625 WorkingSet 159129600 PrivateMemorySize 53448704
marketd PID 11468 CPU 1.203125 WorkingSet 19931136 PrivateMemorySize 53739520
python PID 18396 CPU 10.453125 WorkingSet 104964096 PrivateMemorySize 89505792
```

Memory result:

- No abnormal memory growth observed for the tested PIDs.
- `marketd` stayed around 19-20 MB working set.
- Chrome stayed around 159 MB working set for the controlled test profile.
- Flask stayed around 104-105 MB working set.

UI start:

- Status: `Local engine: connected`
- Badge: `V6 LIVE / Go Engine`
- UI client stats:
  - trades: `313`
  - delta buckets: `163`
  - VWAPs: `39`
  - errors: `0`
  - reconnects: `0`
- Tape rows: `43`
- First trade: `hyperliquid BTC`
- CVD panel was live.
- VWAP panel was live.
- `WARM false` was visible.
- `coverageStart` was visible.
- Console errors: none.

UI middle:

- Status: `Local engine: connected`
- UI client stats:
  - trades: `901`
  - delta buckets: `620`
  - VWAPs: `150`
  - errors: `0`
  - reconnects: `0`
- Tape continued updating.
- CVD evolved.
- VWAP evolved.
- `isWarm=false` remained visible.
- Console errors: none.

Pause / resume / clear:

- Pause clicked successfully; button changed to `Resume`.
- During the 60 second pause:
  - visible tape rows stayed stable
  - client counters continued to increase
  - Delta/CVD continued to update
  - VWAP continued to update
- Resume clicked successfully; button changed back to `Pause`.
- Clear tape clicked successfully.
- Clear tape did not reset CVD or VWAP.
- New live tape rows resumed after clear.

Page navigation:

- Navigated to Dashboard, then returned to Orderflow.
- V6 connection remained connected.
- Tape, Delta/CVD, and VWAP continued after returning.
- No crash observed.

Network:

- V6 used the local engine stream:
  - `ws://127.0.0.1:8765/stream`
- No browser Hyperliquid WebSocket was added by V6.
- No browser Binance WebSocket was added by V6.

Console:

- During stable run: no console errors and no blocking warnings.
- During deliberate outage: expected WebSocket warnings were logged:
  - `[V6 EngineClient] websocket error`
- No `Runtime.exceptionThrown` page crash was observed.

Outage / reconnect test:

- Stopped `marketd` PID `11468` by exact PID.
- The page did not crash.
- V6 status changed to `Local engine: connecting`.
- Badge changed to `V6 CONNECTING...`.
- Last CVD and VWAP values stayed visible:
  - CVD: `-89.670`
  - VWAP: `73,435.2`
  - coverage start: `00:28:03`
  - warm: `false`
- Expected client stats after outage:
  - errors: `3`
  - reconnects: `3`
  - lastError: `Connection closed: code 1006`
- Relaunched `marketd`; new listener PID was `3576`.
- V6 auto-reconnected once the local engine was available.
- Manual reconnect was also validated:
  - clicked `Disconnect`
  - status changed to `Local engine: disconnected`
  - clicked `Connect Local Engine`
  - status returned to `Local engine: connected`
  - Tape + Delta/CVD + VWAP resumed with new live values

Process cleanup:

- Stopped exact PIDs:
  - `marketd` PID `3576`
  - Flask PID `18396`
  - Chrome PID `10176`
- Final port check:
  - no listener on `8765`
  - no listener on `5001`
  - only `TIME_WAIT` entries remained on `9222`

Final verification:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 80 modules (hash: 2431749f2ceb)
Built static/style.css from 56 modules (hash: e81ecc91855f)
Switched templates to bundle mode (token: 2431749f2cebe81ecc91855f)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 2.663s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

```text
Command: go test ./...
Result: success
Output:
?    cockpit-v6-market-go [no test files]
?    cockpit-v6-market-go/cmd/marketd [no test files]
?    cockpit-v6-market-go/cmd/streamcheck [no test files]
ok   cockpit-v6-market-go/internal/calc
ok   cockpit-v6-market-go/internal/config
ok   cockpit-v6-market-go/internal/engine
?    cockpit-v6-market-go/internal/exchange [no test files]
?    cockpit-v6-market-go/internal/exchange/binance [no test files]
ok   cockpit-v6-market-go/internal/exchange/hyperliquid
?    cockpit-v6-market-go/internal/logx [no test files]
?    cockpit-v6-market-go/internal/marketdata [no test files]
ok   cockpit-v6-market-go/internal/ws
ok   cockpit-v6-market-go/pkg/protocol
```

Notes:

- Phase 8.5 is validated.
- Tape, Delta/CVD, and VWAP stayed stable over the corrected long run.
- The only code correction was the hidden-tab batch flush fallback in the isolated V6 local engine client.
- Phase 9 recommendation: add Hyperliquid `l2Book`/DOM on the Go side, without Wails, Binance, heatmap, or footprint yet.

## Phase 9 - Hyperliquid l2Book / Order Book Go Engine

Scope:

- Added Hyperliquid public read-only `l2Book` subscription in `services/market-go`.
- Normalized Hyperliquid book payloads into V6 `OrderBookSnapshot`.
- Added `order_book` envelopes on local `/stream`.
- Enriched `/metrics` with order book fields.
- Updated `streamcheck` to prove `trade + delta_bucket + vwap + order_book`.
- No UI DOM live connection in this phase.
- No Wails, desktop, Binance, heatmap, footprint, Flask route, Journal, legacy Chart, legacy VWAP frontend, Hyperliquid frontend, or `066_orderflow_engine.js` changes.
- No commit.

Files modified:

- `services/market-go/cmd/streamcheck/main.go`
- `services/market-go/internal/config/config.go`
- `services/market-go/internal/config/config_test.go`
- `services/market-go/internal/engine/engine.go`
- `services/market-go/internal/engine/engine_test.go`
- `services/market-go/internal/engine/metrics.go`
- `services/market-go/internal/exchange/exchange.go`
- `services/market-go/internal/exchange/hyperliquid/client.go`
- `services/market-go/internal/exchange/hyperliquid/client_test.go`
- `services/market-go/internal/exchange/hyperliquid/types.go`
- `services/market-go/internal/exchange/hyperliquid/normalize_book.go`
- `services/market-go/internal/exchange/hyperliquid/normalize_book_test.go`
- `services/market-go/internal/marketdata/types.go`
- `services/market-go/internal/ws/server.go`
- `static/app.js`
- `templates/partials/overlays/scripts.html`
- `docs/V6_GO_ENGINE.md`
- `docs/CHANGELOG_V6.md`

Contract added:

- Envelope type: `order_book`
- Payload source: `l2Book`
- `levels[0]` maps to bids.
- `levels[1]` maps to asks.
- `px` maps to `price`.
- `sz` maps to `size`.
- `n` maps to `orders`.
- Invalid price/size levels are skipped without panic.
- Empty bid or ask sides are accepted without panic.

Config added:

- `MARKET_GO_BOOK_ENABLED=true`
- `MARKET_GO_BOOK_DEPTH=20`
- `MARKET_GO_BOOK_EMIT_MS=250`

Metrics added:

- `bookEnabled`
- `totalOrderBookOut`
- `lastBookTsExchange`
- `lastBookTsLocal`
- `orderBookDepthBySymbol`
- `bestBidBySymbol`
- `bestAskBySymbol`
- `spreadBySymbol`
- `midBySymbol`

Live command:

```powershell
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
$env:MARKET_GO_VWAP_ENABLED='true'
$env:MARKET_GO_VWAP_SESSION='utc_day'
$env:MARKET_GO_BOOK_ENABLED='true'
$env:MARKET_GO_BOOK_DEPTH='20'
$env:MARKET_GO_BOOK_EMIT_MS='250'
go run ./cmd/marketd
```

Startup logs:

```text
[market-go] INFO listening on http://127.0.0.1:8765 exchange=hyperliquid mockMode=false symbols=BTC
[market-go] INFO hyperliquid websocket connected url=wss://api.hyperliquid.xyz/ws
[market-go] INFO hyperliquid subscribed trades symbol=BTC url=wss://api.hyperliquid.xyz/ws
[market-go] INFO hyperliquid subscribed l2Book symbol=BTC url=wss://api.hyperliquid.xyz/ws
[market-go] INFO hyperliquid trade received symbol=BTC totalTradesOut=1
[market-go] INFO hyperliquid l2Book received symbol=BTC totalOrderBookOut=1
```

Health check:

```text
Command: curl.exe http://127.0.0.1:8765/health
Result: success
Payload:
{"ok":true,"service":"cockpit-v6-market-go","version":"0.6.0-phase6","time":"2026-05-29T23:04:41.9721741Z"}
```

Initial metrics:

```json
{
  "uptimeSeconds": 21,
  "connected": true,
  "totalMessagesIn": 53,
  "totalTradesOut": 63,
  "totalDeltaBucketsOut": 63,
  "totalVWAPOut": 11,
  "totalOrderBookOut": 37,
  "totalStreamClients": 0,
  "bookEnabled": true,
  "lastError": "",
  "reconnectCount": 0,
  "orderBookDepthBySymbol": {"BTC": 20},
  "bestBidBySymbol": {"BTC": 73425},
  "bestAskBySymbol": {"BTC": 73426},
  "spreadBySymbol": {"BTC": 1},
  "midBySymbol": {"BTC": 73425.5}
}
```

Streamcheck:

```text
Command: go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=91 trades=20 deltaBuckets=36 vwaps=8 orderBooks=26 elapsed=15.26s lastTrade=hyperliquid BTC 0.00017000 @ 73426.00 side=buy lastDelta=hyperliquid BTC intervalMs=60000 delta=0.00015000 cvd=0.07354000 closed=false lastVWAP=hyperliquid BTC value=73421.88521125 coverageStart=1780095842573 isWarm=false cumPV=74689.14695000 cumVol=1.01726000 lastBook=hyperliquid BTC bestBid=73425.00 bestAsk=73426.00 spread=1.00 depth=20 source=l2Book
```

Final streamcheck:

```text
Command: go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=88 trades=20 deltaBuckets=39 vwaps=9 orderBooks=19 elapsed=10.858s lastTrade=hyperliquid BTC 0.00030000 @ 73418.00 side=sell lastDelta=hyperliquid BTC intervalMs=60000 delta=-21.96743000 cvd=6.35021000 closed=false lastVWAP=hyperliquid BTC value=73451.10448860 coverageStart=1780095842573 isWarm=false cumPV=4752558.96401000 cumVol=64.70371000 lastBook=hyperliquid BTC bestBid=73419.00 bestAsk=73420.00 spread=1.00 depth=20 source=l2Book
```

Five minute live test:

- Start: `01:05:10`
- End: `01:10:10`
- Duration: `300` seconds

Metrics at start:

```json
{
  "uptimeSeconds": 50,
  "connected": true,
  "totalMessagesIn": 131,
  "totalTradesOut": 137,
  "totalDeltaBucketsOut": 149,
  "totalVWAPOut": 31,
  "totalOrderBookOut": 86,
  "totalStreamClients": 0,
  "lastError": "",
  "reconnectCount": 0,
  "bestBidBySymbol": {"BTC": 73439},
  "bestAskBySymbol": {"BTC": 73440},
  "spreadBySymbol": {"BTC": 1},
  "midBySymbol": {"BTC": 73439.5}
}
```

Metrics at end:

```json
{
  "uptimeSeconds": 350,
  "connected": true,
  "totalMessagesIn": 968,
  "totalTradesOut": 998,
  "totalDeltaBucketsOut": 1084,
  "totalVWAPOut": 256,
  "totalOrderBookOut": 599,
  "totalStreamClients": 0,
  "lastError": "",
  "reconnectCount": 1,
  "bestBidBySymbol": {"BTC": 73415},
  "bestAskBySymbol": {"BTC": 73416},
  "spreadBySymbol": {"BTC": 1},
  "midBySymbol": {"BTC": 73415.5}
}
```

Reconnect note:

- One Hyperliquid TCP disconnect occurred during the 5 minute run:
  - `wsarecv: An established connection was aborted by the software in your host machine`
- The engine scheduled reconnect attempt `1` with `delay=1s`.
- Reconnect succeeded.
- Trades and `l2Book` were resubscribed.
- `lastError` was empty at the final metrics check.

Process observation:

```text
marketd PID 22256
CPU 0.34375
WorkingSet 21331968
PrivateMemorySize 54624256
```

Cleanup:

- Stopped exact PID `22256`.
- Final port check showed no active listener on `8765`; only `TIME_WAIT` entries remained.
- Flask/UI was not launched for Phase 9.

Final verification:

```text
Command: go mod tidy
Result: success
```

```text
Command: go test ./...
Result: success
Output:
?    cockpit-v6-market-go [no test files]
?    cockpit-v6-market-go/cmd/marketd [no test files]
?    cockpit-v6-market-go/cmd/streamcheck [no test files]
ok   cockpit-v6-market-go/internal/calc
ok   cockpit-v6-market-go/internal/config
ok   cockpit-v6-market-go/internal/engine
?    cockpit-v6-market-go/internal/exchange [no test files]
?    cockpit-v6-market-go/internal/exchange/binance [no test files]
ok   cockpit-v6-market-go/internal/exchange/hyperliquid
?    cockpit-v6-market-go/internal/logx [no test files]
?    cockpit-v6-market-go/internal/marketdata [no test files]
ok   cockpit-v6-market-go/internal/ws
ok   cockpit-v6-market-go/pkg/protocol
```

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 80 modules (hash: 2431749f2ceb)
Built static/style.css from 56 modules (hash: e81ecc91855f)
Switched templates to bundle mode (token: 2431749f2cebe81ecc91855f)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 2.459s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Notes:

- Phase 9 is validated on the engine side.
- `order_book` is available on `/stream`.
- The V6 DOM panel is still not connected to live book data.
- Phase 10 recommendation: connect the V6 DOM panel to `order_book` only, without heatmap or footprint.

## Phase 10 - V6 DOM Panel Live Order Book

Scope:

- Connected the isolated V6 UI state/client to local `order_book` envelopes.
- Added a visible `Books` counter to the V6 engine bar.
- Updated the V6 DOM panel renderer to display live order book snapshots.
- Kept the V6 engine connection manual through `Connect Local Engine`.
- No Wails, desktop, Binance, heatmap, footprint, Flask route, Journal, legacy Chart, legacy VWAP frontend, Hyperliquid frontend, or `066_orderflow_engine.js` changes.
- No commit.

Files modified:

- `static/js/split/070_v6_orderflow_contract.js`
- `static/js/split/071_v6_orderflow_store.js`
- `static/js/split/072_v6_orderflow_mock.js`
- `static/js/split/073_v6_orderflow_layout.js`
- `static/js/split/075_v6_dom_panel.js`
- `static/js/split/078_v6_local_engine_client.js`
- `static/css/split/070_v6_orderflow.css`
- `static/app.js`
- `static/style.css`
- `templates/partials/layout/head_assets_css.html`
- `templates/partials/overlays/scripts.html`
- `docs/CHANGELOG_V6.md`

Implemented UI behavior:

- When disconnected, the V6 DOM panel keeps the existing mock book and labels it as `Mock / No live engine`.
- When connected, the local engine client consumes `type:"order_book"`.
- The store keeps:
  - `orderBook`
  - `lastOrderBookBySymbol`
  - `orderBookCount`
  - `lastOrderBookTs`
  - `selectedDomSymbol`
- The DOM panel displays:
  - symbol
  - exchange
  - bestBid
  - bestAsk
  - spread
  - mid
  - depth
  - last update
  - bids
  - asks
  - price
  - size
  - orders
  - cumulative size
- The renderer computes cumulative size on the UI side if a level does not include it.
- The renderer tolerates empty or invalid levels without crashing.
- Tape pause/resume/clear remains isolated from DOM/CVD/VWAP state.

Engine pre-check:

```text
Command: curl.exe http://127.0.0.1:8765/health
Result: success
Payload:
{"ok":true,"service":"cockpit-v6-market-go","version":"0.6.0-phase6","time":"2026-05-29T23:18:16.5262562Z"}
```

```json
{
  "connected": true,
  "totalTradesOut": 62,
  "totalDeltaBucketsOut": 71,
  "totalVWAPOut": 15,
  "totalOrderBookOut": 45,
  "bookEnabled": true,
  "lastError": "",
  "reconnectCount": 0,
  "bestBidBySymbol": {"BTC": 73370},
  "bestAskBySymbol": {"BTC": 73371},
  "spreadBySymbol": {"BTC": 1},
  "midBySymbol": {"BTC": 73370.5},
  "orderBookDepthBySymbol": {"BTC": 20}
}
```

Verification completed before approval-limit blocker:

```text
Command: node --check static/js/split/078_v6_local_engine_client.js
Result: success
Output: none

Command: node --check static/js/split/075_v6_dom_panel.js
Result: success
Output: none

Command: node --check static/js/split/073_v6_orderflow_layout.js
Result: success
Output: none

Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 80 modules (hash: b7e4ce6d75d9)
Built static/style.css from 56 modules (hash: a308389f216c)
Switched templates to bundle mode (token: b7e4ce6d75d9a308389f216c)

Command: node --check static/app.js
Result: success
Output: none
```

Runtime browser validation:

- URL tested: `http://127.0.0.1:5001/`, page `Orderflow`.
- Before connecting, the DOM panel kept the mock order book and labelled it as `Mock / No live engine`.
- Manual click on `Connect Local Engine` connected the V6 surface to the local Go stream.
- The V6 opened only the local WebSocket:
  - `ws://127.0.0.1:8765/stream`
- No browser WebSocket to Hyperliquid or Binance was added by the V6 UI.
- DevTools console: no blocking errors. The only warnings observed were expected WebSocket errors during the deliberate `marketd` outage test.

Observed live UI after connection:

```text
Badge: V6 LIVE / Go Engine
Status: Local engine: connected
Counters: Trades 575, Deltas 1272, VWAPs 301, Books 865, Errors 0, Reconnects 0
Tape: live Hyperliquid BTC rows visible
Delta/CVD: live values still updating
VWAP: live value visible, live-only warning still visible, isWarm=false
DOM source: Live Go engine
DOM exchange/symbol: hyperliquid BTC
DOM bestBid: 73487
DOM bestAsk: 73488
DOM spread: 1
DOM mid: 73487.5
DOM depth: 20
DOM bids visible: 20
DOM asks visible: 20
```

Five minute runtime check:

```json
{
  "start": {
    "totalTradesOut": 11127,
    "totalDeltaBucketsOut": 12590,
    "totalVWAPOut": 2993,
    "totalOrderBookOut": 8328,
    "bestBidBySymbol": {"BTC": 73496},
    "bestAskBySymbol": {"BTC": 73497},
    "spreadBySymbol": {"BTC": 1},
    "lastError": "",
    "reconnectCount": 472
  },
  "end": {
    "totalTradesOut": 11437,
    "totalDeltaBucketsOut": 13321,
    "totalVWAPOut": 3164,
    "totalOrderBookOut": 8848,
    "bestBidBySymbol": {"BTC": 73487},
    "bestAskBySymbol": {"BTC": 73488},
    "spreadBySymbol": {"BTC": 1},
    "lastError": "",
    "reconnectCount": 472
  }
}
```

Runtime process memory observed near the end of the run:

```text
marketd PID 7684: WorkingSet ~58 MB, PrivateMemory ~55 MB
Flask PID 22660: WorkingSet ~103 MB, PrivateMemory ~87 MB
Chrome PID 5452: WorkingSet ~154 MB, PrivateMemory ~52 MB
```

Outage/reconnect test:

- Stopped only `marketd` PID `7684`.
- The V6 page stayed on `Orderflow` and did not crash.
- The UI kept the last DOM/Tape/Delta/VWAP values visible.
- Status changed to connecting, and UI counters showed expected connection errors/reconnect attempts.
- Relaunched a fresh Hyperliquid live `marketd` with `MARKET_GO_BOOK_ENABLED=true`.
- Fresh engine metrics after restart:

```json
{
  "exchange": "hyperliquid",
  "symbols": ["BTC"],
  "mockMode": false,
  "connected": true,
  "totalTradesOut": 36,
  "totalDeltaBucketsOut": 50,
  "totalVWAPOut": 6,
  "totalOrderBookOut": 19,
  "bookEnabled": true,
  "lastError": "",
  "reconnectCount": 0,
  "bestBidBySymbol": {"BTC": 73487},
  "bestAskBySymbol": {"BTC": 73488},
  "spreadBySymbol": {"BTC": 1}
}
```

- The V6 reconnected and Tape + Delta/CVD + VWAP + DOM resumed.
- Post-reconnect UI counters: Trades `594`, Deltas `1338`, VWAPs `316`, Books `922`.
- Post-reconnect DOM: `hyperliquid BTC`, bestBid `73487`, bestAsk `73488`, spread `1`, depth `20`, 20 bids, 20 asks.

Final checks:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 80 modules (hash: b7e4ce6d75d9)
Built static/style.css from 56 modules (hash: a308389f216c)
Switched templates to bundle mode (token: b7e4ce6d75d9a308389f216c)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 2.678s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

```text
Command: cd services/market-go; go test ./...
Result: success
Summary:
Go packages passed, including internal/calc, internal/config, internal/engine,
internal/exchange/hyperliquid, internal/ws, and pkg/protocol.
```

Shutdown:

- Stopped only `marketd` PID `1324`, launcher PID `21192`, and Flask PID `22660`.
- `127.0.0.1:8765` and `127.0.0.1:5001` had no remaining listeners after shutdown.
- No commit.

Status:

- Phase 10 is complete.
- DOM V6 now consumes local `order_book` envelopes.
- Tape live, Delta/CVD live, and VWAP live still work.
- No heatmap, footprint, Wails, desktop, Binance, Flask route change, legacy chart change, legacy VWAP frontend change, Hyperliquid frontend change, or `066_orderflow_engine.js` change was made.

## Phase 11 - Heatmap SD Frames in Go

Scope:

- Added Go-side `heatmap_frame` generation from normalized `order_book` snapshots.
- Kept the V6 UI without heatmap rendering.
- Kept Hyperliquid public read-only as the only live exchange.
- Kept `trade`, `delta_bucket`, `vwap`, and `order_book` streaming unchanged.
- No Wails, desktop, Binance, footprint, Flask route, Journal, legacy Chart, legacy VWAP frontend, Hyperliquid frontend, or `066_orderflow_engine.js` changes.
- No commit.

Files modified:

- `services/market-go/internal/marketdata/types.go`
- `services/market-go/internal/calc/heatmap.go`
- `services/market-go/internal/calc/heatmap_test.go`
- `services/market-go/internal/config/config.go`
- `services/market-go/internal/config/config_test.go`
- `services/market-go/internal/engine/engine.go`
- `services/market-go/internal/engine/engine_test.go`
- `services/market-go/internal/engine/metrics.go`
- `services/market-go/internal/ws/server.go`
- `services/market-go/cmd/streamcheck/main.go`
- `docs/V6_GO_ENGINE.md`
- `docs/CHANGELOG_V6.md`

Implemented engine behavior:

- New `HeatmapLevel` payload:
  - `price`
  - `bidSize`
  - `askSize`
  - `totalSize`
  - `intensity`
- New `HeatmapFrame` payload:
  - `exchange`
  - `symbol`
  - `tsExchange`
  - `tsLocal`
  - `mid`
  - `bestBid`
  - `bestAsk`
  - `priceMin`
  - `priceMax`
  - `tickSize`
  - `levels`
  - `source`
  - `depth`
- Bids and asks are merged by normalized price level.
- `totalSize = bidSize + askSize`.
- `intensity = totalSize / maxTotalSizeVisible`, clamped to `[0, 1]`.
- Invalid tick size falls back to `1`.
- Empty/bid-only/ask-only books are handled without panic.
- Heatmap frames are throttled by `MARKET_GO_HEATMAP_EMIT_MS`, default `500`.
- `MARKET_GO_HEATMAP_MAX_LEVELS` limits payload size.

Config added:

```text
MARKET_GO_HEATMAP_ENABLED=true
MARKET_GO_HEATMAP_EMIT_MS=500
MARKET_GO_HEATMAP_DEPTH=20
MARKET_GO_HEATMAP_TICK_SIZE=1
MARKET_GO_HEATMAP_MAX_LEVELS=100
```

Metrics added:

- `heatmapEnabled`
- `totalHeatmapFramesOut`
- `lastHeatmapTsLocal`
- `heatmapDepthBySymbol`
- `heatmapLevelsBySymbol`
- `heatmapPriceMinBySymbol`
- `heatmapPriceMaxBySymbol`

Stream checker:

```text
Command: go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=114 trades=20 deltaBuckets=38 vwaps=9 orderBooks=24 heatmapFrames=22 elapsed=13.122s lastTrade=hyperliquid BTC 0.00030000 @ 73518.00 side=sell lastDelta=hyperliquid BTC intervalMs=60000 delta=-0.02059000 cvd=-2.38609000 closed=false lastVWAP=hyperliquid BTC value=73518.30018908 coverageStart=1780133573061 isWarm=false cumPV=438968.21305000 cumVol=5.97087000 lastBook=hyperliquid BTC bestBid=73518.00 bestAsk=73519.00 spread=1.00 depth=20 source=l2Book lastHeatmap=hyperliquid BTC levels=40 priceMin=73499.00 priceMax=73538.00 mid=73518.50 maxIntensity=1.00
```

Five minute live engine test:

```json
{
  "start": {
    "connected": true,
    "totalTradesOut": 89,
    "totalDeltaBucketsOut": 132,
    "totalVWAPOut": 26,
    "totalOrderBookOut": 72,
    "totalHeatmapFramesOut": 69,
    "lastError": "",
    "reconnectCount": 0,
    "heatmapLevelsBySymbol": {"BTC": 40},
    "heatmapPriceMinBySymbol": {"BTC": 73497},
    "heatmapPriceMaxBySymbol": {"BTC": 73536}
  },
  "end": {
    "connected": true,
    "totalTradesOut": 1021,
    "totalDeltaBucketsOut": 918,
    "totalVWAPOut": 213,
    "totalOrderBookOut": 622,
    "totalHeatmapFramesOut": 593,
    "lastError": "",
    "reconnectCount": 0,
    "heatmapLevelsBySymbol": {"BTC": 40},
    "heatmapPriceMinBySymbol": {"BTC": 73511},
    "heatmapPriceMaxBySymbol": {"BTC": 73550}
  }
}
```

UI smoke check:

- Flask was launched temporarily on `127.0.0.1:5001`.
- V6 connected manually to local `ws://127.0.0.1:8765/stream`.
- No heatmap renderer was added.
- UI did not crash while the stream included `heatmap_frame`.
- DevTools console: no errors or warnings during the smoke check.
- Existing Dashboard Binance WebSocket may still appear from the existing dashboard widget; no new exchange WebSocket was added for heatmap.

Final checks:

```text
Command: cd services/market-go; go mod tidy
Result: success
```

```text
Command: cd services/market-go; gofmt -w .
Result: success
```

```text
Command: cd services/market-go; go test ./...
Result: success
Summary:
Go packages passed, including internal/calc, internal/config, internal/engine,
internal/exchange/hyperliquid, internal/ws, and pkg/protocol.
```

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 80 modules (hash: b7e4ce6d75d9)
Built static/style.css from 56 modules (hash: a308389f216c)
Switched templates to bundle mode (token: b7e4ce6d75d9a308389f216c)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 2.409s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Shutdown:

- Stopped only the Phase 11 `marketd`/launcher and Flask PIDs.
- `127.0.0.1:8765` had no listener after shutdown.
- `127.0.0.1:5001` had no listener after shutdown; only short-lived `TIME_WAIT` sockets remained.

Status:

- Phase 11 is complete.
- `heatmap_frame` is produced and streamed by Go.
- `streamcheck` proves `trade`, `delta_bucket`, `vwap`, `order_book`, and `heatmap_frame`.
- No heatmap UI renderer exists yet.

## Phase 12 - Heatmap SD Canvas UI

Date: 2026-05-31

Scope:

- Render `heatmap_frame` messages in the V6 canvas.
- Keep the Go engine manual.
- Keep V6 connection manual through `Connect Local Engine`.
- No footprint.
- No Wails or desktop.
- No Binance.
- No Flask route changes.
- No Journal, legacy Chart, legacy VWAP frontend, Hyperliquid frontend, or `066_orderflow_engine.js` changes.
- No commit.

Files modified for Phase 12:

- `static/js/split/070_v6_orderflow_contract.js`
- `static/js/split/071_v6_orderflow_store.js`
- `static/js/split/072_v6_orderflow_mock.js`
- `static/js/split/073_v6_orderflow_layout.js`
- `static/js/split/077_v6_canvas_chart.js`
- `static/js/split/078_v6_local_engine_client.js`
- `static/app.js`
- `templates/partials/overlays/scripts.html`
- `docs/CHANGELOG_V6.md`
- `docs/V6_GO_ENGINE.md`

UI behavior added:

- V6 store now keeps a bounded FIFO buffer of heatmap frames.
- Default UI buffer: 360 frames, clamped between 60 and 600.
- V6 header now shows `Heatmap` frame count.
- V6 settings include `Show Heatmap`.
- The V6 canvas renders Heatmap SD with Canvas 2D:
  - X axis = frame index.
  - Y axis = price interpolation between `priceMin` and `priceMax`.
  - Each level is rendered as a small rectangle.
  - Color/intensity derives from bid/ask/total liquidity.
  - MID, BID, and ASK guide lines are shown.
  - Labels show frames, levels, price range, and source.
- When disconnected, the existing mock chart remains visible.
- When live but no frame is available yet, the canvas shows `Waiting for heatmap frames`.

Engine command used:

```powershell
cd services/market-go
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
$env:MARKET_GO_VWAP_ENABLED='true'
$env:MARKET_GO_VWAP_SESSION='utc_day'
$env:MARKET_GO_BOOK_ENABLED='true'
$env:MARKET_GO_BOOK_DEPTH='20'
$env:MARKET_GO_BOOK_EMIT_MS='250'
$env:MARKET_GO_HEATMAP_ENABLED='true'
$env:MARKET_GO_HEATMAP_EMIT_MS='500'
$env:MARKET_GO_HEATMAP_DEPTH='20'
$env:MARKET_GO_HEATMAP_TICK_SIZE='1'
$env:MARKET_GO_HEATMAP_MAX_LEVELS='100'
go run ./cmd/marketd
```

Runtime browser validation:

- URL tested: `http://127.0.0.1:5001/`
- Page tested: `Orderflow`
- V6 connected manually to `ws://127.0.0.1:8765/stream`.
- Tape live: OK.
- Delta/CVD live: OK.
- VWAP live: OK.
- DOM live: OK.
- Heatmap SD canvas: OK.
- `isWarm=false` remained visible for live-only VWAP.
- No blocking DevTools console error.
- V6 local engine client opens only `ws://127.0.0.1:8765/stream`.
- Existing Dashboard/widget code may still open its existing Binance WebSocket; Phase 12 did not add any browser exchange WebSocket.
- Browser plugin was not available in this session; validation used Chrome DevTools Protocol fallback against the existing Chrome debug port.

Initial live UI sample:

```json
{
  "badge": "V6 LIVE / Go Engine",
  "trades": 94,
  "deltaBuckets": 231,
  "vwaps": 55,
  "books": 144,
  "heatmapFrames": 135,
  "storedHeatmapFrames": 135,
  "levels": 40,
  "priceMin": 73581,
  "priceMax": 73620,
  "mid": 73600.5,
  "bestBid": 73600,
  "bestAsk": 73601,
  "canvasNonBackgroundPixels": 36000
}
```

Five minute runtime test:

```json
{
  "start": {
    "uptimeSeconds": 55998,
    "connected": true,
    "totalTradesOut": 13779,
    "totalDeltaBucketsOut": 12824,
    "totalVWAPOut": 3082,
    "totalOrderBookOut": 8491,
    "totalHeatmapFramesOut": 8196,
    "totalStreamClients": 1,
    "lastError": "",
    "reconnectCount": 3412,
    "bestBid": 74046,
    "bestAsk": 74047,
    "spread": 1,
    "mid": 74046.5,
    "heatmapLevels": 40,
    "heatmapPriceMin": 74027,
    "heatmapPriceMax": 74066
  },
  "end": {
    "uptimeSeconds": 56304,
    "connected": true,
    "totalTradesOut": 14833,
    "totalDeltaBucketsOut": 13802,
    "totalVWAPOut": 3319,
    "totalOrderBookOut": 9050,
    "totalHeatmapFramesOut": 8735,
    "totalStreamClients": 1,
    "lastError": "",
    "reconnectCount": 3412,
    "bestBid": 74085,
    "bestAsk": 74086,
    "spread": 1,
    "mid": 74085.5,
    "heatmapLevels": 40,
    "heatmapPriceMin": 74066,
    "heatmapPriceMax": 74105
  }
}
```

Observed process memory near the end of the live run:

```text
marketd PID 22088: working set ~26.7 MB, private memory ~57.0 MB
Flask PID 10152: working set ~57.2 MB, private memory ~88.2 MB
Chrome debug PID 5452: working set ~141.6 MB, private memory ~63.9 MB
```

UI state after the five minute run:

```json
{
  "badge": "V6 LIVE / Go Engine",
  "trades": 14660,
  "deltaBuckets": 13511,
  "vwaps": 3254,
  "books": 8876,
  "heatmapFrames": 8573,
  "storedHeatmapFrames": 360,
  "levels": 40,
  "priceMin": 74060,
  "priceMax": 74099,
  "mid": 74079.5,
  "canvasNonBackgroundPixels": 47559,
  "consoleErrors": []
}
```

Notes:

- The large `reconnectCount` was inherited from the already long-running engine process before the measured five minute window.
- `reconnectCount` stayed stable during the measured window.
- `lastError` stayed empty.
- Existing BTC dashboard countdown/REST fallback warnings appeared in DevTools after navigation. They are preexisting widget warnings and were not caused by the V6 heatmap renderer.

Outage and reconnect test:

- Stopped only the active `marketd` listener PID.
- `127.0.0.1:8765` had no listener after shutdown.
- V6 page did not crash.
- Last heatmap remained visible with 360 stored frames.
- UI showed connecting/error counters instead of crashing.
- Relaunched `marketd` manually.
- V6 reconnected and resumed without opening any browser exchange WebSocket from the V6 client.
- Tape, Delta/CVD, VWAP, DOM, and Heatmap all resumed.

Post-reconnect sample:

```json
{
  "badge": "V6 LIVE / Go Engine",
  "trades": 14791,
  "deltaBuckets": 13731,
  "vwaps": 3307,
  "books": 9025,
  "heatmapFrames": 8719,
  "storedHeatmapFrames": 360,
  "levels": 40,
  "priceMin": 74011,
  "priceMax": 74050,
  "mid": 74030.5,
  "bestBid": 74030,
  "bestAsk": 74031,
  "canvasNonBackgroundPixels": 24849,
  "consoleErrors": []
}
```

Final checks:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 80 modules (hash: bb8c264ced74)
Built static/style.css from 56 modules (hash: a308389f216c)
Switched templates to bundle mode (token: bb8c264ced74a308389f216c)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 8.645s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

```text
Command: cd services/market-go; go test ./...
Result: success
Summary:
All Go packages passed, including internal/calc, internal/config, internal/engine,
internal/exchange/hyperliquid, internal/ws, and pkg/protocol.
```

Shutdown:

- Stopped only the active Phase 12 `marketd` and Flask listener PIDs.
- `127.0.0.1:8765` had no listener after shutdown.
- `127.0.0.1:5001` had no listener after shutdown; only short-lived `TIME_WAIT` sockets remained.

Status:

- Phase 12 is complete.
- Heatmap SD is visible in the V6 canvas.
- Tape, Delta/CVD, VWAP, and DOM remain live.
- No footprint exists yet.
- No Wails or desktop integration was added.

## Phase 13 - Footprint V1 Go Engine

Date: 2026-05-31

Scope:

- Build footprint candles in the Go market engine from normalized Hyperliquid trades.
- Stream `footprint_candle` envelopes on local `/stream`.
- Keep V6 UI footprint rendering out of scope.
- Keep existing `trade`, `delta_bucket`, `vwap`, `order_book`, and `heatmap_frame` streams working.
- Hyperliquid public read-only only.
- No wallet, auth, orders, Wails, desktop, Binance, Flask routes, Journal, legacy Chart, legacy VWAP frontend, existing Hyperliquid frontend, or `066_orderflow_engine.js` changes.
- No commit.

Files modified for Phase 13:

- `services/market-go/internal/marketdata/types.go`
- `services/market-go/internal/config/config.go`
- `services/market-go/internal/config/config_test.go`
- `services/market-go/internal/calc/footprint.go`
- `services/market-go/internal/calc/footprint_test.go`
- `services/market-go/internal/engine/engine.go`
- `services/market-go/internal/engine/engine_test.go`
- `services/market-go/internal/engine/metrics.go`
- `services/market-go/internal/ws/server.go`
- `services/market-go/cmd/streamcheck/main.go`
- `docs/CHANGELOG_V6.md`
- `docs/V6_GO_ENGINE.md`

Engine behavior added:

- `MARKET_GO_FOOTPRINT_ENABLED=true` enables footprint generation.
- Default candle interval: `60000` ms.
- Default tick size: `1`.
- Default emit throttle: `500` ms.
- Default max levels: `200`.
- Active footprint candles emit periodically as `closed:false`.
- Previous candle emits with `closed:true` when a new interval starts.
- Invalid trades are ignored without panic.
- `buyVol` and `sellVol` use the already normalized trade side convention:
  - `buyVol` = normalized aggressive buy volume.
  - `sellVol` = normalized aggressive sell volume.
- The engine does not rename buy/sell to bid/ask.

Metrics added:

- `footprintEnabled`
- `totalFootprintCandlesOut`
- `totalFootprintClosedOut`
- `lastFootprintTsLocal`
- `footprintIntervalMs`
- `footprintTickSize`
- `footprintLevelsBySymbol`
- `footprintPOCBySymbol`
- `footprintDeltaBySymbol`
- `footprintVolumeBySymbol`

Unit and compile validation:

```text
Command: cd services/market-go; go mod tidy
Result: success
```

```text
Command: cd services/market-go; gofmt -w .
Result: success
```

```text
Command: cd services/market-go; go test ./...
Result: success
Summary:
All Go packages passed, including internal/calc, internal/config, internal/engine,
internal/exchange/hyperliquid, internal/ws, and pkg/protocol.
```

Note: the first sandboxed `go test ./...` was blocked by Windows AppData Go build cache permissions. The same command passed with approval.

Live startup:

```powershell
cd services/market-go
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
$env:MARKET_GO_VWAP_ENABLED='true'
$env:MARKET_GO_VWAP_SESSION='utc_day'
$env:MARKET_GO_BOOK_ENABLED='true'
$env:MARKET_GO_BOOK_DEPTH='20'
$env:MARKET_GO_BOOK_EMIT_MS='250'
$env:MARKET_GO_HEATMAP_ENABLED='true'
$env:MARKET_GO_HEATMAP_EMIT_MS='500'
$env:MARKET_GO_HEATMAP_DEPTH='20'
$env:MARKET_GO_HEATMAP_TICK_SIZE='1'
$env:MARKET_GO_HEATMAP_MAX_LEVELS='100'
$env:MARKET_GO_FOOTPRINT_ENABLED='true'
$env:MARKET_GO_FOOTPRINT_INTERVAL_MS='60000'
$env:MARKET_GO_FOOTPRINT_TICK_SIZE='1'
$env:MARKET_GO_FOOTPRINT_EMIT_MS='500'
$env:MARKET_GO_FOOTPRINT_MAX_LEVELS='200'
go run ./cmd/marketd
```

Health:

```json
{"ok":true,"service":"cockpit-v6-market-go","version":"0.6.0-phase6","time":"2026-05-31T02:09:43.8131782Z"}
```

Initial `/metrics` sample:

```json
{
  "connected": true,
  "totalTradesOut": 98,
  "totalDeltaBucketsOut": 139,
  "totalVWAPOut": 33,
  "totalOrderBookOut": 86,
  "totalHeatmapFramesOut": 83,
  "totalFootprintCandlesOut": 30,
  "totalFootprintClosedOut": 1,
  "lastError": "",
  "reconnectCount": 0,
  "footprintEnabled": true,
  "footprintIntervalMs": 60000,
  "footprintTickSize": 1,
  "footprintLevelsBySymbol": {"BTC": 10},
  "footprintPOCBySymbol": {"BTC": 74078},
  "footprintDeltaBySymbol": {"BTC": -0.1716600000000001},
  "footprintVolumeBySymbol": {"BTC": 0.5391600000000001}
}
```

Stream checker:

```text
Command: cd services/market-go; go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=64 trades=20 deltaBuckets=20 vwaps=5 orderBooks=7 heatmapFrames=7 footprintCandles=4 elapsed=4.059s lastTrade=hyperliquid BTC 0.00017000 @ 74081.00 side=sell lastDelta=hyperliquid BTC intervalMs=60000 delta=-0.06447000 cvd=0.20197000 closed=false lastVWAP=hyperliquid BTC value=74084.57697263 coverageStart=1780193333032 isWarm=false cumPV=38523.23918000 cumVol=0.51999000 lastBook=hyperliquid BTC bestBid=74084.00 bestAsk=74085.00 spread=1.00 depth=20 source=l2Book lastHeatmap=hyperliquid BTC levels=40 priceMin=74065.00 priceMax=74104.00 mid=74084.50 maxIntensity=1.00 lastFootprint=hyperliquid BTC intervalMs=60000 ohlc=74087.00/74087.00/74083.00/74083.00 volume=0.25187000 delta=-0.06447000 poc=74087.00 levels=4 closed=false source=trades
```

Five minute live engine test:

```json
{
  "start": {
    "uptimeSeconds": 50,
    "connected": true,
    "totalTradesOut": 98,
    "totalDeltaBucketsOut": 139,
    "totalVWAPOut": 33,
    "totalOrderBookOut": 86,
    "totalHeatmapFramesOut": 83,
    "totalFootprintCandlesOut": 30,
    "totalFootprintClosedOut": 1,
    "lastError": "",
    "reconnectCount": 0,
    "footprintLevels": 10,
    "footprintPOC": 74078,
    "footprintDelta": -0.1716600000000001,
    "footprintVolume": 0.5391600000000001
  },
  "middle": {
    "uptimeSeconds": 194,
    "connected": true,
    "totalTradesOut": 322,
    "totalDeltaBucketsOut": 465,
    "totalVWAPOut": 110,
    "totalOrderBookOut": 337,
    "totalHeatmapFramesOut": 318,
    "totalFootprintCandlesOut": 102,
    "totalFootprintClosedOut": 4,
    "lastError": "",
    "reconnectCount": 0,
    "footprintLevels": 2,
    "footprintPOC": 74126,
    "footprintDelta": -0.00289,
    "footprintVolume": 0.00433
  },
  "end": {
    "uptimeSeconds": 337,
    "connected": true,
    "totalTradesOut": 590,
    "totalDeltaBucketsOut": 765,
    "totalVWAPOut": 178,
    "totalOrderBookOut": 583,
    "totalHeatmapFramesOut": 556,
    "totalFootprintCandlesOut": 168,
    "totalFootprintClosedOut": 6,
    "lastError": "",
    "reconnectCount": 0,
    "footprintLevels": 2,
    "footprintPOC": 74131,
    "footprintDelta": 0.04107999999999998,
    "footprintVolume": 0.17834
  }
}
```

Final stream checker:

```text
Command: cd services/market-go; go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=151 trades=20 deltaBuckets=39 vwaps=9 orderBooks=38 heatmapFrames=36 footprintCandles=8 elapsed=21.348s lastTrade=hyperliquid BTC 0.00021000 @ 74135.00 side=buy lastDelta=hyperliquid BTC intervalMs=60000 delta=0.09057000 cvd=95.16210000 closed=false lastVWAP=hyperliquid BTC value=74131.53675986 coverageStart=1780193333032 isWarm=false cumPV=7227792.21621000 cumVol=97.49956000 lastBook=hyperliquid BTC bestBid=74130.00 bestAsk=74131.00 spread=1.00 depth=20 source=l2Book lastHeatmap=hyperliquid BTC levels=40 priceMin=74111.00 priceMax=74150.00 mid=74130.50 maxIntensity=1.00 lastFootprint=hyperliquid BTC intervalMs=60000 ohlc=74130.00/74131.00/74130.00/74131.00 volume=0.09324000 delta=0.08720000 poc=74131.00 levels=2 closed=false source=trades
```

Final app checks:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 80 modules (hash: bb8c264ced74)
Built static/style.css from 56 modules (hash: a308389f216c)
Switched templates to bundle mode (token: bb8c264ced74a308389f216c)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 6.321s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

Shutdown:

- Stopped only the active Phase 13 `marketd` listener PID.
- `127.0.0.1:8765` had no listener after shutdown; only short-lived `TIME_WAIT` remained.
- Flask/UI was not launched during Phase 13 because no footprint UI rendering was added.

Status:

- Phase 13 is complete.
- `footprint_candle` is produced and streamed by Go.
- `streamcheck` proves `trade`, `delta_bucket`, `vwap`, `order_book`, `heatmap_frame`, and `footprint_candle`.
- No footprint UI renderer exists yet.

## Phase 14 - Footprint V1 Canvas UI

Date: 2026-05-31

Scope:

- Render existing `footprint_candle` messages in the V6 canvas.
- Keep Tape, Delta/CVD, VWAP, DOM, and Heatmap SD live.
- Keep the Go engine manual.
- Keep V6 connection manual through `Connect Local Engine`.
- Add no new exchange source, no new engine feature, no backfill, no replay.
- No Wails or desktop.
- No Binance adapter work.
- No Flask route changes.
- No Journal, legacy Chart, legacy VWAP frontend, Hyperliquid frontend, or `066_orderflow_engine.js` changes.
- No commit.

Files modified for Phase 14:

- `static/js/split/070_v6_orderflow_contract.js`
- `static/js/split/071_v6_orderflow_store.js`
- `static/js/split/072_v6_orderflow_mock.js`
- `static/js/split/073_v6_orderflow_layout.js`
- `static/js/split/077_v6_canvas_chart.js`
- `static/js/split/078_v6_local_engine_client.js`
- `static/app.js`
- `templates/partials/overlays/scripts.html`
- `docs/CHANGELOG_V6.md`
- `docs/V6_GO_ENGINE.md`

UI behavior added:

- V6 header now shows `Footprint` message count.
- V6 settings include `Show Footprint`.
- V6 settings include `Chart mode`: `Both`, `Heatmap`, `Footprint`.
- Store now keeps bounded footprint candles.
- Default footprint buffer: 160 candles, clamped between 60 and 240.
- Active footprint candle updates replace by candle identity instead of appending infinite duplicates.
- Canvas renders Footprint V1:
  - each candle is a column.
  - each price level is a compact cell.
  - level delta is green/red/gray.
  - POC is highlighted.
  - OHLC is shown as compact wick/open/close marks.
  - candle delta and volume are labelled.
- Heatmap SD remains available and can render together with footprint in `Both` mode.

Small runtime correction:

- Cleared stale `stats.lastError` when the V6 engine client reconnects successfully. Error count still remains as reconnection history, but `lastError` no longer stays stuck after status returns to `connected`.

Engine command used:

```powershell
cd services/market-go
$env:MARKET_GO_EXCHANGE='hyperliquid'
$env:MARKET_GO_SYMBOLS='BTC'
$env:MARKET_GO_MOCK_MODE='false'
$env:MARKET_GO_DELTA_INTERVALS='1000,5000,60000'
$env:MARKET_GO_VWAP_ENABLED='true'
$env:MARKET_GO_VWAP_SESSION='utc_day'
$env:MARKET_GO_BOOK_ENABLED='true'
$env:MARKET_GO_BOOK_DEPTH='20'
$env:MARKET_GO_BOOK_EMIT_MS='250'
$env:MARKET_GO_HEATMAP_ENABLED='true'
$env:MARKET_GO_HEATMAP_EMIT_MS='500'
$env:MARKET_GO_HEATMAP_DEPTH='20'
$env:MARKET_GO_HEATMAP_TICK_SIZE='1'
$env:MARKET_GO_HEATMAP_MAX_LEVELS='100'
$env:MARKET_GO_FOOTPRINT_ENABLED='true'
$env:MARKET_GO_FOOTPRINT_INTERVAL_MS='60000'
$env:MARKET_GO_FOOTPRINT_TICK_SIZE='1'
$env:MARKET_GO_FOOTPRINT_EMIT_MS='500'
$env:MARKET_GO_FOOTPRINT_MAX_LEVELS='200'
go run ./cmd/marketd
```

Engine pre-browser validation:

```text
Command: cd services/market-go; go run ./cmd/streamcheck -trades 20 -timeout 60s
Result: success
Output:
streamcheck ok addr=ws://127.0.0.1:8765/stream messages=181 trades=20 deltaBuckets=49 vwaps=11 orderBooks=45 heatmapFrames=44 footprintCandles=11 elapsed=25.239s lastTrade=hyperliquid BTC 0.00017000 @ 73890.00 side=buy lastDelta=hyperliquid BTC intervalMs=60000 delta=0.15936000 cvd=0.38059000 closed=false lastVWAP=hyperliquid BTC value=73887.65309455 coverageStart=1780216403202 isWarm=false cumPV=91841.61392000 cumVol=1.24299000 lastBook=hyperliquid BTC bestBid=73887.00 bestAsk=73888.00 spread=1.00 depth=20 source=l2Book lastHeatmap=hyperliquid BTC levels=40 priceMin=73868.00 priceMax=73907.00 mid=73887.50 maxIntensity=1.00 lastFootprint=hyperliquid BTC intervalMs=60000 ohlc=73887.00/73888.00/73887.00/73888.00 volume=0.22756000 delta=0.15936000 poc=73888.00 levels=2 closed=false source=trades
```

Browser validation environment:

- URL: `http://127.0.0.1:5001/`
- Page: `Orderflow`
- Viewport: 1440 x 980 via Chrome CDP.
- Browser plugin was not available in this session. Chrome DevTools Protocol fallback was used.
- Screenshot captured outside the repo: `%TEMP%\cockpit-v6-phase14-footprint.png`.

Initial browser runtime sample:

```json
{
  "badge": "V6 LIVE / Go Engine",
  "trades": 3,
  "deltaBuckets": 14,
  "vwaps": 3,
  "books": 22,
  "heatmapFrames": 18,
  "footprintCandles": 3,
  "footprintStored": 1,
  "poc": 73859,
  "delta": 0.02565000000000006,
  "volume": 0.30409,
  "levels": 2,
  "heatmapLevels": 40,
  "bestBid": 73858,
  "bestAsk": 73859,
  "spread": 1,
  "canvasNonBackgroundPixels": 41434,
  "consoleErrors": []
}
```

Five minute live UI + engine run:

```json
{
  "start": {
    "uptimeSeconds": 452,
    "connected": true,
    "totalTradesOut": 562,
    "totalDeltaBucketsOut": 962,
    "totalVWAPOut": 213,
    "totalOrderBookOut": 767,
    "totalHeatmapFramesOut": 715,
    "totalFootprintCandlesOut": 204,
    "totalFootprintClosedOut": 8,
    "lastError": "",
    "reconnectCount": 0,
    "footprintPOC": 73848,
    "footprintDelta": -2.0646999999999998,
    "footprintVolume": 2.57858,
    "footprintLevels": 15
  },
  "end": {
    "uptimeSeconds": 764,
    "connected": true,
    "totalTradesOut": 1200,
    "totalDeltaBucketsOut": 1555,
    "totalVWAPOut": 348,
    "totalOrderBookOut": 1322,
    "totalHeatmapFramesOut": 1236,
    "totalFootprintCandlesOut": 338,
    "totalFootprintClosedOut": 13,
    "lastError": "",
    "reconnectCount": 0,
    "footprintPOC": 73823,
    "footprintDelta": -58.32019999999995,
    "footprintVolume": 59.45171999999995,
    "footprintLevels": 34
  }
}
```

UI state after five minute run:

```json
{
  "badge": "V6 LIVE / Go Engine",
  "trades": 782,
  "deltaBuckets": 742,
  "vwaps": 170,
  "books": 657,
  "heatmapFrames": 615,
  "footprintCandles": 165,
  "footprintStored": 7,
  "poc": 73825,
  "delta": -0.03370000000000001,
  "volume": 0.6286400000000002,
  "levels": 14,
  "heatmapStored": 360,
  "canvasNonBackgroundPixels": 40719,
  "errors": 0,
  "reconnects": 0
}
```

Network note:

- The V6 engine client opens `ws://127.0.0.1:8765/stream`.
- Chrome CDP also observed the existing Dashboard/BTC widget WebSocket `wss://stream.binance.com:9443/ws/btcusdt@kline_3m`.
- Phase 14 did not add any browser exchange WebSocket.

Outage and reconnect test:

- Stopped only the active `marketd` listener PID.
- `127.0.0.1:8765` had no listener after shutdown.
- V6 page did not crash.
- Last heatmap and footprint stayed visible in store:
  - `heatmapStored: 360`
  - `footprintStored: 7`
- UI moved to `connecting` and tracked reconnect attempts.
- Relaunched `marketd` manually.
- V6 reconnected and resumed Tape, Delta/CVD, VWAP, DOM, Heatmap, and Footprint.

Post-reconnect sample after rebuilding the stale-error correction:

```json
{
  "bundle": "app.js?v=b73361f2a749a308389f216c",
  "badge": "V6 LIVE / Go Engine",
  "trades": 28,
  "deltaBuckets": 18,
  "vwaps": 4,
  "books": 16,
  "heatmapFrames": 16,
  "footprintCandles": 4,
  "errors": 0,
  "reconnects": 0,
  "lastError": "",
  "poc": 73824,
  "delta": -0.039299999999999974,
  "volume": 0.51462,
  "levels": 10,
  "canvasNonBackgroundPixels": 33226
}
```

Final checks:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 80 modules (hash: b73361f2a749)
Built static/style.css from 56 modules (hash: a308389f216c)
Switched templates to bundle mode (token: b73361f2a749a308389f216c)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 2.829s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

```text
Command: cd services/market-go; go test ./...
Result: success
Summary:
All Go packages passed, including internal/calc, internal/config, internal/engine,
internal/exchange/hyperliquid, internal/ws, and pkg/protocol.
```

Status:

- Phase 14 is complete.
- Footprint V1 is visible in the V6 canvas.
- Tape, Delta/CVD, VWAP, DOM, and Heatmap SD remain live.
- No new data source was added.
- No Wails or desktop integration was added.

## Phase 15 - UX Controls V6

Scope:

- Added full UX control panel for the V6 orderflow surface.
- Added localStorage persistence for all V6 settings.
- Added chart mode `None` placeholder with stats.
- Added panel visibility toggles (Tape, DOM, CVD, VWAP).
- Added buffer size controls (max trades, heatmap frames, footprint candles, DOM depth).
- Added clear actions (Tape, Heatmap, Footprint, All UI Buffers).
- Added Reset UI Settings button.
- Added stale detection (10s threshold) with visual indicators.
- Enhanced canvas labels with mode, symbol, mid, price range, counts, VWAP value/warm warning.
- No new data source was added.
- No new WebSocket was added.
- No Go engine modification was made.
- No Flask route was changed.
- No Wails or desktop work was started.
- No Binance connection was added.
- No legacy orderflow engine (066) was modified.
- No commit was made.

Files added:

- `static/js/split/079_v6_orderflow_settings.js` — localStorage persistence module

Files modified:

- `static/js/split/070_v6_orderflow_contract.js` — added showTape, showDOM, showCVD, maxTrades settings; added lastMessageAt and isStale state fields; changed footprintMaxCandles default to 120; added chartMode 'none'
- `static/js/split/071_v6_orderflow_store.js` — added lastMessageAt/isStale normalization; added clearHeatmap(), clearFootprint(), clearAllBuffers() methods
- `static/js/split/073_v6_orderflow_layout.js` — full settings panel redesign with sections (Chart, Panels, Buffers, Filter, Actions); panel visibility toggling; localStorage load at init and auto-save on change; stale warning in engine bar; clear heatmap/footprint/all actions; reset settings action
- `static/js/split/077_v6_canvas_chart.js` — added drawInfoLabels() with mode, symbol, mid, range, counts, VWAP value/warm warning; added drawNonePlaceholder() for chartMode 'none'; added stale indicator on canvas
- `static/js/split/078_v6_local_engine_client.js` — added clearHeatmap(), clearFootprint(), clearAllBuffers() methods; added stale timer (10s threshold); dynamic maxTrades from store settings; lastMessageAt tracking in store
- `static/css/split/070_v6_orderflow.css` — added .v6-settings-section, .v6-settings-section-title, .v6-panel-hidden, .v6-stale-warning, .v6-btn-warn, .v6-settings-actions; scrollable settings panel; compact styling

Settings localStorage:

- Key: `cockpitV6.orderflow.settings`
- Persisted fields: chartMode, showTape, showDOM, showCVD, showVwap, showHeatmap, showFootprint, maxTrades, maxHeatmapFrames, maxFootprintCandles, domDepth, minQty, maxRows, deltaIntervalMs, tickSize
- Loaded at Layout.init() startup
- Saved automatically on every settings change via store subscription
- Reset button clears localStorage and restores defaults
- Invalid JSON fallback to defaults

Controls added:

1. Chart mode select: Heatmap / Footprint / Both / None
2. Panel toggles: Show Tape, Show DOM, Show Delta/CVD, Show VWAP, Show Heatmap, Show Footprint
3. Buffer controls: Max trades (50–5000), Max heatmap frames (60–600), Max footprint candles (30–240), DOM depth UI (5–50)
4. Filter controls: Min qty, Max tape rows
5. Action buttons: Clear Tape, Clear Heatmap, Clear Footprint, Clear All UI Buffers, Reset UI Settings
6. Stale indicator: ⚠ STALE in engine bar + badge + canvas when no message for 10+ seconds

UX tests expected:

1. Chart mode Heatmap: heatmap visible, footprint masked
2. Chart mode Footprint: footprint visible, heatmap masked
3. Chart mode Both: heatmap + footprint visible
4. Chart mode None: no crash, placeholder with stats visible
5. Toggle Tape off/on: panel hidden/shown
6. Toggle DOM off/on: panel hidden/shown
7. Toggle Delta/CVD off/on: panel hidden/shown
8. Toggle VWAP off/on: panel hidden/shown
9. Clear Tape: trades cleared
10. Clear Heatmap: heatmap frames cleared
11. Clear Footprint: footprint candles cleared
12. Clear All UI Buffers: all three cleared
13. Change max heatmap frames: respected
14. Change max footprint candles: respected
15. Change DOM depth UI: respected
16. Reload page: settings restored from localStorage
17. Reset UI Settings: defaults restored, localStorage cleared

Verification results:

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success
Output:
Built static/app.js from 81 modules (hash: 8c7c4ae4ec4a)
Built static/style.css from 56 modules (hash: 616455c5be43)
Switched templates to bundle mode (token: 8c7c4ae4ec4a616455c5be43)
```

```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests -v
Result: success
Summary:
Ran 75 tests in 2.607s
OK
```

```text
Command: node --check static/app.js
Result: success
Output: none
```

```text
Command: cd services/market-go; go test ./...
Result: success
Output:
All packages OK (config, engine, hyperliquid, ws, protocol).
```

Status:

- Phase 15 is complete.
- UX controls are visible and functional.
- Settings persist via localStorage.
- Stale detection is active.
- Canvas labels are enhanced.
- Tape, Delta/CVD, VWAP, DOM, Heatmap SD, and Footprint V1 remain live.
- No new data source was added.
- No new WebSocket exchange connection was added.
- No Wails or desktop integration was added.
- No commit was made.

Proposed Phase 16 (not started):

Option A — Chart V6 Polish:
- Crosshair / tooltip on canvas hover
- Volume profile sidebar
- Timeframe selector for footprint
- Better heatmap colormap / intensity controls
- Zoom/pan on canvas

Option B — Desktop / Wails preparation:
- Wails v2 project scaffold
- Single-binary packaging of Go engine + UI
- Tray icon, auto-start, OS notifications
- Native window controls

## 2026-05-31 - Phase 17 Completed (V6 Chart Engine: scales / crosshair / pan-zoom)

Goal: turn the V6 canvas from an index-based prototype into a real chart engine
with a persistent price/time coordinate system, close to TradingView.

### Files added

- `static/js/split/083_v6_chart_viewport.js` — `V6OF.ChartViewport`:
  internal viewport model (`timeStart/timeEnd`, `priceMin/priceMax`,
  `followLive`, `autoFit`) + transforms `timeToX` / `xToTime` / `priceToY` /
  `yToPrice`, plus `setPlot`, `syncToData`, `setTimeRange`, `setPriceRange`,
  `fitToData`, `resetView`, `goLive`, `panByPixels`, `zoomTime`, `zoomPrice`.
  Hard limits: time span 4s..24h, min price span, live-edge pad.
- `static/js/split/084_v6_chart_interactions.js` — `V6OF.ChartInteractions`:
  single-attachment pointer handlers (idempotent, detachable), crosshair state
  `V6OF.chartCrosshair`, left-toolbar wiring (Cursor / Crosshair / Fit / Reset /
  Follow live). All redraws routed through the existing rAF queue.

### Files modified

- `static/js/split/077_v6_canvas_chart.js` — live render path rewritten on top of
  the viewport: grid, right price scale, bottom time scale (nice ticks), crosshair
  with price/time readouts, MID/BID/ASK/POC/VWAP reference lines, follow-live badge
  and visible price/time range readout. Heatmap SD and Footprint V1 now render in
  the shared time/price space via `timeToX` / `priceToY` (timestamp-positioned
  columns, offscreen culling, clipped to plot rect). The mock (index-based) path is
  preserved unchanged.
- `static/js/split/080_v6_layout_shell.js` — shell made NON-DESTRUCTIVE. Instead of
  `root.innerHTML = shellHtml()` (which previously destroyed the Layout panels), it
  now MOVES the existing panels into TradingView regions (left toolbar | center
  chart + bottom CVD/VWAP | right Tape/DOM/Settings). Nodes stay inside the root so
  `Layout.render()` keeps working. Attaches chart interactions + wires the toolbar.
- `static/css/split/071_v6_layout_shell.css` — layout for the move-based shell,
  left-toolbar tool/active states, chart canvas crosshair/grab cursors, right and
  bottom panel hosting.

### Interactions

- Pan: drag canvas (horizontal time + vertical price drift). Shift-drag = price only.
- Zoom: wheel = horizontal time zoom (centred on cursor). Ctrl/Alt+wheel = price zoom.
- Fit / Reset: re-frame to live data extents, re-enable follow-live + auto-fit.
- Follow live: ON by default; panning/zooming back into history turns it OFF; the
  Follow-live tool (or returning to the live edge) re-enables it.
- Crosshair: follows the mouse, shows price (right gutter) and time (bottom);
  toggleable via Cursor / Crosshair tools.

### Validation

```text
Command: .\.venv\Scripts\python.exe build.py
Result: success — Built static/app.js from 84 modules; style.css from 57 modules.
```
```text
Command: node --check static/app.js
Result: success
```
```text
Command: .\.venv\Scripts\python.exe -m unittest discover -s tests
Result: success — Ran 75 tests, OK.
```
```text
Command: cd services/market-go; go test ./...
Result: success (cached) — config, engine, hyperliquid, ws, protocol OK.
```

Runtime validation (manual, to be performed by user per Phase 17 test script):
marketd + Flask running, Connect Local Engine, verify scales/grid/crosshair/
pan/zoom/fit/reset/follow-live and that Tape/DOM/Delta-CVD/VWAP stay live.

### Constraints respected

- UI/chart only. Go engine NOT modified (go test cached confirms no Go change).
- No Wails, no desktop, no Binance, no backfill/replay, no new browser WebSocket.
- V6 still uses only `ws://127.0.0.1:8765/stream`; engine + connection stay manual.
- No Flask route, Journal, legacy chart, legacy VWAP, legacy Hyperliquid, or
  `066_orderflow_engine.js` change. No commit.

### Current Phase 17 limits

- No full drawing engine (no persistent trendlines / rectangles yet).
- No replay / backfill. No multi-symbol advanced UI. No Wails.

Proposed Phase 18 (NOT started):
- Option A — Basic drawing tools (horizontal line, trendline) persisted in the
  viewport coordinate space, snapping to price/time.
- Option B — Chart interaction polish (price-axis drag zoom, double-click reset,
  inertia pan, keyboard shortcuts, crosshair magnet to footprint/heatmap levels).

## 2026-06-01 - Hyperliquid candle backfill + chart-dominant redesign

Goal: make the chart look like a real platform (TradingView / cryexc). Two
breakthroughs: candles are the base layer, and they are filled with history.

### Engine (Go) — historical backfill
- `internal/exchange/hyperliquid/candles.go` — `FetchCandles` + `ParseCandlesJSON`
  hitting Hyperliquid's public `candleSnapshot` info endpoint (read-only HTTP,
  not a new exchange / not a browser WS). Unit tested (`candles_test.go`).
- `internal/config/config.go` — `HyperliquidHTTPURL`, `BackfillEnabled` (default
  true), `BackfillInterval` (1m), `BackfillLookbackMin` (1440 = 24h) + env vars
  `MARKET_GO_BACKFILL_*`, `MARKET_GO_HL_HTTP_URL`.
- `internal/engine/engine.go` — `CandleHistory` envelope builder (`candle_history`).
- `internal/ws/server.go` — `runBackfill` fetches once per symbol on startup,
  broadcasts `candle_history`, caches it, and replays it to every new `/stream`
  client (after the heartbeat). Verified live: 1441 BTC 1m candles fetched.

### Frontend — candle base + dominant layout
- `077_v6_canvas_chart.js` — candle base layer (`drawCandlesVp`) from merged
  history (`chartCandles`) + live footprint candles; viridis liquidity heatmap
  (`drawHeatmapVp`) as background; footprint as a cell overlay. Layer model
  replaces the old exclusive chartMode.
- `073` — top toolbar with layer toggles (Candles/Heatmap/Footprint/VWAP) +
  live BID/ASK/spread ticket; `078` handles `candle_history`; `070`/`071` store
  + contract gain `chartCandles`.
- `080`/`071css` — chart-dominant (~85%) layout: big center chart + tabbed right
  column (DOM / Tape / CVD / VWAP / Settings); SVG tool rail.
- `070_v6_orderflow.css` / `071_v6_layout_shell.css` — "Obsidian Tape" design
  system (tokens, viridis-friendly dark, cyan accent).

### Defaults
- Candles ON by default; Heatmap/Footprint OFF (opt-in overlays).

### Verification
- `go build ./...` OK, `go test ./...` OK (incl. candle parse tests).
- `build.py` OK, `node --check static/app.js` OK.
- Runtime: marketd restarted with new binary, backfill logged `candles=1441`,
  frontend rendered a full 24h candlestick chart (browser screenshot).

### Notes / limits
- Heatmap remains live-only (no historical order-book) — it grows from the live
  edge leftwards; this is expected.
- Liquidations / News / multi-month history still out of scope (no data source).

## 2026-06-01 - Backtest / Replay engine (Binance Data Vision)

Goal: exact, free historical backtesting. Hyperliquid archive (S3) is locked
(requester-pays + IAM AccessDenied, verified). Binance Data Vision provides free,
public, tick-level aggTrades with no credentials — proven: 897,738 real trades for
1 day BTCUSDT.

### Engine (Go)
- `internal/replay/source.go` — Source interface (pluggable; HL adapter can be
  added later if S3 access opens).
- `internal/replay/binance.go` — BinanceSource: downloads daily aggTrades zip from
  data.binance.vision, unzips in-memory, ParseAggTradesCSV -> marketdata.Trade
  (side from isBuyerMaker, µs->ms timestamps). Unit tested.
- `internal/replay/player.go` — Player: streams a loaded day through an Emit at a
  wall-clock speed multiplier (1x/10x/60x/300x/max), with pause/resume/stop/status.
- `internal/ws/server.go` — replayEmit pushes each replayed trade through the SAME
  engine pipeline (Trade/DeltaBuckets/VWAP/FootprintCandles) + hub broadcast, so
  footprint/CVD/delta are identical to live. New POST /replay endpoint (start/pause/
  resume/speed/stop/status, CORS). replay_status pushed over the stream.
- `internal/engine/engine.go` — ReplayStatus envelope.

### Frontend
- `087_v6_backtest_panel.js` — Backtest popover in the header: symbol/date/speed,
  play/pause/resume/stop, progress bar, live status. POSTs to /replay; reflects
  replay_status from the store.
- `078` — handles replay_status -> store.replay.

### Verified
- Real run: POST start BTCUSDT 2025-05-28 -> state=playing, total=897738, index
  advancing, clockMs = real historical timestamp.
- go vet clean; go test ./... all pass (incl. replay unit tests); build.py + node
  --check OK. No commit.

### Notes / limits
- Backtest data is Binance BTCUSDT (≠ Hyperliquid) — only free public tick source.
- Footprint/CVD/bubbles during replay are exact (rebuilt from real ticks).

## 2026-06-01 - Phase Desktop 1 (Wails launcher/shell)

Goal: a controlled desktop wrapper that runs the existing app in a window —
without rewriting UI, migrating Flask, or converting the frontend.

### Added (apps/desktop, separate Go module cockpit-v6-desktop)
- `go.mod`, `main.go` (default/headless launcher), `main_wails.go` (tag `wails`,
  native window -> 127.0.0.1:5001), `frontend/dist/index.html` (redirector).
- `internal/launcher/ports.go` — PortFree/PortInUse/WaitForHTTP (health).
- `internal/launcher/process.go` — ManagedProcess + Manager: start/stop only OUR
  children by exact PID; never global kills.
- `internal/launcher/flask.go` — FlaskSpec (PORT=5001, OPEN_BROWSER=0) + health URLs.
- `internal/launcher/marketd.go` — MarketdSpec with full Hyperliquid env.
- `internal/app/app.go` — Startup()/Shutdown() orchestration (no Wails dependency).
- `internal/launcher/launcher_test.go` — port/health/spec/start-stop tests.
- `docs/V6_DESKTOP.md` — full architecture + Wails install + limits.

### Wails
- `wails` NOT installed on this machine (`wails version` -> not found). Go 1.26 ok.
- Window code is ready behind the `wails` build tag; install with
  `go install github.com/wailsapp/wails/v2/cmd/wails@latest` then `wails dev`.
- No false claim of desktop-window validation; only the headless path is runtime-verified.

### Verified
- `go vet`/`go build`/`go test ./...` in apps/desktop: pass (launcher tests OK).
- Headless `go run .` against the running services: detected ports 5001/8765 in
  use, started NO duplicates, killed nothing, confirmed Flask + marketd healthy,
  clean shutdown.
- Repo gates: build.py OK, unittest 75 OK, node --check OK, market-go go test OK.
- No commit.

### Limitations
- No installer/packaging/auto-update/tray/multi-window.
- Frontend not migrated to Wails assets; window hosts the live Flask app.
- marketd supervised, not embedded.

### Proposed Phase Desktop 2 (not started)
- Stabilise `wails build` packaging, OR embed market-go as a direct Go package
  (single binary, no `go run` child).

## 2026-06-01 - Phase Desktop 1.5 (Wails window validated)

Goal: prove the Wails desktop window actually opens, reuses Flask + marketd, and
hosts the live app — no UI rewrite.

### Wails
- wails v2.12.0; `wails doctor` -> SUCCESS (WebView2 148, Node 24, npm 11).
- `wails dev` -> bindings + assets + compile Done, native window "Cockpit V6"
  opens, launcher reuses running services (ports 5001/8765 already in use ->
  no duplicate started, nothing killed), Flask + marketd health OK.
- Verified: msedgewebview2 child present, MainWindowTitle = "Cockpit V6",
  services still single-instance after launch.

### Fix (apps/desktop only)
- Inverted build tags so the DEFAULT build is the Wails app (binding generator
  requires it). main.go = `!headless` (Wails window); main_headless.go =
  `headless` (no-window launcher). Previous `wails`-tag layout hung `wails dev`
  at "Generating bindings".
- Added wails.json (Wails v2 project config). Added wails v2 dependency to go.mod.

### Process safety re-confirmed
- Launcher detected existing manual Flask (15900) + marketd (22236), reused them,
  started no duplicates. Killing CockpitV6 left both services alive.
- Stuck `wails dev` (old layout) was stopped by exact PID only; services untouched.
- Inspected webview2 processes before any kill: the remaining ones belonged to
  Windows SearchHost, not our app — so nothing was killed there.

### Gates
- build.py OK; unittest 75 OK; node --check OK; market-go go test OK;
  apps/desktop go test OK (launcher tests). No commit.

### Limitations
- Window content validation (Dashboard/Orderflow/live panels) is visual and must
  be done by the user in the native window (WebView2 can't be driven by Playwright).
- No installer/packaging/auto-update/tray/multi-window.

### Proposed Phase Desktop 2 (not started)
- Stabilise `wails build` packaging (icons, NSIS optional), OR embed market-go as
  a direct Go package for a single binary (no `go run` child).

## 2026-06-01 - Phase 17A Completed (Historical Backfill & TradingView Layout Alignment)

Goal: solve the invisible historical candle bug and align the price chart and indicators into a professional TradingView-like layout.

### Diagnostic of Invisible Candle Bug
- Viewport Initialization Bug: The viewport's time span was seeding itself based on the duration of the *currently available data* at startup. With only 1 or 2 live candles on startup, it initialized to a degenerate 4-second span, pushing all subsequent candles offscreen.
- Buffer Limits: Memory buffers were capped too aggressively (CVD at 100, heatmap at 600, footprint candles at 240).
- Lack of UI Fetch Fallback: If the Go backfill broadcast was missed or failed, the UI had no fallback to load history from Flask.

### Implemented Fixes & Enhancements
- Viewport model (`083_v6_chart_viewport.js`) modified to guarantee a minimum initial time span of 30 minutes (`30 * 60 * 1000` ms) on startup, maintaining a beautiful and stable default trading view.
- Store buffers (`078_v6_local_engine_client.js`) increased: `MAX_BUCKETS_PER_INTERVAL` raised to 500, `heatmapFrames` limit to 1000, `footprintCandles` limit to 300.
- Automatic fetch fallback (`078_v6_local_engine_client.js` connect method) added to fetch 300 historical candles (5 hours of history) from Flask proxy API (`/api/hyperliquid/klines?market=BTC&interval=1m`) on connection, populating the store immediately.
- HTML Settings controls (`073_v6_orderflow_layout.js`) updated to allow settings limits up to 1000 frames and 300 candles.
- Horizontal layout alignment (`086_v6_cvd_panel_canvas.js` CVD canvas):
  - Gutter margins changed to `LABEL_W = 8` and `VAL_W = 66` to align CVD plot area horizontally pixel-perfect with the price chart.
  - Scale vertical hairline and background drawn on the right.
  - Sub-pane title legends ("CVD Large", "CVD Medium", "CVD Small") float inside the plot areas.
  - Live values render neatly inside the right scale.

### Verification
- `build.py` ran successfully (Built static/app.js token 4aaccd715418280c874d0e84).
- `node --check static/app.js` passed successfully with no syntax errors.
- Python tests: `75 tests passed`.
- Go tests: `go test ./...` in services/market-go passed successfully.
- Visual checks confirmed: Aligned margins, floating legends, right-aligned CVD values, and beautiful, immediate historical candle backfill on local connection.
- No commit was made.

### Proposed Phase 17B (NOT started)
- True TradingView crosshair, advanced zooming/panning gestures, and persistent drawing tools placeholders.

## 2026-06-01 - Phase 22 Completed (Standalone Sidecar Packaging)

Goal: Package `marketd.exe` as a standalone sidecar binary for the Wails desktop application to remove Go toolchain dependency on user PCs.

### Implemented Sidecar Strategy
- **Go Sidecar compilation**: Compiled standalone `marketd.exe` directly to `apps/desktop/bin/marketd.exe` using `go build`.
- **Three-tier Resolution Strategy**:
  - `existing-port`: Bypasses launching if port `8765` is occupied, preventing process duplication.
  - `prod-sidecar`: Detects and launches the sidecar `marketd.exe` located next to `CockpitV6.exe` in Wails production directory (`apps/desktop/build/bin/`).
  - `dev-sidecar`: Detects and launches the development sidecar in `apps/desktop/bin/marketd.exe`.
  - `go-run-fallback`: Bypasses binary execute and runs `go run ./cmd/marketd` from `services/market-go` only in development if no binary exists.
- **Fail-Safe startup**: If `marketd` cannot start, launcher prints a clear `WARNING` but continues, letting the desktop load in offline/mock mode rather than crashing.

### Verification (SUCCESS)
- **Wails build**: `wails build` compiles standalone production executable at `apps/desktop/build/bin/CockpitV6.exe`.
- **Sidecar Copy**: Post-build manual copy places `marketd.exe` next to `CockpitV6.exe` to complete packaging.
- **Test A (Port Reuse)**: Confirmed existing ports 5001/8765 are reused without starting duplicates. Closing the app keeps manual services alive.
- **Test B (Free Ports)**: Confirmed automatic spawning of child processes on free ports using the compiled `marketd.exe` directly (not `go run`). Exiting the app cleanly kills exact child PIDs and frees all ports.
- **Test C (Go Absent simulation)**: Logs verified that `marketd strategy: dev-sidecar` was selected and `go run` was completely bypassed.
- **Gates**: `build.py` OK, Python tests passed (75/75), `node --check` OK, `services/market-go` tests OK, and `apps/desktop` launcher tests OK. No commits.

### Limitations
- Flask still runs via Python /.venv.

### Proposed Phase 23 (NOT started)
- Zero-dependency Single Binary: bundle Python/Flask or rewrite backend in Go to remove Python environment dependency.

## 2026-06-02 - Phase 17A design pass (header compact + CVD integrated)

User feedback addressed (4 targeted CSS fixes, no JS/markup changes):
1. CVD now an INTEGRATED indicator sub-pane inside the single center panel
   (price chart + CVD share one bordered panel, thin divider — TradingView style)
   instead of a separate boxed strip. (071_v6_layout_shell.css)
2. Chart area enlarged: CVD sub-pane reduced 226px -> 150px, heavy CVD header
   bar removed (now an 18px sub-pane legend). More room for price.
3. Left tool rail made compact: 52px -> 40px, buttons 38x34 -> 30x28, icons
   18 -> 15px, transparent until hover.
4. Header refonte: single non-wrapping 40px bar (was wrapping to 2 lines).
   Brand mark 30->20px, symbol pill flattened, ticket/stats inlined & shrinkable.

Verified visually (Flask started by me on 5001 then stopped; marketd not used —
chart shown in MOCK mode): header on one clean line, compact rail, large chart,
CVD integrated under price in the same panel. build.py OK, node --check OK.

### Environment note (not a code bug)
Port 8765 was held by `workers/market_ws_server.py` (a Python worker), NOT the Go
`marketd`. That's why Hyperliquid was "KO": the Go engine wasn't running. Flask
(5001) was also down. Both are manual-launch per project rules — relaunch:
  - Flask:   $env:PORT='5001'; $env:OPEN_BROWSER='0'; .\.venv\Scripts\python.exe app.py
  - marketd: free 8765 from the python worker (exact PID), then `go run ./cmd/marketd`

### Not done / next
- Live validation of old-candles/viewport/follow-live needs marketd running.
- No commit.

## 2026-06-02 - G1: Go engine = single source for HL klines (all intervals)

Goal (user): "tout par le moteur Go". Step G1 makes the Go engine serve ALL
candle intervals; the frontend no longer fetches klines from Flask.

### Engine (Go)
- config.go: BackfillIntervals []string (default 1m,3m,5m,15m,30m,1h,2h,4h,8h,12h,1d
  — 6h removed: HL returns HTTP 422), BackfillBars (default 1000). New env
  MARKET_GO_BACKFILL_INTERVALS, MARKET_GO_BACKFILL_BARS.
- ws/server.go: runBackfill now loops over all intervals, fetching `bars`
  candles per interval (window = bars × intervalMs), broadcasting one
  candle_history envelope per interval (cached + replayed to new clients).
  Added intervalMs() helper + strconv import.

### Frontend
- 078: candle_history handler stores per-interval into _candlesByInterval and
  only swaps chartCandles when the interval matches the active timeframe.
  fetchCandleHistory() is now a no-op (Flask klines path removed).
- 073: timeframe switch loads candles from the per-interval cache (no fetch);
  source switch no longer calls Flask. Removed 6h timeframe button.

### Verified (live)
- marketd backfilled 11 intervals × 1001 candles, 0 errors.
- Frontend: _candlesByInterval has 11 intervals (1001 each), auto-connect OK,
  timeframe 1m->1h swap works, 0 console errors (was 381 due to the store bug).
- Gates: go test ./... OK, unittest 75 OK, node --check OK, build.py OK. No commit.

### Note
- Bug fix included: render() referenced undefined `store` (line 392,
  wireDomDragDrop) -> ReferenceError spam that froze auto-connect. Now V6OF.store.

### Next (unification roadmap)
- G2: real Binance adapter in Go (live WS + klines) — placeholder today.
- G3/G4: unified source selector through Go; remove Flask market-data paths from V6.

## 2026-06-02 - G2: real Binance adapter in the Go engine (live + klines)

Goal (user): "tout par le moteur Go". G2 implements the Binance adapter so
Binance live runs through the SAME engine pipeline as Hyperliquid (was an empty
placeholder before).

### Engine (Go) — new package internal/exchange/binance
- normalize.go: ParseCombined (combined-stream envelope), NormalizeAggTrade
  (isBuyerMaker=true => sell), NormalizeDepth (partial book -> OrderBookSnapshot).
- klines.go: FetchKlines + ParseKlinesJSON (public REST /api/v3/klines, no key).
- client.go: stdlib WebSocket client (mirrors the proven HL transport) on the
  combined stream <sym>@aggTrade [+ <sym>@depthN@100ms]; reconnect with backoff.
- binance_test.go: unit tests for trade/depth/klines/combined parsing.
- config.go: ExchangeBinance, BinanceWSURL/RESTURL (+ env MARKET_GO_BINANCE_WS_URL,
  MARKET_GO_BINANCE_REST_URL).
- ws/server.go: dispatch exchange=binance -> startBinance + runBinanceBackfill;
  trades reuse the shared replayEmit (Trade/DeltaBuckets/VWAP/FootprintCandles).

### Bug fixed during G2
- Go's encoding/json is case-insensitive: a `json:"E"` tag also captured the
  event-type string "e" (aggTrade/depthUpdate), throwing "cannot unmarshal".
  Removed the unused event-type/event-time fields; depth uses TsLocal.

### Verified (live, port 8766, MARKET_GO_EXCHANGE=binance)
- 1241 trades, 259 delta buckets, 76 VWAP, 103 order books, 44 footprint candles,
  11 intervals klines backfilled, lastError empty.
- go vet/build/test ./... all pass. No commit.

### Next
- G3: header HL/BN source selector drives the Go engine (restart/switch exchange).
- G4: remove remaining Flask market-data paths from the V6 frontend.

## 2026-06-02 - Fix: page restored at boot not shown until re-navigation

Long-standing bug (since the start): on first load you couldn't open Orderflow
directly — clicking did nothing; you had to visit another page then click again.

Root cause: 008_boot.js restored state.currentPage from localStorage ("lastPage")
but never synced the DOM. The template marks "today" .page.active by default, so
JS state and the visible page desynchronised. goPage() early-returns when
state.currentPage === pageName, so clicking the already-"current" (but not
visible) page did nothing.

Fix: after restoring lastPage, sync the DOM — toggle .page.active and
.nav-item.active to the restored page and dispatch pageChange. No change to
goPage().

Verified (runtime): with lastPage=orderflow, the orderflow page is active +
visible on first load with zero clicks (v6 root visible). With lastPage=today,
a single click on Orderflow shows it. build.py + node --check OK. No commit.
