#!/usr/bin/env pwsh
# AgentIX pre-commit secret scanner
# Called by .git/hooks/pre-commit (installed via install-hooks.ps1)
# Can also run standalone: powershell -File scripts/secret-scan.ps1

param(
    [switch]$Staged = $true
)

$Patterns = @(
    @{ Name = "Ethereum private key"; Regex = '0x[a-fA-F0-9]{64}' }
    @{ Name = "Alchemy/Infura RPC URL with key"; Regex = 'https?://[a-zA-Z0-9.-]+\.(alchemy|infura|moralis|quicknode)\.(com|io)/v[12]/\w{32,}' }
    @{ Name = "AWS Access Key"; Regex = 'AKIA[0-9A-Z]{16}' }
    @{ Name = "OpenAI API Key"; Regex = 'sk-[a-zA-Z0-9]{20,}' }
    @{ Name = "GitHub token"; Regex = '(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}' }
    @{ Name = "Hardcoded PRIVATE_KEY"; Regex = 'PRIVATE_KEY[0-9_]*=[''"][a-zA-Z0-9]{64,}[''"]' }
    @{ Name = "Bearer token / JWT"; Regex = 'Bearer [a-zA-Z0-9_\-\.]{20,}' }
)

$allowlistPaths = @(
    '\.example$'
    'test-placeholder'
    'node_modules'
    'package-lock\.json'
    'pnpm-lock\.yaml'
    '\.gitignore'
    '\.gitleaks\.toml'
)

$violations = @()
$repoRoot = Split-Path -Parent $PSScriptRoot

if ($Staged) {
    $files = git diff --cached --name-only --diff-filter=ACMR
} else {
    $files = Get-ChildItem -Recurse -File $repoRoot | Where-Object { -not $_.FullName.Contains("node_modules") -and -not $_.FullName.Contains(".git") } | ForEach-Object { $_.FullName.Substring($repoRoot.Length + 1) }
}

if (-not $files) { exit 0 }

foreach ($file in $files) {
    $fullPath = Join-Path $repoRoot $file
    if (-not (Test-Path $fullPath)) { continue }

    $shouldSkip = $false
    foreach ($allow in $allowlistPaths) {
        if ($file -match $allow) { $shouldSkip = $true; break }
    }
    if ($shouldSkip) { continue }

    $content = Get-Content -Raw $fullPath -ErrorAction SilentlyContinue
    if (-not $content) { continue }

    foreach ($pattern in $Patterns) {
        $matches = [regex]::Matches($content, $pattern.Regex)
        foreach ($m in $matches) {
            $line = ($content.Substring(0, $m.Index) -split "`n").Count
            $val = $m.Value
            if ($val.Length -gt 40) { $val = $val.Substring(0, 20) + "..." + $val.Substring($val.Length - 10) }
            $violations += "  ${file}:${line}  ${val}  ($($pattern.Name))"
        }
    }
}

if ($violations.Count -gt 0) {
    Write-Host "`n[SECURITY BLOCKED] Potential secrets detected:" -ForegroundColor Red
    $violations | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
    if ($Staged) {
        Write-Host "`nTo override (not recommended): git commit --no-verify" -ForegroundColor Gray
    }
    Write-Host "" -ForegroundColor Gray
    exit 1
}

exit 0
