# Copilot API Investigation Findings

**Date**: 2025-10-29
**Status**: Session/Agent Registration Required for API Access

---

## Executive Summary

The Business Central Copilot API provides comprehensive page metadata and record querying capabilities, **but** requires either:
1. An active BC server session (`server-session-id` header), OR
2. A registered Agent User ID + Task ID

This means we **cannot** use it as a standalone REST API without additional setup.

---

## API Endpoint Groups

### 1. Skills API (`/v{version}/skills/*`)

**Purpose**: Platform skills for page discovery, metadata, and data querying

**Key Endpoints**:
```
GET  /v{version}/skills/pageMetadata?query=...&pageTypes[]=List
GET  /v{version}/skills/pageMetadata/{pageId}
GET  /v{version}/skills/pages/{pageId}/summary
GET  /v{version}/skills/pages/{pageId}/records/{systemId}/data
GET  /v{version}/skills/pages/{pageId}/copilotActions
GET  /v{version}/skills/search?query=...
```

**Authentication**: `X-Copilot-ApiKey` header
**Session Requirement**: ✅ **REQUIRED** - `server-session-id` header
**Error without session**: `Could not find a session with external id '' on tenant 'default'.`

**Capabilities**:
- ✅ Search for pages by name/description
- ✅ Get complete page metadata (fields, controls, subpages)
- ✅ Query records with filters and sorting
- ✅ Get complete record data (OData-style)
- ✅ Discover available actions

**Problem**: Requires active BC session, which requires WebSocket or web client connection.

---

### 2. Agents API (`/v{version}/agents/{agentUserId}/*`)

**Purpose**: Agent task management and interaction context

**Key Endpoints**:
```
GET    /v{version}/agents/{agentUserId}
GET    /v{version}/agents/{agentUserId}/tasks/{taskId}
PATCH  /v{version}/agents/{agentUserId}/tasks/{taskId}
GET    /v{version}/agents/{agentUserId}/tasks/{taskId}/context?pageId=...
GET    /v{version}/agents/{agentUserId}/tasks/{taskId}/pagescripts
GET    /v{version}/agents/{agentUserId}/tasks/{taskId}/messages
POST   /v{version}/agents/{agentUserId}/tasks/{taskId}/messages
GET    /v{version}/agents/{agentUserId}/tasks/{taskId}/memoryEntries
POST   /v{version}/agents/{agentUserId}/tasks/{taskId}/memoryEntries
```

**Authentication**: `X-Copilot-ApiKey` header
**Session Requirement**: ⚠️ **OPTIONAL** - `server-session-id` header (endpoints branch on presence)
**Agent Requirement**: ✅ **REQUIRED** - Valid Agent User ID (GUID) + Task ID (long)

**Capabilities**:
- ✅ Task-based agent workflow
- ✅ Page context for specific page ID
- ✅ Page scripts (v2.2+)
- ✅ Agent memory/context management
- ✅ Message threading

**Problem**: Requires registered agent, likely created via AL code or BC admin interface.

---

## Data Structures

### PageMetadataResponse
```typescript
interface PageMetadataResponse {
  Name: string;                       // "Customer List"
  Id: number;                         // 22
  SourceTableName: string;            // "Customer"
  SourceTableId: number;              // 18
  Description: string;
  PageType: string;                   // "List", "Card", "Document"
  Fields: FieldMetadata[];            // Table fields with types, descriptions
  Controls: PageControlMetadata[];    // UI controls (buttons, actions)
  SubPages: InfoPartMetadata[];       // Embedded page parts
  SupportedCapabilities: number;      // Filtering, AnalysisMode flags
}
```

### FieldMetadata
```typescript
interface FieldMetadata {
  Id: number;
  Name: string;
  Type: string;                       // "Code", "String", "Integer", "Option"
  Description: string;                // Tooltip/help text
  OptionValues?: string[];            // For Option/Enum fields
  MaxLength?: number;                 // For Code/Text fields
  CanBeUsedForSorting: boolean;
}
```

### PageControlMetadata
```typescript
interface PageControlMetadata {
  ControlId: number;
  Name: string;
  Caption: string;                    // Display text
  Tooltip: string;
  HasDrillDown: boolean;              // Can navigate to details
  HasLookup: boolean;                 // Can open value picker
  Visible: boolean;
}
```

---

## Solutions for MCP Server

### Option 1: Session Management in MCP Server ⭐ **Recommended**

**Approach**: Programmatically create and manage BC sessions

**Steps**:
1. Investigate BC session creation (likely through standard web services)
2. Create session on MCP server startup
3. Maintain session with keep-alive
4. Use Skills API with `server-session-id` header

**Pros**:
- Uses official Copilot API
- Access to all Skills endpoints
- Clean metadata structures

**Cons**:
- Adds session management complexity
- May require periodic session refresh
- Session tied to MCP server lifecycle

