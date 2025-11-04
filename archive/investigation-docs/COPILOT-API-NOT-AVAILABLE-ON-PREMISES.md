# CopilotApi Not Available for On-Premises BC

**Date**: 2025-10-29
**Status**: ❌ Blocked - Cannot use CopilotApi on-premises
**Finding**: Microsoft's CopilotApi requires cloud AAD authentication

---

## Executive Summary

Microsoft's CopilotApi (port 7100) **exists in Business Central** but **requires Azure Active Directory (AAD) S2S authentication** that is only available in cloud/SaaS deployments. It **cannot be enabled** on on-premises or Docker container installations.

### Key Findings:

✓ **CopilotApi exists** - Code is present in `Microsoft.Dynamics.Nav.Service.CopilotApi`
✓ **Port 7100 configured** - `CopilotApiHostFactory.cs:22` defines port 7100
✓ **Configuration setting available** - `CopilotApiServicesEnabled` can be set
❌ **AAD authentication required** - Startup fails without cloud authentication
❌ **Not available on-premises** - Error: `S2S40011: At least one inbound policy should be provided`

---

## Investigation Timeline

### 1. Discovery (from decompiled code)

Found CopilotApi architecture in decompiled BC assemblies:
- **File**: `Microsoft.Dynamics.Nav.Server\NavServerWindowsService.cs:129`
- **Configuration**: `NavEnvironment.Topology.EnableCopilotApi`
- **Setting**: `ServerUserSettings.Instance.CopilotApiServicesEnabled`

### 2. Enabling the API

Successfully set the configuration:
```powershell
Set-NAVServerConfiguration -ServerInstance 'BC' -KeyName 'CopilotApiServicesEnabled' -KeyValue 'true'
```

**Result**: Setting accepted ✓

### 3. Service Restart - FAILED

Attempted to restart BC service to activate CopilotApi:
```powershell
Restart-NAVServerInstance -ServerInstance 'BC'
```

**Result**: Service failed to start ❌

### 4. Error Analysis

**Event Log Error**:
```
Server instance: BC
Type: Microsoft.IdentityModel.S2S.Configuration.ConfigurationException
Message: S2S40011: At least one inbound policy should be provided.

Source: Microsoft.IdentityModel.S2S.Configuration
StackTrace:
     at Microsoft.IdentityModel.S2S.Configuration.DefaultAuthenticationOptionsValidator.ValidateOptions(AadAuthenticationOptions authenticationOptions)
     at Microsoft.IdentityModel.S2S.Configuration.S2SAuthenticationManagerFactory.BuildS2SAuthenticationManager(AadAuthenticationOptions authenticationOptions)
     at Microsoft.Dynamics.Nav.Service.CopilotApi.Hosts.CopilotApiStartup.ConfigureServices(IServiceCollection services)
```

**Root Cause**: CopilotApi startup (`CopilotApiStartup.ConfigureServices`) requires AAD/S2S authentication configuration with "inbound policies".

---

## Technical Details

### Authentication Requirements

From the error stack trace, CopilotApi requires:

1. **Azure Active Directory (AAD)** authentication
2. **S2S (Service-to-Service)** authentication configuration
3. **Inbound policies** - AAD-based authentication policies
4. **Cloud identity infrastructure** - Not available on-premises

### CopilotApi Startup Code

**File**: `Microsoft.Dynamics.Nav.Service.CopilotApi/Service/CopilotApi/Hosts/CopilotApiStartup.cs`

The `ConfigureServices` method calls:
```csharp
S2SAuthenticationManagerFactory.BuildS2SAuthenticationManager(authenticationOptions)
```

This factory method validates that AAD `authenticationOptions` includes at least one "inbound policy", which is only available in cloud/SaaS environments.

### Topology Configuration

**File**: `Microsoft.Dynamics.Nav.Ncl\Microsoft\Dynamics\Nav\Runtime\StandardServiceTopology.cs:35`

```csharp
public bool EnableCopilotApi => ServerUserSettings.Instance.CopilotApiServicesEnabled.Value;
```

The topology allows the setting to be enabled, but the actual service startup requires cloud infrastructure.

---

## Why This Matters

### Original Problem

We discovered CopilotApi while investigating the **form caching issue**:
- WebSocket protocol returns the same form for multiple page requests
- Page 21, 22, 30 all return Page 21 data due to server-side form caching

### CopilotApi Would Have Solved It

The Agent API architecture from `MICROSOFT-AGENT-API-DISCOVERY.md` showed:
- **Direct page access by ID** - No form opening required
- **Stateless REST requests** - No session/caching issues
- **Structured metadata** - Clean JSON responses
- **Designed for programmatic access** - Perfect for AI agents

