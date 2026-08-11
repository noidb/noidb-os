@echo off
title NOID-B Order Update
cd /d "%~dp0"
echo Checking downloaded Coupang files...
echo.
call npm.cmd run coupang:collect
echo.
if errorlevel 1 goto failed
echo UPDATE COMPLETED SUCCESSFULLY.
echo Google Sheets and Hanjin output have been updated.
pause
exit /b 0

:failed
echo UPDATE FAILED. Please send this screen to Codex.
pause
exit /b 1
