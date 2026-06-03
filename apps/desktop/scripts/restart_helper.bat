@echo off
:: restart_helper.bat — lancé par Flask avant le rebuild+restart
:: Tue l'app desktop, attend que Flask soit MORT puis REVIVE, relance l'app
cd /d %~dp0..\..

:: Tue l'app desktop (CockpitV6.exe)
taskkill /F /IM CockpitV6.exe >nul 2>&1

:: Attend que Flask MEURE (le rebuild+restart va le tuer)
:wait_death
timeout /t 2 /nobreak >nul
curl -s http://127.0.0.1:5001/api/config >nul 2>&1
if not errorlevel 1 goto wait_death

:: Flask est mort — attend maintenant qu'il REVIENNE
:wait_alive
timeout /t 2 /nobreak >nul
curl -s http://127.0.0.1:5001/api/config >nul 2>&1
if errorlevel 1 goto wait_alive

:: Flask est de nouveau dispo — relance l'app desktop (dev)
start "" "C:\Users\gb781\Desktop\Cockpit V6.lnk"
