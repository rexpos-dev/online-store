@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist .env (
  echo Missing .env file. Copy .env.example to .env and set DATABASE_URL.
  pause
  exit /b 1
)
if not exist node_modules\mysql2 (
  echo Installing dependencies...
  call npm install
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:5050/"
node server.js
pause
