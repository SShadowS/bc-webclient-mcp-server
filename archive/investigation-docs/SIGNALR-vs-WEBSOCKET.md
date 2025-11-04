# SignalR vs Raw WebSocket in Business Central

## Discovery: BC Uses SignalR, Not Raw WebSockets!

From the decompiled code analysis, I found that the Business Central web client uses **SignalR Hub**, not raw WebSockets.

### Evidence from Decompiled Code

**File**: `Prod.Client.WebCoreApp\Controllers\ClientServiceHub.cs:34`
```csharp
public static string EndpointPath = "/csh";
```

**File**: `Prod.Client.WebCoreApp\Startup.cs:501`
```csharp
HubEndpointRouteBuilderExtensions.MapHub<ClientServiceHub>(endpoints, ClientServiceHub.EndpointPath, ...);
```

## The Two Endpoints

### 1. SignalR Hub: `/csh` ✅ (Used by Web Client)

**Location**: `Prod.Client.WebCoreApp` assembly
**Protocol**: SignalR (WebSocket + fallbacks)
**Path**: `/csh`
**Full URL Example**: `http://Cronus27/BC/csh`

**Methods** (from ClientServiceHub.cs):
- `OPENSESSION` - Initialize client session
- `INVOKE` - Execute interactions/RPC calls
- `ValidateConnection` - Ping/health check

###2. Raw WebSocket: `/ws/connect` ❓ (Purpose Unknown)

**Location**: `Microsoft.Dynamics.Nav.Service.ClientService` assembly
**Protocol**: Raw WebSocket
**Path**: `/ws/connect`
**Full URL Example**: `http://Cronus27/???/ws/connect`

**Status**: Exists in decompiled code but:
- Not used by web client (web client uses SignalR at `/csh`)
- Might be for server-to-server communication
- Might be older/deprecated API
- Hosting location unclear (separate service?)

## Why SignalR Instead of Raw WebSocket?

SignalR provides:
1. **Automatic reconnection** - Client reconnects on disconnect
2. **Transport fallbacks** - Falls back to Server-Sent Events, Long Polling if WebSocket fails
3. **Message framing** - Built-in JSON-RPC message handling
4. **Hub invocation** - Method-based RPC instead of manual message routing
5. **Handshake protocol** - Negotiation for best transport

## Authentication with SignalR

SignalR supports the same authentication as HTTP requests:

### NavUserPassword with SignalR

```typescript
import * as signalR from '@microsoft/signalr';

const connection = new signalR.HubConnectionBuilder()
  .withUrl('http://Cronus27/BC/csh', {
    headers: {
      'Authorization': 'Basic ' + Buffer.from('default\\sshadows:password').toString('base64')
    }
  })
  .build();

await connection.start();

// Call hub methods
const response = await connection.invoke('InvokeRequest', rpcRequest);
```

## Comparing Both Approaches

| Aspect | SignalR (`/csh`) | Raw WebSocket (`/ws/connect`) |
|--------|------------------|-------------------------------|
| **Used by BC Web Client** | ✅ Yes | ❌ No |
| **Authentication** | HTTP Headers during handshake | HTTP Headers during upgrade |
| **Protocol** | SignalR Hub (method invocation) | Raw JSON-RPC messages |
| **Reconnection** | Automatic | Manual |
| **Endpoint Path** | `/csh` | `/ws/connect` (maybe) |
| **Status** | ✅ Confirmed working | ❓ Unknown hosting |
| **Complexity** | Medium (SignalR library) | Lower (just ws lib) |
| **BC Alignment** | ✅ Matches web client | ⚠️ Diverges from web client |

## Recommendation for PoC

**Use SignalR** (`/csh`) because:
1. ✅ Confirmed to be what BC web client uses
2. ✅ Endpoint location known: `/csh` on web client URL
3. ✅ Authentication works the same way
4. ✅ Better documented (we can observe web client network traffic)
5. ✅ More robust (automatic reconnection, fallbacks)

## SignalR Endpoint URL Construction

Based on your configuration:
```env
BC_BASE_URL=http://Cronus27/BC/
```

SignalR endpoint should be:
```
http://Cronus27/BC/csh
```

The `/BC/` part is your **web client path**, and SignalR Hub is at `/csh` relative to that.

## Next Steps

1. Update PoC to use `@microsoft/signalr` instead of raw `ws`
2. Connect to `/csh` endpoint
3. Implement SignalR Hub method calls matching web client:
   - `OpenSession` - Initialize session
   - `InvokeRequest` - Send JSON-RPC requests

## Why `/ws/connect` Gave 404

The `/ws/connect` endpoint from `WebSocketController` is in a **different service assembly** that:
- Might not be running in your BC container
- Might require a different URL path
- Might be for internal BC components only
- Might be deprecated/unused

The web client definitively uses `/csh` SignalR Hub, not `/ws/connect`.