**Investigation needed**:
- How to create BC sessions programmatically
- Session timeout and refresh requirements
- Multi-tenant session handling

---

### Option 2: Custom No-Session Endpoint in CopilotPatcher ⭐ **Fast Alternative**

**Approach**: Extend CopilotPatcher with custom controller that bypasses session requirements

**Implementation**:
```csharp
// Add to CopilotPatcher
[ApiController]
[Route("v1/mcp")]
public class McpController : Controller
{
    [HttpGet("pages/{pageId}/metadata")]
    public IActionResult GetPageMetadata(int pageId, [FromQuery] string tenantId)
    {
        // Create tenant-specific session internally
        var tenant = NavEnvironment.Instance.Tenants.GetTenantById(tenantId);
        using (var session = CreateTemporarySession(tenant))
        {
            var metadata = PageMetadataResponse.Create(session, pageId);
            return Ok(metadata);
        }
    }

    [HttpGet("pages/{pageId}/summary")]
    public IActionResult GetPageSummary(/* ... */)
    {
        // Similar pattern - create temp session, query data, dispose
    }
}
```

**Pros**:
- No external session management
- Direct API key authentication
- Complete control over API design
- Can simplify response structures

**Cons**:
- Requires modifying CopilotPatcher
- Custom API (not standard BC)
- Need to handle session creation internally

---

### Option 3: Use ODataV4 API Instead

**Approach**: Use BC's standard OData API which doesn't require Copilot infrastructure

**Endpoints**:
```
GET  http://Cronus27/BC/ODataV4/Company('CRONUS%20USA%2C%20Inc.')/Customer
GET  http://Cronus27/BC/ODataV4/Company('CRONUS%20USA%2C%20Inc.')/Customer?$filter=Balance_LCY gt 1000
GET  http://Cronus27/BC/api/v2.0/companies({id})/customers
```

**Pros**:
- Established BC API
- Session-independent (basic auth or OAuth)
- Well-documented
- Standard OData query syntax

**Cons**:
- ❌ No UI metadata (page structures, field layouts)
- ❌ No control metadata (buttons, actions)
- ❌ Only data access, not UI modeling
- Less structured than Copilot API

---

## Recommended Path Forward

### Phase 1: Quick Win - OData + Manual Metadata
1. Use OData API for data access
2. Manually define page metadata for common pages (Customer, Sales Order, etc.)
3. Build MCP tools around this hybrid approach

### Phase 2: Session-Based Skills API
1. Research BC session creation methods
2. Implement session management in MCP server
3. Switch to Skills API for dynamic page metadata

### Phase 3: Production - Custom Endpoint (if needed)
1. If session management proves problematic, extend CopilotPatcher
2. Add `/mcp/*` endpoints that handle sessions internally
3. Deploy as part of standard CopilotPatcher package

---

## Code References

### Skills API Implementation
- **File**: `PlatformSkillsController.cs`
- **Line 88**: `GetDatabaseContext` - session required check
- **Line 154**: `GetPageMetadataAsync` - page search with session
- **Line 246**: `GetPageMetadataAsync` - page by ID with session
- **Line 338**: `GetPageSummary` - records with filters, session required

### Data Providers
- **File**: `CopilotDataProvider.cs`
- **Line 52**: `GetCopilotActions` - discovers page actions
- **Line 75**: `GetPageSummary` - core summary logic
- **Line 278**: `GetPageRecordSummary` - single record data

### Metadata Structures
- **File**: `PageMetadataResponse.cs:24-84` - Page metadata structure
- **File**: `FieldMetadata.cs:17-90` - Field definitions
- **File**: `PageControlMetadata.cs:13-49` - Control definitions

---

## Next Steps

1. **Decide on approach**: Session management vs. OData vs. custom endpoint
2. **If session approach**: Research BC session creation
3. **If OData approach**: Define metadata schema for common pages
4. **If custom endpoint**: Design API surface and implement in CopilotPatcher

---

## Testing Commands

### Test Skills API (requires session):
```bash
curl -H "X-Copilot-ApiKey: your-secret-key-here" \
  "http://Cronus27:7100/BC/copilot/v2.0/skills/pageMetadata/22?tenantId=default"
# ❌ Error: Could not find a session with external id '' on tenant 'default'.
```

### Test OData API (no session needed):
```bash
curl -u "ADMIN:" \
  "http://Cronus27/BC/ODataV4/Company('CRONUS%20USA%2C%20Inc.')/Customer?\$top=5"
# ✅ Works - returns customer data
```

### Test Agent API (requires agent registration):
```bash
curl -H "X-Copilot-ApiKey: your-secret-key-here" \
  "http://Cronus27:7100/BC/copilot/v2.0/agents/{guid}"
# ⚠️ Requires valid agent GUID
```
