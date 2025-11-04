# CopilotApi On-Premises Workarounds - All Possible Options

**Date**: 2025-10-29
**Analysis Method**: GPT-5 Max Thinking Mode
**Confidence**: VERY HIGH

---

## Executive Summary

**YES, IT IS TECHNICALLY POSSIBLE** to make CopilotApi work on-premises through IL patching of the compiled DLL. The **most viable approach** is Option 1: Full IL Patching with 70-80% success likelihood.

### Quick Comparison

| Option | Success Rate | Effort | Complexity | Recommendation |
|--------|-------------|--------|------------|----------------|
| **Option 1: Full IL Patching** | 70-80% | 4-8h | Medium-High | ✅ **RECOMMENDED** |
| Option 2: Auth Bypass Only | 50-60% | 2-4h | Low-Medium | ⚠️ May need Option 1 anyway |
| Option 3: Mock S2S Manager | 30-40% | 20-40h | Very High | ❌ Not worth the effort |
| Option 4: Proxy/Custom API | 90% | 40-80h | High | ✅ Most robust, most work |

---

## The Root Problem (Quick Recap)

**Line 70 of CopilotApiStartup.cs**:
```csharp
TokenValidationParameters validationParameters =
    (s2sAuthenticationManager.AuthenticationHandlers.First<S2SAuthenticationHandler>()
        as JwtAuthenticationHandler)
    .InboundPolicies.First<JwtInboundPolicy>()
    .TokenValidationParameters;
```

- `.First()` throws `InvalidOperationException` when AAD doesn't provide inbound policies
- On-premises BC not registered in Microsoft's AAD backend
- HTTP.sys binds port before exception occurs
- Port 7100 listening but no application behind it

**Additional Problem**: Even if line 70 is bypassed, controllers require authentication:
- `PlatformSkillsController`: `[Authorize]` + `[AllowedRoles("CopilotService")]`
- `AgentsController`: `[Authorize]` + `[AllowedRoles("CopilotService")]`

---

## Option 1: Full IL Patching ✅ RECOMMENDED

### Overview

**Approach**: Use dnSpy to patch the compiled DLL and remove ALL authentication requirements.

**Success Likelihood**: 70-80%
**Estimated Effort**: 4-8 hours
**Complexity**: Medium-High
**Risk Level**: High (breaks signing, unsupported)

### What Gets Patched

1. **CopilotApiStartup.cs - ConfigureServices method (lines 48-87)**
   - Remove S2S authentication setup (lines 57-70)
   - Remove authentication middleware (lines 75-79)
   - Remove authorization middleware (lines 80-87)
   - Keep only routing and controller registration

2. **PlatformSkillsController.cs (line 39)**
   - Remove `[Authorize]` attribute from class declaration
   - Remove ALL `[AllowedRoles(new string[] {"CopilotService"})]` attributes from all methods

3. **AgentsController.cs (lines 31-32)**
   - Remove `[Authorize]` attribute from class declaration
   - Remove `[AllowedRoles(new string[] {"CopilotService"})]` attribute from class declaration

### Detailed Step-by-Step Instructions

#### Prerequisites

1. **Install dnSpy** (IL editor/debugger)
   - Download: https://github.com/dnSpy/dnSpy/releases
   - Extract to: `C:\Tools\dnSpy\`
   - No installation required (portable)

2. **Backup Original DLL**
   ```powershell
   docker exec Cronus27 powershell "
   Copy-Item 'C:\Program Files\Microsoft Dynamics NAV\270\Service\Microsoft.Dynamics.Nav.Service.CopilotApi.dll' `
            'C:\Backup\Microsoft.Dynamics.Nav.Service.CopilotApi.dll.ORIGINAL'
   "
   ```

#### Step 1: Extract DLL from Container

```powershell
# Copy DLL from container to host
docker cp Cronus27:"C:\Program Files\Microsoft Dynamics NAV\270\Service\Microsoft.Dynamics.Nav.Service.CopilotApi.dll" `
         C:\Temp\Microsoft.Dynamics.Nav.Service.CopilotApi.dll
