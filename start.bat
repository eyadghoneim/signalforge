@echo off
chcp 65001 >nul
title SignalForge - Quant Signal Platform
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org then run again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run - installing packages ^(2-5 minutes^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] Install failed. Check your internet connection and run again.
    pause
    exit /b 1
  )
)

echo.
echo ============================================================
echo   SignalForge is starting... Browser will open automatically
echo   URL: http://localhost:3000
echo   Keep this window OPEN while using the platform
echo   Close it with Ctrl+C or by closing this window
echo ============================================================
echo.
start "" "http://localhost:3000"
npx tsx server/index.ts
pause
