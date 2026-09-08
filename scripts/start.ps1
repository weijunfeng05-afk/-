$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) { throw 'Run scripts/setup.ps1 first.' }
Write-Output 'Resume Assistant: http://127.0.0.1:8000 (Ctrl+C to stop)'
& ./.venv/Scripts/python.exe scripts/run.py
