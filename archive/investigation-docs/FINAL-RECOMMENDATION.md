# Final Recommendation: MCP Server for Business Central

**Date**: 2025-10-29
**Status**: Solution Identified - Custom Endpoint Required

---

## Problem Discovery

After investigating the Copilot API, we found that:

1. ✅ **Copilot API Skills endpoints provide excellent page metadata and record querying**
2. ❌ **Skills endpoints require a `server-session-id` from BC Server tier's active sessions**
3. ❌ **WebSocket sessions are on the Web Client tier - different from Server tier sessions**
4. ❌ **No way to create Server tier sessions programmatically without custom code**

### Technical Details

The Copilot API lookup (ControllerHelper.cs:29):
```csharp
session = tenant.ActiveSessions.SingleOrDefault<NavSession>(
    s => s.ExternalId == serverSessionId
);
```

This searches `tenant.ActiveSessions` - sessions managed by the NAV Server service. WebSocket sessions are managed separately by the Web Client tier and aren't in this collection.

---

## Recommended Solution: Custom MCP Endpoint in CopilotPatcher

### Overview

Extend CopilotPatcher to add a new `/mcp/*` endpoint that:
- ✅ Uses API key authentication (already working)
- ✅ Creates temporary BC sessions internally
- ✅ Exposes the same page metadata & record querying capabilities
- ✅ No external session management required

### Implementation

Add a new controller class to CopilotPatcher that reuses the existing Copilot API data providers:

```csharp
// File: CopilotPatcher/McpController.cs

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Dynamics.Nav.Runtime;
using Microsoft.Dynamics.Nav.Service.CopilotApi.Models;
using Microsoft.Dynamics.Nav.Service.CopilotApi.Search.Metadata;
using Microsoft.Dynamics.Nav.Types;
using System;
using System.Collections.Generic;

namespace CopilotPatcher
{
    [ApiController]
    [Route("mcp")]
    [Authorize] // Uses our OnPremApiKeyAuthHandler
    public class McpController : Controller
    {
        // Helper to create temporary session for operations
        private NavSession CreateTempSession(string tenantId)
        {
            if (!NavEnvironment.Instance.Tenants.TryGetTenantById(tenantId, out var tenant))
            {
                throw new InvalidOperationException($"Tenant '{tenantId}' not found");
            }

            // Create a temporary system session for the operation
            NavSession session = null;
            ((ITenantSessionHandler)tenant).RunTenantActionInSystemSessionAsync(
                async (t, s) => { session = s; },
                readOnly: true
            ).GetAwaiter().GetResult();

            return session;
        }

        /// <summary>
        /// Search for pages by name
        /// GET /mcp/pages/search?tenantId=default&query=Customer&pageTypes=List&pageTypes=Card&top=10
        /// </summary>
        [HttpGet("pages/search")]
        public IActionResult SearchPages(
            [FromQuery] string tenantId,
            [FromQuery] string query,
            [FromQuery] string[] pageTypes,
            [FromQuery] int top = 10)
        {
            try
            {
                using (var session = CreateTempSession(tenantId))
                {
                    var results = CopilotMetadataSearch.SearchObjectsAccessibleToSessionAsync(
                        session,
                        ObjectType.Page,
                        pageTypes,
                        new[] { query },
                        top,
                        null, // capability
                        default // cancellation token
                    ).GetAwaiter().GetResult();

                    return Ok(results);
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        /// <summary>
        /// Get page metadata by ID
        /// GET /mcp/pages/22?tenantId=default
        /// </summary>
        [HttpGet("pages/{pageId}")]
        public IActionResult GetPageMetadata(
            int pageId,
            [FromQuery] string tenantId)
        {
            try
            {
                using (var session = CreateTempSession(tenantId))
                {
                    var metadata = PageMetadataResponse.Create(session, pageId);
                    return Ok(metadata);
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        /// <summary>
        /// Get page summary with records
        /// GET /mcp/pages/22/records?tenantId=default&filters='Balance (LCY)'='>1000'&topRecords=5
        /// </summary>
        [HttpGet("pages/{pageId}/records")]
        public IActionResult GetPageRecords(
            int pageId,
            [FromQuery] string tenantId,
            [FromQuery] string[] filters,
            [FromQuery] string sortField,
            [FromQuery] string sortDirection,
            [FromQuery] int topRecords = 5,
            [FromQuery] bool includeCount = false,
            [FromQuery] bool includeRecordFields = true,
            [FromQuery] string[] fieldsToInclude = null)
        {
            try
            {
                using (var session = CreateTempSession(tenantId))
                {
                    var summary = CopilotDataProvider.GetPageSummary(
                        session,
                        pageId,
                        filters,
                        sortField,
                        sortDirection,
                        topRecords,
                        includeCount,
                        includeRecordFields,
                        fieldsToInclude,
                        NavCancellationToken.None
                    );

                    return Ok(summary);
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        /// <summary>
        /// Get complete record data
        /// GET /mcp/pages/22/records/{systemId}?tenantId=default
        /// </summary>
        [HttpGet("pages/{pageId}/records/{systemId}")]
        public IActionResult GetRecordData(
            int pageId,
            Guid systemId,
            [FromQuery] string tenantId)
        {
            try
            {
                using (var session = CreateTempSession(tenantId))
                {
                    var record = CopilotDataProvider.GetPageRecordSummary(
                        session,
                        pageId,
                        systemId,
                        includeRecordFields: true
                    );

                    return Ok(record);
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }
    }
}
```

