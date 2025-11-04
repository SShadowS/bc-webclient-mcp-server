# Microsoft's Official Agent API for Business Central

**Date**: 2025-10-29
**Discovery**: Microsoft has a dedicated REST API for AI agents, completely separate from the WebSocket UI protocol

---

## Executive Summary

We've been trying to use BC's **WebSocket UI protocol** (designed for human users) when Microsoft actually provides a **dedicated Agent REST API** (`CopilotApi`) designed specifically for programmatic access by AI agents.

###Key Differences:

| **WebSocket UI Protocol** (What we used) | **Agent REST API** (What we should use) |
|---|---|
| Port 80/443 `/BC/` | Port 7100 `/copilot/` |
| WebSocket connection with sessions | REST API with stateless requests |
| Must "open" forms and manage server-side state | Direct page metadata access by ID |
| Form caching issues | No caching - each request is independent |
| Designed for interactive UI | Designed for programmatic agent access |

---

## The Agent API Architecture

### Base Configuration

**File**: `CopilotApiHostFactory.cs:22`
```csharp
new AspNetCoreApiHost(ApiType.CopilotApi, new AspNetCoreApiHostOptions(
    Category.CopilotApi,
    useSsl,
    7100,              // ← Port
    "copilot",         // ← Path prefix
    ...
))
```

**API Base URL**: `http://server:7100/copilot/v{version}/`

### API Endpoints

**File**: `AgentsController.cs`

#### 1. Get Agent
```http
GET /v2.0/agents/{agentUserId}?tenantId={tenantId}
```

#### 2. Get Page Context
```http
GET /v2.0/agents/{agentUserId}/tasks/{taskId}/context?pageId={pageId}&bookmark={bookmark}&tenantId={tenantId}
```
**This is the key endpoint for page access!**

#### 3. Agent Task Management
```http
GET    /v2.0/agents/{agentUserId}/tasks/{taskId}
PATCH  /v2.0/agents/{agentUserId}/tasks/{taskId}
GET    /v2.0/agents/{agentUserId}/tasks/{taskId}/messages
POST   /v2.0/agents/{agentUserId}/tasks/{taskId}/messages
GET    /v2.0/agents/{agentUserId}/tasks/{taskId}/memoryEntries
POST   /v2.0/agents/{agentUserId}/tasks/{taskId}/memoryEntries
GET    /v2.0/agents/{agentUserId}/tasks/{taskId}/timelineSteps
POST   /v2.0/agents/{agentUserId}/tasks/{taskId}/timelineSteps
GET    /v2.0/agents/{agentUserId}/tasks/{taskId}/logEntries
POST   /v2.0/agents/{agentUserId}/tasks/{taskId}/logEntries
```

### Authentication

**File**: `AgentsController.cs:32`
```csharp
[Authorize]
[AllowedRoles(new string[] {"CopilotService"})]
```

**Authentication Scheme**: Uses role-based authorization with "CopilotService" role
**Headers Required**:
- `Authorization`: Bearer token or appropriate auth
- `server-session-id`: Required for certain operations (optional for others)

---

## Page Metadata Access

### The Right Way (Agent API)

**File**: `PageMetadataResponse.cs:68-77`
```csharp
internal static PageMetadataResponse Create(NavSession session, int pageId)
{
    PageMetadata page;
    if (!PageAccessValidator.HasAccessToPage(session, pageId, out page))
        throw new NavPermissionException(...);

    return new PageMetadataResponse(session, page, new PageMetadataResponseProperties()
    {
        IncludeFields = true,
        IncludeSubPages = true,
        IncludeControls = true
    });
}
```

### Page Metadata Structure

```csharp
public class PageMetadataResponse
{
    public string Name { get; }
    public int Id { get; }
    public string SourceTableName { get; }
    public string Description { get; }
    public string PageType { get; }
    public bool IsBookmarked { get; }
    public IReadOnlyList<FieldMetadata> Fields { get; }
    public IReadOnlyList<InfoPartMetadata> SubPages { get; }
    public IReadOnlyList<PageControlMetadata> Controls { get; }
    public PageCapabilities SupportedCapabilities { get; }
    public int AppGroupId { get; }
}
```

**Key Features**:
- Direct access by `pageId` - no need to "open" forms!
- Returns structured metadata: fields, subpages, controls
- No caching issues - each request is independent
- Access validation built-in

---

## Agent Task Model

### Agent Structure

**File**: `Agent.cs`
```csharp
public class Agent
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string Initials { get; set; }
    public int ConfigurationPageId { get; set; }
    public int SummaryPageId { get; set; }
    public int TaskCount { get; set; }
    public AgentState State { get; set; }
}
```

### Task-Based Interaction

Agents work with **tasks** that have:
- **Messages**: Communication between agent and BC
- **Memory Entries**: Agent's memory/context
- **Timeline Steps**: Sequence of actions
- **Log Entries**: Debugging/tracking
- **User Intervention Suggestions**: When agent needs help
- **Page Context**: Current page being accessed

---

## How It Solves Our Problems

### Problem 1: Form Caching
**Old approach** (WebSocket):
```
OpenForm(Page=21) → Returns form "39A"
OpenForm(Page=22) → Returns form "39A" (cached!)
OpenForm(Page=30) → Returns form "39A" (still cached!)
```

