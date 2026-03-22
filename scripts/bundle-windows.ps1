param(
  [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"

function Invoke-Robocopy {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$DirectoryExcludes = @(),
    [string[]]$FileExcludes = @()
  )

  $args = @($Source, $Destination, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
  if ($DirectoryExcludes.Count -gt 0) {
    $args += "/XD"
    $args += $DirectoryExcludes
  }
  if ($FileExcludes.Count -gt 0) {
    $args += "/XF"
    $args += $FileExcludes
  }

  & robocopy @args | Out-Null
  $exitCode = $LASTEXITCODE
  if ($exitCode -gt 7) {
    throw "robocopy failed with exit code $exitCode"
  }
  $global:LASTEXITCODE = 0
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$OutputRoot = Join-Path $RepoRoot $OutputDir
$BundleRoot = Join-Path $OutputRoot "orgops-windows-bundle"
$ArchivePath = Join-Path $OutputRoot "orgops-windows-bundle.zip"
$RuntimeNodeRoot = Join-Path $BundleRoot "runtime\node"
$RuntimeGitRoot = Join-Path $BundleRoot "runtime\git"
$LaunchScriptPath = Join-Path $BundleRoot "start-orgops.cmd"
$PrereqScriptPath = Join-Path $BundleRoot "install-prereqs.ps1"
$PrereqCmdPath = Join-Path $BundleRoot "install-prereqs.cmd"
$InstallOrgOpsScriptPath = Join-Path $BundleRoot "install-orgops.ps1"
$InstallOrgOpsCmdPath = Join-Path $BundleRoot "install-orgops.cmd"

Write-Host "Preparing output directory at $OutputRoot"
if (Test-Path $OutputRoot) {
  Remove-Item -Path $OutputRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $OutputRoot | Out-Null

Write-Host "Copying repository files into staging bundle"
Invoke-Robocopy `
  -Source $RepoRoot `
  -Destination $BundleRoot `
  -DirectoryExcludes @(
    ".git",
    ".github",
    ".cursor",
    "node_modules",
    "dist",
    ".orgops-data",
    "files"
  )

Push-Location $BundleRoot
try {
  Write-Host "Installing workspace dependencies in bundle"
  npm ci

  Write-Host "Building UI assets"
  npm run build

  $NodeVersion = node -p "process.version"
  $NodeZip = "node-$NodeVersion-win-x64.zip"
  $NodeUrl = "https://nodejs.org/dist/$NodeVersion/$NodeZip"
  $NodeZipPath = Join-Path $env:TEMP $NodeZip
  $ExtractRoot = Join-Path $env:TEMP "orgops-node-extract"

  Write-Host "Downloading portable Node runtime from $NodeUrl"
  if (Test-Path $NodeZipPath) { Remove-Item $NodeZipPath -Force }
  Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZipPath

  if (Test-Path $ExtractRoot) {
    Remove-Item -Path $ExtractRoot -Recurse -Force
  }
  Expand-Archive -Path $NodeZipPath -DestinationPath $ExtractRoot -Force
  New-Item -ItemType Directory -Force -Path $RuntimeNodeRoot | Out-Null

  $ExtractedNodeDir = Get-ChildItem -Path $ExtractRoot | Select-Object -First 1
  Invoke-Robocopy -Source $ExtractedNodeDir.FullName -Destination $RuntimeNodeRoot

  $GitInstallPath = "C:\Program Files\Git"
  if (Test-Path $GitInstallPath) {
    Write-Host "Copying Git Bash runtime from $GitInstallPath"
    New-Item -ItemType Directory -Force -Path $RuntimeGitRoot | Out-Null
    Invoke-Robocopy -Source $GitInstallPath -Destination $RuntimeGitRoot
  } else {
    Write-Warning "Git for Windows was not found. Bundle will fall back to PowerShell."
  }

  $LaunchScript = @'
@echo off
setlocal
set "ROOT=%~dp0"
set "PATH=%ROOT%runtime\node;%PATH%"

if exist "%ROOT%runtime\git\bin\bash.exe" (
  set "ORGOPS_GIT_BASH_PATH=%ROOT%runtime\git\bin\bash.exe"
)

if not exist "%ROOT%.env" (
  if exist "%ROOT%.env.example" (
    copy "%ROOT%.env.example" "%ROOT%.env" >nul
  )
)

echo Starting OrgOps on Windows...
call "%ROOT%runtime\node\npm.cmd" run prod:all
'@
  Set-Content -Path $LaunchScriptPath -Value $LaunchScript -Encoding ASCII

  $PrereqScript = @'
param(
  [switch]$IncludePython = $false,
  [switch]$IncludeVCRedist = $true
)

$scriptPath = Join-Path $PSScriptRoot "scripts\install-windows-prereqs.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Cannot find prerequisite installer at $scriptPath"
}

& $scriptPath -IncludePython:$IncludePython -IncludeVCRedist:$IncludeVCRedist
'@
  Set-Content -Path $PrereqScriptPath -Value $PrereqScript -Encoding ASCII

  $PrereqCmd = @'
@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-prereqs.ps1"
'@
  Set-Content -Path $PrereqCmdPath -Value $PrereqCmd -Encoding ASCII

  $InstallOrgOpsScript = @'
param(
  [string]$InstallDir = "C:\orgops",
  [switch]$IncludePython = $false,
  [switch]$IncludeVCRedist = $true
)

$prereqScript = Join-Path $PSScriptRoot "install-prereqs.ps1"
$installScript = Join-Path $PSScriptRoot "scripts\install-windows-extracted-bundle.ps1"

if (-not (Test-Path -LiteralPath $prereqScript)) {
  throw "Cannot find prerequisite installer at $prereqScript"
}
if (-not (Test-Path -LiteralPath $installScript)) {
  throw "Cannot find bundle installer at $installScript"
}

& $prereqScript -IncludePython:$IncludePython -IncludeVCRedist:$IncludeVCRedist
& $installScript -SourceDir $PSScriptRoot -InstallDir $InstallDir
'@
  Set-Content -Path $InstallOrgOpsScriptPath -Value $InstallOrgOpsScript -Encoding ASCII

  $InstallOrgOpsCmd = @'
@echo off
setlocal
set "INSTALL_DIR=%~1"
if "%INSTALL_DIR%"=="" set "INSTALL_DIR=C:\orgops"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-orgops.ps1" -InstallDir "%INSTALL_DIR%"
'@
  Set-Content -Path $InstallOrgOpsCmdPath -Value $InstallOrgOpsCmd -Encoding ASCII
}
finally {
  Pop-Location
}

Write-Host "Creating zip archive at $ArchivePath"
Compress-Archive -Path $BundleRoot -DestinationPath $ArchivePath -CompressionLevel Optimal -Force

Write-Host "Bundle ready:"
Write-Host "  Folder: $BundleRoot"
Write-Host "  Zip:    $ArchivePath"
exit 0
