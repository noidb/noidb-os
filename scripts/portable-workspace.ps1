param(
  [ValidateSet('Check','Open','Setup','Dev','Extension','Guide')][string]$Action = 'Check'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
$site = 'https://noidb-os.vercel.app/wms/inbound'
$guide = Join-Path $projectRoot '새PC-작업이어가기.md'
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'app/wms/inbound/WeeklyWork.tsx'))) { throw '프로젝트 폴더를 찾지 못했습니다. 외장하드의 노이드비AI 폴더 전체를 연결하세요.' }
function Assert-Node {
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw '개발 준비에는 Node.js가 필요합니다. Node.js 24 LTS를 설치하고 이 메뉴를 다시 여세요. 운영 사이트는 설치 없이 1번으로 열 수 있습니다.' }
  $nodeMajor = [int]((& node.exe --version) -replace '^v(\d+).*','$1')
  if ($nodeMajor -lt 20) { throw 'Node.js 20 이상이 필요합니다. 현재 검증 환경은 Node.js 24입니다.' }
}
switch ($Action) {
  'Open' { Start-Process $site }
  'Guide' { Start-Process notepad.exe -ArgumentList ('"' + $guide + '"') }
  'Check' {
    Write-Host ('프로젝트: ' + $projectRoot)
    Write-Host ('운영 주간 업무: ' + $site)
    foreach ($tool in @('node.exe','npm.cmd','git.exe')) {
      $found = Get-Command $tool -ErrorAction SilentlyContinue
      if ($found) { Write-Host ($tool + ': 설치됨') } else { Write-Host ($tool + ': 없음 (운영 사이트 이용에는 불필요)') }
    }
    Write-Host ('로컬 환경설정 파일: ' + (Test-Path -LiteralPath (Join-Path $projectRoot '.env.local')))
    Write-Host ('개발 패키지: ' + (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/next/package.json')))
    Write-Host '로컬 개발과 운영 사이트는 저장소가 다를 수 있습니다. 실제 업무는 운영 주소에서 진행하세요.'
    Write-Host '코드 폴더와 설정은 외장하드에 있습니다. Codex 및 브라우저 로그인은 새 PC에서 직접 진행하세요.'
  }
  'Setup' {
    Assert-Node
    Write-Host '새 PC의 개발 패키지를 준비합니다. 기존 코드와 환경설정은 유지합니다.'
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw '패키지 준비에 실패했습니다. 위 오류를 새 PC의 Codex에 보여 주세요.' }
    Write-Host '개발 준비 완료. Codex에 이 프로젝트 폴더를 추가하고 새PC-작업이어가기.md를 읽도록 요청하세요.'
  }
  'Dev' {
    Assert-Node
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/next/package.json'))) { throw '먼저 2번 개발 환경 준비를 실행하세요.' }
    Write-Host '개발용 서버: http://localhost:3000 (운영 사이트와 다릅니다). 종료하려면 Ctrl+C.'
    & npm.cmd run dev
    if ($LASTEXITCODE -ne 0) { throw '개발 서버가 종료되었습니다. 위 오류 내용을 확인하세요.' }
  }
  'Extension' {
    $source = Join-Path $projectRoot 'browser-extension/noidb-supplier-sync'
    if (-not (Test-Path -LiteralPath (Join-Path $source 'manifest.json'))) { throw '확장 프로그램 원본을 찾지 못했습니다.' }
    $destination = Join-Path $env:LOCALAPPDATA 'NOIDB/SupplierSync'
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Get-ChildItem -LiteralPath $source -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $destination $_.Name) -Force }
    Write-Host ('확장 폴더: ' + $destination)
    Write-Host 'Chrome의 chrome://extensions 또는 Edge의 edge://extensions에서 개발자 모드를 켜고 압축해제된 확장 프로그램 로드로 이 폴더를 선택하세요.'
    Start-Process explorer.exe -ArgumentList ('"' + $destination + '"')
  }
}
