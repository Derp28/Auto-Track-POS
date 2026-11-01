param(
  [string]$ProjectRoot = "",
  [switch]$Background
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$LogDir = Join-Path $RuntimeDir "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Read-DotEnv([string]$Path) {
  $values = @{}
  if (Test-Path $Path) {
    foreach ($line in Get-Content $Path) {
      if ($line -match '^\s*([^#=]+?)\s*=\s*(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
          $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$name] = $value
      }
    }
  }
  return $values
}

function Test-TcpPort([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $result.AsyncWaitHandle.WaitOne(400)) { return $false }
    $client.EndConnect($result)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Wait-TcpPort([int]$Port, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort $Port) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

$envValues = Read-DotEnv (Join-Path $ProjectRoot ".env")
$appPort = 3100
if ($envValues.ContainsKey("PORT") -and $envValues["PORT"] -match '^\d+$') {
  $appPort = [int]$envValues["PORT"]
}
$mysqlPort = 3307
if ($envValues.ContainsKey("DATABASE_URL") -and
    $envValues["DATABASE_URL"] -match '^mysql://[^@]+@[^:]+:(\d+)/') {
  $mysqlPort = [int]$matches[1]
}

$mysqlExe = Join-Path $RuntimeDir "mysql-8.4.13-winx64\bin\mysqld.exe"
$mysqlIni = Join-Path $RuntimeDir "my.ini"
if (Test-Path $mysqlExe) {
  if (-not (Test-TcpPort $mysqlPort)) {
    if (-not (Test-Path $mysqlIni)) {
      throw "MySQL configuration not found: $mysqlIni"
    }
    Write-Host "Starting the local MySQL server on 127.0.0.1:$mysqlPort ..."
    Start-Process -FilePath $mysqlExe `
      -ArgumentList "--defaults-file=`"$mysqlIni`"" `
      -WorkingDirectory $RuntimeDir -WindowStyle Hidden
    if (-not (Wait-TcpPort $mysqlPort 45)) {
      throw "MySQL did not open 127.0.0.1:$mysqlPort. See .runtime/mysql-data/mysql-error.log."
    }
  }
} elseif (-not (Test-TcpPort $mysqlPort)) {
  Write-Warning "Portable MySQL was not found under .runtime; assuming MySQL is already running on 127.0.0.1:$mysqlPort."
}

Write-Host "Applying database migrations ..."
Push-Location $ProjectRoot
try {
  & node "scripts/migrate.mjs"
  if ($LASTEXITCODE -ne 0) {
    throw "Database migrations failed. Check .env and MySQL, then try again."
  }
} finally {
  Pop-Location
}

if (-not (Test-TcpPort $appPort)) {
  Write-Host "Starting Auto-Track POS on 127.0.0.1:$appPort ..."
  $nodeExe = (Get-Command node -ErrorAction Stop).Source
  $outLog = Join-Path $LogDir "server.out.log"
  $errLog = Join-Path $LogDir "server.err.log"
  $process = Start-Process -FilePath $nodeExe `
    -ArgumentList "server/index.js" `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru
  Set-Content -Path (Join-Path $RuntimeDir "server.pid") -Value $process.Id
  if (-not (Wait-TcpPort $appPort 45)) {
    throw "Auto-Track POS did not start. See .runtime/logs/server.err.log."
  }
}

$url = "http://127.0.0.1:$appPort/"
if (-not $Background) {
  Write-Host "Opening $url"
  Start-Process $url
} else {
  Write-Host "Auto-Track POS is running at $url"
}
