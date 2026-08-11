@echo off
title NOID-B Coupang Auto Collector
cd /d "%~dp0"
call npm.cmd run coupang:auto
echo.
if errorlevel 1 echo ERROR: Please show this window to Codex.
pause
