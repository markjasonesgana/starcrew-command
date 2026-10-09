@echo off
setlocal EnableExtensions
title Starcrew Command setup
cd /d "%~dp0"
echo.
echo   ==============================================
echo     STARCREW COMMAND  -  one-time setup
echo   ==============================================
echo.

rem ---- 1. Node.js -------------------------------------------------------------
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo   [1/4] Node.js is not installed. Installing the LTS version with winget...
  where winget >nul 2>nul
  if errorlevel 1 goto nonode
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
  where node >nul 2>nul
  if errorlevel 1 goto nonode
) else (
  echo   [1/4] Node.js found.
)
node -e "process.exit(+process.versions.node.split('.')[0]>=18?0:1)"
if errorlevel 1 (
  echo   Your Node.js is older than version 18. Please install the LTS version from https://nodejs.org
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

rem ---- 2. Which AI -------------------------------------------------------------
echo.
echo   [2/4] How should your crew think?
echo     1 = My Claude plan (Pro or Max) via Claude Code   [recommended]
echo     2 = My ChatGPT plan (Plus or Pro) via Codex
echo     3 = Decide later in the app (API key, free local Ollama, or the demo crew)
choice /c 123 /n /m "   Press 1, 2 or 3: "
if errorlevel 3 goto browser
if errorlevel 2 goto codex

:claude
where claude >nul 2>nul
if errorlevel 1 (
  echo   Installing Claude Code, Anthropic's official app...
  call npm install -g @anthropic-ai/claude-code
)
echo.
echo   Sign in with YOUR Claude account in the window or browser page that opens.
echo   Starcrew never sees your password.
call claude auth status >nul 2>nul
if errorlevel 1 call claude auth login
goto browser

:codex
where codex >nul 2>nul
if errorlevel 1 (
  echo   Installing Codex, OpenAI's official command-line app...
  call npm install -g @openai/codex
)
echo.
echo   Sign in with YOUR ChatGPT account in the browser page that opens.
echo   Starcrew never sees your password.
call codex login status >nul 2>nul
if errorlevel 1 call codex login
goto browser

rem ---- 3. Crew browser (optional) ------------------------------------------------
:browser
echo.
echo   [3/4] Install the crew browser? It lets the crew click and type on websites
echo         in its own separate profile (about 150 MB). You can do this later
echo         with INSTALL-BROWSER.bat.
choice /c YN /n /m "   Install it now? (Y/N): "
if errorlevel 2 goto shortcut
call npm install --no-audit --no-fund
call npx playwright install chromium

rem ---- 4. Desktop shortcut -----------------------------------------------------
:shortcut
echo.
echo   [4/4] Adding a "Starcrew Command" shortcut to your desktop...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Starcrew Command.lnk'); $s.TargetPath='%~dp0START.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%SystemRoot%\System32\imageres.dll,76'; $s.Save()" >nul 2>nul
echo.
echo   All set! Starting Starcrew now. Next time, use the desktop shortcut.
echo.
call "%~dp0START.bat"
exit /b 0

:nonode
echo.
echo   Could not install Node.js automatically. Please install the LTS version from
echo   https://nodejs.org (the page opens now), then run SETUP.bat again.
start "" https://nodejs.org/en/download
pause
exit /b 1