### Update CopilotApiPatcher.cs

Add the new controller to the ASP.NET Core pipeline:

```csharp
// In CopilotApiStartup.ConfigureServices method:
public void ConfigureServices(IServiceCollection services)
{
    services.AddRouting();
    services.AddControllers()
        .AddApplicationPart(typeof(McpController).Assembly); // Add MCP controller

    // ... existing code ...
}
```

---

## API Endpoints

### 1. Search Pages
```bash
GET /mcp/pages/search?tenantId=default&query=Customer&pageTypes=List&pageTypes=Card&top=10

Headers:
  X-Copilot-ApiKey: your-secret-key-here

Response:
[
  {
    "Name": "Customer List",
    "Id": 22,
    "SourceTableName": "Customer",
    "Fields": [...],
    "Controls": [...],
    "SubPages": [...]
  }
]
```

### 2. Get Page Metadata
```bash
GET /mcp/pages/22?tenantId=default

Headers:
  X-Copilot-ApiKey: your-secret-key-here

Response:
{
  "Name": "Customer List",
  "Id": 22,
  "SourceTableName": "Customer",
  "Fields": [
    { "Id": 1, "Name": "No.", "Type": "Code", "MaxLength": 20 },
    { "Id": 2, "Name": "Name", "Type": "String" }
  ],
  "Controls": [...],
  "SubPages": [...]
}
```

### 3. Query Records
```bash
GET /mcp/pages/22/records?tenantId=default&filters='Balance (LCY)'='>1000'&topRecords=5&fieldsToInclude=No.&fieldsToInclude=Name

Headers:
  X-Copilot-ApiKey: your-secret-key-here

Response:
{
  "Caption": "Customer List",
  "Url": "http://...",
  "TotalRecordCount": 15,
  "Records": [
    {
      "SystemId": "...",
      "Heading": "Customer 10000",
      "Fields": [
        { "Caption": "No.", "FieldValue": "10000" },
        { "Caption": "Name", "FieldValue": "Adatum Corporation" }
      ]
    }
  ]
}
```

### 4. Get Record Data
```bash
GET /mcp/pages/22/records/{systemId}?tenantId=default

Headers:
  X-Copilot-ApiKey: your-secret-key-here

Response:
{
  ... complete OData-style record ...
}
```

---

## Deployment Steps

1. **Add McpController.cs** to CopilotPatcher project
2. **Update CopilotApiPatcher.cs** to register the controller
3. **Rebuild and deploy**:
   ```bash
   cd "C:\bc4ubuntu\Decompiled\bc-poc\CopilotPatcher"
   dotnet clean
   dotnet publish --configuration Release --output ".\publish"

   docker stop Cronus27
   docker cp ".\publish\CopilotPatcher.dll" Cronus27:"C:/Program Files/Microsoft Dynamics NAV/270/Service/CopilotPatcher.dll"
   docker start Cronus27
   ```

