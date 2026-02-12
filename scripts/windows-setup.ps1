#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Auto-install Windows Build Tools for AI Voice Bot (bankAI)

.DESCRIPTION
    Automatically installs Visual Studio Build Tools 2022 (with C++ workload)
    and CMake. Uses winget when available, falls back to direct download.

.EXAMPLE
    # Run as Administrator
    powershell -ExecutionPolicy Bypass -File scripts\windows-setup.ps1

    # Check only (no install)
    powershell -ExecutionPolicy Bypass -File scripts\windows-setup.ps1 -CheckOnly

    # Skip confirmation prompts
    powershell -ExecutionPolicy Bypass -File scripts\windows-setup.ps1 -Force
#>

param(
    [switch]$CheckOnly,
    [switch]$Force,
    [switch]$JsonOutput
)

$ErrorActionPreference = "Stop"

# --- Helpers ---

function Write-Status {
    param([string]$Message, [string]$Type = "info")
    if ($JsonOutput) {
        $obj = @{ event = "status"; message = $Message; type = $Type; timestamp = (Get-Date -Format o) }
        Write-Output ($obj | ConvertTo-Json -Compress)
    } else {
        switch ($Type) {
            "success" { Write-Host "  ✅ $Message" -ForegroundColor Green }
            "warning" { Write-Host "  ⚠️  $Message" -ForegroundColor Yellow }
            "error"   { Write-Host "  ❌ $Message" -ForegroundColor Red }
            "info"    { Write-Host "  ℹ️  $Message" -ForegroundColor Cyan }
            "step"    { Write-Host "`n🔧 $Message" -ForegroundColor White }
        }
    }
}

function Write-Banner {
    if (-not $JsonOutput) {
        Write-Host ""
        Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
        Write-Host "  ║   AI Voice Bot — Windows Build Tools Installer  ║" -ForegroundColor Cyan
        Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
        Write-Host ""
    }
}

function Test-CommandExists {
    param([string]$Command)
    try {
        $null = Get-Command $Command -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Test-WingetAvailable {
    return (Test-CommandExists "winget")
}

function Test-VSBuildTools {
    # Check for cl.exe (MSVC compiler)
    $vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vsWhere) {
        $installPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($installPath) {
            return @{
                Installed = $true
                Path = $installPath
                Version = (& $vsWhere -latest -products * -property installationVersion 2>$null)
            }
        }
    }

    # Fallback: search for cl.exe in known paths
    $clPaths = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe"
    )
    foreach ($pattern in $clPaths) {
        $found = Get-Item $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            return @{ Installed = $true; Path = $found.DirectoryName; Version = "detected" }
        }
    }

    return @{ Installed = $false }
}

function Test-CMakeInstalled {
    try {
        $ver = cmake --version 2>$null | Select-Object -First 1
        if ($ver -match "cmake version (.+)") {
            return @{ Installed = $true; Version = $Matches[1] }
        }
    } catch {}
    return @{ Installed = $false }
}

function Test-GitInstalled {
    try {
        $ver = git --version 2>$null
        if ($ver -match "git version (.+)") {
            return @{ Installed = $true; Version = $Matches[1] }
        }
    } catch {}
    return @{ Installed = $false }
}

# --- Check Phase ---

function Invoke-CheckAll {
    $results = @{
        vsBuildTools = Test-VSBuildTools
        cmake = Test-CMakeInstalled
        git = Test-GitInstalled
        winget = Test-WingetAvailable
        allReady = $false
    }
    $results.allReady = $results.vsBuildTools.Installed -and $results.cmake.Installed -and $results.git.Installed
    return $results
}

# --- Install Phase ---

