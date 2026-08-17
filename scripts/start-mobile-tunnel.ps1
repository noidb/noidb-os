<#
  NOID-B OS 휴대폰 테스트용 Cloudflare Quick Tunnel 실행 스크립트

  하는 일:
    - localhost:3000이 이미 떠있는지 확인한다 (없으면 안내만 하고 종료).
    - cloudflared가 설치되어 있는지 확인한다 (PATH + 일반적인 설치 경로).
    - 설치되어 있으면 임시 Quick Tunnel을 실행하고, 발급된 https://...trycloudflare.com
      주소를 화면에 크게 보여준다.
    - 설치되어 있지 않으면 설치 방법만 안내한다 (자동 설치하지 않음).

  하지 않는 일:
    - 실행 중인 프로세스를 강제로 종료하지 않는다.
    - cloudflared를 대신 설치하지 않는다 (안내만 한다).
    - 계정 로그인이 필요한 named tunnel은 쓰지 않는다 (계정 없이 되는 Quick Tunnel만 사용).
#>

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== NOID-B OS 휴대폰 테스트용 터널 ===" -ForegroundColor Cyan
Write-Host ""

$serverRunning = $false
try {
    $connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($connections) { $serverRunning = $true }
} catch {
    # Get-NetTCPConnection을 못 쓰는 환경이면 TCP 연결 시도로 대신 확인한다
    try {
        $test = Test-NetConnection -ComputerName "localhost" -Port 3000 -WarningAction SilentlyContinue
        if ($test.TcpTestSucceeded) { $serverRunning = $true }
    } catch {}
}

if (-not $serverRunning) {
    Write-Host "[안내] localhost:3000에서 개발 서버가 감지되지 않았습니다." -ForegroundColor Yellow
    Write-Host "먼저 scripts\start-noidb-os.ps1 을 실행해 개발 서버를 켜주세요."
    exit 1
}

Write-Host "[확인됨] localhost:3000 개발 서버가 실행 중입니다." -ForegroundColor Green
Write-Host ""

$cloudflaredPath = $null
$cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cmd) {
    $cloudflaredPath = $cmd.Source
} else {
    $candidates = @(
        "C:\Program Files (x86)\cloudflared\cloudflared.exe",
        "C:\Program Files\cloudflared\cloudflared.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { $cloudflaredPath = $candidate; break }
    }
}

if (-not $cloudflaredPath) {
    Write-Host "[안내] cloudflared가 설치되어 있지 않습니다." -ForegroundColor Yellow
    Write-Host "이 스크립트는 자동으로 설치하지 않습니다. 아래 명령으로 직접 설치해주세요:"
    Write-Host ""
    Write-Host "  winget install --id Cloudflare.cloudflared -e" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "설치가 끝난 뒤 이 스크립트를 다시 실행해주세요."
    exit 1
}

Write-Host "[확인됨] cloudflared 발견: $cloudflaredPath" -ForegroundColor Green
Write-Host "임시 터널을 시작합니다 (계정 로그인 없는 Quick Tunnel)..." -ForegroundColor Cyan
Write-Host ""

$logFile = Join-Path $env:TEMP ("noidb-tunnel-" + (Get-Random) + ".log")
$process = Start-Process -FilePath $cloudflaredPath -ArgumentList "tunnel", "--url", "http://localhost:3000" `
    -RedirectStandardError $logFile -RedirectStandardOutput $logFile -PassThru -WindowStyle Hidden

Write-Host "터널 프로세스를 시작했습니다 (PID: $($process.Id)). 주소가 발급될 때까지 기다립니다..."

$url = $null
$attempts = 0
while (-not $url -and $attempts -lt 30) {
    Start-Sleep -Seconds 1
    $attempts++
    if (Test-Path $logFile) {
        $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
        if ($content -match "https://[a-zA-Z0-9\-]+\.trycloudflare\.com") {
            $url = $Matches[0]
        }
    }
}

Write-Host ""
if ($url) {
    Write-Host "=================================================" -ForegroundColor Green
    Write-Host "  휴대폰 접속 주소:" -ForegroundColor Green
    Write-Host "  $url" -ForegroundColor Green
    Write-Host "=================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "이 창을 닫지 않아야 터널이 계속 유지됩니다."
    Write-Host "종료하려면 이 창에서 Ctrl+C를 누르세요 (기존 개발 서버는 종료되지 않습니다)."
} else {
    Write-Host "[안내] 30초 안에 주소를 확인하지 못했습니다. 로그 파일을 확인해주세요:" -ForegroundColor Yellow
    Write-Host "  $logFile"
    Write-Host "터널 프로세스(PID $($process.Id))는 계속 실행 중입니다 — 임의로 종료하지 않았습니다."
}
