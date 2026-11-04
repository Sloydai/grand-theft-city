@echo off
rem Grand Theft Oslo: starts a small web server on this computer and opens the game in the
rem browser. Keep this window open while you play; close it to stop.
cd /d "%~dp0game"
set PORT=8777
echo Grand Theft Oslo: http://localhost:%PORT%
echo Keep this window open while you play. Close it to stop.
where node >nul 2>nul
if %errorlevel%==0 (
  start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"
  node tools\serve.mjs %PORT%
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0game\tools\serve.ps1" %PORT%
)
pause
