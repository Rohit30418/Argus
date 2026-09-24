@echo off
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo   ARGUS Pro v3 - QA Investigator
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Check your internet/npm configuration.
    pause
    exit /b 1
  )
)

if not exist .env (
  copy /Y .env.example .env >nul
  echo Created .env from .env.example
)

echo.
echo Starting ARGUS Pro at http://localhost:4100
start "ARGUS" http://localhost:4100
call npm start

endlocal