function Install-VSBuildTools {
    Write-Status "Installing Visual Studio Build Tools 2022..." -Type "step"

    $useWinget = Test-WingetAvailable

    if ($useWinget) {
        Write-Status "Using winget..." -Type "info"
        try {
            winget install Microsoft.VisualStudio.2022.BuildTools `
                --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" `
                --accept-package-agreements --accept-source-agreements

            if ($LASTEXITCODE -eq 0) {
                Write-Status "VS Build Tools installed via winget" -Type "success"
                return $true
            }
        } catch {
            Write-Status "winget failed, falling back to direct download..." -Type "warning"
        }
    }

    # Fallback: direct download
    Write-Status "Downloading VS Build Tools installer..." -Type "info"
    $installerUrl = "https://aka.ms/vs/17/release/vs_buildtools.exe"
    $installerPath = "$env:TEMP\vs_buildtools.exe"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

        Write-Status "Running silent installer (this may take 5-15 minutes)..." -Type "info"
        $proc = Start-Process -FilePath $installerPath -ArgumentList @(
            "--quiet", "--wait", "--norestart",
            "--add", "Microsoft.VisualStudio.Workload.VCTools",
            "--includeRecommended"
        ) -Wait -PassThru

        if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
            Write-Status "VS Build Tools installed successfully" -Type "success"
            if ($proc.ExitCode -eq 3010) {
                Write-Status "A reboot is recommended to complete the installation" -Type "warning"
            }
            return $true
        } else {
            Write-Status "Installer exited with code $($proc.ExitCode)" -Type "error"
            return $false
        }
    } catch {
        Write-Status "Download/install failed: $_" -Type "error"
        return $false
    } finally {
        Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
    }
}

function Install-CMake {
    Write-Status "Installing CMake..." -Type "step"

    $useWinget = Test-WingetAvailable

    if ($useWinget) {
        Write-Status "Using winget..." -Type "info"
        try {
            winget install Kitware.CMake `
                --override "ADD_CMAKE_TO_PATH=System" `
                --accept-package-agreements --accept-source-agreements

            if ($LASTEXITCODE -eq 0) {
                Write-Status "CMake installed via winget" -Type "success"
                return $true
            }
        } catch {
            Write-Status "winget failed, falling back to direct download..." -Type "warning"
        }
    }

    # Fallback: direct download
    Write-Status "Downloading CMake installer..." -Type "info"
    $cmakeVersion = "3.31.4"
    $installerUrl = "https://github.com/Kitware/CMake/releases/download/v$cmakeVersion/cmake-$cmakeVersion-windows-x86_64.msi"
    $installerPath = "$env:TEMP\cmake-installer.msi"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

        Write-Status "Running installer..." -Type "info"
        $proc = Start-Process msiexec.exe -ArgumentList @(
            "/i", $installerPath,
            "/quiet", "/norestart",
            "ADD_CMAKE_TO_PATH=System"
        ) -Wait -PassThru

        if ($proc.ExitCode -eq 0) {
            Write-Status "CMake $cmakeVersion installed successfully" -Type "success"
            return $true
        } else {
            Write-Status "MSI installer exited with code $($proc.ExitCode)" -Type "error"
            return $false
        }
    } catch {
        Write-Status "Download/install failed: $_" -Type "error"
        return $false
    } finally {
        Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
    }
}

