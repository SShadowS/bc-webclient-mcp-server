# CopilotPatcher Deployment Package

This package enables Business Central's CopilotApi to run on-premises using:
- **Kestrel** web server (instead of cloud-only HTTP.sys)
- **API Key authentication** (instead of Azure S2S tokens)

## What's Included

```
deploy/
├── CopilotPatcher.dll         # Main patcher with Harmony patches
├── 0Harmony.dll                # Harmony runtime IL patching library
├── Deploy-CopilotPatcher.ps1  # Automated deployment script
└── README.md                   # This file
```

## Requirements

- Business Central Server (tested with BC 27)
- Windows container or server
- PowerShell with administrative privileges

## Quick Deployment

### Option 1: Automated Deployment (Recommended)

1. Copy the entire `deploy` folder to your container/server
2. Run PowerShell as Administrator
3. Execute the deployment script:

```powershell
cd path\to\deploy
.\Deploy-CopilotPatcher.ps1 -ApiKey "your-secret-key-here"
```

**Parameters:**
- `-ApiKey` (optional): Your API key. Default: `default-copilot-key-CHANGE-ME`
- `-ContainerName` (optional): Container name. Default: `BC`
- `-BCServicePath` (optional): BC service path. Default: `C:\Program Files\Microsoft Dynamics NAV\270\Service`

### Option 2: Manual Deployment

If you prefer manual deployment or need to customize:

```powershell
# 1. Create directory
$ServicePath = "C:\Program Files\Microsoft Dynamics NAV\270\Service"
$PatcherDir = "$ServicePath\CopilotPatcher"
New-Item -ItemType Directory -Path $PatcherDir -Force

# 2. Copy files
Copy-Item CopilotPatcher.dll $PatcherDir\
Copy-Item 0Harmony.dll $PatcherDir\

# 3. Set environment variables
[Environment]::SetEnvironmentVariable('DOTNET_STARTUP_HOOKS', "$PatcherDir\CopilotPatcher.dll", 'Machine')
[Environment]::SetEnvironmentVariable('BC_COPILOT_API_KEYS', 'your-secret-key-here', 'Machine')

# 4. Restart BC service
Restart-Service MicrosoftDynamicsNavServer*
```

## Verification

After deployment, verify the installation:

### 1. Check Service Status

```powershell
Get-Service MicrosoftDynamicsNavServer* | Select-Object Name, Status
```

Expected: `Status = Running`

### 2. Check Logs

```powershell
Get-Content "C:\Program Files\Microsoft Dynamics NAV\270\Service\CopilotPatcher.log" -Tail 20
```

Look for these success messages:
```
[CopilotPatcher] CopilotApi detected - startupType: Microsoft.Dynamics.Nav.Service.CopilotApi.Hosts.CopilotApiStartup
[CopilotPatcher] UseKestrel applied
[CopilotPatcher] Services configured successfully (S2S replaced with API key auth)
[CopilotPatcher] Added path base middleware for '/BC/copilot'
```

### 3. Test Endpoint

```powershell
$headers = @{ 'X-Copilot-ApiKey' = 'your-secret-key-here' }
$guid = [Guid]::NewGuid().ToString()
Invoke-WebRequest -Uri "http://localhost:7100/BC/copilot/v1.0/agents/$guid?tenantId=default" `
                  -Headers $headers -UseBasicParsing
```

Expected: HTTP 400 (Bad Request) - means authentication worked, endpoint exists

## Configuration

### API Keys

Set multiple API keys (semicolon-separated):

```powershell
[Environment]::SetEnvironmentVariable('BC_COPILOT_API_KEYS', 'key1;key2;key3', 'Machine')
```

Then restart the BC service.

### Server Instance

The patcher automatically detects the server instance from the `SERVERINSTANCE` environment variable. If not set, it defaults to `BC`.

To override:

```powershell
[Environment]::SetEnvironmentVariable('SERVERINSTANCE', 'YourInstanceName', 'Machine')
```

## API Endpoints

Base URL: `http://localhost:7100/BC/copilot/`

### Available Controllers

1. **AgentsController** - `v{version}/agents`
   - GET `/{agentUserId}` - Get agent details
   - POST `/` - Create agent
   - DELETE `/{agentUserId}` - Delete agent

