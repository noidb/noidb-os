param(
  [string]$DailyTime = "08:30",
  [string]$TaskName = "NOID-B 쿠팡 발주 자동수집"
)

$projectDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $npmPath -Argument "run coupang:auto" -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -Daily -At $DailyTime
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Supplier Hub 발주리스트 다운로드 및 NOID-B 상품DB 자동 반영" -Force
Write-Host "예약 작업 설치 완료: $TaskName / 매일 $DailyTime"
