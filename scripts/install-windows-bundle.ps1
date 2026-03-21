param(
  [string]$BundleSource = "",
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
}

function Install-OrgOpsBundle {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BundleSource,
    [string]$InstallDir = "$env:USERPROFILE\orgops"
  )

  $workDir = Join-Path $env:TEMP ("orgops-install-" + [Guid]::NewGuid().ToString("N"))
  $bundleArchive = Join-Path $workDir "orgops-bundle.zip"
  $extractDir = Join-Path $workDir "extract"

  try {
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

    Write-Host "Resolving bundle source: $BundleSource"
    if (Test-Path -LiteralPath $BundleSource) {
      Copy-Item -LiteralPath $BundleSource -Destination $bundleArchive -Force
    } elseif ($BundleSource -match "^https?://") {
      Invoke-WebRequest -Uri $BundleSource -OutFile $bundleArchive
    } else {
      throw "Invalid bundle source. Provide a local path or HTTP(S) URL."
    }

    Write-Host "Extracting bundle archive"
    Expand-Archive -Path $bundleArchive -DestinationPath $extractDir -Force

    $bundleRoot = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
    if (-not $bundleRoot) {
      throw "Bundle archive does not contain a valid top-level directory."
    }

    Write-Host "Installing OrgOps into $InstallDir"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Invoke-RobocopyMirror -Source $bundleRoot.FullName -Destination $InstallDir

    $envFile = Join-Path $InstallDir ".env"
    $envExampleFile = Join-Path $InstallDir ".env.example"
    if ((-not (Test-Path -LiteralPath $envFile)) -and (Test-Path -LiteralPath $envExampleFile)) {
      Copy-Item -LiteralPath $envExampleFile -Destination $envFile -Force
    }

    Write-Host "OrgOps installed (idempotent update applied; data directory preserved)."
    Write-Host "Start with: `"$InstallDir\start-orgops.cmd`""
    Write-Host "Note: DB migrations are applied automatically when the API starts."
  }
  finally {
    if (Test-Path -LiteralPath $workDir) {
      Remove-Item -Path $workDir -Recurse -Force
    }
  }
}

if ($BundleSource) {
  Install-OrgOpsBundle -BundleSource $BundleSource -InstallDir $InstallDir
}
