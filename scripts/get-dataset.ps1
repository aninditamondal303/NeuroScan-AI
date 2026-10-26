<#
.SYNOPSIS
  Puts the Kaggle "Brain Tumor MRI Dataset" (masoudnickparvar) into data\brain-tumor-mri-dataset.

.DESCRIPTION
  Two ways, pick one:
   1. Download the zip yourself in a browser from
      https://www.kaggle.com/datasets/masoudnickparvar/brain-tumor-mri-dataset
      and run:  scripts\get-dataset.ps1 -Zip "$HOME\Downloads\archive.zip"
   2. Use the Kaggle command-line tool with your own API token saved at
      %USERPROFILE%\.kaggle\kaggle.json (Kaggle > Settings > API > Create New Token).
      Never paste the token into chats or source files.

  The data folder is ignored by Git, so the images are never committed.
#>
[CmdletBinding()]
param(
    [string]$Zip,
    [string]$Dest
)
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not $Dest) { $Dest = $DefaultDataDir }

$found = Find-DatasetDir $Dest
if ($found) {
    Write-Ok "Dataset already present: $found"
} elseif ($Zip) {
    if (-not (Test-Path $Zip)) { throw "Zip file not found: $Zip" }
    Write-Step "Extracting $Zip"
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    Expand-Archive -Path $Zip -DestinationPath $Dest -Force
} else {
    Assert-Venv
    $tokenFile = Join-Path $env:USERPROFILE '.kaggle\kaggle.json'
    if (-not (Test-Path $tokenFile) -and -not ($env:KAGGLE_USERNAME -and $env:KAGGLE_KEY)) {
        Write-Note 'No Kaggle API token found, so the dataset cannot be downloaded automatically.'
        Write-Note 'Either download the zip in your browser and run:'
        Write-Note '  scripts\get-dataset.ps1 -Zip "$HOME\Downloads\archive.zip"'
        Write-Note "or save your Kaggle token to $tokenFile and run this script again."
        exit 1
    }
    Write-Step 'Installing the Kaggle command-line tool into .venv'
    Invoke-Checked $VenvPy @('-m', 'pip', 'install', '--quiet', 'kaggle')
    Write-Step 'Downloading masoudnickparvar/brain-tumor-mri-dataset'
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    $kaggle = Join-Path $Root '.venv\Scripts\kaggle.exe'
    Invoke-Checked $kaggle @('datasets', 'download', '-d', 'masoudnickparvar/brain-tumor-mri-dataset', '-p', $Dest, '--unzip')
}

$found = Find-DatasetDir $Dest
if (-not $found) {
    throw "Could not find Training\ and Testing\ folders under $Dest. Check the zip contents."
}

Write-Step 'Dataset contents'
foreach ($split in 'Training', 'Testing') {
    foreach ($cls in Get-ChildItem (Join-Path $found $split) -Directory | Sort-Object Name) {
        $n = (Get-ChildItem $cls.FullName -File | Where-Object { $_.Extension -match '^\.(jpe?g|png|webp)$' }).Count
        Write-Host ("   {0,-9} {1,-12} {2,6} images" -f $split, $cls.Name, $n)
    }
}
Write-Ok "Ready. Train with: scripts\train.ps1 -DataDir `"$found`""
