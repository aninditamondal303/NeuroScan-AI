<#
.SYNOPSIS
  Starts NeuroScan AI.

.DESCRIPTION
  Default: builds the website if needed and serves everything from one process,
  then opens your browser. Uses port 8000, or the next free port if another
  program already uses it. Press Ctrl+C to stop.

  -Dev starts the backend in a second window with auto-reload and the Vite dev
  server here (http://localhost:5173), for editing the code.

.EXAMPLE
  scripts\start.ps1
  scripts\start.ps1 -Rebuild
  scripts\start.ps1 -Dev
#>
[CmdletBinding()]
param(
    [switch]$Dev,
    [switch]$Rebuild,
    [switch]$NoBrowser,
    [int]$Port = 8000
)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Venv

function Test-PortFree([int]$P) {
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $P)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

# True only when the server on $P is NeuroScan (other local apps may also have /api/health).
function Test-NeuroScanHealth([int]$P) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$P/api/health"
        $h = $r.Content | ConvertFrom-Json
        return ($r.StatusCode -eq 200 -and $null -ne $h.PSObject.Properties['model_ready'] -and $null -ne $h.PSObject.Properties['app_version'])
    } catch {
        return $false
    }
}

if (-not (Test-Path (Join-Path $Root 'frontend\node_modules'))) {
    throw "Frontend packages are missing. Run scripts\setup.ps1 first."
}
if (-not (Test-Path (Join-Path $Root 'model\metadata.json'))) {
    Write-Note 'No trained model found. The site will open, but analysis stays disabled until you run scripts\train.ps1.'
}

if (-not (Test-PortFree $Port)) {
    $busy = $Port
    $Port = 0
    foreach ($candidate in ($busy + 1)..($busy + 20)) {
        if (Test-PortFree $candidate) { $Port = $candidate; break }
    }
    if ($Port -eq 0) { throw "Port $busy and the next 20 ports are all in use. Close other local servers and try again." }
    Write-Note "Port $busy is already used by another program; using port $Port instead."
}

if ($Dev) {
    Write-Step "Starting the backend in a new window (http://127.0.0.1:$Port)"
    $cmd = "Set-Location '$Root'; & '$VenvPy' -m uvicorn backend.app.main:app --host 127.0.0.1 --port $Port --reload"
    Start-Process powershell -ArgumentList @('-NoExit', '-Command', $cmd) | Out-Null
    Write-Step 'Starting the Vite dev server (http://localhost:5173)'
    $env:NEUROSCAN_API_URL = "http://127.0.0.1:$Port"
    if (-not $NoBrowser) { Start-Process 'http://localhost:5173' | Out-Null }
    Push-Location frontend
    try { & npm run dev } finally { Pop-Location }
    return
}

$dist = Join-Path $Root 'frontend\dist\index.html'
if ($Rebuild -or -not (Test-Path $dist)) {
    Write-Step 'Building the website'
    Push-Location frontend
    try { Invoke-Checked npm @('run', 'build') } finally { Pop-Location }
}

Write-Step "Starting NeuroScan AI on http://localhost:$Port  (Ctrl+C to stop)"
$server = Start-Process -FilePath $VenvPy `
    -ArgumentList @('-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', "$Port") `
    -NoNewWindow -PassThru
try {
    $up = $false
    # Loading TensorFlow and the model can take a minute on a laptop.
    for ($i = 0; $i -lt 180 -and -not $server.HasExited; $i++) {
        if (Test-NeuroScanHealth $Port) { $up = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $up) {
        throw "The NeuroScan backend did not start. Read the messages above for the reason."
    }
    $health = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/health").Content | ConvertFrom-Json
    if ($health.model_ready) { Write-Ok "Model ready: $($health.model_version)" }
    else { Write-Note 'Model not ready. Open About in the site to see which check failed.' }
    Write-Ok "Open http://localhost:$Port"
    if (-not $NoBrowser) { Start-Process "http://localhost:$Port" | Out-Null }
    Wait-Process -Id $server.Id
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
