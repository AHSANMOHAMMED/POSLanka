@echo off
title POSLanka print agent
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
  start https://nodejs.org
  pause
  exit /b 1
)
echo Leave this window open while printing labels and receipts.
echo To start it with Windows: press Win+R, type shell:startup and put a shortcut to this file there.
node index.mjs
pause
