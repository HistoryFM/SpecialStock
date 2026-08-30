@echo off
setlocal
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found. Open this folder in Codex and ask it to repair the Windows setup.
  pause
  exit /b 1
)

if not exist ".next\BUILD_ID" (
  echo The production build is missing. Run Setup-Windows.ps1 or ask Codex to rebuild the app.
  pause
  exit /b 1
)

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:3000'"
echo SpecialStock is starting at http://127.0.0.1:3000
echo Keep this window open. Press Ctrl+C to stop the app.
call pnpm start --hostname 127.0.0.1

endlocal
