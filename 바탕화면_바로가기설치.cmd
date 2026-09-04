@echo off
title NOID-B Desktop Shortcut Setup
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-desktop-shortcut.ps1"
echo.
pause