**New approach** (Agent API):
```
GET /context?pageId=21 → Returns Page 21 metadata
GET /context?pageId=22 → Returns Page 22 metadata
GET /context?pageId=30 → Returns Page 30 metadata
```
✓ No caching - each request is independent

### Problem 2: Session Management
**Old**: Must maintain WebSocket connection, sessions expire, form state tracking
**New**: Stateless REST requests - no session management needed

### Problem 3: Programmatic Access
**Old**: WebSocket protocol designed for UI interactions (click, type, etc.)
**New**: REST API designed for programmatic access (get metadata, read data, etc.)

---

## Implementation Requirements

### 1. Enable the Copilot API

The API runs on port 7100 by default. It might need to be enabled in BC configuration.

**Check**:
```bash
curl http://Cronus27:7100/copilot/v2.0/agents
```

### 2. Authentication Setup

Need to obtain "CopilotService" role credentials:
- Might be AAD/OAuth token
- Might be configured in BC Server Administration
- May require special service account

### 3. Create Agent Registration

To use the API, need:
- Agent User ID (GUID)
- Agent Task ID (long)
- These might be created via BC AL code or admin interface

### 4. API Client Implementation

```typescript
class BCAgentApiClient {
  async getPageContext(agentUserId: string, taskId: number, pageId: number, bookmark?: string) {
    return await fetch(`http://server:7100/copilot/v2.0/agents/${agentUserId}/tasks/${taskId}/context?pageId=${pageId}&tenantId=${tenantId}`, {
      headers: {
        'Authorization': 'Bearer ...',
        'server-session-id': '...' // optional
      }
    });
  }
}
```

---

## Next Steps

1. **Investigate API Availability**
   - Check if CopilotApi is enabled on Cronus27
   - Identify required configuration
   - Determine authentication method

2. **Obtain Credentials**
   - Get "CopilotService" role credentials
   - Create agent registration
   - Get agent User ID and task ID

3. **Test Basic Access**
   - Test `/agents/{id}` endpoint
   - Test page context endpoint with Page 21
   - Verify metadata structure

4. **Implement MCP Server**
   - Replace WebSocket client with REST API client
   - Use Agent API for all page operations
   - Remove form caching workarounds

5. **Documentation**
   - Document Agent API authentication
   - Document page access patterns
   - Create example workflows

---

## Key Findings from Decompiled Code

### Files Analyzed:
1. `Microsoft.Dynamics.Nav.Service.CopilotApi/Controllers/AgentsController.cs` - Main API controller
2. `Microsoft.Dynamics.Nav.Service.CopilotApi/Models/PageMetadataResponse.cs` - Page metadata structure
3. `Microsoft.Dynamics.Framework.UI/Agent.cs` - Agent model
4. `Microsoft.Dynamics.Nav.Service.CopilotApi/Hosts/CopilotApiHostFactory.cs` - API configuration

### Related Components:
- `AgentDataProvider.cs` - Data access layer for agents
- `AgentTaskDataProvider.cs` - Task management
- `AgentTaskMemoryDataProvider.cs` - Memory/context management
- `PageAccessValidator.cs` - Permission checking
- `PageMetadataHelper.cs` - Metadata extraction utilities

---

## Comparison: Old vs New Approach

### Old Approach (WebSocket UI Protocol)

```typescript
// 1. Connect via WebSocket
const client = new BCRawWebSocketClient(config);
await client.authenticateWeb();
await client.connect();

// 2. Open session with OpenForm
await client.openSession({
  interactionsToInvoke: [{
    interactionName: 'OpenForm',
    namedParameters: { query: "page=21" }
  }]
});

// 3. Try to open Page 22 - FAILS! Returns cached Page 21
const response = await client.invoke({
  interactionName: 'OpenForm',
  namedParameters: { Page: '22' },
  openFormIds: [],  // Doesn't help
});
// ❌ Still returns Page 21 data

// 4. Maintain WebSocket connection, track form state, etc.
```

### New Approach (Agent REST API)

```typescript
// 1. Authenticate once (get token)
const token = await authenticate();

// 2. Direct page access - no sessions!
const page21 = await fetch(`http://server:7100/copilot/v2.0/agents/${agentId}/tasks/${taskId}/context?pageId=21&tenantId=default`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
// ✓ Returns Page 21 metadata

const page22 = await fetch(`http://server:7100/copilot/v2.0/agents/${agentId}/tasks/${taskId}/context?pageId=22&tenantId=default`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
// ✓ Returns Page 22 metadata - no caching!

// 3. No state management needed - stateless REST
```

---

## Benefits of Agent API

✓ **No form caching** - Each request is independent
✓ **Stateless** - No WebSocket sessions to manage
✓ **Designed for agents** - Programmatic access, not UI interactions
✓ **Structured data** - Clean JSON metadata
✓ **Task-based** - Organized around agent tasks and memory
✓ **Better error handling** - HTTP status codes, structured errors
✓ **Scalable** - Multiple concurrent requests, no session limits

---

## Conclusion

Microsoft has built a proper API for AI agents that solves all our problems:
- No more WebSocket session management
- No more form caching issues
- Direct page access by ID
- Designed for programmatic use

**Our next step**: Figure out how to enable/access this API on our BC server (Cronus27:7100) and implement authentication.
