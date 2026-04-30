@echo off
setlocal EnableExtensions EnableDelayedExpansion
echo step1
if not defined HOST set HOST=127.0.0.1
if not defined PORT set PORT=5000
echo step2
set "_DESIRED_PORT=%PORT%"
set "_PORT_TRY=%PORT%"
set "_PORT_SCAN_MAX=30"
set "_PORT_SCAN_COUNT=0"
echo step3
:find_free_port
set "_PORT_BUSY="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%_PORT_TRY% .*LISTENING"') do (
    set "_PORT_BUSY=1"
    goto :port_taken
)
echo step4
goto :port_ok
:port_taken
echo step5
set /a _PORT_SCAN_COUNT+=1
if !_PORT_SCAN_COUNT! geq !_PORT_SCAN_MAX! (
    echo too many
    exit /b 1
)
set /a _PORT_TRY+=1
goto :find_free_port
:port_ok
echo step6
if not "%_PORT_TRY%"=="%_DESIRED_PORT%" (
    echo switched
)
echo step7
if /I "%HOST%"=="0.0.0.0" (
    set "APP_URL=http://127.0.0.1:%PORT%/"
) else (
    set "APP_URL=http://%HOST%:%PORT%/"
)
echo step8
