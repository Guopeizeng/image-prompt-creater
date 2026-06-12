# PVOS V6.1.1 Local Windows Launcher · Visual Core 5.16.1
# Double-click ../01_START_PVOS_WINDOWS_双击启动.bat instead of running this file directly.
$ErrorActionPreference = "Stop"

$BaseDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DataDir = Join-Path $BaseDir "data"
$UploadsDir = Join-Path $BaseDir "uploads"
$PrivateAssetsDir = Join-Path $BaseDir "private_assets"
$LogsDir = Join-Path $BaseDir "logs"
$VenvDir = Join-Path $BaseDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$PidPath = Join-Path $DataDir "pvos-local.pid"
$SecretsPath = Join-Path $DataDir "pvos-local-secrets.json"
$LoginInfoPath = Join-Path $DataDir "本地后台登录信息.txt"
$StdoutLog = Join-Path $LogsDir "pvos-local.stdout.log"
$StderrLog = Join-Path $LogsDir "pvos-local.stderr.log"
$RuntimeBuild = "V6.1.1"
$VisualCoreVersion = "5.16.1"
$UiBuild = "v6101-20260612"
$WorkbenchUrl = "http://127.0.0.1:4173/?ui=$UiBuild"
$AdminUrl = "http://127.0.0.1:4173/admin"
$HealthUrl = "http://127.0.0.1:4173/api/health"

function Write-Step([string]$Text) {
  Write-Host "[PVOS] $Text" -ForegroundColor Cyan
}

function Get-PvosHealthAny {
  try {
    return Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
  } catch {
    return $null
  }
}

function Test-IsCurrentPvosHealth($Response) {
  if (-not $Response) { return $false }
  return (
    $Response.status -eq "healthy" -and
    $Response.visual_core_version -eq $VisualCoreVersion -and
    $Response.runtime_build -eq $RuntimeBuild -and
    $Response.ui_build -eq $UiBuild
  )
}

function Get-ListeningPidOnPort4173 {
  try {
    $conn = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn -and $conn.OwningProcess) { return [int]$conn.OwningProcess }
  } catch {
    $line = netstat -ano -p tcp | Select-String -Pattern '^\s*TCP\s+127\.0\.0\.1:4173\s+.*\s+LISTENING\s+(\d+)\s*$' | Select-Object -First 1
    if ($line -and $line.Matches.Count -gt 0) { return [int]$line.Matches[0].Groups[1].Value }
  }
  return $null
}

function Stop-DetectedOldPvos([int]$TargetPid) {
  if (-not $TargetPid) { throw "无法定位旧版 PVOS 进程。请先关闭旧版终端窗口，或在任务管理器中结束占用 4173 端口的 Python 进程。" }
  Write-Step "停止占用 4173 端口的旧版 PVOS 进程 PID=$TargetPid"
  Stop-Process -Id $TargetPid -Force -ErrorAction Stop
  Start-Sleep -Seconds 2
  if (Get-ListeningPidOnPort4173) { throw "4173 端口仍被占用。请在任务管理器中结束旧版 Python 进程后重试。" }
}

function Find-SystemPython {
  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) { return @{ File = $py.Source; Args = @("-3") } }
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($python) { return @{ File = $python.Source; Args = @() } }
  throw "没有检测到 Python 3。请先安装 Python 3.11 或更新版本，并在安装时勾选 Add Python to PATH。"
}

Write-Host "==============================================" -ForegroundColor Green
Write-Host " PVOS V6.1.1 · Poster Structure Runtime" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
New-Item -ItemType Directory -Force -Path $DataDir, $UploadsDir, $PrivateAssetsDir, $LogsDir | Out-Null

$existingHealth = Get-PvosHealthAny
if ($existingHealth) {
  if (Test-IsCurrentPvosHealth $existingHealth) {
    Write-Step "检测到当前版本 PVOS 已经运行，直接打开工作台。"
    Start-Process $WorkbenchUrl
    Write-Host "工作台：$WorkbenchUrl"
    Write-Host "后台：  $AdminUrl"
    if (Test-Path $LoginInfoPath) { Write-Host "后台密码：请查看 $LoginInfoPath" -ForegroundColor Yellow }
    Read-Host "按 Enter 关闭本窗口（服务会继续运行）"
    exit 0
  }

  $detectedBuild = if ($existingHealth.runtime_build) { $existingHealth.runtime_build } else { "legacy / unknown" }
  $detectedUi = if ($existingHealth.ui_build) { $existingHealth.ui_build } else { "legacy / unknown" }
  Write-Host "" 
  Write-Host "[检测到旧版 PVOS 占用 4173 端口]" -ForegroundColor Yellow
  Write-Host "旧服务 Runtime Build：$detectedBuild" -ForegroundColor Yellow
  Write-Host "旧服务 UI Build：     $detectedUi" -ForegroundColor Yellow
  Write-Host "当前需要 Runtime Build：$RuntimeBuild / $UiBuild" -ForegroundColor Green
  Write-Host "为了避免继续打开旧页面，启动器不会静默复用旧服务。" -ForegroundColor Yellow
  $answer = Read-Host "输入 Y 停止旧版 PVOS 并启动当前版本；输入其他内容取消"
  if ($answer -notmatch '^(?i:y|yes|是)$') { throw "已取消启动。请先停止旧版 PVOS 后再重试。" }
  Stop-DetectedOldPvos (Get-ListeningPidOnPort4173)
} elseif (Get-ListeningPidOnPort4173) {
  throw "4173 端口被未知程序占用，且该程序不是可识别的 PVOS 服务。请释放端口后重试。"
}

