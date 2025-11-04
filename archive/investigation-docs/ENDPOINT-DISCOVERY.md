# Finding the Correct BC WebSocket Endpoint

## The Problem

You're getting a **404 Not Found** error:
```
Connecting to: ws://Cronus27/BC/ws/connect
Error: Unexpected server response: 404
```

This means:
- ✅ Authentication is working (NavUserPassword is supported!)
- ✅ Network connectivity is working (server responded)
- ❌ The WebSocket endpoint is not at `/BC/ws/connect`

## Possible Endpoint Paths

The WebSocket endpoint path varies by BC version and configuration. Try these:

### Option 1: Standard Path (What We're Using)
```
/ws/connect
```
Full URL: `ws://Cronus27/BC/ws/connect`
Source: `WebSocketController.cs` - `[Route("ws")]` + `[Route("connect")]`

### Option 2: Without Instance Name
```
/ws/connect
```
Full URL: `ws://Cronus27/ws/connect`
(Maybe "BC" shouldn't be in the path)

### Option 3: With Server Instance Name
```
/{instance}/ws/connect
```
Full URL: `ws://Cronus27/BC190/ws/connect` or `ws://Cronus27/BC270/ws/connect`

### Option 4: ClientService Path
```
/clientservice/ws/connect
```
Full URL: `ws://Cronus27/BC/clientservice/ws/connect`

### Option 5: Different Port
```
:7085/ws/connect    (HTTP)
:7086/ws/connect    (HTTPS)
```
Full URL: `ws://Cronus27:7085/BC/ws/connect`

## How to Find the Correct Endpoint

### Method 1: Check BC Web Client Network Traffic

1. Open BC web client in browser: `http://Cronus27/BC/`
2. Open browser Developer Tools (F12)
3. Go to **Network** tab
4. Filter by **WS** (WebSocket)
5. Refresh the page
6. Look for WebSocket connection - note the exact URL!

Example:
```
ws://cronus27/BC190/ws/connect
```

### Method 2: Test with cURL

Try different paths to see which one responds:

```bash
# Test 1: Current path
curl -i http://Cronus27/BC/ws/connect

# Test 2: Without instance
curl -i http://Cronus27/ws/connect

# Test 3: With clientservice
curl -i http://Cronus27/BC/clientservice/ws/connect

# Test 4: Different instance name
curl -i http://Cronus27/BC190/ws/connect
curl -i http://Cronus27/BC270/ws/connect
```

**Look for**:
- `401 Unauthorized` ✅ Good! Endpoint exists, needs auth
- `404 Not Found` ❌ Wrong path
- `200 OK` or upgrade headers ✅ Found it!

### Method 3: Check BC Server Configuration

On the BC server (or container), check the service configuration:

**PowerShell (on BC server)**:
```powershell
# List all BC instances
Get-NAVServerInstance

# Get instance details
Get-NAVServerInstance | Select Name, State, Version

# Check web client URL
Get-NAVServerConfiguration BC270 -KeyName PublicWebBaseUrl
```

**Container Logs**:
```bash
# Check container logs for startup messages
docker logs <container-name> | grep -i websocket
docker logs <container-name> | grep -i "listening"
```

Look for messages like:
```
Now listening on: http://[::]:7085
WebSocket endpoint: /BC270/ws/connect
```

### Method 4: Check Web Service URL

The WebSocket endpoint usually mirrors the web service path:

If OData services are at:
```
http://Cronus27/BC/ODataV4/
```

Then WebSocket might be at:
```
ws://Cronus27/BC/ws/connect
```

If services are at:
```
http://Cronus27/BC190/api/v2.0/
```

Then WebSocket might be at:
```
ws://Cronus27/BC190/ws/connect
```

## Quick Test Script

Create this test file to try different endpoints:

**`test-endpoints.js`**:
```javascript
import WebSocket from 'ws';

const baseUrl = 'Cronus27';
const username = 'sshadows';
const password = 'your-password';
const tenantId = 'default';

// Create auth header
const authHeader = Buffer.from(`${tenantId}\\${username}:${password}`).toString('base64');

// List of endpoint paths to try
const endpoints = [
  `ws://${baseUrl}/BC/ws/connect`,
  `ws://${baseUrl}/ws/connect`,
  `ws://${baseUrl}/BC190/ws/connect`,
  `ws://${baseUrl}/BC270/ws/connect`,
  `ws://${baseUrl}/BC/clientservice/ws/connect`,
  `ws://${baseUrl}:7085/BC/ws/connect`,
  `ws://${baseUrl}:7085/ws/connect`,
];