4. **Test**:
   ```bash
   curl -H "X-Copilot-ApiKey: your-secret-key-here" \
     "http://Cronus27:7100/BC/copilot/mcp/pages/22?tenantId=default"
   ```

---

## MCP Server Implementation

Once the custom endpoint is deployed, implement the MCP server:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const server = new McpServer({
  name: 'business-central',
  version: '1.0.0'
});

// Tool: Search for pages
server.tool(
  'bc_search_pages',
  'Search for Business Central pages',
  {
    query: { type: 'string', description: 'Search query' },
    pageTypes: { type: 'array', items: { type: 'string' } }
  },
  async (args) => {
    const params = new URLSearchParams({
      tenantId: 'default',
      query: args.query as string,
      top: '10'
    });

    (args.pageTypes as string[])?.forEach(type =>
      params.append('pageTypes', type)
    );

    const response = await fetch(
      `http://Cronus27:7100/BC/copilot/mcp/pages/search?${params}`,
      { headers: { 'X-Copilot-ApiKey': API_KEY } }
    );

    return await response.json();
  }
);

// Tool: Get page metadata
server.tool(
  'bc_get_page',
  'Get Business Central page metadata',
  {
    pageId: { type: 'number', description: 'Page ID' }
  },
  async (args) => {
    const response = await fetch(
      `http://Cronus27:7100/BC/copilot/mcp/pages/${args.pageId}?tenantId=default`,
      { headers: { 'X-Copilot-ApiKey': API_KEY } }
    );

    return await response.json();
  }
);

// Tool: Query records
server.tool(
  'bc_query_records',
  'Query records from a page',
  {
    pageId: { type: 'number' },
    filters: { type: 'array', items: { type: 'string' } },
    fields: { type: 'array', items: { type: 'string' } }
  },
  async (args) => {
    const params = new URLSearchParams({
      tenantId: 'default',
      topRecords: '5',
      includeRecordFields: 'true'
    });

    (args.filters as string[])?.forEach(f =>
      params.append('filters', f)
    );
    (args.fields as string[])?.forEach(f =>
      params.append('fieldsToInclude', f)
    );

    const response = await fetch(
      `http://Cronus27:7100/BC/copilot/mcp/pages/${args.pageId}/records?${params}`,
      { headers: { 'X-Copilot-ApiKey': API_KEY } }
    );

    return await response.json();
  }
);
```

---

## Benefits

✅ **No session management** - Server creates temporary sessions internally
✅ **Simple authentication** - Just API key
✅ **Reuses existing code** - Leverages Copilot API data providers
✅ **Same capabilities** - Full page metadata and record querying
✅ **Easy deployment** - Part of CopilotPatcher
✅ **Clean API design** - RESTful, simple to use

---

## Next Steps

1. **Implement McpController** in CopilotPatcher project
2. **Test custom endpoints** with curl
3. **Build MCP server** using the new endpoints
4. **Add MCP tools** for page search, metadata, and record queries
5. **Deploy and integrate** with Claude Desktop or other MCP clients

---

## Files Created

- ✅ `MICROSOFT-AGENT-API-DISCOVERY.md` - Initial API discovery
- ✅ `COPILOT-API-FINDINGS.md` - Detailed endpoint documentation
- ✅ `INTEGRATION-GUIDE.md` - WebSocket + API integration attempt
- ✅ `FINAL-RECOMMENDATION.md` - This file (solution recommendation)
- ✅ `poc-copilot-api-query.ts` - Standalone POC (requires sessions)
- ✅ `poc-websocket-copilot-api.ts` - WebSocket + API POC (session incompatibility found)
- ⏳ `McpController.cs` - **TO BE CREATED**

---

## Conclusion

The investigation revealed that the Copilot API Skills endpoints have excellent capabilities but require BC Server tier sessions that can't be created from WebSocket connections.

The **cleanest solution is to extend CopilotPatcher with a custom `/mcp/*` endpoint** that bypasses session requirements while providing the same capabilities. This approach:
- Requires minimal new code
- Reuses existing BC data providers
- Provides a simple, stateless API
- Works with existing API key authentication

This solution provides the perfect foundation for a powerful MCP server that gives Claude full access to Business Central's UI metadata and data.
