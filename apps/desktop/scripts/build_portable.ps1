# build_portable.ps1
$ErrorActionPreference = "Stop"

# Get Repo Root (parent of apps/desktop/scripts -> apps/desktop -> apps -> repo root)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path "$ScriptDir\..\..\..").Path
Set-Location $RepoRoot

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Cockpit V6 Portable Build System Started" -ForegroundColor Cyan
Write-Host "Repo Root: $RepoRoot" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. Clean & Recreate dist directories
$DistDir = Join-Path $RepoRoot "dist"
$PortableDir = Join-Path $DistDir "CockpitV6_Portable"
$ZipPath = Join-Path $DistDir "CockpitV6_Portable.zip"

if (Test-Path $PortableDir) {
    Write-Host "Cleaning existing portable directory: $PortableDir" -ForegroundColor Yellow
    Remove-Item -Recurse -Force $PortableDir
}
if (Test-Path $ZipPath) {
    Write-Host "Cleaning existing ZIP archive: $ZipPath" -ForegroundColor Yellow
    Remove-Item -Force $ZipPath
}

# Ensure dist exists
New-Item -ItemType Directory -Force -Path $PortableDir | Out-Null

# 2. Quality & Test Gates
Write-Host "--- Running Build Gate: build.py ---" -ForegroundColor Cyan
& ".\.venv\Scripts\python.exe" build.py
if ($LASTEXITCODE -ne 0) { throw "build.py failed with exit code $LASTEXITCODE" }

Write-Host "--- Running Quality Gate: Python Unittests ---" -ForegroundColor Cyan
& ".\.venv\Scripts\python.exe" -m unittest discover -s tests -v
if ($LASTEXITCODE -ne 0) { throw "Python tests failed with exit code $LASTEXITCODE" }

Write-Host "--- Running Quality Gate: Node AST Check ---" -ForegroundColor Cyan
& node --check static/app.js
if ($LASTEXITCODE -ne 0) { throw "Node AST check failed with exit code $LASTEXITCODE" }

Write-Host "--- Running Quality Gate: Go market-go tests ---" -ForegroundColor Cyan
Set-Location (Join-Path $RepoRoot "services\market-go")
& go test ./...
if ($LASTEXITCODE -ne 0) { throw "Go market-go tests failed with exit code $LASTEXITCODE" }
Set-Location $RepoRoot

Write-Host "--- Running Quality Gate: Go desktop tests ---" -ForegroundColor Cyan
Set-Location (Join-Path $RepoRoot "apps\desktop")
& go test ./...
if ($LASTEXITCODE -ne 0) { throw "Go desktop tests failed with exit code $LASTEXITCODE" }
Set-Location $RepoRoot

Write-Host "--- Compiling Flask Standalone Binary with PyInstaller ---" -ForegroundColor Cyan
& ".\.venv\Scripts\python.exe" -m PyInstaller --clean --noconfirm (Join-Path $RepoRoot "apps\desktop\pyinstaller\journal-server.spec")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller compilation failed with exit code $LASTEXITCODE" }

# Sync compiled PyInstaller binary to desktop bin paths
$PyiDistBin = Join-Path $RepoRoot "dist\journal-server.exe"
$DevBinDir = Join-Path $RepoRoot "apps\desktop\bin"
$WailsBinDir = Join-Path $RepoRoot "apps\desktop\build\bin"

if (-not (Test-Path $DevBinDir)) { New-Item -ItemType Directory -Force -Path $DevBinDir | Out-Null }
if (-not (Test-Path $WailsBinDir)) { New-Item -ItemType Directory -Force -Path $WailsBinDir | Out-Null }

Copy-Item $PyiDistBin $DevBinDir -Force
Copy-Item $PyiDistBin $WailsBinDir -Force

Write-Host "--- Compiling Production Binary with Wails ---" -ForegroundColor Cyan
Set-Location (Join-Path $RepoRoot "apps\desktop")
& wails build
if ($LASTEXITCODE -ne 0) { throw "Wails build failed with exit code $LASTEXITCODE" }
Set-Location $RepoRoot

# 3. Executable Validation
$WailsBinDir = Join-Path $RepoRoot "apps\desktop\build\bin"
$WailsExe = Join-Path $WailsBinDir "CockpitV6.exe"
$MarketdExe = Join-Path $WailsBinDir "marketd.exe"
$JournalServerExe = Join-Path $WailsBinDir "journal-server.exe"

if (-not (Test-Path $WailsExe)) { throw "Missing CockpitV6.exe in Wails build bin path!" }
if (-not (Test-Path $MarketdExe)) { throw "Missing marketd.exe in Wails build bin path!" }
if (-not (Test-Path $JournalServerExe)) { throw "Missing journal-server.exe in Wails build bin path!" }

Write-Host "Success: All 3 executables compiled and verified." -ForegroundColor Green

# 4. Copy Executables
Write-Host "Copying executables to portable directory..." -ForegroundColor Cyan
Copy-Item $WailsExe $PortableDir
Copy-Item $MarketdExe $PortableDir
Copy-Item $JournalServerExe $PortableDir

