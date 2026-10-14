@echo off
setlocal
chcp 65001 >nul
title Xueshu - Local Launcher
pushd "%~dp0"
if errorlevel 1 (
  echo [ERROR] Cannot open the project directory.
  pause
  exit /b 1
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 24 is required. Install it as described in README.md, then try again.
  popd
  pause
  exit /b 1
)
node.exe "%~dp0scripts\start-local.mjs" %*
set "launcher_exit=%errorlevel%"
popd
if not "%launcher_exit%"=="0" (
  echo.
  echo Startup failed. Read the error above. Press any key to close this window.
  pause
)
exit /b %launcher_exit%
