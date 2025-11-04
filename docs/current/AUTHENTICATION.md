# Business Central Authentication Methods

Based on analysis of decompiled BC code (v26.0), here are the supported authentication methods for the WebSocket endpoint.

## Supported Authentication Types

From `NavClientCredentialType.cs:10-20`:

```csharp
public enum NavClientCredentialType
{
  None = -1,
  Windows = 0,
  UserName = 1,
  NavUserPassword = 2,        // ✓ Preferred for PoC
  AccessControlService = 3,
  ExchangeIdentity = 4,
  TaskScheduler = 5,
  Impersonate = 6,
}
```

## NavUserPassword Authentication (Recommended for PoC)

**Status**: ✅ **Fully Supported**

### How It Works

1. **Server Configuration**: BC server must be configured with `ClientServicesCredentialType = NavUserPassword`

2. **HTTP Basic Authentication**: Uses standard HTTP Basic Auth
   - Authorization header: `Basic <base64-encoded-credentials>`
   - Credentials format: `username:password` (Base64-encoded)

3. **WebSocket Upgrade**: Authentication happens during HTTP upgrade request before WebSocket is established

### Implementation Details

#### Source Files
- `ClientServiceAuthenticationHandler.cs:39-45` - Authentication handler for WebSocket endpoint
- `WebServiceBasicAuthenticator.cs:21-158` - Basic auth implementation
- `NavUserPasswordValidator.cs:17-43` - Password validation logic
- `WebServiceCredentialsHelper.cs:26-32` - Authentication provider registration

#### Authentication Flow

**Step 1: HTTP WebSocket Upgrade Request**
```
GET /ws/connect HTTP/1.1
Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=
Upgrade: websocket
Connection: Upgrade
```

**Step 2: Server Validates Credentials**

From `ClientServiceAuthenticationHandler.cs:39-45`:
```csharp
case NavClientCredentialType.NavUserPassword:
    StringValues source;
    if (!this.Context.Request.Headers.TryGetValue("Authorization", out source))
        return Task.FromResult<AuthenticateResult>(AuthenticateResult.Fail("..."));

    this.Context.User = new GenericPrincipal(
        new GenericIdentity(GetUsernameAndPasswordFromAuthorizeHeader(...).Item1),
        Array.Empty<string>());

    return Task.FromResult<AuthenticateResult>(AuthenticateResult.Success(...));
```

**Step 3: Password Validation**

From `WebServiceBasicAuthenticator.cs:63-67`:
```csharp
NavUserNameBasicAuthenticationToken token =
    new NavUserNameBasicAuthenticationToken(
        userName.ToUpper(CultureInfo.CurrentUICulture),
        password);

authenticationAsync = await navTenant.AuthenticationCache.GetNavUserAuthenticationAsync(
    token, navAppId, navTenant.Diagnostics, authenticationFunc,
    authenticationType: NavClientCredentialType.NavUserPassword);
```

**Step 4: WebSocket Connection Established**

If authentication succeeds, the HTTP connection upgrades to WebSocket and JSON-RPC communication begins.

### Username Format

#### Single Tenant
```
username
```

#### Multi-Tenant
```
TenantId\username
```

From `NavTenantHelper.cs` (ExtractTenantIdFromUserName):
- Split username at `\` character
- Before `\`: Tenant ID
- After `\`: Username

### Security Features

**Rate Limiting** (`NavUserPasswordValidator.cs:34-35`):
```csharp
if (4 < validationAttempts.AddOrUpdate(...))
    Thread.Sleep(30000);  // 30-second delay after 4 failures
```

**Authentication Caching**:
- Validated credentials are cached in `tenant.AuthenticationCache`
- Reduces database lookups for subsequent requests
- Cache key is based on username + token

**Encoding** (`WebServiceBasicAuthenticator.cs:98-99`):
- Uses ISO-8859-1 encoding (code page 28591) for Basic Auth
- Standard HTTP Basic Auth base64 encoding

### BC Server Configuration

The server must have these settings:

**CustomSettings.config** (or equivalent):
```xml
<add key="ClientServicesCredentialType" value="NavUserPassword"/>
```

Optional (for OAuth/Federation support):
```xml
<add key="AppIdUri" value="..."/>
<add key="WSFederationMetadataLocation" value="..."/>
<add key="TokenAuthorityEndpoint" value="..."/>
```

## Other Authentication Methods

### Windows Authentication (NavClientCredentialType.Windows)

**Status**: ✅ Supported (for Windows environments)

From `ClientServiceAuthenticationHandler.cs:36-38`:
```csharp
case NavClientCredentialType.Windows:
    return Context.User is WindowsPrincipal &&
           Identity.IsAuthenticated ? Success : Fail;