```

#### Step 2: Open DLL in dnSpy

1. Launch dnSpy
2. File → Open → Select `C:\Temp\Microsoft.Dynamics.Nav.Service.CopilotApi.dll`
3. Wait for decompilation to complete

#### Step 3: Patch CopilotApiStartup.ConfigureServices

**Navigate to**:
```
Microsoft.Dynamics.Nav.Service.CopilotApi.dll
  └─ Microsoft.Dynamics.Nav.Service.CopilotApi.Hosts
      └─ CopilotApiStartup
          └─ ConfigureServices(IServiceCollection)
```

**Right-click method** → **Edit Method (C#)...**

**Replace entire method with**:
```csharp
public void ConfigureServices(IServiceCollection services)
{
    // Basic routing and controllers
    services.AddRouting();
    services.AddControllers();

    // API versioning
    services.AddApiVersioning((Action<ApiVersioningOptions>) (opt =>
    {
        opt.ReportApiVersions = true;
        opt.ApiVersionReader = (IApiVersionReader) new UrlSegmentApiVersionReader();
    }));

    // NO AUTHENTICATION - All authentication and authorization removed
    // This allows anonymous access to all CopilotApi endpoints
}
```

**Click "Compile"** → Should show "Compilation successful"

#### Step 4: Patch PlatformSkillsController

**Navigate to**:
```
Microsoft.Dynamics.Nav.Service.CopilotApi.dll
  └─ Microsoft.Dynamics.Nav.Service.CopilotApi.Controllers
      └─ PlatformSkillsController
```

**Right-click class** → **Edit Class (C#)...**

**Find line 39**:
```csharp
[ApiController]
[ApiVersion("1.0")]
[ApiVersion("2.0")]
[Route("v{version:apiVersion}/skills")]
[Authorize]  // ← REMOVE THIS LINE
public class PlatformSkillsController : Controller
```

**Remove `[Authorize]`**

**Then find and remove ALL instances of `[AllowedRoles(new string[] {"CopilotService"})]`** from every method in the class (appears on lines 49, 60, 86, 116, 153, 200, 259, 294, 335, 365, 399, 455, 488, 521, 545, 569).

**Alternatively**: Use Find & Replace:
- Find: `[AllowedRoles(new string[] {"CopilotService"})]`
- Replace: `// [AllowedRoles - REMOVED FOR ON-PREMISES]`

**Click "Compile"** → Should show "Compilation successful"

#### Step 5: Patch AgentsController

**Navigate to**:
```
Microsoft.Dynamics.Nav.Service.CopilotApi.dll
  └─ Microsoft.Dynamics.Nav.Service.CopilotApi.Controllers
      └─ AgentsController
```

