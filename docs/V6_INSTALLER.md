# Cockpit V6 — Windows AppData Integration & NSIS Installer (Phase 25)

This document describes the design, architecture, safety rules, and lifecycle validation of the native Windows Installer and `%APPDATA%` integration implemented in Phase 25.

---

## 1. Directory Resolution & Storage Modes

To support both a standard Windows installation (where program directories under `C:\Program Files` are read-only) and a standalone portable deployment, the path constants module ([00_paths_constants.py](file:///c:/Users/gb781/Desktop/Journal/app_parts/00_paths_constants.py)) dynamically resolves the user's data directory at launch.

### Portable Mode
* **Activation**: Triggered by the presence of a `portable.mode` marker file in the parent folder of the running `journal-server.exe` executable.
* **Paths**:
  - `USER_DATA_DIR` / `BASE_DIR` = Executable's parent directory (`EXE_DIR`).
  - SQLite Database = `EXE_DIR\data\journal.db`.
  - Screenshots = `EXE_DIR\data\screenshots\`.
  - Backups = `EXE_DIR\data\backups\`.
  - Logs = `EXE_DIR\logs\`.
* **Behavior**: Zero system modification. Moving the portable directory moves all user data.

### Installed Mode (Standard Windows Setup)
* **Activation**: Active when `portable.mode` is absent and the application is running in frozen mode (as compiled by PyInstaller).
* **Paths**:
  - `USER_DATA_DIR` / `BASE_DIR` = `%APPDATA%\CockpitV6\` (typically `C:\Users\<username>\AppData\Roaming\CockpitV6\`).
  - SQLite Database = `%APPDATA%\CockpitV6\data\journal.db`.
  - Screenshots = `%APPDATA%\CockpitV6\data\screenshots\`.
  - Backups = `%APPDATA%\CockpitV6\data\backups\`.
  - Logs = `%APPDATA%\CockpitV6\logs\`.
* **Behavior**: Full compatibility with standard Windows security policies. Writes are restricted to the user's personal profile, preventing UAC write errors.

---

## 2. Safe Automatic Migration (Portable -> AppData)

When running in **Installed Mode**, the application safeguards existing user history by performing a one-time copy-only migration if it detects portable data:

* **Trigger**: The application starts in Installed Mode, a database file exists locally in the program folder (`EXE_DIR\data\journal.db`), and NO database exists in the AppData directory (`%APPDATA%\CockpitV6\data\journal.db` is empty/absent).
* **Safety Protocol**:
  - **Copy-Only**: The migration uses `shutil.copy2` to copy files. It never deletes or moves files, keeping the portable directory fully intact as a backup.
  - **Zero Overwrite**: If `%APPDATA%\CockpitV6\data\journal.db` already exists, the migration is completely bypassed to prevent overwriting newer database contents, logging a warning instead.
  - **Assets Migrated**:
    - SQLite database (`journal.db`).
    - Personal environmental configuration (`.env`).
    - Dynamic application configurations (`config.json`).
    - User screenshots and backups.

---

## 3. Configuration & Fallback Logic

At startup, the Python backend loads environmental variables from `USER_DATA_DIR / ".env"`.
If the configuration catalog `config.json` does not exist in the designated `USER_DATA_DIR`, the application resolves it via a cascade fallback:
1. Try local program directory `EXE_DIR / "config.json"`.
2. Try development repository resource directory `RESOURCE_DIR / "config.json"`.
3. If found, copy it to the user's data directory to allow custom configurations.

---

## 4. NSIS Installer Packaging

The desktop installer is generated using Wails' native NSIS command integration:

```powershell
# Run from apps/desktop
wails build -nsis
```

### Sidecar Declarations
Because Wails' default file packager macro only embeds the primary executable (`CockpitV6.exe`), the NSIS installation script [project.nsi](file:///c:/Users/gb781/Desktop/Journal/apps/desktop/build/windows/installer/project.nsi) was customized to explicitly package the compiled sidecar executables:

```nsis
# Embed compiled sidecars in the installer bundle
File "..\\..\\bin\\journal-server.exe"
File "..\\..\\bin\\marketd.exe"
File "..\\..\\config.json"
```

### Uninstaller Data Safety
To protect user data from accidental deletions during updates or uninstalls:
* The uninstaller only deletes executable binaries and shortcut items located within the installation directory (e.g. `C:\Program Files\Cockpit V6`).
* The uninstaller **does not touch** `%APPDATA%\CockpitV6` or the registry data, ensuring the trading history is fully preserved.

---

## 5. Lifecycle Validation Results

Extensive test suites were executed on a Windows client:

### Test A — Installation & AppData Spawning
* Installed `Cockpit V6-amd64-installer.exe` silently to `C:\Users\gb781\Desktop\CockpitV6_Installed_Test`.
* Launched `Cockpit V6.exe` (Wails window).
* **Result**:
  - App booted cleanly, sidecars successfully started and passed health checks.
  - SQLite database, backups, logs, and screenshots folders were initialized inside `%APPDATA%\CockpitV6\`.
  - The installation folder remained completely free of write operations.

### Test B — Safe Automatic Migration
* Deleted `%APPDATA%\CockpitV6`.
* Placed a portable `journal.db` containing `"DUMMY_DATABASE_CONTENT"` and a `.env` file in the installation directory.
* Launched the server.
* **Result**:
  - Log confirmed: `migration: copied portable data to AppData`.
  - Both `.env` and `journal.db` were copied successfully to the AppData folder.

### Test C — Uninstall Validation
* Created a dummy database in `%APPDATA%\CockpitV6\data\journal.db`.
* Executed the silent uninstaller.
* **Result**:
  - The installation folder `C:\Users\gb781\Desktop\CockpitV6_Installed_Test` was deleted.
  - `%APPDATA%\CockpitV6\data\journal.db` remained completely intact.

### Test D — Portable Mode Isolation
* Launched `journal-server.exe` from `dist\CockpitV6_Portable\`.
* **Result**:
  - SQLite database was created and written directly to the local directory `dist\CockpitV6_Portable\data\journal.db`.
  - `%APPDATA%\CockpitV6` folder was not created, confirming 100% isolation.
