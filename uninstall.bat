@echo off
setlocal
cd /d "%~dp0"

echo ====================================================
echo             Tracker - Uninstaller
echo ====================================================
echo.

node scripts/uninstall.mjs
echo.
pause
