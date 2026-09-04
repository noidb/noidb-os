$ErrorActionPreference = "Stop"
$projectDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectDir

npm run build
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "저장할 변경사항이 없습니다."
  exit 0
}

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "PC 작업 저장 $stamp"
git pull --rebase origin main
git push origin main
Write-Host "GitHub 저장 및 Vercel 배포 요청 완료"
