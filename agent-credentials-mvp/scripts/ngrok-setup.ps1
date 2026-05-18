# Agentix ngrok Setup for Lambda Testing
# This script helps set up ngrok tunnel for testing Lambda connectivity

Write-Host "=== Agentix ngrok Setup ===" -ForegroundColor Cyan

# Check if ngrok is installed
$ngrokPath = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrokPath) {
    Write-Host "`n[INSTALLING] ngrok not found. Installing..." -ForegroundColor Yellow

    # Try winget first
    $wingetResult = Start-Process -FilePath "winget" -ArgumentList "install", "--id", "Ngrok.Ngrok", "-e", "--accept-source", "--accept-package" -Wait -PassThru -NoNewWindow

    if ($wingetResult.ExitCode -eq 0) {
        Write-Host "  ngrok installed successfully via winget" -ForegroundColor Green
    } else {
        Write-Host @"

  Please install ngrok manually:

  Option 1 - Chocolatey:
    choco install ngrok

  Option 2 - Download directly:
    1. Go to https://ngrok.com/download
    2. Download Windows version
    3. Extract to a folder in your PATH
    4. Run: ngrok config add-authtoken <your-token>

  Option 3 - winget (retry):
    winget install Ngrok.Ngrok

"@ -ForegroundColor Yellow
        exit 1
    }
}

# Verify ngrok is available
$ngrokPath = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrokPath) {
    Write-Host "ERROR: ngrok still not found after installation. Please restart terminal." -ForegroundColor Red
    exit 1
}

Write-Host "  ngrok found at: $($ngrokPath.Source)" -ForegroundColor Green

# Check if ngrok is authenticated
Write-Host "`n[AUTH] Checking ngrok authentication..." -ForegroundColor Yellow
$ngrokStatus = ngrok config check 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host @"

  ngrok requires authentication. Sign up at https://ngrok.com and run:

    ngrok config add-authtoken <your-authtoken>

  Your authtoken is available at: https://dashboard.ngrok.com/get-started/your-authtoken

"@ -ForegroundColor Yellow
    exit 1
}
Write-Host "  ngrok is authenticated" -ForegroundColor Green

# Check if backend is running
Write-Host "`n[BACKEND] Checking if backend is running on port 3001..." -ForegroundColor Yellow
$backendHealth = Invoke-RestMethod -Uri "http://localhost:3001/health" -Method Get -ErrorAction SilentlyContinue
if (-not $backendHealth -or $backendHealth.status -ne "ok") {
    Write-Host "  Starting backend..." -ForegroundColor Yellow
    Start-Process -FilePath "npm" -ArgumentList "run", "dev:backend" -WorkingDirectory "D:\BLOCKCHAIN AND ZK PROJECTS\AGENT_CREDENTIAL\agent-credentials-mvp" -NoNewWindow
    Start-Sleep -Seconds 5
    $backendHealth = Invoke-RestMethod -Uri "http://localhost:3001/health" -Method Get -ErrorAction SilentlyContinue
}

if ($backendHealth.status -eq "ok") {
    Write-Host "  Backend is running" -ForegroundColor Green
} else {
    Write-Host "  ERROR: Backend not running. Start it manually: npm run dev:backend" -ForegroundColor Red
    exit 1
}

# Kill any existing ngrok processes on port 4040
Write-Host "`n[CLEANUP] Killing existing ngrok processes..." -ForegroundColor Yellow
Get-Process -Name ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Start ngrok tunnel
Write-Host "`n[TUNNEL] Starting ngrok tunnel on port 3001..." -ForegroundColor Yellow
Write-Host "  This will open a public URL for your local backend" -ForegroundColor Gray

# Start ngrok in background
$ngrokJob = Start-Process -FilePath "ngrok" -ArgumentList "http", "3001", "--log=stdout" -PassThru -WindowStyle Hidden

Write-Host "  Waiting for ngrok to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Get the public URL from ngrok API
Write-Host "`n[URL] Fetching public URL from ngrok API..." -ForegroundColor Yellow
try {
    $tunnels = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -Method Get -ErrorAction Stop
    $publicUrl = $tunnels.tunnels[0].public_url
    Write-Host "  Public URL: $publicUrl" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Could not get ngrok URL. Is ngrok running?" -ForegroundColor Red
    Write-Host "  Try: ngrok http 3001" -ForegroundColor Yellow
    exit 1
}

# Test the tunnel
Write-Host "`n[TEST] Testing tunnel connection..." -ForegroundColor Yellow
try {
    $tunnelHealth = Invoke-RestMethod -Uri "$publicUrl/health" -Method Get -ErrorAction Stop
    if ($tunnelHealth.status -eq "ok") {
        Write-Host "  Tunnel is working! Backend accessible via: $publicUrl" -ForegroundColor Green
    }
} catch {
    Write-Host "  WARNING: Could not reach backend through tunnel: $_" -ForegroundColor Yellow
}

# Generate Lambda environment variables
Write-Host "`n" + ("="*60) -ForegroundColor Cyan
Write-Host "NGROK SETUP COMPLETE" -ForegroundColor Green
Write-Host ("="*60) -ForegroundColor Cyan

Write-Host @"

Set these AWS Lambda environment variables NOW:

  AGENTIX_API_URL = $publicUrl
  AGENTIX_RUNTIME_ID = 1
  AGENTIX_API_KEY = agentix-test-key-$([System.Guid]::NewGuid().ToString().Substring(0,8))
  AGENTIX_ORG_ID = 1
  POLL_INTERVAL = 5

Lambda will poll: POST $publicUrl/external/1/poll
Lambda will report: POST $publicUrl/external/1/report

"@ -ForegroundColor White

Write-Host "Dashboard: http://localhost:4040" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop ngrok" -ForegroundColor Gray

# Keep running and show status
Write-Host "`n[LOGGING] ngrok is running. Press Ctrl+C to stop..." -ForegroundColor Cyan
Write-Host "  Opening ngrok dashboard..." -ForegroundColor Gray

Start-Process "http://localhost:4040"

# Wait for ngrok process
$ngrokJob.WaitForExit()
