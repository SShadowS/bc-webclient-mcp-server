# SignalR Version - Quick Start

## What Changed?

The PoC now uses **SignalR** instead of raw WebSocket, matching how the actual Business Central web client works.

### Why SignalR?

From the decompiled code analysis:
- ✅ BC web client uses **SignalR Hub** at `/csh`
- ✅ Automatic reconnection and transport fallbacks
- ✅ Better error handling and session management
- ❌ The `/ws/connect` endpoint doesn't exist in your BC deployment

## Quick Start

```bash
# Your .env file stays the same!
# No changes needed to configuration

# Run the SignalR version (now the default)
npm run dev
```

## What You'll See

```
╔═══════════════════════════════════════════════════════════╗
║  Business Central SignalR PoC                            ║
║  Role Center Metadata Retrieval via /csh Hub            ║
╚═══════════════════════════════════════════════════════════╝

Step 1: Authenticating...
────────────────────────────────────────────────────────────
Using NavUserPassword authentication (SignalR)
✓ Credentials validated
  User: sshadows
  Tenant: default

Step 2: Connecting to Business Central via SignalR...
────────────────────────────────────────────────────────────
Connecting to SignalR Hub: http://Cronus27/BC/csh
✓ SignalR connection established
  Connection ID: ABC123...

Step 3: Opening BC session...
────────────────────────────────────────────────────────────
Opening BC session via SignalR...
✓ Session opened
  User: John Doe (sshadows)
  Company: CRONUS International Ltd.
  Work Date: 2025-01-15
  Culture: en-US
  State: Authenticated

Step 5: Retrieving role center metadata...
────────────────────────────────────────────────────────────
  Page ID: 9022

Fetching metadata for page 9022...
✓ Metadata retrieved

═══════════════════════════════════════════════════════════════
PAGE METADATA
═══════════════════════════════════════════════════════════════
...
```

## Key Differences from WebSocket Version

| Aspect | SignalR (New) | WebSocket (Old) |
|--------|---------------|-----------------|
| **Endpoint** | `/csh` | `/ws/connect` |
| **Protocol** | SignalR Hub | Raw WebSocket |
| **Status** | ✅ Working | ❌ 404 Error |
| **BC Web Client** | ✅ Same protocol | ❌ Different |
| **Reconnection** | ✅ Automatic | ❌ Manual |
| **Error Handling** | ✅ Better | ⚠️ Basic |

## Authentication

Authentication works exactly the same:
- ✅ NavUserPassword (HTTP Basic Auth)
- ✅ OAuth/Azure AD (Bearer token)

The auth header is sent during SignalR connection negotiation.

## Code Structure

**New Files**:
- `src/BCSignalRClient.ts` - SignalR-based client
- `src/index.ts` - Main entry point (uses SignalR)

**Backup Files** (still available):
- `src/BCWebSocketClient.ts` - Original WebSocket client
- `src/index-websocket.ts` - WebSocket entry point

## Available Commands

```bash
# SignalR version (default, recommended)
npm run dev
npm run dev:signalr

# WebSocket version (for reference, will fail with 404)
npm run dev:websocket

# Test your .env file
npm run test:env

# Find endpoints (discovery tool)
npm run find:endpoint
```

## SignalR Connection Flow

1. **Negotiate Transport**
   - Client asks server which transports are available
   - Server responds: WebSockets, ServerSentEvents, LongPolling
   - Client picks best available (usually WebSockets)

2. **Authenticate**
   - Auth headers sent during negotiation
   - BC validates credentials
   - Connection established if valid

3. **Open Session**
   - Call `InvokeRequest` hub method with `OpenSession`
   - BC creates server-side session
   - Returns user settings and session ID

4. **Make RPC Calls**
   - All subsequent calls use `InvokeRequest` hub method
   - Include session ID in parameters
   - Get JSON-RPC responses

5. **Close**
   - Call `CloseSession` (optional but polite)
   - Stop SignalR connection

## SignalR Client Methods

### Connection
```typescript
await client.connect();  // Connect to /csh hub
await client.disconnect();  // Close connection
client.getState();  // Get connection state
```

### Session
```typescript
const userSettings = await client.openSession({
  clientType: 'WebClient',
  clientVersion: '26.0.0.0',
  clientCulture: 'en-US',
  clientTimeZone: 'UTC'
});
```

### Company
```typescript
await client.openCompany('CRONUS International Ltd.');
```

### Metadata
```typescript
const metadata = await client.getMasterPage(9022);  // Role center
```

### Generic RPC
```typescript
const result = await client.invokeMethod('GetPage', {
  pageId: 21,
  // ... other params
});
```

## Troubleshooting SignalR

### "Failed to negotiate" or "404"

**Problem**: SignalR can't find the `/csh` endpoint

**Check**:
```bash
# Test if endpoint exists
curl -i http://Cronus27/BC/csh/negotiate

# Should get: 200 OK with negotiation JSON
# NOT: 404 Not Found
```

**Fix**: Verify `BC_BASE_URL` is correct:
```env
# Should point to web client base URL
BC_BASE_URL=http://Cronus27/BC/
```

### "401 Unauthorized"

**Problem**: Authentication failed

**Check**:
- Username/password correct?
- Tenant ID correct for multi-tenant?
- BC server has `ClientServicesCredentialType=NavUserPassword`?

**Debug**:
```bash
npm run test:env  # Verify credentials are loaded
```

### "Connection failed" or timeout

**Problem**: Can't reach BC server

**Check**:
- BC container/server running?
- Network connectivity?
- Firewall blocking?

**Test**:
```bash
# Can you reach the web client?
curl -i http://Cronus27/BC/

# Should get: 200 OK (or 302 redirect to login)
```

### SignalR falls back to Long Polling

**What**: You see "LongPolling" in logs instead of "WebSockets"

**Why**: Server doesn't support WebSockets or network blocks them

**Impact**: Still works, but slower and more resource-intensive

**Fix**:
- Check BC server WebSocket configuration
- Check proxy/load balancer settings
- Check firewall rules

## Behind the Scenes

The SignalR client:

1. **Auto-negotiates** best transport (WebSockets > SSE > Long Polling)
2. **Handles reconnection** automatically on disconnect
3. **Manages ping/pong** to keep connection alive
4. **Queues messages** during reconnection
5. **Provides state events** (connecting, connected, reconnecting, disconnected)

## Next Steps

Now that SignalR connection works:

1. ✅ Implement more BC APIs (GetPage, ValidateField, etc.)
2. ✅ Build the full MCP server
3. ✅ Add session persistence
4. ✅ Implement callback handling
5. ✅ Add metadata caching

See the GPT-5 Pro design in the main README for the full MCP server architecture.

## References

- `SIGNALR-vs-WEBSOCKET.md` - Detailed comparison
- `ClientServiceHub.cs` - Decompiled SignalR hub code
- `Startup.cs` - SignalR endpoint registration
- [@microsoft/signalr docs](https://docs.microsoft.com/aspnet/core/signalr/javascript-client)