2. **PlatformSkillsController** - `v{version}/platformSkills`
   - GET `/` - List platform skills
   - POST `/execute` - Execute skill

3. **AILanguageModelRequestStorageController** - `v{version}/aiLanguageModelRequestStorage`
   - POST `/` - Store AI request

### Supported API Versions

- v1.0
- v2.0
- v2.1
- v2.2
- v2.3

### Authentication

All endpoints require the `X-Copilot-ApiKey` header:

```http
GET /BC/copilot/v1.0/agents/{guid}?tenantId=default HTTP/1.1
Host: localhost:7100
X-Copilot-ApiKey: your-secret-key-here
```

## Troubleshooting

### Service Won't Start

1. Check Event Viewer for .NET errors:
   ```powershell
   Get-EventLog -LogName Application -Source ".NET Runtime" -Newest 10
   ```

2. Verify DLL paths:
   ```powershell
   Test-Path "C:\Program Files\Microsoft Dynamics NAV\270\Service\CopilotPatcher\CopilotPatcher.dll"
   Test-Path "C:\Program Files\Microsoft Dynamics NAV\270\Service\CopilotPatcher\0Harmony.dll"
   ```

3. Check environment variables:
   ```powershell
   [Environment]::GetEnvironmentVariable('DOTNET_STARTUP_HOOKS', 'Machine')
   [Environment]::GetEnvironmentVariable('BC_COPILOT_API_KEYS', 'Machine')
   ```

### 401 Unauthorized

- Verify API key matches: `[Environment]::GetEnvironmentVariable('BC_COPILOT_API_KEYS', 'Machine')`
- Check header name: Must be `X-Copilot-ApiKey` (case-insensitive)

### 404 Not Found

- Verify path includes `/BC/copilot/` prefix
- Check logs for "Added path base middleware" message
- Ensure service restarted after deployment

### Port Not Listening

```powershell
netstat -an | Select-String "7100"
```

Expected: `TCP 0.0.0.0:7100 LISTENING`

If not listening:
- Check BC server configuration (CustomSettings.config)
- Verify CopilotApi is enabled
- Review CopilotPatcher.log for errors

## Uninstallation

To remove CopilotPatcher:

```powershell
# 1. Stop service
Stop-Service MicrosoftDynamicsNavServer*

# 2. Remove environment variables
[Environment]::SetEnvironmentVariable('DOTNET_STARTUP_HOOKS', $null, 'Machine')
[Environment]::SetEnvironmentVariable('BC_COPILOT_API_KEYS', $null, 'Machine')

# 3. Delete files
Remove-Item "C:\Program Files\Microsoft Dynamics NAV\270\Service\CopilotPatcher" -Recurse -Force

# 4. Start service
Start-Service MicrosoftDynamicsNavServer*
```

## Technical Details

### How It Works

1. **DOTNET_STARTUP_HOOKS** environment variable loads CopilotPatcher.dll at .NET runtime startup
2. **Harmony library** patches BC methods at runtime using IL manipulation:
   - `AspNetCoreApiHost.ConfigureBuilder` - Switches HTTP.sys to Kestrel for CopilotApi only
   - `CopilotApiStartup.ConfigureServices` - Replaces S2S auth with API key handler
   - `CopilotApiStartup.Configure` - Adds path base middleware, skips cloud-only middleware

3. **Other APIs unaffected** - ClientApi, OData, SOAP continue using HTTP.sys with Windows auth

### Architecture

```
BC Service Startup
    ↓
DOTNET_STARTUP_HOOKS loads CopilotPatcher.dll
    ↓
Harmony patches apply to AspNetCoreApiHost & CopilotApiStartup
    ↓
CopilotApi uses Kestrel + API key auth
Other APIs use HTTP.sys + Windows auth (unchanged)
```

## Support

For issues or questions:
- Check logs: `C:\Program Files\Microsoft Dynamics NAV\270\Service\CopilotPatcher.log`
- Review BC event log: `Get-EventLog -LogName Application -Source "Dynamics *" -Newest 20`

## License

This is a proof-of-concept implementation for on-premises BC deployments.
Use at your own risk in production environments.

## Version

- CopilotPatcher: 1.0
- Target BC Version: 27.0
- Last Updated: 2025-10-29
