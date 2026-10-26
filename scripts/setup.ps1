<#
.SYNOPSIS
  One-time setup: Python environment, packages, frontend packages, tests and a production build.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipTests,
    [switch]$NoTensorFlow   # install only what the website needs (no training, no model loading)
)
. (Join-Path $PSScriptRoot 'common.ps1')

Write-Step 'Checking Python (TensorFlow needs 3.10 to 3.13)'

# Returns the full path of an installed Python 3.10-3.13, or $null.
function Find-SupportedPython {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in '3.12', '3.11', '3.13', '3.10') {
            if (Test-Native py @("-$v", '-c', 'import sys')) {
                $exe = (& py "-$v" -c 'import sys; print(sys.executable)' 2>$null | Select-Object -First 1)
                if ($exe -and (Test-Path $exe)) { return $exe.Trim() }
            }
        }
    }
    # Runtimes added by the Python install manager live here and are not always visible to 'py'.
    $roots = @("$env:LOCALAPPDATA\Python", "$env:LOCALAPPDATA\Programs\Python", "$env:ProgramFiles")
    foreach ($v in '312', '311', '313', '310') {
        foreach ($r in $roots) {
            foreach ($name in "pythoncore-$($v.Insert(1,'.'))-64", "Python$v") {
                $exe = Join-Path $r "$name\python.exe"
                if (Test-Path $exe) { return $exe }
            }
        }
    }
    return $null
}

if (-not (Test-Path $VenvPy)) {
    $basePy = Find-SupportedPython
    if (-not $basePy -and (Get-Command pymanager -ErrorAction SilentlyContinue)) {
        # TensorFlow has no wheels for Python 3.14+; add 3.12 next to the existing version.
        Write-Note 'Only Python 3.14 or newer found, which TensorFlow does not support yet. Installing Python 3.12 with the Python install manager...'
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        & pymanager install 3.12
        $ErrorActionPreference = $old
        $basePy = Find-SupportedPython
    }
    if (-not $basePy) {
        throw "No Python 3.10-3.13 found (TensorFlow does not support 3.14 yet). Install Python 3.12 from https://www.python.org/downloads/ and run this script again."
    }
    Write-Ok "Using $basePy"
    Write-Step 'Creating .venv'
    Invoke-Checked $basePy @('-m', 'venv', '.venv')
} else {
    Write-Ok '.venv already exists'
}

Write-Step 'Installing Python packages (TensorFlow is large; this can take a while)'
Invoke-Checked $VenvPy @('-m', 'pip', 'install', '--upgrade', 'pip')
$reqs = @('-r', 'backend\requirements.txt', '-r', 'backend\requirements-dev.txt')
if (-not $NoTensorFlow) { $reqs += @('-r', 'ml\requirements.txt') }
Invoke-Checked $VenvPy (@('-m', 'pip', 'install') + $reqs)

Write-Step 'Checking Node.js (20 or newer)'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found. Install the LTS version from https://nodejs.org/ and reopen PowerShell."
}
$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw "Node.js $nodeMajor found; version 20 or newer is needed." }
Write-Ok "Node.js $(& node --version)"

Write-Step 'Installing frontend packages'
Push-Location frontend
try {
    Invoke-Checked npm @('install')
} finally { Pop-Location }

if (-not $SkipTests) {
    Write-Step 'Running backend and ML tests'
    Invoke-Checked $VenvPy @('-m', 'pytest', '-q')

    Write-Step 'Running frontend tests'
    Push-Location frontend
    try { Invoke-Checked npm @('test') } finally { Pop-Location }
}

Write-Step 'Building the website (type check + production build)'
Push-Location frontend
try { Invoke-Checked npm @('run', 'build') } finally { Pop-Location }

Write-Step 'Setup complete'
if (Test-Path (Join-Path $Root 'model\metadata.json')) {
    Write-Ok 'A model folder is present. Start the site with: scripts\start.ps1'
} else {
    Write-Note 'No trained model yet. The site will run but analysis stays disabled until you train one:'
    Write-Note '  scripts\get-dataset.ps1'
    Write-Note '  scripts\train.ps1 -Quick     (pipeline check)'
    Write-Note '  scripts\train.ps1            (full training)'
    Write-Note 'Then: scripts\start.ps1'
}
