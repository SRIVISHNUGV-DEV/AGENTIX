#!/usr/bin/env pwsh
# Install git pre-commit hooks for the AgentIX repo
# Run: powershell -ExecutionPolicy Bypass -File scripts/install-hooks.ps1

$RepoRoot = Split-Path -Parent $PSScriptRoot
$HookDir = Join-Path $RepoRoot ".git"
$HookDir = Join-Path $HookDir "hooks"
$HookPath = Join-Path $HookDir "pre-commit"

# --- Pre-commit hook script ---
$HookContent = @'#!/bin/sh
# AgentIX pre-commit hook — calls scripts/secret-scan.ps1
# Installed by scripts/install-hooks.ps1 — re-run to update

powershell -ExecutionPolicy Bypass -File "$(dirname "$0")/../../scripts/secret-scan.ps1"
if [ $? -ne 0 ]; then exit 1; fi
'@

# ---- Install ----
if (-not (Test-Path $HookDir)) {
    New-Item -ItemType Directory -Path $HookDir -Force | Out-Null
}

Set-Content -Path $HookPath -Value $HookContent -Encoding ASCII -NoNewline
Write-Host "Installed pre-commit hook at: $HookPath" -ForegroundColor Green

# Make executable (best effort on Windows)
try {
    git update-index --chmod=+x $HookPath 2>$null
    icacls $HookPath /grant "Everyone:RX" 2>$null
} catch {}

Write-Host ""
Write-Host "Guardrails active:" -ForegroundColor Cyan
Write-Host "  • Pre-commit hook scans staged files for secrets" -ForegroundColor Gray
Write-Host "  • .gitleaks.toml config ready for gitleaks CI scanning" -ForegroundColor Gray
Write-Host "  • .gitignore blocks .env, credentials, and key files" -ForegroundColor Gray
Write-Host ""
Write-Host "Recommended: Install gitleaks for CI scanning" -ForegroundColor Yellow
Write-Host "  winget install gitleaks" -ForegroundColor Gray
Write-Host "  gitleaks detect --source . --verbose" -ForegroundColor Gray
Write-Host ""
