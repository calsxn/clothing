@echo off
title sxn opti
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

rem If a folder was dragged onto this .bat, scan it straight away (dry run,
rem then it asks before changing anything). Otherwise start the guided prompts.
if "%~1"=="" (
  "%NODE%" "%~dp0optimize.js"
) else (
  "%NODE%" "%~dp0optimize.js" "%~1"
  echo.
  echo That was a preview. To actually rewrite them, re-run and add --apply, e.g.:
  echo   "%NODE%" optimize.js "%~1" --apply
)

echo.
pause
