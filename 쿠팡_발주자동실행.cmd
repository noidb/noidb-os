@echo off
chcp 65001 >nul
title 노이드비 발주서 한 번 처리
cd /d "%~dp0"
echo 새 발주서를 확인하고 구글시트와 한진택배 파일을 갱신합니다.
echo.
call npm.cmd run coupang:collect
echo.
if errorlevel 1 (
  echo 처리 중 오류가 발생했습니다. 이 화면을 Codex에게 보여주세요.
) else (
  echo 처리가 끝났습니다. 이 창을 닫아도 됩니다.
)
pause