function Install-Git {
    Write-Status "Installing Git..." -Type "step"

    $useWinget = Test-WingetAvailable

    if ($useWinget) {
        Write-Status "Using winget..." -Type "info"
        try {
            winget install Git.Git --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -eq 0) {
                Write-Status "Git installed via winget" -Type "success"
                return $true
            }
        } catch {
            Write-Status "winget failed, falling back to direct download..." -Type "warning"
        }
    }

    # Fallback: direct download
    Write-Status "Downloading Git installer..." -Type "info"
    $gitVersion = "2.47.1"
    $installerUrl = "https://github.com/git-for-windows/git/releases/download/v$gitVersion.windows.1/Git-$gitVersion-64-bit.exe"
    $installerPath = "$env:TEMP\git-installer.exe"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

        Write-Status "Running installer..." -Type "info"
        $proc = Start-Process -FilePath $installerPath -ArgumentList "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS=`"icons,ext\reg\shellhere,assoc,assoc_sh`"" -Wait -PassThru

        if ($proc.ExitCode -eq 0) {
            Write-Status "Git $gitVersion installed successfully" -Type "success"
            return $true
        } else {
            Write-Status "Installer exited with code $($proc.ExitCode)" -Type "error"
            return $false
        }
    } catch {
        Write-Status "Download/install failed: $_" -Type "error"
        return $false
    } finally {
        Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
    }
}

# --- Main ---

Write-Banner

# Phase 1: Check
Write-Status "Checking installed tools..." -Type "step"
$check = Invoke-CheckAll

if ($check.vsBuildTools.Installed) {
    Write-Status "VS Build Tools: Installed (v$($check.vsBuildTools.Version))" -Type "success"
} else {
    Write-Status "VS Build Tools: NOT FOUND" -Type "warning"
}

if ($check.cmake.Installed) {
    Write-Status "CMake: Installed (v$($check.cmake.Version))" -Type "success"
} else {
    Write-Status "CMake: NOT FOUND" -Type "warning"
}

if ($check.git.Installed) {
    Write-Status "Git: Installed (v$($check.git.Version))" -Type "success"
} else {
    Write-Status "Git: NOT FOUND" -Type "warning"
}

if ($check.winget) {
    Write-Status "winget: Available (fast install)" -Type "success"
} else {
    Write-Status "winget: Not available (will use direct download)" -Type "info"
}

# JSON output mode
if ($JsonOutput) {
    Write-Output ($check | ConvertTo-Json -Depth 3 -Compress)
    if ($CheckOnly) { exit 0 }
}

# Check only mode
if ($CheckOnly) {
    if ($check.allReady) {
        Write-Host "`n  🎉 All build tools are ready!" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "`n  ⚠️  Some tools are missing. Run without -CheckOnly to install." -ForegroundColor Yellow
        exit 1
    }
}

# Already all installed
if ($check.allReady) {
    Write-Status "All tools already installed — nothing to do!" -Type "success"
    exit 0
}

# Phase 2: Confirm
if (-not $Force -and -not $JsonOutput) {
    Write-Host ""
    $missing = @()
    if (-not $check.vsBuildTools.Installed) { $missing += "VS Build Tools 2022 (~3-7 GB)" }
    if (-not $check.cmake.Installed) { $missing += "CMake (~100 MB)" }
    if (-not $check.git.Installed) { $missing += "Git (~300 MB)" }

    Write-Host "  The following tools will be installed:" -ForegroundColor White
    foreach ($m in $missing) {
        Write-Host "    • $m" -ForegroundColor Yellow
    }
    Write-Host ""

    $confirm = Read-Host "  Proceed? (Y/n)"
    if ($confirm -and $confirm -ne "Y" -and $confirm -ne "y") {
        Write-Host "  Cancelled." -ForegroundColor Gray
        exit 0
    }
}

# Phase 3: Install missing
$success = $true

if (-not $check.vsBuildTools.Installed) {
    if (-not (Install-VSBuildTools)) { $success = $false }
}

if (-not $check.cmake.Installed) {
    if (-not (Install-CMake)) { $success = $false }
}

if (-not $check.git.Installed) {
    if (-not (Install-Git)) { $success = $false }
}

# Phase 4: Verify
Write-Status "Verifying installation..." -Type "step"
$final = Invoke-CheckAll

if ($final.allReady) {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "  ║   ✅ All build tools installed successfully!    ║" -ForegroundColor Green
    Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host "    1. Open a NEW terminal (to pick up PATH changes)" -ForegroundColor Gray
    Write-Host "    2. cd bankAI" -ForegroundColor Gray
    Write-Host "    3. npm install" -ForegroundColor Gray
    Write-Host "    4. npx nodejs-whisper download" -ForegroundColor Gray
    Write-Host ""
    exit 0
} else {
    Write-Host ""
    Write-Host "  ⚠️  Some tools may need a terminal restart to be detected." -ForegroundColor Yellow
    Write-Host "  Please close and reopen your terminal, then run:" -ForegroundColor Yellow
    Write-Host "    powershell -File scripts\windows-setup.ps1 -CheckOnly" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}
