# cross-platform bun wrapper — installs bun automatically if missing, then runs the given script.
# usage: powershell -ExecutionPolicy Bypass -File scripts/run.ps1 scripts/query.ts
param([Parameter(ValueFromRemainingArguments)]$ScriptArgs)
$ErrorActionPreference = 'Stop'

function Ensure-Bun {
    $found = Get-Command bun -ErrorAction SilentlyContinue
    if ($found) { return }

    Write-Host 'bun not found — installing automatically...' -ForegroundColor Yellow

    try {
        irm bun.sh/install.ps1 | iex *>&1 | Out-Null
    } catch {
        Write-Error "bun installation failed — install manually: https://bun.sh"
        exit 1
    }

    # add to current session PATH
    $bunDir = Join-Path $env:USERPROFILE '.bun' 'bin'
    if (Test-Path $bunDir) {
        $env:PATH = "$bunDir;$env:PATH"
    }

    $found = Get-Command bun -ErrorAction SilentlyContinue
    if (-not $found) {
        Write-Error "bun installation failed — install manually: https://bun.sh"
        exit 1
    }

    Write-Host "bun installed successfully ($(bun --version))" -ForegroundColor Green
}

Ensure-Bun
& bun @ScriptArgs
exit $LASTEXITCODE
