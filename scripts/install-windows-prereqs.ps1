param(
  [switch]$IncludePython = $false,
  [switch]$IncludeVCRedist = $true
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message"
}

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-Winget {
  if (-not (Test-Command -Name "winget")) {
    throw "winget is not available on this host. Install App Installer from Microsoft Store or install prerequisites manually."
  }
}

function Install-WithWinget {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [Parameter(Mandatory = $true)][string]$DisplayName
  )

  Write-Step "Installing $DisplayName via winget ($Id)"
  & winget install --id $Id --exact --silent --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "winget failed installing $DisplayName (exit code $LASTEXITCODE)"
  }
}

function Install-VCRedistFallback {
  $url = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
  $exe = Join-Path $env:TEMP "vc_redist.x64.exe"
  Write-Step "Downloading VC++ Redistributable fallback installer"
  Invoke-WebRequest -Uri $url -OutFile $exe
  Write-Step "Running VC++ Redistributable fallback installer"
  & $exe /install /quiet /norestart
  if ($LASTEXITCODE -ne 0) {
    throw "VC++ Redistributable fallback install failed (exit code $LASTEXITCODE)"
  }
}

function Install-GitFallback {
  $url = "https://github.com/git-for-windows/git/releases/latest/download/Git-64-bit.exe"
  $exe = Join-Path $env:TEMP "Git-64-bit.exe"
  Write-Step "Downloading Git for Windows fallback installer"
  Invoke-WebRequest -Uri $url -OutFile $exe
  Write-Step "Running Git for Windows fallback installer"
  & $exe /VERYSILENT /NORESTART /NOCANCEL /SP-
  if ($LASTEXITCODE -ne 0) {
    throw "Git fallback install failed (exit code $LASTEXITCODE)"
  }
}

function Install-NodeFallback {
  $url = "https://nodejs.org/dist/latest-v22.x/node-v22.21.1-x64.msi"
  $msi = Join-Path $env:TEMP "node-v22-x64.msi"
  Write-Step "Downloading Node.js fallback installer"
  Invoke-WebRequest -Uri $url -OutFile $msi
  Write-Step "Running Node.js fallback installer"
  & msiexec.exe /i $msi /qn /norestart
  if ($LASTEXITCODE -ne 0) {
    throw "Node fallback install failed (exit code $LASTEXITCODE)"
  }
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Ensure-NodeAndNpm {
  if ((Test-Command -Name "node") -and (Test-Command -Name "npm")) {
    Write-Step "Node.js + npm already present"
    return
  }

  try {
    Ensure-Winget
    Install-WithWinget -Id "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS"
  } catch {
    Write-Warning $_
    Install-NodeFallback
  }

  Refresh-Path
  if (-not ((Test-Command -Name "node") -and (Test-Command -Name "npm"))) {
    throw "Node.js/npm still unavailable after installation."
  }
}

function Ensure-GitBash {
  if (Test-Path -LiteralPath "C:\Program Files\Git\bin\bash.exe") {
    Write-Step "Git Bash already present"
    return
  }

  try {
    Ensure-Winget
    Install-WithWinget -Id "Git.Git" -DisplayName "Git for Windows"
  } catch {
    Write-Warning $_
    Install-GitFallback
  }

  if (-not (Test-Path -LiteralPath "C:\Program Files\Git\bin\bash.exe")) {
    throw "Git Bash still unavailable after installation."
  }
}

function Ensure-VCRedist {
  if (-not $IncludeVCRedist) {
    Write-Step "Skipping VC++ Redistributable (IncludeVCRedist disabled)"
    return
  }

  try {
    Ensure-Winget
    Install-WithWinget -Id "Microsoft.VCRedist.2015+.x64" -DisplayName "Microsoft VC++ Redistributable x64"
  } catch {
    Write-Warning $_
    Install-VCRedistFallback
  }
}

function Ensure-Python {
  if (-not $IncludePython) {
    return
  }

  if (Test-Command -Name "python") {
    Write-Step "Python already present"
    return
  }

  try {
    Ensure-Winget
    Install-WithWinget -Id "Python.Python.3.11" -DisplayName "Python 3.11"
  } catch {
    Write-Warning "Python install failed via winget; skipping fallback for now."
  }
}

Write-Step "Installing Windows prerequisites for OrgOps"
Ensure-VCRedist
Ensure-NodeAndNpm
Ensure-GitBash
Ensure-Python

Write-Step "Done. Detected versions:"
node --version
npm --version
if (Test-Path -LiteralPath "C:\Program Files\Git\bin\bash.exe") {
  & "C:\Program Files\Git\bin\bash.exe" --version
}
if (Test-Command -Name "python") {
  python --version
}
