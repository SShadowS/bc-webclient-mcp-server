# Setting Up S2S Authentication for CopilotApi On-Premises

**Date**: 2025-10-29
**Question**: Can we set up S2S (Service-to-Service) authentication on-premises to enable CopilotApi?
**Answer**: ⚠️ Technically possible with Azure AD, but complex and may have limitations

---

## Executive Summary

After analyzing the decompiled BC code, the CopilotApi **CAN** potentially work on-premises IF you set up proper Azure Active Directory (AAD) authentication. The settings exist and can be configured - it's not entirely cloud-locked.

### Requirements:
✓ **Azure AD tenant** (free tier available)
✓ **AAD app registration** for your BC instance
✓ **Three BC configuration settings** properly configured
⚠️ **Complexity**: Non-trivial setup with potential limitations

---

## How CopilotApi Authentication Works

### Code Analysis: `CopilotApiStartup.cs`

**Lines 64-69**:
```csharp
S2SAuthenticationManager s2sAuthenticationManager =
    S2SAuthenticationManagerFactory.Default.BuildS2SAuthenticationManager(
        new AadAuthenticationOptions()
        {
            Instance = "https://login.microsoftonline.com/",
            ClientId = ServerUserSettings.Instance.InternalApiValidAudience.Value,
            TenantId = ServerUserSettings.Instance.InternalApiAuthAadTenantId.Value
        }
    );
```

**Line 61**:
```csharp
{
    "CopilotService",
    ServerUserSettings.Instance.CopilotServiceClientId.Value
}
```

### Required Configuration Settings

From `ServerUserSettings.cs`:

1. **`CopilotServiceClientId`** (line 2004-2005)
   - Azure AD App ID for the calling service (your webapp)
   - This identifies WHO is calling the CopilotApi

2. **`InternalApiValidAudience`** (line 2010-2011)
   - Azure AD App ID for BC itself
   - This is WHO the token is issued FOR

3. **`InternalApiAuthAadTenantId`** (line 2013-2014)
   - Your Azure AD Tenant ID
   - Identifies WHICH Azure AD tenant to trust

All three default to empty strings (`""`), which is why the S2S authentication fails.

---

## Setup Procedure (Azure AD Approach)

### Step 1: Create Azure AD Tenant

**Option A: Free Azure AD**
- Create a free Azure account at https://azure.microsoft.com/free/
- You get a default Azure AD tenant automatically
- No credit card required for basic AD features

**Option B: Microsoft 365 Developer Program**
- Sign up at https://developer.microsoft.com/microsoft-365/dev-program
- Get a free E5 developer tenant (90-day renewable)
- Includes full Azure AD features

### Step 2: Register BC as an App

1. Go to Azure Portal → Azure Active Directory → App Registrations
2. Click "New registration"
3. **Name**: "Business Central On-Premises"
4. **Supported account types**: "Accounts in this organizational directory only"
5. **Redirect URI**: Leave blank for now
6. Click "Register"
7. **Copy the Application (client) ID** - This is your `InternalApiValidAudience`
8. **Copy the Directory (tenant) ID** - This is your `InternalApiAuthAadTenantId`

### Step 3: Register Your Webapp as an App

1. Go to Azure Portal → Azure Active Directory → App Registrations
2. Click "New registration"
3. **Name**: "My BC Copilot Client"
4. **Supported account types**: "Accounts in this organizational directory only"
5. Click "Register"
6. **Copy the Application (client) ID** - This is your `CopilotServiceClientId`

### Step 4: Create Client Secret

For your webapp app (from Step 3):
1. Go to "Certificates & secrets"
2. Click "New client secret"
3. **Description**: "BC Copilot Access"
4. **Expires**: Choose duration
5. **Copy the secret VALUE** immediately - you won't see it again!

### Step 5: Configure API Permissions

For your webapp app:
1. Go to "API permissions"
2. Click "Add a permission"
3. Choose "My APIs" tab
4. Select "Business Central On-Premises" (your BC app from Step 2)
5. Add required permissions (you may need to expose an API scope first)

**For BC app (Step 2):**
1. Go to "Expose an API"
2. Click "Add a scope"
3. **Scope name**: `CopilotApi.Access`
4. **Who can consent**: Admins and users
5. **Description**: "Access BC Copilot API"
6. Save

**Return to webapp app:**
1. Add permission for `api://<BC-client-id>/CopilotApi.Access`
2. Click "Grant admin consent"

### Step 6: Configure BC Server

Use PowerShell to set the configuration:

```powershell
docker exec Cronus27 powershell "
Import-Module 'C:\\Program Files\\Microsoft Dynamics NAV\\270\\Service\\NavAdminTool.ps1';

# Set the three AAD configuration values
Set-NAVServerConfiguration -ServerInstance 'BC' `
    -KeyName 'InternalApiValidAudience' `
    -KeyValue '<BC-APPLICATION-CLIENT-ID-FROM-STEP-2>';

Set-NAVServerConfiguration -ServerInstance 'BC' `
    -KeyName 'InternalApiAuthAadTenantId' `
    -KeyValue '<TENANT-ID-FROM-STEP-2>';

Set-NAVServerConfiguration -ServerInstance 'BC' `
    -KeyName 'CopilotServiceClientId' `
    -KeyValue '<WEBAPP-CLIENT-ID-FROM-STEP-3>';

# Enable CopilotApi
Set-NAVServerConfiguration -ServerInstance 'BC' `
    -KeyName 'CopilotApiServicesEnabled' `
    -KeyValue 'true';

# Restart to apply
Restart-NAVServerInstance -ServerInstance 'BC';
"
```

### Step 7: Test CopilotApi Endpoint

