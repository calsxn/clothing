@echo off
title FiveM Texture Optimizer - UI
cd /d "%~dp0"

rem --- Find a Node.js to run with ---
rem 1) portable node bundled with the clothing tracker (one folder up)
rem 2) portable node dropped next to this tool
rem 3) Node.js installed on the system (PATH)
set "NODE="
if exist "%~dp0..\node\node.exe" set "NODE=%~dp0..\node\node.exe"
if not defined NODE if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if not defined NODE (
  where node >nul 2>nul && set "NODE=node"
)
if not defined NODE (
  echo Could not find Node.js.
  echo Install it from https://nodejs.org  ^(or copy the "node" folder here^)
  echo and run this again.
  pause
  exit /b 1
)

echo Starting the Texture Optimizer...
echo A browser tab will open at  http://localhost:3001
echo Keep THIS black window open while you use it. Close it to stop.
echo.
"%NODE%" "%~dp0server.js"
pause