**Right-click class** → **Edit Class (C#)...**

**Find lines 31-32**:
```csharp
[ApiController]
[ApiVersion("1.0")]
[ApiVersion("2.0")]
[Route("v{version:apiVersion}/agents")]
[Authorize]  // ← REMOVE THIS LINE
[AllowedRoles(new string[] {"CopilotService"})]  // ← REMOVE THIS LINE
[TypeFilter(typeof (ExceptionFilter))]
public class AgentsController : Controller
```

**Remove both `[Authorize]` and `[AllowedRoles(...)]` lines**

**Click "Compile"** → Should show "Compilation successful"

#### Step 6: Save Modified DLL

**File** → **Save Module...**
- Save as: `C:\Temp\Microsoft.Dynamics.Nav.Service.CopilotApi.PATCHED.dll`

**dnSpy will warn**: "Module contains references to other modules. These will not be saved."
- Click **OK** (this is normal)

**dnSpy will warn**: "The assembly is signed but the new file won't be signed"
- Click **OK** (we're intentionally breaking the signature)

#### Step 7: Disable Strong-Name Verification (Required)

Because we broke the assembly signature, BC might refuse to load it. Disable verification:

```powershell
docker exec Cronus27 powershell "
# Disable strong-name verification for this assembly
sn.exe -Vr 'Microsoft.Dynamics.Nav.Service.CopilotApi,31bf3856ad364e35'
"
```

#### Step 8: Replace DLL in BC Container

```powershell
# Stop BC service
docker exec Cronus27 powershell "Stop-Service 'MicrosoftDynamicsNavServer`$BC' -Force"

# Copy patched DLL into container
docker cp C:\Temp\Microsoft.Dynamics.Nav.Service.CopilotApi.PATCHED.dll `
         Cronus27:"C:\Program Files\Microsoft Dynamics NAV\270\Service\Microsoft.Dynamics.Nav.Service.CopilotApi.dll"

# Start BC service
docker exec Cronus27 powershell "Start-Service 'MicrosoftDynamicsNavServer`$BC'"
```

#### Step 9: Wait for Service to Start

```powershell
# Monitor BC service status
docker exec Cronus27 powershell "
Get-Service 'MicrosoftDynamicsNavServer`$BC' | Select-Object Status, Name
"
# Should show: Status: Running

# Wait 30 seconds for CopilotApi to initialize
Start-Sleep -Seconds 30

# Check port 7100 is listening
docker exec Cronus27 powershell "netstat -an | Select-String '7100'"
# Should show: TCP    0.0.0.0:7100    ...    LISTENING
```

#### Step 10: Test Endpoints WITHOUT Authentication

```bash
# Test environment information (no auth token)
curl -v http://Cronus27:7100/copilot/v2.0/skills/environmentInformation?tenantId=default

# Expected: HTTP 200 OK with JSON response
# Should NOT return 401 Unauthorized
```

```bash
# Test page metadata for Page 21 (Customer Card)
curl -v http://Cronus27:7100/copilot/v2.0/skills/pageMetadata/21?tenantId=default

# Expected: HTTP 200 OK with page metadata JSON
```

**If you get `Server: Microsoft-HTTPAPI/2.0` and 404**: The patching didn't work, see Troubleshooting below.

**If you get `Server: Kestrel` (or similar) and 200 OK**: ✅ SUCCESS!

### What Will Work After Patching

✅ **All PlatformSkillsController endpoints** (no authentication required):
```bash
# Environment information
GET /copilot/v2.0/skills/environmentInformation?tenantId=default

# Page metadata by ID
GET /copilot/v2.0/skills/pageMetadata/21?tenantId=default

# Page metadata search
GET /copilot/v2.0/skills/pageMetadata?tenantId=default&query=customer&query=sales

# Page URL
GET /copilot/v2.0/skills/pageMetadata/21/url?tenantId=default

# Page summary (data preview)
GET /copilot/v2.0/skills/pages/21/summary?tenantId=default&topRecords=5

# Search across BC
GET /copilot/v2.0/skills/search?tenantId=default&query=customer
```

⚠️ **Agent endpoints require `server-session-id` header** (need active BC session):
```bash
# These require an active BC WebSocket session ID
GET /copilot/v2.0/agents/{agentUserId}?tenantId=default
GET /copilot/v2.0/agents/{agentUserId}/tasks/{taskId}?tenantId=default
```

To get a `server-session-id`:
1. Connect via BC WebSocket protocol (existing code works)
2. Use the session's `ExternalId` as `server-session-id` header
3. Call agent endpoints with that header

### Risks and Limitations

#### Risks
1. **Strong-name signature broken** - Assembly is unsigned
2. **BC updates overwrite changes** - Must reapply after every BC update
3. **Completely unsupported** - No Microsoft support
4. **Security implications** - No authentication on CopilotApi
5. **Stability unknown** - May have unexpected side effects

#### Limitations
1. **Endpoints requiring `server-session-id`** - Need active BC session from WebSocket connection
2. **Cloud-dependent features** - Won't work (agent registration, etc.)
3. **Licensing-gated features** - May fail with license errors

### Troubleshooting

#### Problem: BC Service Won't Start

**Check event logs**:
```powershell
docker exec Cronus27 powershell "
Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='*Dynamics*'} -MaxEvents 10
"
```

**Common errors**:
- "Could not load file or assembly" → Strong-name verification still enabled
- "Method not found" → Compilation error in dnSpy, recheck patches

**Solution**:
1. Restore original DLL
2. Restart BC service
3. Review patches in dnSpy
4. Try again

#### Problem: Still Getting 404 with HTTP.sys

**Diagnosis**: Application still failing to start, HTTP.sys orphaned again

**Check**: Is it actually Kestrel responding?
```bash
curl -I http://Cronus27:7100/
# Look for "Server:" header
# If "Microsoft-HTTPAPI/2.0" → App not starting
# If "Kestrel" or no Server header → App started
```

**Solution**: Check dnSpy compilation:
1. Reopen patched DLL in dnSpy
2. Verify changes were saved
3. Look for compilation errors
4. Common issue: Missing semicolon, unclosed brace

#### Problem: Getting 500 Internal Server Error

**Diagnosis**: App started but runtime error

**Check logs**:
```powershell
docker exec Cronus27 powershell "
Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='*Dynamics*'} -MaxEvents 5 |
  Where-Object { $_.LevelDisplayName -eq 'Error' }
