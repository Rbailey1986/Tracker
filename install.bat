@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ====================================================
echo             Tracker - 1-Click Installer
echo ====================================================
echo.

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js 20 or later from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Check npm
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not found in PATH!
    echo.
    pause
    exit /b 1
)

echo [1/3] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install encountered an error.
    echo.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Building and configuring Tracker...
node scripts/setup.mjs
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Setup script failed.
    echo.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Ready!
echo.
set /p LAUNCH="Do you want to launch Tracker now? (Y/n): "
if /i "%LAUNCH%"=="n" (
    echo.
    echo You can start Tracker anytime from your Desktop shortcut or Start Menu.
) else (
    echo Launching Tracker...
    start "" wscript "desktop\start-tray.vbs" /open
)

echo.
pause
