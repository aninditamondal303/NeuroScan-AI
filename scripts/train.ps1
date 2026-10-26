<#
.SYNOPSIS
  Trains and evaluates the classifier, writing the model to model\.

.EXAMPLE
  scripts\train.ps1 -Quick     # small subset, few epochs: checks the pipeline, metrics NOT meaningful
  scripts\train.ps1            # full run (CPU-only training is slow; leave it running)
  scripts\train.ps1 -FullFineTune   # EfficientNetB0 only, all backbone layers fine-tuned, longer schedule
#>
[CmdletBinding()]
param(
    [string]$DataDir,
    [switch]$Quick,
    [switch]$FullFineTune,
    [string[]]$Extra = @()   # passed through to ml.train, e.g. -Extra '--models','efficientnet_b0'
)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Venv

if (-not $DataDir) { $DataDir = $DefaultDataDir }
$resolved = Find-DatasetDir $DataDir
if (-not $resolved) {
    throw "No dataset found at $DataDir (it needs Training\ and Testing\ folders). Run scripts\get-dataset.ps1 first."
}

if (-not (Test-Native $VenvPy @('-c', 'import tensorflow'))) {
    throw "TensorFlow is not installed in .venv. Run scripts\setup.ps1 (without -NoTensorFlow)."
}

$argsList = @('-m', 'ml.train', '--data-dir', $resolved) + $Extra
if ($FullFineTune) {
    # Skips the baseline and unfreezes every EfficientNet layer (BatchNorm stays frozen).
    $argsList += @('--models', 'efficientnet_b0', '--finetune-layers', '300', '--finetune-epochs', '20', '--patience', '5')
    Write-Note 'Full fine-tune: EfficientNetB0 only, all backbone layers trainable, up to 20 fine-tuning epochs.'
}
if ($Quick) {
    $argsList += '--quick'
    Write-Note 'Quick mode: checks the pipeline end to end. Its metrics are not meaningful; run without -Quick for a real model.'
}

Write-Step "Training on $resolved"
$started = Get-Date
Invoke-Checked $VenvPy $argsList
$elapsed = (Get-Date) - $started

Write-Step ("Finished in {0:hh\:mm\:ss}" -f $elapsed)
Write-Ok 'Outputs in model\: best_model.keras, metadata.json, evaluation.json, ood_stats.npz, split_manifest.json'
Write-Ok 'Start the website with: scripts\start.ps1  (it loads the new model at startup)'
