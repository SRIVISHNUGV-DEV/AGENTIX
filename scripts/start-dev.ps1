$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'

function Get-ListeningProcessId([int]$Port) {
  $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($connection) {
    return $connection.OwningProcess
  }
  return $null
}

function Wait-ForHttp([string]$Url, [int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  Write-Output "Waiting for $Url ..."
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method Get -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {}
    Start-Sleep -Milliseconds 700
  }
  return $false
}

function Print-LogPreview([string]$Label, [string]$Path) {
  if (Test-Path $Path) {
    $lines = Get-Content $Path -ErrorAction SilentlyContinue | Select-Object -First 20
    if ($lines) {
      Write-Output ""
      Write-Output "$Label log preview:"
      $lines | ForEach-Object { Write-Output "  $_" }
    }
  }
}

function Get-AvailableLogPath([string]$BasePath) {
  if (-not (Test-Path $BasePath)) {
    return $BasePath
  }

  try {
    Remove-Item $BasePath -Force -ErrorAction Stop
    return $BasePath
  } catch {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $directory = Split-Path -Parent $BasePath
    $filename = Split-Path -Leaf $BasePath
    return Join-Path $directory "$timestamp.$filename"
  }
}

$backendOut = Get-AvailableLogPath (Join-Path $backendDir '.backend.out.log')
$backendErr = Get-AvailableLogPath (Join-Path $backendDir '.backend.err.log')
$frontendOut = Get-AvailableLogPath (Join-Path $frontendDir '.frontend.out.log')
$frontendErr = Get-AvailableLogPath (Join-Path $frontendDir '.frontend.err.log')

$backendCmd = 'npm run dev'
$frontendCmd = 'npx next dev --webpack --hostname 127.0.0.1 --port 3000'

$backendPid = Get-ListeningProcessId 3001
$frontendPid = Get-ListeningProcessId 3000

if (-not $backendPid) {
  Write-Output 'Starting backend on port 3001...'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $backendCmd -WorkingDirectory $backendDir -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr -WindowStyle Hidden
} else {
  Write-Output "Backend already running on port 3001 (PID $backendPid)"
}

if (-not $frontendPid) {
  Write-Output 'Starting frontend on port 3000...'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $frontendCmd -WorkingDirectory $frontendDir -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr -WindowStyle Hidden
} else {
  Write-Output "Frontend already running on port 3000 (PID $frontendPid)"
}

Start-Sleep -Seconds 2
Print-LogPreview 'Backend' $backendOut
Print-LogPreview 'Frontend' $frontendOut

$backendReady = Wait-ForHttp 'http://127.0.0.1:3001/health'
$frontendReady = Wait-ForHttp 'http://127.0.0.1:3000'

if ($backendReady) {
  Write-Output 'Backend started successfully.'
} else {
  Write-Output 'Backend did not become ready in time. Check logs.'
}

if ($frontendReady) {
  Write-Output 'Frontend started successfully.'
} else {
  Write-Output 'Frontend did not become ready in time. Check logs.'
}

Write-Output ''
Write-Output 'Open these URLs:'
Write-Output '  Frontend: http://127.0.0.1:3000'
Write-Output '  Backend:  http://127.0.0.1:3001'
Write-Output ''
Write-Output 'Logs:'
Write-Output "  Backend out: $backendOut"
Write-Output "  Backend err: $backendErr"
Write-Output "  Frontend out: $frontendOut"
Write-Output "  Frontend err: $frontendErr"