### But It's Not Available

The CopilotApi **only works in Microsoft's cloud environments**:
- Azure-hosted Business Central Online
- SaaS deployments with AAD identity
- NOT available for:
  - On-premises installations
  - Docker containers
  - Self-hosted BC servers

---

## Alternative Approaches

Since CopilotApi is not available, we need to solve the form caching issue using other methods:

### Option 1: Fix WebSocket Form Caching ✓ (Most Viable)

**Approach**: Discover the correct WebSocket protocol for multi-page access

**Method**: Capture real WebSocket traffic from BC web client (see `CAPTURE-WEBSOCKET-TRAFFIC.md`)

**Status**: User provided captured traffic showing:
- `OpenForm` only used in `OpenSession`
- `LoadForm` used to display forms
- `InvokeAction` for UI interactions
- No standalone `OpenForm` for page switching

**Next Step**: Analyze captured messages to understand correct protocol

### Option 2: Use OData V4 API (Partial Solution)

**Pros**:
- Available on-premises (port 7048)
- Direct entity access without forms
- Well-documented REST API

**Cons**:
- Only exposes published entities, NOT page metadata
- Cannot get form structure, controls, actions
- Limited to CRUD operations on data

**Verdict**: ❌ Doesn't solve our metadata access needs

### Option 3: Use SOAP Web Services (Partial Solution)

**Pros**:
- Available on-premises
- Can expose pages as web services
- Established protocol

**Cons**:
- Must manually publish each page
- SOAP overhead and complexity
- No dynamic page discovery

**Verdict**: ❌ Too limited and manual

### Option 4: Create Custom AL Extension (Advanced)

**Approach**: Build AL extension that exports page metadata via API

**Pros**:
- Full control over metadata format
- Can use OData or custom endpoint
- Designed for our specific needs

**Cons**:
- Requires AL development and deployment
- Must maintain custom extension
- More complex setup

**Verdict**: ⚠️ Possible but significant effort

---

## Conclusions

1. **CopilotApi exists but is cloud-only**
   - Architecture is sound and would solve our problems
   - Requires AAD/S2S authentication not available on-premises
   - Error: `S2S40011: At least one inbound policy should be provided`

2. **Must use different approach**
   - WebSocket protocol investigation remains most viable path
   - Need to understand correct form navigation pattern
   - User-provided captured traffic is key to solution

3. **Lesson learned**
   - Decompiled code showed CopilotApi architecture
   - But runtime requirements (AAD) not visible in code
   - Cloud vs on-premises capabilities differ significantly

---

## Files Referenced

- `Microsoft.Dynamics.Nav.Server\NavServerWindowsService.cs:129` - CopilotApi registration
- `Microsoft.Dynamics.Nav.Service.CopilotApi\Service\CopilotApi\Hosts\CopilotApiHostFactory.cs:22` - Port 7100 configuration
- `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\ServerUserSettings.cs:671` - Configuration setting
- `Microsoft.Dynamics.Nav.Ncl\Microsoft\Dynamics\Nav\Runtime\StandardServiceTopology.cs:35` - Topology configuration
- `Microsoft.Dynamics.Nav.Service.CopilotApi\Service\CopilotApi\Hosts\CopilotApiStartup.cs` - Startup requiring AAD

---

## Configuration Tested

```powershell
# Setting that was enabled (but failed to start)
Set-NAVServerConfiguration -ServerInstance 'BC' -KeyName 'CopilotApiServicesEnabled' -KeyValue 'true'

# Error on restart
Restart-NAVServerInstance -ServerInstance 'BC'
# Error: S2S40011: At least one inbound policy should be provided.

# Disabled to restore service
Set-NAVServerConfiguration -ServerInstance 'BC' -KeyName 'CopilotApiServicesEnabled' -KeyValue 'false'
Start-NAVServerInstance -ServerInstance 'BC'
# Success: Service running
```

---

## Next Steps

1. **Analyze captured WebSocket traffic** (from user)
   - Understand correct page navigation pattern
   - Identify form management interactions
   - Determine how BC web client avoids caching

2. **Implement correct WebSocket protocol**
   - Use findings from traffic analysis
   - Update `bc-session-connection.ts`
   - Test with Pages 21, 22, 30

3. **Verify solution**
   - Confirm no form caching
   - Each page returns correct metadata
   - All 8 tests pass

---

## Status

**CopilotApi Investigation**: ❌ CLOSED - Not available on-premises
**Current Focus**: ✓ WebSocket protocol analysis (captured traffic from user)
**Alternative Path**: Analyze real BC web client WebSocket messages
