$ErrorActionPreference = "Stop"
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$target = Join-Path $projectDir "coupang-auto.cmd"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "NOID-B Order Update.lnk"

if (-not (Test-Path -LiteralPath $target)) {
  throw "Launcher not found: $target"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $projectDir
$shortcut.Description = "Update Google Sheets and create Hanjin files from downloaded Coupang files"
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,137"
$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath"
