@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 24, then run this file again.
 pause
 exit /b 1
)
set PUBLIC_ORIGIN=http://localhost:8080
set HOST=127.0.0.1
set PORT=8080
start "" http://localhost:8080
node server/server.mjs
pause
