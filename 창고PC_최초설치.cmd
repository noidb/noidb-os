@echo off
setlocal
title NOID-B Warehouse PC Setup
set "PROJECT_DIR=%USERPROFILE%\Documents\NOID-B-Automation"
echo [1/4] Checking Git and Node.js...
where git.exe >nul 2>nul || goto missing_git
where npm.cmd >nul 2>nul || goto missing_node

echo [2/4] Downloading the shared NOID-B project...
if exist "%PROJECT_DIR%\.git" (
  git -C "%PROJECT_DIR%" pull --ff-only origin main || goto failed
) else (
  git clone https://github.com/noidb/noidb-os.git "%PROJECT_DIR%" || goto failed
)

echo [3/4] Installing project dependencies...
cd /d "%PROJECT_DIR%"
call npm.cmd ci || goto failed

echo [4/4] Creating the desktop shortcut...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%\scripts\install-desktop-shortcut.ps1" || goto failed

echo.
echo NOID-B warehouse PC setup completed successfully.
echo Use the NOID-B Coupang shortcut on the desktop from now on.
pause
exit /b 0

:missing_git
echo ERROR: Git is not installed. Open Codex and ask it to install the NOID-B project.
pause
exit /b 1

:missing_node
echo ERROR: Node.js is not installed. Open Codex and ask it to install the NOID-B project.
pause
exit /b 1

:failed
echo ERROR: Setup failed. Please show this window to Codex.
pause
exit /b 1
