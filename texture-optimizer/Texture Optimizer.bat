@echo off
rem FiveM Texture Optimizer - desktop app launcher.
rem Opens in its own window (using the Edge/Chrome engine built into Windows) -
rem no browser tabs, no address bar. Double-click this file to run it.

rem Relaunch ourselves minimized so there's no big black console - the app has
rem its own window. The tiny console just keeps the program alive in the taskbar.
if not defined TO_APP_MIN (
  set TO_APP_MIN=1
  start "" /min cmd /c "%~f0"
  exit /b
)

title FiveM Texture Optimizer
cd /d "%~dp0"

rem --- Find Node.js (bundled with the tracker, next to us, or on the system) ---
set "NODE="
if exist "%~dp0..\node\node.exe" set "NODE=%~dp0..\node\node.exe"
if not defined NODE if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if not defined NODE ( where node >nul 2>nul && set "NODE=node" )
if not defined NODE (
  start "" cmd /c "echo Could not find Node.js. Install it from https://nodejs.org and try again. & echo. & pause"
  exit /b 1
)

rem Runs in the foreground: when you close the app window, this exits too.
"%NODE%" "%~dp0server.js" --app
exit /b
