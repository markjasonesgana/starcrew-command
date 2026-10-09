@echo off
title Install the Starcrew crew browser
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo   npm was not found. Install Node.js from https://nodejs.org first.
  pause
  exit /b 1
)
echo.
echo   Installing the crew browser. It lets the crew open, read, click and type on
echo   websites in its own separate browser profile (never your personal browser).
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto fail
echo.
echo   Downloading Chromium for the crew (about 150 MB)...
call npx playwright install chromium
if errorlevel 1 (
  echo.
  echo   The Chromium download did not finish. That's OK: Starcrew will use
  echo   Microsoft Edge instead, with its own separate crew profile.
)
echo.
echo   Done. Start Starcrew again with START.bat.
pause
exit /b 0
:fail
echo.
echo   Something went wrong. Check your internet connection and try again.
pause
exit /b 1