"
```

**Common causes**:
- Missing `server-session-id` header on endpoints that require it
- Invalid `tenantId` parameter
- BC tenant not initialized

### Rollback Procedure

If anything goes wrong:

```powershell
# Stop BC service
docker exec Cronus27 powershell "Stop-Service 'MicrosoftDynamicsNavServer`$BC' -Force"

# Restore original DLL
docker exec Cronus27 powershell "
Copy-Item 'C:\Backup\Microsoft.Dynamics.Nav.Service.CopilotApi.dll.ORIGINAL' `
         'C:\Program Files\Microsoft Dynamics NAV\270\Service\Microsoft.Dynamics.Nav.Service.CopilotApi.dll' -Force
"

# Re-enable strong-name verification
docker exec Cronus27 powershell "sn.exe -Vu 'Microsoft.Dynamics.Nav.Service.CopilotApi,31bf3856ad364e35'"

# Start BC service
docker exec Cronus27 powershell "Start-Service 'MicrosoftDynamicsNavServer`$BC'"
```

---

## Option 2: Authentication Bypass Only

### Overview

**Approach**: Patch only `ConfigureServices` to skip authentication, leave controllers unchanged.

**Success Likelihood**: 50-60%
**Estimated Effort**: 2-4 hours
**Complexity**: Low-Medium
**Risk Level**: Medium

### What Gets Patched

Only `CopilotApiStartup.cs - ConfigureServices` method.

Replace S2S auth with permissive anonymous auth:

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services.AddRouting();
    services.AddControllers();
    services.AddApiVersioning(...);

    // Anonymous authentication
    services.AddAuthentication("Anonymous")
        .AddScheme<AuthenticationSchemeOptions, AnonymousAuthenticationHandler>(
            "Anonymous", options => { });

    // Permissive authorization (always allow)
    services.AddAuthorization(options =>
    {
        options.DefaultPolicy = new AuthorizationPolicyBuilder()
            .RequireAssertion(context => true)  // Always returns true
            .Build();
    });
}
```

### Why Lower Success Rate?

Controllers still have `[AllowedRoles]` attributes. This custom authorization attribute may:
1. Check for specific role claims in the user principal
2. Fail because anonymous user has no claims
3. Return 403 Forbidden

**If this happens, you'll need to do Option 1 (full patching).**

### When to Use This

- Quick test to see if partial patching works
- Less invasive than full patching
- Can upgrade to Option 1 if it fails

---

## Option 3: Mock S2S Authentication Manager

### Overview

**Approach**: Create custom assembly with mock `S2SAuthenticationManager` that returns fake inbound policies.

**Success Likelihood**: 30-40%
**Estimated Effort**: 20-40 hours
**Complexity**: Very High
**Risk Level**: Extreme

### Why Not Recommended

1. **Still requires valid JWT tokens** - Controllers will validate tokens
2. **Azure AD signing keys needed** - Must match Microsoft's keys
3. **Complex implementation** - Deep understanding of S2S library required
4. **Assembly binding redirects** - May not work with BC's assembly loading
5. **More work than Option 1** - For worse results

### When to Consider

Never. If you're doing this much work, do Option 1 instead.

---

## Option 4: Build Custom Proxy/API ✅ MOST ROBUST

### Overview

**Approach**: Don't use BC's CopilotApi at all. Build your own API that calls BC's internal methods.

**Success Likelihood**: 90%+
**Estimated Effort**: 40-80 hours
**Complexity**: High
**Risk Level**: Low (no BC modifications)

### How It Works

1. **Create ASP.NET Core application** (separate from BC)
2. **Reference BC assemblies** (same DLLs BC uses)
3. **Call BC internal methods directly**:
   - `PageMetadataResponse.Create(session, pageId)`
   - `CopilotMetadataSearch.GetObjectsAccessibleToSession(...)`
   - `CopilotDataProvider.GetPageSummary(...)`
4. **Expose as REST API** on your own port (e.g., 8100)
5. **No authentication** or your own auth scheme

### Architecture

```
Your Webapp
    ↓ HTTP Request
Custom API (Port 8100)
    ↓ Reference BC DLLs
    ↓ Call BC internal methods
BC Server (Process boundary)
    ↓ Returns data
Custom API
    ↓ JSON Response
Your Webapp
```

