# Deploy-CopilotPatcher.ps1
# Deploys CopilotPatcher to Business Central container to enable Kestrel-based CopilotApi with API key authentication

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$ContainerName = "BC",

    [Parameter(Mandatory=$false)]
    [string]$ApiKey = "default-copilot-key-CHANGE-ME",

    [Parameter(Mandatory=$false)]
    [string]$BCServicePath = "C:\Program Files\Microsoft Dynamics NAV\270\Service"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "CopilotPatcher Deployment Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check if required files exist
$RequiredFiles = @(
    "CopilotPatcher.dll",
    "0Harmony.dll"
)

foreach ($file in $RequiredFiles) {
    $filePath = Join-Path $ScriptDir $file
    if (-not (Test-Path $filePath)) {
        Write-Error "Required file not found: $file"
        exit 1
    }
}

Write-Host "[1/7] Checking BC service..." -ForegroundColor Yellow
try {
    $service = Get-Service "MicrosoftDynamicsNavServer*" -ErrorAction Stop
    Write-Host "      Found service: $($service.Name)" -ForegroundColor Green
} catch {
    Write-Error "Business Central service not found. Is BC installed?"
    exit 1
}

Write-Host ""
Write-Host "[2/7] Stopping BC service..." -ForegroundColor Yellow
Stop-Service $service.Name -Force
Write-Host "      Service stopped" -ForegroundColor Green
Write-Host "      Waiting for file handles to release..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "[3/7] Creating CopilotPatcher directory..." -ForegroundColor Yellow
$TargetDir = Join-Path $BCServicePath "CopilotPatcher"
if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    Write-Host "      Created: $TargetDir" -ForegroundColor Green
} else {
    Write-Host "      Directory exists: $TargetDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "[4/7] Copying files..." -ForegroundColor Yellow
foreach ($file in $RequiredFiles) {
    $sourcePath = Join-Path $ScriptDir $file
    $targetPath = Join-Path $TargetDir $file

    # Try to delete old file if it exists
    if (Test-Path $targetPath) {
        try {
            Remove-Item $targetPath -Force -ErrorAction Stop
            Write-Host "      Removed old: $file" -ForegroundColor Gray
        } catch {
            Write-Warning "Could not remove old file: $file. Attempting force copy..."
        }
    }

    Copy-Item -Path $sourcePath -Destination $targetPath -Force
    Write-Host "      Copied: $file" -ForegroundColor Green
}

Write-Host ""
Write-Host "[5/7] Enabling CopilotApi..." -ForegroundColor Yellow
$configPath = Join-Path $BCServicePath "CustomSettings.config"
if (Test-Path $configPath) {
    [xml]$config = Get-Content $configPath
    $appSettings = $config.SelectSingleNode("//appSettings")

    # Check if CopilotApi is already enabled
    # IMPORTANT: BC expects "CopilotApiServicesEnabled" not "EnableCopilotApi"
    $enabledSetting = $appSettings.SelectSingleNode("add[@key='CopilotApiServicesEnabled']")
    $portSetting = $appSettings.SelectSingleNode("add[@key='CopilotApiPort']")

    $needsSave = $false

    # Also check for wrong key name and remove it
    $wrongKeySetting = $appSettings.SelectSingleNode("add[@key='EnableCopilotApi']")
    if ($null -ne $wrongKeySetting) {
        $appSettings.RemoveChild($wrongKeySetting) | Out-Null
        Write-Host "      Removed incorrect key 'EnableCopilotApi'" -ForegroundColor Yellow
        $needsSave = $true
    }

    if ($null -eq $enabledSetting) {
        $newSetting = $config.CreateElement("add")
        $newSetting.SetAttribute("key", "CopilotApiServicesEnabled")
        $newSetting.SetAttribute("value", "true")
        $appSettings.AppendChild($newSetting) | Out-Null
        Write-Host "      Added CopilotApiServicesEnabled=true" -ForegroundColor Green
        $needsSave = $true
    } elseif ($enabledSetting.value -ne "true") {
        $enabledSetting.value = "true"
        Write-Host "      Updated CopilotApiServicesEnabled=true" -ForegroundColor Green
        $needsSave = $true
    } else {
        Write-Host "      CopilotApi already enabled (CopilotApiServicesEnabled=true)" -ForegroundColor Green
    }

    if ($null -eq $portSetting) {
        $newSetting = $config.CreateElement("add")
        $newSetting.SetAttribute("key", "CopilotApiPort")
        $newSetting.SetAttribute("value", "7100")
        $appSettings.AppendChild($newSetting) | Out-Null
        Write-Host "      Added CopilotApiPort=7100" -ForegroundColor Green
        $needsSave = $true
    } else {
        Write-Host "      CopilotApiPort=$($portSetting.value)" -ForegroundColor Green
    }

    if ($needsSave) {
        $config.Save($configPath)
        Write-Host "      Configuration saved" -ForegroundColor Green
    }
} else {
    Write-Warning "CustomSettings.config not found at: $configPath"
    Write-Warning "CopilotApi may not start without manual configuration"
}

Write-Host ""
Write-Host "[6/7] Setting environment variables..." -ForegroundColor Yellow

# Set DOTNET_STARTUP_HOOKS
$hookPath = Join-Path $TargetDir "CopilotPatcher.dll"
[Environment]::SetEnvironmentVariable('DOTNET_STARTUP_HOOKS', $hookPath, 'Machine')
Write-Host "      DOTNET_STARTUP_HOOKS = $hookPath" -ForegroundColor Green

# Set BC_COPILOT_API_KEYS
[Environment]::SetEnvironmentVariable('BC_COPILOT_API_KEYS', $ApiKey, 'Machine')
Write-Host "      BC_COPILOT_API_KEYS = $ApiKey" -ForegroundColor Green

Write-Host ""
Write-Host "[7/7] Starting BC service..." -ForegroundColor Yellow
Start-Service $service.Name
Write-Host "      Service started" -ForegroundColor Green

# Wait for service to be running
Start-Sleep -Seconds 5
$service = Get-Service $service.Name
if ($service.Status -eq 'Running') {
    Write-Host "      Service is running" -ForegroundColor Green
} else {
    Write-Warning "Service status: $($service.Status)"
}

# Wait a bit more for CopilotApi to start
Write-Host "      Waiting for CopilotApi to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Check if CopilotApi port is listening
Write-Host "      Checking if CopilotApi is listening on port 7100..." -ForegroundColor Yellow
$listening = Get-NetTCPConnection -LocalPort 7100 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    Write-Host "      CopilotApi is listening on port 7100!" -ForegroundColor Green
} else {
    Write-Warning "CopilotApi port 7100 is NOT listening. Check logs:"
    Write-Warning "  $BCServicePath\CopilotPatcher.log"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "CopilotApi Configuration:" -ForegroundColor Cyan
Write-Host "  - Listening on: http://localhost:7100/BC/copilot/" -ForegroundColor White
Write-Host "  - Authentication: API Key (X-Copilot-ApiKey header)" -ForegroundColor White
Write-Host "  - API Key: $ApiKey" -ForegroundColor White
Write-Host "  - Config Key: CopilotApiServicesEnabled=true (in CustomSettings.config)" -ForegroundColor White
Write-Host ""
Write-Host "Test endpoint:" -ForegroundColor Cyan
Write-Host "  curl -H 'X-Copilot-ApiKey: $ApiKey' http://localhost:7100/BC/copilot/v2.0/agents/{guid}?tenantId=default" -ForegroundColor White
Write-Host ""
Write-Host "Available API Versions: 1.0, 2.0, 2.1, 2.2, 2.3" -ForegroundColor Cyan
Write-Host ""
Write-Host "Logs:" -ForegroundColor Cyan
Write-Host "  $BCServicePath\CopilotPatcher.log" -ForegroundColor White
Write-Host ""
Write-Host "NOTE: BC requires 'CopilotApiServicesEnabled' config key (not 'EnableCopilotApi')" -ForegroundColor Yellow
Write-Host ""