# Create the portable mode marker file (Garde-fous Phase 25)
New-Item -ItemType File -Force -Path (Join-Path $PortableDir "portable.mode") -Value "" | Out-Null

# 5. Create Empty Folders
$Folders = @("data", "screenshots", "backups", "logs")
foreach ($folder in $Folders) {
    $folderPath = Join-Path $PortableDir $folder
    New-Item -ItemType Directory -Force -Path $folderPath | Out-Null
    $gitkeepPath = Join-Path $folderPath ".gitkeep"
    New-Item -ItemType File -Force -Path $gitkeepPath -Value "" | Out-Null
}

# 6. Copy Configurations
Write-Host "Copying configuration templates..." -ForegroundColor Cyan
Copy-Item (Join-Path $RepoRoot "config.json") (Join-Path $PortableDir "config.example.json")
Copy-Item (Join-Path $RepoRoot ".env.example") (Join-Path $PortableDir ".env.example")

# 7. Write README_START_HERE.txt
$ReadmeContent = @"
========================================================================
             COCKPIT V6 — PORTABLE DESKTOP BUNDLE
========================================================================

Welcome to Cockpit V6! This portable directory contains everything you 
need to run the application on any Windows machine. No Python or Go 
runtimes are required.

------------------------------------------------------------------------
HOW TO RUN:
------------------------------------------------------------------------
Double-click 'CockpitV6.exe' in this directory.

This will automatically launch the three integrated engines:
1. CockpitV6.exe (the native Wails desktop application window)
2. journal-server.exe (the Flask/Jinja/SQLite backend, listening on port 5001)
3. marketd.exe (the Go Market Engine Hyperliquid feed client, listening on port 8765)

------------------------------------------------------------------------
PORTABLE MODE vs INSTALLED MODE:
------------------------------------------------------------------------
This bundle has been pre-configured to run in PORTABLE mode because the 
file 'portable.mode' is present next to the executable. 

In PORTABLE mode:
- All user data, screenshots, backups, and logs are kept inside this 
  folder, completely isolated.
- The standard system registry or %APPDATA% directories are NOT touched.
- Moving or copying this folder transfers all your data.

In INSTALLED mode (standard Windows installer):
- Program executables are placed in 'Program Files\Cockpit V6'.
- User data, configurations, and logs live in '%APPDATA%\CockpitV6\'.
- Moving or deleting the program directory does NOT delete your trading 
  history or configurations.

------------------------------------------------------------------------
USER DATA STORAGE (PORTABLE):
------------------------------------------------------------------------
Your data is fully preserved and stored locally within this folder:
- 'data/'        : Holds your SQLite trading database ('journal.db')
- 'screenshots/' : Holds any user-taken screenshots
- 'backups/'     : Holds your database backups
- 'logs/'        : Holds process and system execution logs

WARNING: Do NOT delete the 'data/' folder unless you want to permanently 
lose your trading journal, trades, and settings!

------------------------------------------------------------------------
HOW TO RESET:
------------------------------------------------------------------------
If you want to clear your data and start with a completely fresh journal:
1. Close Cockpit V6.
2. Back up or rename 'data/journal.db'.
3. Delete 'data/journal.db'.
4. Launch CockpitV6.exe again. The app will automatically initialize a fresh DB.

------------------------------------------------------------------------
LIMITATIONS & COMING SOON:
------------------------------------------------------------------------
- This is a portable release folder.
- Auto-updating is not yet integrated.
- Code-signing is not yet completed.
========================================================================
"@

[System.IO.File]::WriteAllText((Join-Path $PortableDir "README_START_HERE.txt"), $ReadmeContent, [System.Text.Encoding]::UTF8)

# 8. Security Safety Gate Scan
Write-Host "--- Running Security & Safety Gate Scan ---" -ForegroundColor Yellow

$SensitiveFiles = Get-ChildItem -Recurse $PortableDir | Where-Object {
    $_.Name -match "journal\.db|\.env$|wal$|shm$|api|secret|key"
}

if ($SensitiveFiles) {
    Write-Host "CRITICAL WARNING: Sensitive user data detected inside build directory!" -ForegroundColor Red
    foreach ($file in $SensitiveFiles) {
        Write-Host "  Sensitive: $($file.FullName)" -ForegroundColor Red
    }
    throw "Packaging aborted to prevent leaking sensitive information."
}

Write-Host "Security Scan PASSED: Zero sensitive user files or private keys detected in portable folder." -ForegroundColor Green

# 9. ZIP Packaging
Write-Host "Compressing portable release folder into ZIP..." -ForegroundColor Cyan
Compress-Archive -Path $PortableDir -DestinationPath $ZipPath -Force

Write-Host "=============================================" -ForegroundColor Green
Write-Host "Portable build and packaging complete!" -ForegroundColor Green
Write-Host "Dossier : dist/CockpitV6_Portable/" -ForegroundColor Green
Write-Host "Archive : dist/CockpitV6_Portable.zip" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
