# Session-Based Authentication

## The Correct Approach (January 2025)

After analyzing browser DevTools network traffic, we discovered the **exact** authentication flow Business Central uses:

## Discovery from Browser DevTools

The actual WebSocket connection in the browser:
```
ws://cronus27/BC/csh?ackseqnb=-1&csrftoken=CfDJ8KHgNyGeG6R...
```

Key observations:
1. ✅ Endpoint is `/BC/csh` (SignalR Hub)
2. ✅ Requires `ackseqnb=-1` query parameter
3. ✅ Requires `csrftoken=<TOKEN>` query parameter
4. ✅ Requires session cookies from web login
5. ❌ Does NOT use HTTP Basic Auth headers

## Why Previous Attempts Failed

### Attempt 1: Raw WebSocket to /ws/connect
```typescript
ws://cronus27/BC/ws/connect
```
**Result**: 404 Not Found
**Reason**: This endpoint is in the Server Tier service (different assembly), not the web client.

### Attempt 2: SignalR with Basic Auth
```typescript
http://cronus27/BC/csh
Authorization: Basic <base64(username:password)>
```
**Result**: 404 Not Found during negotiation
**Reason**: The `ClientServiceHub` has `[Authorize]` attribute which requires cookie-based authentication, not Basic Auth headers.

## The Correct Flow: BCSessionClient

### Step 1: Login to Web UI

```typescript
// GET /SignIn?tenant=default
const loginPageResponse = await fetch(`${baseUrl}/SignIn?tenant=${tenant}`);

// Parse HTML to extract CSRF token
const $ = cheerio.load(loginPageHtml);
const requestVerificationToken = $('input[name="__RequestVerificationToken"]').val();

// Save session cookies
this.sessionCookies = loginPageResponse.headers.raw()['set-cookie'];
```

### Step 2: POST Credentials

```typescript
// POST /SignIn with form data
const loginFormData = new URLSearchParams();
loginFormData.append('userName', this.username);
loginFormData.append('password', this.password);
loginFormData.append('__RequestVerificationToken', requestVerificationToken);

const loginResponse = await fetch(loginPageUrl, {
  method: 'POST',
  body: loginFormData,
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cookie': this.sessionCookies.join('; ')
  }
});

// Update session cookies from Set-Cookie headers
// Status 302 = successful login
```

### Step 3: Extract WebSocket CSRF Token

```typescript
// GET main page with session cookies
const mainPageResponse = await fetch(`${baseUrl}/?tenant=${tenant}`, {
  headers: { 'Cookie': this.sessionCookies.join('; ') }
});

// Extract CSRF token from page HTML
const csrfMatch = mainPageHtml.match(/csrftoken['":\s]+([\w-]+)/i);
this.csrfToken = csrfMatch[1];
```

### Step 4: Connect to SignalR with Cookies

```typescript
// Build URL with query parameters
let hubUrl = `${baseUrl}/csh?ackseqnb=-1&csrftoken=${this.csrfToken}`;

// Connect with session cookies
const builder = new signalR.HubConnectionBuilder()
  .withUrl(hubUrl, {
    headers: async () => ({
      'Cookie': this.sessionCookies.join('; ')
    }),
    skipNegotiation: false,
    transport: signalR.HttpTransportType.WebSockets
  });

await this.connection.start();
```

### Step 5: Open Session and Make RPC Calls

```typescript
// Now you can make JSON-RPC calls via SignalR
const rpcRequest = {
  jsonrpc: '2.0',
  method: 'OpenSession',
  params: [{ clientType: 'WebClient', ... }],
  id: uuidv4()
};

const response = await this.connection.invoke('InvokeRequest', rpcRequest);
```

## Why This Works

### Authentication Flow Matches Browser

1. **Browser**: Submits login form → Gets session cookies → Connects to WebSocket with cookies
2. **Our Client**: Does the exact same thing using `node-fetch` and `cheerio`

### SignalR Hub Authorization

From `ClientServiceHub.cs:39`:
```csharp
[Authorize]
public class ClientServiceHub : Hub
```

The `[Authorize]` attribute checks for:
- ✅ Valid session cookies (ASP.NET authentication cookie)
- ✅ Anti-CSRF token validation
- ❌ NOT HTTP Basic Auth headers

### CSRF Protection

BC uses ASP.NET Core's anti-forgery system:
- Login page has `__RequestVerificationToken` hidden input
- Main page has CSRF token for WebSocket connection
- Both must be included in requests

## Running the Session-Based Client

```bash
# Make sure .env has these variables
BC_BASE_URL=http://cronus27/BC/
BC_USERNAME=sshadows
BC_PASSWORD=your-password
BC_TENANT_ID=default
ROLE_CENTER_PAGE_ID=9022

# Run the session-based version
npm run dev
# or
npm run dev:session
```

## Comparison of Implementations

| Implementation | Endpoint | Auth Method | Status |
|----------------|----------|-------------|--------|
| BCWebSocketClient | /ws/connect | Basic Auth | ❌ 404 - Wrong endpoint |
| BCSignalRClient | /csh | Basic Auth | ❌ 404 - Wrong auth |
| **BCSessionClient** | /csh | **Cookies + CSRF** | ✅ **Works!** |

## Technical Details

### Query Parameters

From browser DevTools:
```
?ackseqnb=-1&csrftoken=<TOKEN>
```

- `ackseqnb`: Acknowledgement sequence number (-1 = no previous messages)
- `csrftoken`: Anti-CSRF token from main page

### Session Cookies

Typical cookies from BC login:
```
.AspNetCore.Antiforgery.xxx=...
.AspNetCore.Session=...
ARRAffinity=...
ARRAffinitySameSite=...
```

These cookies prove you've authenticated via the web UI.

### CSRF Token Format

The CSRF token is a Base64-encoded value with dashes:
```
CfDJ8KHgNyGeG6RKgffcrutyE2m4l3DxX4-He29eWzXIKoQxg-Iq6f5uokqN...
```

It's generated by ASP.NET Core's Data Protection API.

## Security Considerations

This approach is secure because:

1. ✅ Uses the same authentication flow as the official web client
2. ✅ Leverages ASP.NET Core's built-in security (anti-CSRF, session management)
3. ✅ Credentials are sent over HTTPS during login (if using https://)
4. ✅ Session cookies can expire (configurable in BC)
5. ✅ CSRF tokens prevent cross-site attacks

## Limitations

⚠️ **Session Lifetime**: The session will expire based on BC server configuration (typically 30-60 minutes of inactivity).

⚠️ **No Refresh**: Unlike OAuth tokens, you can't "refresh" a web session. You must re-authenticate by logging in again.

⚠️ **Browser-like Behavior**: This simulates browser behavior, including user-agent strings, cookie handling, and form submission.

## Next Steps

Now that we have working authentication:

1. ✅ Test with actual BC deployment
2. ✅ Implement remaining IClientApi methods
3. ✅ Add session refresh logic (re-login when expired)
4. ✅ Build full MCP server
5. ✅ Add connection pooling and session management

## References

- Browser DevTools Network tab (the source of truth!)
- `ClientServiceHub.cs:39` - [Authorize] attribute
- `Startup.cs:501` - SignalR endpoint mapping
- ASP.NET Core Authentication documentation
- ASP.NET Core Anti-CSRF documentation
