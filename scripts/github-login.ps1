param([switch]$CheckOnly, [switch]$RepairPath)
$ErrorActionPreference = 'Stop'

# Codex bundles Git, but an ordinary PowerShell session may not have it on PATH.
$gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
$gitCandidates = @(
    $(if ($gitCommand) { $gitCommand.Source }),
    (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe'),
    (Join-Path $env:ProgramFiles 'Git/cmd/git.exe')
)
$gitExecutable = $gitCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $gitExecutable) { throw 'Git was not found. Install Git for Windows, then run this script again.' }
& $gitExecutable --version
if ($LASTEXITCODE -ne 0) { throw 'Git could not start.' }
& $gitExecutable credential-manager --version
if ($LASTEXITCODE -ne 0) { throw 'Git Credential Manager is unavailable in this Git installation.' }

if ($RepairPath) {
    $gitDirectory = Split-Path -Parent $gitExecutable
    $existingUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($existingUserPath -split ';' | Where-Object { $_ })
    if (-not ($entries | Where-Object { $_.TrimEnd('\', '/') -ieq $gitDirectory.TrimEnd('\', '/') })) {
        $updatedUserPath = if ([string]::IsNullOrEmpty($existingUserPath)) { $gitDirectory } else { $existingUserPath.TrimEnd(';') + ';' + $gitDirectory }
        [Environment]::SetEnvironmentVariable('Path', $updatedUserPath, 'User')
    }
    $env:Path = $gitDirectory + ';' + $env:Path
    Write-Output 'Git has been added to your user PATH. Reopen PowerShell to use it in other terminals.'
}
Write-Output "Git executable: $gitExecutable"
if (-not $CheckOnly) {
    & $gitExecutable credential-manager github login --browser
    if ($LASTEXITCODE -ne 0) { throw 'GitHub login did not complete. Check the browser authorization and network connection.' }
}
