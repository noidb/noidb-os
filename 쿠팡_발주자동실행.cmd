@echo off
chcp 65001 >nul
cd /d "%~dp0"
npm run coupang:auto
pause
