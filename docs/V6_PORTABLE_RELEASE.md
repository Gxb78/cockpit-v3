# Cockpit V6 — Portable Release & ZIP Packaging (Phase 24)

This document details the architecture, safety guarantees, automated packaging process, and lifecycle verification of the standalone **Cockpit V6 Portable Release Folder & ZIP** package.

---

## 1. Portable Bundle Structure

The compiled standalone release folder `dist/CockpitV6_Portable/` is structured as a self-contained, lightweight trading terminal package:

```text
dist/
  CockpitV6_Portable/
    CockpitV6.exe          # Wails frontend desktop shell (Go)
    marketd.exe            # Go Market Engine (Hyperliquid adapter sidecar)
    journal-server.exe     # Flask/SQLite backend server (PyInstaller sidecar)
    README_START_HERE.txt  # Human-readable user manual & quickstart guide
    config.example.json    # Instrument and strategy catalog template
    .env.example           # API keys and environment configuration template
    data/
      .gitkeep             # Local SQLite database destination ('journal.db')
    screenshots/
      .gitkeep             # User screenshot storage
    backups/
      .gitkeep             # Automatic database backups
    logs/
      .gitkeep             # Live stdout/stderr log capture
```

---

## 2. Safety & Isolation Guarantees

* **Zero Leaks**: The packaging engine (`build_portable.ps1`) enforces a strict security scan. If any actual `journal.db`, `.env` file (containing private API keys), `*.db-wal`, `*.db-shm` runtime locks, or private user files are found in the staging area, the build immediately aborts. Only `.example` configuration templates and empty folders are bundled.
* **100% Portability**: The system does **not** write to or depend on Windows registry, `%APPDATA%`, or Python/Go system paths. All state, screenshots, and logs are contained entirely within the directory of the running executables.
* **Zero Runtime Dependencies**: The end-user does not need Python, virtualenv, Go, Node.js, or GCC installed on their machine to run the application.

---

## 3. Automated Packaging Engine (`build_portable.ps1`)

The release is compiled and packed by the automated Powershell script `apps/desktop/scripts/build_portable.ps1`.
It executes sequentially:
1. **Quality Gates**:
   - Re-compiles vanilla JS/CSS bundles via `build.py`.
   - Runs full Python test suites (75/75 tests passed).
   - Validates Node.js AST on the javascript files.
   - Runs `go test ./...` in the Go market adapter (`services/market-go`).
   - Runs `go test ./...` in the desktop launcher (`apps/desktop`).
2. **Production Compilation**: Runs `wails build` inside the desktop project folder.
3. **Staging Creation**: Copies the three compiled executables (`CockpitV6.exe`, `marketd.exe`, `journal-server.exe`) side-by-side.
4. **Configuration Generation**: Sets up `.env.example`, `config.example.json`, empty folder structures, and `README_START_HERE.txt`.
5. **Security Gate**: Performs recursive pattern scans for keys/DBs.
6. **Archive Compression**: Creates a ready-to-ship `dist/CockpitV6_Portable.zip` archive.

---

## 4. Full Lifecycle Testing Results

We executed extensive lifecycle test scenarios inside a freshly extracted isolated workspace (`C:\Users\gb781\Desktop\CockpitV6_Portable_Test`) on Windows:

### Test A — Port Reuse / Services Pre-existing (SUCCESS)
* Started Flask manually on port `5001` and `marketd.exe` on `8765`.
* Started `CockpitV6.exe` in portable mode.
* **Result**: Launcher successfully detected the busy ports, bypassed spawning new subprocesses, reused the running instances, and cleanly hooked the WebView. Closing the desktop left the pre-existing services running completely untouched.

### Test B — Free Ports & Spawning (SUCCESS)
* Verified ports `5001` and `8765` are free.
* Started `CockpitV6.exe` inside the extracted portable workspace.
* **Result**:
  - `journal-server.exe` (PID `28428`) and `marketd.exe` (PID `10368`) spawned automatically.
  - SQLite database `data/journal.db` was automatically initialized locally inside the portable directory.
  - Live Hyperliquid feeds immediately connected and streamed trade ticks, DOM, and CVD events to the UI.
  - Flask backend logged API requests with `200 OK` responses.

### Process Tree Clean Teardown Validation (SUCCESS)
* To prevent orphaned PyInstaller subprocesses on Windows (since the single-file bootloader spawns Python as a child process and standard `exec.Command.Process.Kill()` only kills the parent bootloader), we patched `process.go`'s `Stop()` implementation:
  - Added native `taskkill /F /T /PID <pid>` tree termination.
* **Result**: Closing the `CockpitV6.exe` window cleanly and forcefully terminated the entire process tree of both child adapters.
  - Confirmed: `Get-Process -Name CockpitV6, journal-server, marketd` returned empty (all dead).
  - Confirmed: Ports `5001` and `8765` were instantly and completely released.

### Test C — Go/Python Absent Simulation (SUCCESS)
* Bypassed Go toolchain compiler (`go run`) and local virtualenv Python (`.venv`) entirely. Both sidecars were started directly from their compiled standalone binaries, confirming that the bundle runs perfectly on any bare-metal Windows machine.

---

## 5. Portable Limitations & Installed Mode Resolution

The portable bundle is distributed as a standalone `.zip` folder. While highly flexible, it has some limitations compared to the installed version:
* **Storage Location**: In Portable mode, user data (SQLite database, backups, screenshots) lives directly inside the portable directory. In Installed mode (introduced in Phase 25), user data is isolated inside `%APPDATA%\CockpitV6\`, ensuring it is not affected by Windows access permission policies in `Program Files` or overwritten during binary updates.
* **Shortcut Creation**: Portable mode requires manually launching `CockpitV6.exe` inside the folder. The NSIS Installer (introduced in Phase 25) automatically creates Start Menu and desktop shortcuts.
* **Uninstallation**: Deleting the portable folder deletes all data (unless backed up). The NSIS Installer provides a clean uninstaller that removes binary directories while explicitly preserving user data in `%APPDATA%\CockpitV6\`.
