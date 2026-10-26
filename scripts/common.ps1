# Shared helpers for the NeuroScan AI PowerShell scripts.
# Works in Windows PowerShell 5.1 and PowerShell 7.

$ErrorActionPreference = 'Stop'
$script:Root = Split-Path -Parent $PSScriptRoot
$script:VenvPy = Join-Path $script:Root '.venv\Scripts\python.exe'
$script:DefaultDataDir = Join-Path $script:Root 'data\brain-tumor-mri-dataset'

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "== $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) { Write-Host "   $Message" -ForegroundColor Green }
function Write-Note([string]$Message) { Write-Host "   $Message" -ForegroundColor Yellow }

# Runs a native command and stops the script if it fails.
function Invoke-Checked {
    param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @())
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed (exit $LASTEXITCODE): $Exe $($Arguments -join ' ')"
    }
}

# Returns $true when a native command exits with 0. Its output (including stderr,
# which Windows PowerShell 5.1 would otherwise turn into a terminating error) is discarded.
function Test-Native {
    param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @())
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe @Arguments 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $old
    }
}

function Assert-Venv {
    if (-not (Test-Path $script:VenvPy)) {
        throw "The Python environment is missing. Run scripts\setup.ps1 first."
    }
}

# A dataset folder is valid when it has Training\ and Testing\, each with class subfolders.
function Test-DatasetDir([string]$Dir) {
    if (-not $Dir) { return $false }
    foreach ($split in 'Training', 'Testing') {
        $p = Join-Path $Dir $split
        if (-not (Test-Path $p -PathType Container)) { return $false }
        if (-not (Get-ChildItem $p -Directory -ErrorAction SilentlyContinue)) { return $false }
    }
    return $true
}

# Finds the folder that holds Training\ and Testing\ at, or up to two levels below, $Dir.
function Find-DatasetDir([string]$Dir) {
    if (Test-DatasetDir $Dir) { return (Resolve-Path $Dir).Path }
    if (-not (Test-Path $Dir)) { return $null }
    $candidates = Get-ChildItem $Dir -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue
    foreach ($c in $candidates) {
        if (Test-DatasetDir $c.FullName) { return $c.FullName }
    }
    return $null
}

Set-Location $script:Root