if (-not (Test-Path $VenvPython)) {
  Write-Step "首次启动：创建独立 Python 环境 .venv"
  $systemPython = Find-SystemPython
  $venvArgs = @()
  $venvArgs += $systemPython.Args
  $venvArgs += @("-m", "venv", $VenvDir)
  & $systemPython.File @venvArgs
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPython)) {
    throw "创建 .venv 失败。请确认 Python 安装完整，并包含 venv 模块。"
  }
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $VenvPython -c "import fastapi, uvicorn, pydantic, multipart" *> $null
$dependencyExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($dependencyExitCode -ne 0) {
  Write-Step "首次启动：安装必要依赖。该步骤只执行一次。"
  & $VenvPython -m pip install --disable-pip-version-check -r (Join-Path $BaseDir "service\requirements.lock.txt")
  if ($LASTEXITCODE -ne 0) { throw "依赖安装失败。请检查网络连接后重新双击启动。" }
}

if (Test-Path $SecretsPath) {
  $secrets = Get-Content -Raw -Encoding UTF8 $SecretsPath | ConvertFrom-Json
} else {
  Write-Step "生成仅限本机使用的后台密码与 Core API Key"
  $adminSuffix = ([guid]::NewGuid().ToString("N")).Substring(0, 12)
  $projectSuffix = ([guid]::NewGuid().ToString("N"))
  $secrets = [PSCustomObject]@{
    admin_password = "admin-$adminSuffix"
    project_key = "pvos-$projectSuffix"
    generated_at = (Get-Date).ToString("s")
  }
  $secrets | ConvertTo-Json | Set-Content -Path $SecretsPath -Encoding UTF8
}

$loginInfo = @"
PVOS V6.1.1 本地登录信息`nVisual Core：5.16.1 sealed library

工作台：$WorkbenchUrl
后台：  $AdminUrl
后台密码：$($secrets.admin_password)

说明：
1. 该密码仅用于你电脑上的本地后台。
2. 不要把本文件上传到公开仓库或发送给其他人。
3. 需要停止服务时，双击根目录的 02_STOP_PVOS_WINDOWS_双击停止.bat。
"@
$loginInfo | Set-Content -Path $LoginInfoPath -Encoding UTF8

$env:PVOS_ADMIN_PASSWORD = $secrets.admin_password
$env:PVOS_PROJECT_KEY = $secrets.project_key
$env:PVOS_DATA_DIR = $DataDir
$env:PVOS_UPLOADS_DIR = $UploadsDir
$env:PVOS_PRIVATE_ASSETS_DIR = $PrivateAssetsDir
$env:PVOS_DB_PATH = Join-Path $DataDir "pvos_lite.db"
$env:PVOS_CORS_ORIGINS = "http://127.0.0.1:4173,http://localhost:4173"
$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONUNBUFFERED = "1"

if (Test-Path $StdoutLog) { Remove-Item $StdoutLog -Force }
if (Test-Path $StderrLog) { Remove-Item $StderrLog -Force }

Write-Step "启动本地服务：http://127.0.0.1:4173"
$process = Start-Process -FilePath $VenvPython `
  -ArgumentList @("-m", "uvicorn", "service.main:app", "--host", "127.0.0.1", "--port", "4173") `
  -WorkingDirectory $BaseDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $StdoutLog `
  -RedirectStandardError $StderrLog `
  -PassThru
$process.Id | Set-Content -Path $PidPath -Encoding ASCII

$ready = $false
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 1
  if (Test-IsCurrentPvosHealth (Get-PvosHealthAny)) { $ready = $true; break }
  if ($process.HasExited) { break }
}

if (-not $ready) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item $PidPath -Force -ErrorAction SilentlyContinue
  Write-Host "服务没有成功启动。错误日志：$StderrLog" -ForegroundColor Red
  if (Test-Path $StderrLog) { Get-Content $StderrLog -Tail 30 }
  throw "PVOS 启动失败。"
}

Write-Step "启动成功，正在打开浏览器。"
Start-Process $WorkbenchUrl
Write-Host ""
Write-Host "工作台：$WorkbenchUrl" -ForegroundColor Green
Write-Host "后台：  $AdminUrl" -ForegroundColor Green
Write-Host "后台密码已保存到：$LoginInfoPath" -ForegroundColor Yellow
Write-Host "停止服务：双击 02_STOP_PVOS_WINDOWS_双击停止.bat" -ForegroundColor Yellow
Write-Host ""
Read-Host "按 Enter 关闭本窗口（PVOS 服务会继续在后台运行）"
