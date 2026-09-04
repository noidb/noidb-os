param([string]$TaskName = "NOID-B 쿠팡 발주 자동반영")

$projectDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $npmPath -Argument "run coupang:watch" -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "다운로드 폴더의 쿠팡 발주리스트를 NOID-B 상품DB에 자동 반영" -Force
Write-Host "예약 작업 설치 완료: $TaskName / Windows 로그인 시 자동 시작"
