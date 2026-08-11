$ErrorActionPreference = "Stop"
$projectDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectDir

if ((git status --porcelain).Length -gt 0) {
  throw "저장하지 않은 변경사항이 있습니다. 먼저 PC_작업저장.cmd를 실행해주세요."
}

git pull --ff-only origin main
if (-not (Test-Path -LiteralPath (Join-Path $projectDir "node_modules"))) {
  npm ci
}
Write-Host "최신 프로젝트 동기화 완료: $projectDir"
