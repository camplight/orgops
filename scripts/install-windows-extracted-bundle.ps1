param(
  [string]$SourceDir = "",
  [string]$InstallDir = "$env:USERPROFILE\orgops"
)

$ErrorActionPreference = "Stop"

function Invoke-RobocopyMirror {
  param(
    [string]$Source,
    [string]$Destination
  )

  $args = @(
    $Source,
    $Destination,
    "/MIR",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/NP",
    "/XD", ".orgops-data", "files",
    "/XF", ".env"
  )

  & robocopy @args | Out-Null
  $exitCode = $LASTEXITCODE
  if ($exitCode -gt 7) {
    throw "robocopy mirror failed with exit code $exitCode"
  }
  $global:LASTEXITCODE = 0
}

if (-not $SourceDir) {
  $SourceDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$resolvedSource = (Resolve-Path -LiteralPath $SourceDir).Path

Write-Host "Installing OrgOps from extracted bundle: $resolvedSource"
Write-Host "Target install dir: $InstallDir"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Invoke-RobocopyMirror -Source $resolvedSource -Destination $InstallDir

$envFile = Join-Path $InstallDir ".env"
$envExampleFile = Join-Path $InstallDir ".env.example"
if ((-not (Test-Path -LiteralPath $envFile)) -and (Test-Path -LiteralPath $envExampleFile)) {
  Copy-Item -LiteralPath $envExampleFile -Destination $envFile -Force
}

Write-Host "OrgOps installed (idempotent update applied; data directory preserved)."
Write-Host "Not started automatically."
Write-Host "Start manually with: `"$InstallDir\start-orgops.cmd`""
Write-Host "Note: DB migrations are applied automatically when the API starts."
