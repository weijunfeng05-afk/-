$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$testTemp = Join-Path $projectRoot ('.qa/tests-' + [guid]::NewGuid().ToString('N'))
& ./.venv/Scripts/python.exe -m pytest tests -q --tb=short -p no:cacheprovider --basetemp $testTemp
if ($LASTEXITCODE -ne 0) { throw 'Backend or document tests failed.' }
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$packageManager = if ($pnpmCommand) { $pnpmCommand.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm.cmd' }
Push-Location frontend
try {
    & $packageManager test
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
    & $packageManager build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