### Advantages

✅ **No BC modifications** - Original DLLs untouched
✅ **Survives BC updates** - Independent application
✅ **Full control** - Your auth, your endpoints
✅ **Robust** - Fewer failure points
✅ **Supported by you** - You maintain it

### Disadvantages

❌ **Most work** - Build entire API from scratch
❌ **BC assembly references** - Version compatibility issues
❌ **Process boundary** - Can't directly access BC sessions (need RPC/WCF)
❌ **Maintenance** - Must update with BC versions

### When to Use

- **Production use** - Most reliable long-term solution
- **Clean architecture** - Keep BC unmodified
- **Multiple BC versions** - Can support different versions with different builds
- **Have development time** - 1-2 weeks of work

### Sample Code Structure

```csharp
// CustomCopilotApi/Controllers/MetadataController.cs
[ApiController]
[Route("api/[controller]")]
public class MetadataController : ControllerBase
{
    [HttpGet("page/{pageId}")]
    public async Task<IActionResult> GetPageMetadata(int pageId, string tenantId)
    {
        // Connect to BC tenant
        NavTenant tenant = NavEnvironment.Instance.Tenants.GetTenantById(tenantId);

        // Create system session
        using (NavSession session = CreateSystemSession(tenant))
        {
            // Call BC internal method (same as CopilotApi does)
            var metadata = PageMetadataResponse.Create(session, pageId);
            return Ok(metadata);
        }
    }
}
```

---

## Hybrid Approach: Staged Patching

If unsure about full patching:

### Stage 1: Patch ConfigureServices Only (2 hours)

1. Follow Option 2 steps
2. Test endpoints
3. If `[AllowedRoles]` blocks requests → Go to Stage 2

### Stage 2: Patch Controllers (2 more hours)

1. Follow Option 1 controller patching steps
2. Test again
3. Should now work

**Total effort**: 4 hours (same as Option 1, but staged)

---

## Final Recommendations

### For Quick Testing / POC
**Use: Option 1 (Full IL Patching)**
- 4-8 hours effort
- 70-80% success
- Can test CopilotApi functionality immediately

### For Production / Long-Term
**Use: Option 4 (Custom API)**
- 40-80 hours effort
- 90%+ success
- No BC modifications, survives updates
- Cleanest architecture

### Don't Use
- ❌ Option 2 alone (likely to fail, waste of time)
- ❌ Option 3 (too complex, low success rate)

---

## Success Criteria

After successful patching (Option 1), you should see:

✅ BC service starts successfully
✅ Port 7100 listening
✅ `curl -I http://Cronus27:7100/` returns `Server: Kestrel` (not HTTP.sys)
✅ Endpoints return 200 OK with JSON (not 401/403/404)
✅ Page metadata accessible without authentication tokens

---

## Support After Patching

**Microsoft Support**: ❌ None (modified assemblies)
**Community Support**: ⚠️ Limited (unsupported scenario)
**Your Support**: ✅ You own it

**Document everything**:
- Exact patches made
- dnSpy project files
- Rollback procedures
- Known issues

---

## Legal / License Considerations

⚠️ **This may violate your BC license agreement.**

- Modifying BC assemblies could breach terms
- Using CopilotApi in ways not intended by Microsoft
- Check your license before proceeding

**Safer alternatives**:
- Use BC APIs v2.0 (supported)
- Build AL extensions (supported)
- Use WebSocket protocol (documented)

---

## Conclusion

### Is It Possible?
**YES** - Option 1 (Full IL Patching) will work with 70-80% confidence.

### Should You Do It?
**Depends**:
- Quick POC / Testing → ✅ Go ahead (Option 1)
- Production use → ⚠️ Use Option 4 (Custom API) instead
- Compliance-sensitive → ❌ Use supported BC APIs

### How Long Will It Take?
- Option 1: **4-8 hours** (IL patching)
- Option 4: **40-80 hours** (custom API)
- Hybrid: **4 hours** (staged patching)

### What's the Risk?
- **Technical**: Medium-High (unsigned DLL, updates, stability)
- **Support**: High (no Microsoft support)
- **Legal**: Unknown (license compliance)
- **Security**: High (no authentication)

**Proceed with caution and keep backups!**
