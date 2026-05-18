# Agentix Lambda Runtime Setup Script
# Configures and tests the connection between AWS Lambda and Agentix backend

param(
    [string]$LambdaUrl = "https://sw5i7nbvglic7qjecidbn4fggi0kfigv.lambda-url.us-east-1.on.aws",
    [string]$BackendUrl = "http://localhost:3001",
    [int]$OrgId = 1
)

Write-Host "=== Agentix Lambda Runtime Setup ===" -ForegroundColor Cyan

# Step 1: Check backend is running
Write-Host "`n[1/4] Checking backend health..." -ForegroundColor Yellow
$health = Invoke-RestMethod -Uri "$BackendUrl/health" -Method Get -ErrorAction SilentlyContinue
if ($health.status -eq "ok") {
    Write-Host "  Backend is running (uptime: $([math]::Round($health.uptime, 1))s)" -ForegroundColor Green
} else {
    Write-Host "  ERROR: Backend not responding. Start it with: npm run dev:backend" -ForegroundColor Red
    exit 1
}

# Step 2: Get or create external agent for Lambda
Write-Host "`n[2/4] Checking external agents..." -ForegroundColor Yellow
$agents = Invoke-RestMethod -Uri "$BackendUrl/external?orgId=$OrgId" -Method Get

$lambdaAgent = $agents | Where-Object { $_.name -like "*Lambda*" -or $_.name -like "*runtime*" } | Select-Object -First 1

if ($lambdaAgent) {
    Write-Host "  Found existing agent: $($lambdaAgent.name) (ID: $($lambdaAgent.id))" -ForegroundColor Green
} else {
    Write-Host "  Creating new Lambda runtime agent..." -ForegroundColor Yellow

    # Generate a UUID for the request
    $requestId = [System.Guid]::NewGuid().ToString()
    $timestamp = [int][double]::Parse((Get-Date -UFormat %s))

    # Create agent (without signature for setup)
    $body = @{
        orgId = $OrgId
        agentType = "custom"
        name = "AWS Lambda Runtime"
        endpoint = $LambdaUrl
        metadata = @{
            runtimeType = "lambda"
            deployment = "aws"
        }
    } | ConvertTo-Json -Depth 2

    try {
        $result = Invoke-RestMethod -Uri "$BackendUrl/external" -Method Post -Body $body -ContentType "application/json"
        $lambdaAgent = $result
        Write-Host "  Created agent ID: $($lambdaAgent.id)" -ForegroundColor Green
    } catch {
        Write-Host "  Note: Agent creation requires wallet signature. Using existing agent..." -ForegroundColor Yellow
        $lambdaAgent = $agents[0]
    }
}

$runtimeId = $lambdaAgent.id
Write-Host "  Runtime ID: $runtimeId" -ForegroundColor Cyan

# Step 3: Queue a test task for the Lambda
Write-Host "`n[3/4] Queuing test task..." -ForegroundColor Yellow
$taskBody = @{
    action = "execute_command"
    params = @{
        command = "echo 'Hello from Agentix Lambda Runtime!'"
    }
    priority = 1
} | ConvertTo-Json -Depth 2

try {
    $queueResult = Invoke-RestMethod -Uri "$BackendUrl/external/$runtimeId/queue" -Method Post -Body $taskBody -ContentType "application/json"
    Write-Host "  Task queued: ID=$($queueResult.taskId)" -ForegroundColor Green
} catch {
    Write-Host "  Task queue error: $_" -ForegroundColor Yellow
}

# Step 4: Test Lambda endpoint directly
Write-Host "`n[4/4] Testing Lambda endpoint..." -ForegroundColor Yellow

$testBody = @{
    action = "api_call"
    params = @{
        url = "https://httpbin.org/get"
        method = "GET"
    }
} | ConvertTo-Json -Depth 2

try {
    $lambdaTest = Invoke-RestMethod -Uri "$LambdaUrl/execute" -Method Post -Body $testBody -ContentType "application/json" -ErrorAction Stop
    Write-Host "  Lambda responded: $($lambdaTest.status)" -ForegroundColor Green
    Write-Host "  Result: $($lambdaTest.result | ConvertTo-Json -Compress)" -ForegroundColor Cyan
} catch {
    Write-Host "  Lambda test error: $_" -ForegroundColor Yellow
    Write-Host "  This is expected if environment variables are not set in Lambda" -ForegroundColor Yellow
}

# Summary
Write-Host "`n=== Configuration Summary ===" -ForegroundColor Cyan
Write-Host "Lambda URL: $LambdaUrl"
Write-Host "Backend URL: $BackendUrl"
Write-Host "Runtime ID: $runtimeId"
Write-Host "Org ID: $OrgId"

Write-Host "`n=== AWS Lambda Environment Variables ===" -ForegroundColor Yellow
Write-Host "Set these in AWS Lambda console:"
Write-Host "  AGENTIX_API_URL = $BackendUrl" -ForegroundColor White
Write-Host "  AGENTIX_RUNTIME_ID = $runtimeId" -ForegroundColor White
Write-Host "  AGENTIX_API_KEY = <generate-key>" -ForegroundColor White
Write-Host "  AGENTIX_ORG_ID = $OrgId" -ForegroundColor White
Write-Host "  POLL_INTERVAL = 5" -ForegroundColor White

Write-Host "`n=== Polling Flow ===" -ForegroundColor Cyan
Write-Host "Lambda will poll: POST $BackendUrl/external/$runtimeId/poll"
Write-Host "Lambda will report: POST $BackendUrl/external/$runtimeId/report"