```bash
# Should now be listening on port 7100
docker exec Cronus27 powershell "netstat -an | Select-String '7100'"

# Test endpoint (will require auth token)
curl http://Cronus27:7100/copilot/v2.0/health
```

### Step 8: Get Access Token from Your Webapp

**Node.js example using `@azure/identity`:**

```typescript
import { ClientSecretCredential } from '@azure/identity';

const credential = new ClientSecretCredential(
  '<TENANT-ID>',
  '<WEBAPP-CLIENT-ID>',  // From Step 3
  '<CLIENT-SECRET>'       // From Step 4
);

// Get token for BC
const token = await credential.getToken(
  `api://<BC-APPLICATION-CLIENT-ID>/CopilotApi.Access`
);

// Use token to call CopilotApi
const response = await fetch(
  'http://Cronus27:7100/copilot/v2.0/agents/<agent-id>?tenantId=default',
  {
    headers: {
      'Authorization': `Bearer ${token.token}`
    }
  }
);
```

---

## Potential Issues and Limitations

### Issue 1: Inbound Policy Requirements

The S2S library validates AAD tokens using Microsoft-specific features:
- Azure AD signing keys
- AAD token issuers (`https://sts.windows.net/...`)
- Specific claim structures

**Self-hosted identity providers (like IdentityServer, Keycloak) may not work** because they don't match AAD's token format.

### Issue 2: Network Connectivity

BC server needs to reach:
- `https://login.microsoftonline.com/` - For AAD metadata
- `https://graph.microsoft.com/` - Potentially for token validation

**If your BC container has no internet access**, this won't work.

### Issue 3: Agent Registration

Even with authentication working, you still need:
- Valid agent User ID (GUID)
- Valid task ID (long)

These are typically created by BC's built-in Copilot features or AL code. You may need to:
- Create AL extension to register agents
- Use BC UI to create agents (if available on-premises)
- Query existing agents if any are pre-created

### Issue 4: License Requirements

CopilotApi might check for specific licensing:
- Copilot features may require Business Central Online license
- On-premises licenses might not include Copilot entitlements
- Could result in runtime license errors even if auth works

### Issue 5: Complexity vs. Benefit

**Setup complexity**:
- Azure AD tenant setup
- App registrations (2 apps)
- Permission configuration
- Secret management
- Token acquisition in webapp
- Agent/task registration

**Compared to**:
- Fixing WebSocket form caching (simpler, already mostly understood)

---

## Alternative: Mock S2S Authentication (Advanced)

**Theoretical approach** (NOT RECOMMENDED unless you're very experienced):

1. Create a custom S2SAuthenticationManager
2. Implement minimal inbound policy validation
3. Bypass AAD validation for local development
4. Replace the authentication middleware in CopilotApiStartup

**Risks**:
- Requires modifying/replacing BC assemblies
- Security vulnerabilities
- May break with BC updates
- Unsupported configuration

**Code location to study**:
- `Microsoft.IdentityModel.S2S/S2S/S2SAuthenticationManager.cs`
- `Microsoft.IdentityModel.S2S/Configuration/S2SAuthenticationManagerFactory.cs`

---

## Recommendation

### For Production Use: ❌ Don't Use On-Premises CopilotApi

**Reasons**:
1. **Complexity**: AAD setup, app registrations, secrets, token management
2. **Dependencies**: Requires internet access to Azure AD
3. **Licensing**: May not be licensed for on-premises
4. **Maintenance**: Token expiry, secret rotation, app updates
5. **Uncertainty**: No official documentation for on-premises setup

### For Development/Learning: ⚠️ Possible but Complex

**If you want to experiment**:
1. Set up free Azure AD tenant
2. Follow the setup procedure above
3. Test if it works with your BC version
4. Document any additional issues encountered

### For Your Current Problem: ✓ Fix WebSocket Protocol

**Best path forward**:
1. Analyze the captured WebSocket traffic you provided
2. Understand how BC web client navigates between pages
3. Implement correct form management in our code
4. Much simpler, fully on-premises, no external dependencies

---

## Configuration Settings Reference

| Setting | Location | Purpose |
|---------|----------|---------|
| `CopilotApiServicesEnabled` | Line 671 | Enable/disable CopilotApi service |
| `CopilotServiceClientId` | Line 2004 | AAD Client ID of calling service |
| `InternalApiValidAudience` | Line 2010 | AAD Client ID of BC (token audience) |
| `InternalApiAuthAadTenantId` | Line 2013 | Azure AD Tenant ID |

All in: `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\ServerUserSettings.cs`

---

## Conclusion

**Yes, technically possible** to set up S2S authentication on-premises using Azure AD.

**But practically**:
- Complex setup (6+ steps)
- External dependencies (Azure AD, internet)
- Uncertain licensing
- Maintenance overhead
- No official documentation

**Better approach**: Fix the WebSocket form caching issue using the protocol we've already partially understood from captured traffic.

---

## If You Still Want to Try It

**Decision points**:

1. **Do you have/want an Azure AD tenant?**
   - Yes → Proceed with setup
   - No → Stick with WebSocket approach

2. **Is your BC server internet-connected?**
   - Yes → Can reach Azure AD endpoints
   - No → S2S authentication won't work

3. **Do you need this for production or experimentation?**
   - Production → Not recommended (unsupported)
   - Experimentation → Worth trying if you're curious

4. **Estimated time investment**:
   - Azure AD setup: 1-2 hours
   - BC configuration: 30 minutes
   - Troubleshooting: ???  (could be extensive)
   - **vs.**
   - WebSocket protocol analysis: 2-4 hours total

**My recommendation**: Focus on WebSocket protocol - it's the supported, documented way to access BC page metadata on-premises.