```

**Use Case**: On-premises BC with Windows AD integration
**Limitation**: Requires Windows environment, not suitable for web/cross-platform

### AccessControlService (NavClientCredentialType.AccessControlService)

**Status**: ✅ Supported (OAuth/Federation)

Enables:
- Bearer token authentication (`WebServiceBearerAuthenticator`)
- MS-Auth ATPOP authentication (`WebServiceMSAuthATPOPAuthenticator`)

From `WebServiceCredentialsHelper.cs:34-50`:
- Requires `AppIdUri` and `WSFederationMetadataLocation` configuration
- Supports standard OAuth 2.0 Bearer tokens

**Use Case**: BC Online with Azure AD integration

### UserName (NavClientCredentialType.UserName)

**Status**: ⚠️ Unclear from decompiled code
- May be legacy/deprecated
- Similar handling to Windows auth in ClientServiceAuthenticationHandler

## Authentication for Web Client vs WebSocket

### Web Client Authentication
- Uses cookies + session state
- `UserPasswordAuthenticationProvider.cs` in web app
- Different from WebSocket endpoint

### WebSocket Endpoint Authentication
- **No cookies** - stateless per connection
- **HTTP headers only** during WebSocket upgrade
- Once WebSocket is established, auth context is maintained for that connection

## Implementation for PoC

### Recommended: NavUserPassword

**Pros**:
- ✅ Simple username/password
- ✅ No Azure AD setup required
- ✅ Works on-premises and online
- ✅ Standard HTTP Basic Auth
- ✅ Easy to test

**Cons**:
- ⚠️ Requires HTTPS in production (credentials in header)
- ⚠️ No modern OAuth flows
- ⚠️ May not be enabled in all BC environments

### Implementation Code

```typescript
import WebSocket from 'ws';

function createBasicAuthHeader(username: string, password: string): string {
  const credentials = `${username}:${password}`;
  const encoded = Buffer.from(credentials, 'utf-8').toString('base64');
  return `Basic ${encoded}`;
}

async function connectWithNavUserPassword(
  url: string,
  username: string,
  password: string,
  tenantId?: string
): Promise<WebSocket> {

  // Multi-tenant: prefix username with tenant
  const fullUsername = tenantId ? `${tenantId}\\${username}` : username;

  const ws = new WebSocket(url, {
    headers: {
      'Authorization': createBasicAuthHeader(fullUsername, password)
    }
  });

  return ws;
}
```

### Multi-Tenant Example

```typescript
// Single tenant
const ws = await connectWithNavUserPassword(
  'wss://bc.company.com/ws/connect',
  'john.doe',
  'password123'
);

// Multi-tenant
const ws = await connectWithNavUserPassword(
  'wss://bc.company.com/ws/connect',
  'john.doe',
  'password123',
  'CRONUS'  // Tenant ID
);

// Internally becomes: "CRONUS\john.doe"
```

## Comparison: NavUserPassword vs OAuth

| Aspect | NavUserPassword | OAuth/Azure AD |
|--------|----------------|----------------|
| Setup complexity | Low | High |
| BC configuration | Single setting | Multiple settings + Azure AD |
| Credential format | Username + password | Client ID + secret/certificate |
| Token refresh | N/A (session-based) | Required |
| Enterprise ready | ⚠️ Basic | ✅ Production-grade |
| Modern security | ⚠️ Password-based | ✅ Token-based |
| Cross-platform | ✅ Yes | ✅ Yes |
| PoC suitability | ✅ Excellent | ⚠️ Overkill |

## Security Recommendations

### Development/PoC
- ✅ Use NavUserPassword for simplicity
- ⚠️ Use HTTPS even in dev (wss://)
- ✅ Test rate limiting (4 failed attempts)

### Production
- ✅ Use OAuth/Azure AD (AccessControlService)
- ✅ Implement token refresh
- ✅ Use service principals for automation
- ✅ Enable audit logging
- ✅ Implement connection pooling with token management

## Testing Authentication

### Check Server Configuration

```powershell
# Check BC server config
Get-NAVServerConfiguration BC260 -KeyName ClientServicesCredentialType
# Should return: NavUserPassword
```

### Test with cURL

```bash
# Test WebSocket upgrade with Basic Auth
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)" \
  https://bc.company.com/ws/connect
```

### Expected Responses

**Success**:
```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
```

**Auth Failure**:
```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm=""
```

**Wrong Credential Type**:
```
HTTP/1.1 401 Unauthorized
(or 403 Forbidden)
```

## References

### Key Source Files
- `ClientServiceAuthenticationHandler.cs` - Main auth handler
- `WebServiceBasicAuthenticator.cs` - Basic auth implementation
- `NavUserPasswordValidator.cs` - Password validation
- `NavClientCredentialType.cs` - Credential type enum
- `WebSocketController.cs` - WebSocket endpoint
- `AuthenticationHelper.cs` - Auth middleware helper

### Related Documentation
- Business Central Web Services Authentication: https://docs.microsoft.com/dynamics365/business-central/dev-itpro/webservices/web-services-authentication
- HTTP Basic Authentication: RFC 7617
