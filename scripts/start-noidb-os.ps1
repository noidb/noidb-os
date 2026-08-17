<#
  NOID-B OS 개발 서버 실행 스크립트

  하는 일:
    - 이 스크립트가 있는 위치를 기준으로 프로젝트 폴더를 찾는다 (컴퓨터마다 사용자 이름/
      경로가 달라도 동작하도록 상대경로만 사용한다).
    - node_modules가 없으면 설치가 필요하다고 안내만 하고 종료한다 (자동으로 설치하지 않음).
    - 3000번 포트가 이미 사용 중이면(다른 개발 서버가 떠있으면) 새로 켜지 않고 안내만 한다.
    - npm run dev로 개발 서버를 실행하고, 접속 주소를 화면에 크게 보여준다.

  하지 않는 일:
    - 실행 중인 프로세스를 강제로 종료하지 않는다.
    - .next 폴더를 임의로 지우지 않는다.
    - npm install을 대신 실행하지 않는다 (안내만 한다).
#>

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

Write-Host ""
Write-Host "=== NOID-B OS 개발 서버 시작 ===" -ForegroundColor Cyan
Write-Host "프로젝트 폴더: $projectRoot"
Write-Host ""

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
    Write-Host "[오류] $projectRoot 에서 package.json을 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "이 스크립트는 프로젝트의 scripts 폴더 안에 있어야 합니다."
    exit 1
}

$nodeModulesPath = Join-Path $projectRoot "node_modules"
if (-not (Test-Path $nodeModulesPath)) {
    Write-Host "[안내] node_modules 폴더가 없습니다. 먼저 아래 명령을 실행해주세요:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  cd `"$projectRoot`""
    Write-Host "  npm install"
    Write-Host ""
    Write-Host "설치가 끝난 뒤 이 스크립트를 다시 실행해주세요."
    exit 1
}

$portInUse = $false
try {
    $connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($connections) { $portInUse = $true }
} catch {
    # Get-NetTCPConnection을 쓸 수 없는 환경이면 그냥 건너뛴다 (오류로 멈추지 않음)
}

if ($portInUse) {
    Write-Host "[안내] 3000번 포트가 이미 사용 중입니다 — 개발 서버가 이미 실행 중일 수 있습니다." -ForegroundColor Yellow
    Write-Host "기존 프로세스를 강제로 종료하지 않습니다. 아래 주소가 이미 열려있는지 먼저 확인해보세요."
    Write-Host ""
    Write-Host "  http://localhost:3000" -ForegroundColor Green
    Write-Host ""
    Write-Host "정말 새로 켜야 한다면, 기존 서버를 직접 확인 후 종료(Ctrl+C 등)하고 다시 실행해주세요."
    exit 0
}

Write-Host "개발 서버를 시작합니다 (npm run dev)..." -ForegroundColor Cyan
Write-Host ""
Write-Host "접속 주소:" -ForegroundColor Cyan
Write-Host "  http://localhost:3000" -ForegroundColor Green
Write-Host ""
Write-Host "종료하려면 이 창에서 Ctrl+C를 누르세요."
Write-Host ""

Set-Location $projectRoot
npm run dev
