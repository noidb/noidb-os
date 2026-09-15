@echo off
chcp 65001 >nul
setlocal
:menu
cls
echo NOID-B 외장하드 작업 이어가기
echo.
echo 1. 주간 업무 운영 사이트 열기
echo 2. 새 PC 개발 환경 준비 (Node.js 필요, 처음 한 번)
echo 3. 로컬 개발 서버 실행
echo 4. 서플라이허브 확장 프로그램 설치 폴더 준비
echo 5. 연결 상태 점검
echo 6. 작업 이어가기 안내문 열기
echo 0. 종료
echo.
choice /c 1234560 /n /m "번호를 선택하세요: "
if errorlevel 7 exit /b 0
if errorlevel 6 goto guide
if errorlevel 5 goto check
if errorlevel 4 goto extension
if errorlevel 3 goto dev
if errorlevel 2 goto setup
if errorlevel 1 goto open
goto menu
:open
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\portable-workspace.ps1" -Action Open
goto done
:setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\portable-workspace.ps1" -Action Setup
goto done
:dev
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\portable-workspace.ps1" -Action Dev
goto done
:extension
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\portable-workspace.ps1" -Action Extension
goto done
:check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\portable-workspace.ps1" -Action Check
goto done
:guide
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\portable-workspace.ps1" -Action Guide
:done
pause
goto menu
