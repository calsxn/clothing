@echo off
title FiveM Clothing Tracker - Public
cd /d "%~dp0"
echo Starting the website server...
start "FiveM Clothing Tracker - Server" "%~dp0node\node.exe" server.js
timeout /t 3 >nul
echo.
echo ============================================================
echo  Starting the public link...
echo.
echo  Look below for an address ending in  .trycloudflare.com
echo  THAT is the link you give your friends.
echo.
echo  Keep BOTH black windows open while people use the site.
echo  NOTE: the link CHANGES every time you restart this.
echo ============================================================
echo.
cloudflared.exe tunnel --url http://localhost:3000
pause
