# PVOS V6.1.1 Local Windows Stopper
$ErrorActionPreference = "Stop"
$BaseDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DataDir = Join-Path $BaseDir "data"
$PidPath = Join-Path $DataDir "pvos-local.pid"

Write-Host "==============================================" -ForegroundColor Green
Write-Host " Portrait Visual OS V6.1.1 · 停止本地服务" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green

if (-not (Test-Path $PidPath)) {
  Write-Host "没有找到本地服务 PID 文件。PVOS 可能已经停止。" -ForegroundColor Yellow
  exit 0
}

$pidValue = (Get-Content -Raw $PidPath).Trim()
if (-not ($pidValue -match '^\d+$')) {
  Remove-Item $PidPath -Force -ErrorAction SilentlyContinue
  Write-Host "PID 文件无效，已清理。" -ForegroundColor Yellow
  exit 0
}

$targetPid = [int]$pidValue
$process = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $targetPid -Force
  Write-Host "PVOS 服务已停止。" -ForegroundColor Green
} else {
  Write-Host "对应进程已经不存在，已清理记录。" -ForegroundColor Yellow
}
Remove-Item $PidPath -Force -ErrorAction SilentlyContinue
