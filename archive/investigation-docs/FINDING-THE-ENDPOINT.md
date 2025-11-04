# Finding the Actual BC SignalR Endpoint

## Current Situation

We've tested both:
- ❌ `/ws/connect` - 404 Not Found
- ❌ `/csh` - 404 Not Found

Both endpoints exist in the decompiled code but return 404 on your BC deployment.

## The Mystery

From the decompiled code:
- `ClientServiceHub.cs:34` says: `EndpointPath = "/csh"`
- `WebSocketController.cs:24` says: `[Route("ws")]`

But neither endpoint is accessible at:
- `http://Cronus27/BC/csh`
- `http://Cronus27/BC/ws/connect`

## How to Find the Real Endpoint

### Step 1: Open BC Web Client in Browser

1. Open Chrome/Edge/Firefox
2. Navigate to: `http://cronus27/BC/?tenant=default`
3. Log in with your credentials

### Step 2: Open Developer Tools

1. Press **F12** to open DevTools
2. Go to the **Network** tab
3. **IMPORTANT**: Filter by **WS** (WebSocket) or **All**
4. Refresh the page (F5)

### Step 3: Find the WebSocket/SignalR Connection

Look for entries like:
- `ws://cronus27/...` (WebSocket)
- `/negotiate` (SignalR negotiation)
- `/csh` (SignalR hub)
- Any WebSocket upgrade requests

### Step 4: Note the Exact URL

When you find the WebSocket/SignalR connection, note:
- ✅ Full URL path
- ✅ Query parameters (if any)
- ✅ Headers (especially authentication)

### Example of What to Look For

**SignalR Connection Example**:
```
Request URL: ws://cronus27/BC/csh?id=abc123&tenant=default
Status: 101 Switching Protocols
```

**Or WebSocket Example**:
```
Request URL: ws://cronus27/BC190/ws/connect
Status: 101 Switching Protocols
```

### Step 5: Report Back

Once you find it, we'll update the PoC to use that exact path.

## Possible Reasons for 404

### 1. Different Instance Name

Maybe it's:
- `http://cronus27/BC190/csh` (with version)
- `http://cronus27/BC260/csh`
- `http://cronus27/NAV/csh`

### 2. Different Base Path

Maybe it's:
- `http://cronus27/csh` (no /BC/)
- `http://cronus27/WebClient/csh`

### 3. Different Port

Maybe it's on a different port:
- `http://cronus27:7085/csh`
- `http://cronus27:7046/csh`

### 4. Not Using SignalR/WebSocket

Maybe your BC version doesn't use SignalR at all and uses:
- AJAX polling
- Server-Sent Events
- Different protocol entirely

### 5. Container Configuration

Maybe the BC container doesn't have the SignalR hub enabled or exposed.

## Alternative: Check BC Server Configuration

If you have access to the BC server/container:

### Docker Container

```bash
# List running containers
docker ps

# Check container logs for "SignalR" or "WebSocket"
docker logs <container-name> | grep -i signalr
docker logs <container-name> | grep -i websocket

# Check exposed ports
docker port <container-name>
```

### BC Server Config

Check the BC server configuration:

```powershell
# On BC server
Get-NAVServerConfiguration BC260 | Select *WebSocket*
Get-NAVServerConfiguration BC260 | Select *ClientService*
```

## What We Know For Sure

From testing:
1. ✅ BC web UI is accessible at `http://cronus27/BC/?tenant=default`
2. ✅ Authentication works (NavUserPassword accepted)
3. ❌ `/csh` endpoint returns 404
4. ❌ `/ws/connect` endpoint returns 404
5. ❌ OData `/ODataV4/` returns 404
6. ❌ API `/api/` returns 404

This suggests:
- **Only the web UI is accessible**, not the programmatic APIs
- OR the APIs are at different paths
- OR the APIs require specific configuration/enablement

## Next Steps

**Option 1**: Find the real endpoint using browser DevTools (recommended)

**Option 2**: Check if BC container has web services enabled

**Option 3**: Use a different approach entirely (see below)

## Alternative Approaches

If we can't find a direct SignalR/WebSocket endpoint, we could:

### 1. Use BC REST API (if available)

Check if these work:
- `http://cronus27:7048/BC/api/v2.0/`
- `http://cronus27/BC/api/v2.0/`

### 2. Use OData (if available)

Check if these work:
- `http://cronus27:7048/BC/ODataV4/`
- `http://cronus27/BC/ODataV4/`

### 3. Use SOAP Web Services (if available)

Check if these work:
- `http://cronus27:7047/BC/WS/`
- `http://cronus27/BC/WS/`

### 4. Browser Automation

Use Puppeteer/Playwright to automate the actual web client browser session.

**Pros**:
- ✅ Works with any BC version
- ✅ No need to find hidden endpoints
- ✅ Can interact with any page

**Cons**:
- ⚠️ Slower (browser overhead)
- ⚠️ More complex
- ⚠️ Harder to run headless

## Help Needed

Please:
1. Check browser DevTools Network tab when loading BC web client
2. Share the WebSocket/SignalR connection URL you find
3. Or share screenshots of the Network tab showing WebSocket connections

With this information, we can update the PoC to use the correct endpoint!

## Current PoC Code

The PoC currently tries to connect to:
```typescript
// In BCSignalRClient.ts:buildSignalRUrl()
return `${cleanBaseUrl}/csh`;
// Results in: http://Cronus27/BC/csh
```

Once we know the real endpoint, we'll update this method.
