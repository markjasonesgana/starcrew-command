@echo off
title Starcrew Command
cd /d "%~dp0"
set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Starcrew needs Node.js 18 or newer. Run SETUP.bat first, or install the
  echo   LTS version from https://nodejs.org and double-click START.bat again.
  echo.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)
node server.js
echo.
echo   Starcrew has stopped. Close this window, or press a key to restart it.
pause >nul
"%~f0"
