$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$bundledRoot = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies'
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$pythonRuntime = if ($pythonCommand) { $pythonCommand.Source } else { Join-Path $bundledRoot 'python/python.exe' }
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    & $pythonRuntime -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment setup failed.' }
}
& ./.venv/Scripts/python.exe -m pip install -r requirements.lock
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$packageManager = if ($pnpmCommand) { $pnpmCommand.Source } else { Join-Path $bundledRoot 'bin/fallback/pnpm.cmd' }
Push-Location frontend
try {
    & $packageManager install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    & $packageManager build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
Write-Output 'Ready. Run .\scripts\start.ps1 and open http://127.0.0.1:8000'
