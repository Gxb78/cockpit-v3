@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title COCKPIT Trading Journal
cls
echo ============================================
echo   COCKPIT v3 - Trading Journal
echo ============================================
echo.
if not defined HOST set HOST=127.0.0.1
if not defined PORT set PORT=5000

:: ---- Port resolution (avoid conflicts with old servers) ----
set "_DESIRED_PORT=%PORT%"
set "_PORT_TRY=%PORT%"
set "_PORT_SCAN_MAX=30"
set "_PORT_SCAN_COUNT=0"

:find_free_port
set "_PORT_BUSY="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%_PORT_TRY% .*LISTENING"') do (
    set "_PORT_BUSY=1"
    goto :port_taken
)
goto :port_ok

:port_taken
set /a _PORT_SCAN_COUNT+=1
if !_PORT_SCAN_COUNT! geq !_PORT_SCAN_MAX! (
    echo [!] No free port found starting from %_DESIRED_PORT% ^(tries: !_PORT_SCAN_MAX!^).
    pause
    exit /b 1
)
set /a _PORT_TRY+=1
goto :find_free_port

:port_ok
if not "%_PORT_TRY%"=="%_DESIRED_PORT%" (
    echo [i] Port %_DESIRED_PORT% is busy. Auto-switching to %_PORT_TRY%.
)
set "PORT=%_PORT_TRY%"
if /I "%HOST%"=="0.0.0.0" (
    set "APP_URL=http://127.0.0.1:%PORT%/"
) else (
    set "APP_URL=http://%HOST%:%PORT%/"
)
set "OPEN_BROWSER=1"
set "COCKPIT_RUN_ID=run-%RANDOM%-%RANDOM%"

:: ---- Python resolver ----
set "PY_BOOT="
where python >nul 2>&1 && set "PY_BOOT=python"
if not defined PY_BOOT (
    where py >nul 2>&1 && set "PY_BOOT=py -3"
)

:: ---- Venv ----
if not exist ".venv\Scripts\python.exe" (
    if not defined PY_BOOT (
        echo [ERR] Python launcher not found ^(python or py^).
        pause
        exit /b 1
    )
    echo Creating virtual environment...
    %PY_BOOT% -m venv .venv
    if errorlevel 1 (
        echo [ERR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)

set "PY_CMD=.venv\Scripts\python.exe"
if not exist "%PY_CMD%" (
    echo [ERR] Missing venv interpreter: %PY_CMD%
    pause
    exit /b 1
)

:: ---- Deps (only if requirements.txt changed) ----
if exist data\.reqhash (
    set /p _SAVED_HASH=<data\.reqhash
)
for /f "delims=" %%H in ('certutil -hashfile requirements.txt MD5 ^| findstr /v "hash" ^| findstr /v "CertUtil"') do set _CUR_HASH=%%H
set "_CUR_HASH=%_CUR_HASH: =%"
if not "%_CUR_HASH%"=="%_SAVED_HASH%" (
    "%PY_CMD%" -m pip install -q -r requirements.txt
    if errorlevel 1 (
        echo [ERR] Dependency install failed.
        pause
        exit /b 1
    )
    echo %_CUR_HASH%>data\.reqhash
)

:: ---- Dev mode ----
if /I "%~1"=="dev" (
    echo Dev mode: split files
    call "%PY_CMD%" build.py --restore
    if errorlevel 1 (
        echo [ERR] Restore failed
        pause
        exit /b 1
    )
    goto :start
)

:: ---- Build ----
echo.
echo Building bundle...
call "%PY_CMD%" build.py
if errorlevel 1 (
    echo [ERR] Build failed
    pause
    exit /b 1
)
echo OK.

:start
echo.
echo Starting server:
echo   URL       : %APP_URL%
echo   Run ID    : %COCKPIT_RUN_ID%
echo   Debug API : %APP_URL%api/debug/runtime
echo.
echo Open your browser at this URL.
echo Press Ctrl+C in this window to stop.
echo.
"%PY_CMD%" app.py
pause