console.log('Testing WebSocket endpoints...\n');

for (const url of endpoints) {
  try {
    console.log(`Trying: ${url}`);

    const ws = new WebSocket(url, {
      headers: {
        'Authorization': `Basic ${authHeader}`
      }
    });

    ws.on('error', (err) => {
      if (err.message.includes('404')) {
        console.log('  ❌ 404 Not Found\n');
      } else if (err.message.includes('401')) {
        console.log('  ✅ Found! (401 - needs different auth)\n');
      } else {
        console.log(`  ⚠️  ${err.message}\n`);
      }
    });

    ws.on('open', () => {
      console.log('  ✅ Connected!\n');
      ws.close();
    });

    // Wait before trying next endpoint
    await new Promise(resolve => setTimeout(resolve, 1000));

  } catch (error) {
    console.log(`  ❌ ${error.message}\n`);
  }
}
```

Run it:
```bash
node test-endpoints.js
```

## BC Container Specific Issues

### Issue 1: WebSocket Not Enabled

Some BC container images might not have WebSocket endpoint enabled.

**Check**: Look in container startup logs for WebSocket references

### Issue 2: Wrong Base URL

Your `BC_BASE_URL` might need adjustment:

**Current**:
```env
BC_BASE_URL=http://Cronus27/BC/
```

**Try**:
```env
# Without /BC/
BC_BASE_URL=http://Cronus27

# With instance name
BC_BASE_URL=http://Cronus27/BC190

# With port
BC_BASE_URL=http://Cronus27:7085/BC
```

### Issue 3: Container Port Mapping

Check if the WebSocket port is exposed:

```bash
docker ps
# Look for port mappings like: 0.0.0.0:7085->7085/tcp
```

If not mapped, you might need to recreate the container with port exposure.

## Once You Find the Correct Endpoint

Update your `.env` file:

**If the path is different**:
```env
# Adjust BC_BASE_URL to match the working path
BC_BASE_URL=http://Cronus27/BC190
```

**Or** we can add a custom WebSocket path override:
```env
BC_BASE_URL=http://Cronus27/BC
BC_WEBSOCKET_PATH=/clientservice/ws/connect
```

## NavUserPassword Authentication Confirmation

From the decompiled code (`ClientServiceAuthenticationHandler.cs:39-45`):

```csharp
case NavClientCredentialType.NavUserPassword:
case NavClientCredentialType.AccessControlService:
    StringValues source;
    if (!this.Context.Request.Headers.TryGetValue("Authorization", out source))
        return Task.FromResult<AuthenticateResult>(AuthenticateResult.Fail(...));

    this.Context.User = new GenericPrincipal(
        new GenericIdentity(GetUsernameAndPasswordFromAuthorizeHeader(...).Item1),
        Array.Empty<string>());

    return Task.FromResult<AuthenticateResult>(AuthenticateResult.Success(...));
```

**NavUserPassword IS fully supported on the WebSocket endpoint!** ✅

Your authentication is working - the issue is just finding the correct endpoint path for your specific BC deployment.

## Next Steps

1. **Use browser DevTools** to see WebSocket connection from web client (easiest!)
2. **Run `test-endpoints.js`** to systematically test paths
3. **Check container logs** for WebSocket endpoint information
4. **Report back** what you find, and I'll update the code to use the correct path
