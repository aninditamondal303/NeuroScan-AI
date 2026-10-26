<#
.SYNOPSIS
  Runs every software test: backend + ML (pytest), frontend type check, frontend tests.
  These tests use a stand-in model; they check the software, not model accuracy.
  Model accuracy comes from training (model\evaluation.json, shown on the Model Performance page).
#>
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Venv

Write-Step 'Backend and ML tests'
Invoke-Checked $VenvPy @('-m', 'pytest', '-q')

Push-Location frontend
try {
    Write-Step 'Frontend type check'
    Invoke-Checked npm @('run', 'typecheck')
    Write-Step 'Frontend tests'
    Invoke-Checked npm @('test')
} finally { Pop-Location }

Write-Step 'All tests passed'
