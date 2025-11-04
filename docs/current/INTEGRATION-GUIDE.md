# Integration Guide: WebSocket + Copilot API

**Status**: Ready for implementation with your existing WebSocket client
**Date**: 2025-10-29

---

## Summary

You can now use your existing WebSocket client to create BC sessions, then use those session IDs with the Copilot API Skills endpoints to get page metadata and query records.

---

## Architecture

```
┌─────────────────────┐
│   MCP Server        │
└──────┬──────────────┘
       │
       ├─────► WebSocket Client ────────┐
       │       (Session Creation)        │
       │                                  │
       │       ┌──────────────────────────┘
       │       │ ServerSessionId
       │       ▼
       └─────► Copilot API Client ───────► Skills Endpoints
               (Page Metadata & Records)    (/skills/*)
```

**Flow**:
1. **WebSocket**: Authenticate & create session → Get `ServerSessionId`
2. **Copilot API**: Use `ServerSessionId` + API Key → Query metadata & data

---

## Step 1: Extract Session ID from WebSocket

I've added a `getServerSessionId()` method to `BCRawWebSocketClient`:

```typescript
// src/BCRawWebSocketClient.ts (ALREADY UPDATED)
getServerSessionId(): string | null {
  return this.serverSessionId;
}
```

**Usage**:
```typescript
const wsClient = new BCRawWebSocketClient(config, username, password, tenant);
await wsClient.authenticateWeb();
await wsClient.connect();

// Open a session (any page will do)
await wsClient.openSession({
  interactionsToInvoke: [{
    interactionName: 'OpenForm',
    namedParameters: { query: 'page=21' }
  }]
});

const serverSessionId = wsClient.getServerSessionId();
// Example: "0000Kq...5Agw=="
```

---

## Step 2: Use Session ID with Copilot API

Create a Copilot API client that includes the session ID:

```typescript
interface CopilotApiConfig {
  baseUrl: string;           // 'http://Cronus27:7100/BC/copilot'
  apiKey: string;            // 'your-secret-key-here'
  tenantId: string;          // 'default'
  serverSessionId: string;   // From WebSocket
}

class CopilotApiClient {
  constructor(private config: CopilotApiConfig) {}

  private async fetch(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.config.baseUrl}${path}`;
    const headers = {
      'X-Copilot-ApiKey': this.config.apiKey,
      'server-session-id': this.config.serverSessionId, // ← Required!
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await globalThis.fetch(url, { ...options, headers });

    if (!response.ok) {
      throw new Error(`API Error ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  // ... methods below
}
```

---

## Step 3: Available Endpoints

### Search for Pages
```typescript
async searchPages(query: string, pageTypes?: string[]): Promise<PageMetadataResponse[]> {
  const params = new URLSearchParams({
    tenantId: this.config.tenantId,
    query: query,
    top: '10'
  });

  if (pageTypes) {
    pageTypes.forEach(type => params.append('pageTypes', type));
  }

  return this.fetch(`/v2.0/skills/pageMetadata?${params}`);
}

// Usage:
const pages = await api.searchPages('Customer', ['List', 'Card']);
// Returns: [{ Name: 'Customer List', Id: 22, Fields: [...], Controls: [...] }, ...]
```

### Get Page Metadata by ID
```typescript
async getPageMetadata(pageId: number): Promise<PageMetadataResponse> {
  const params = new URLSearchParams({
    tenantId: this.config.tenantId
  });

  return this.fetch(`/v2.0/skills/pageMetadata/${pageId}?${params}`);
}

// Usage:
const metadata = await api.getPageMetadata(22); // Customer List
// Returns: {
//   Name: 'Customer List',
//   Id: 22,
//   SourceTableName: 'Customer',
//   Fields: [
//     { Id: 1, Name: 'No.', Type: 'Code', MaxLength: 20 },
//     { Id: 2, Name: 'Name', Type: 'String', MaxLength: 100 },
//     ...
//   ],
//   Controls: [
//     { ControlId: 1, Caption: 'New', HasDrillDown: false, HasLookup: false },
//     ...
//   ],
//   SubPages: [...]
// }
```

### Get Page Summary with Records
```typescript
async getPageSummary(
  pageId: number,
  options: {
    filters?: string[];       // e.g. ["'Balance (LCY)' = '>1000'"]
    sortField?: string;       // e.g. 'Name'
    sortDirection?: 'Ascending' | 'Descending';
    topRecords?: number;      // max 5
    includeCount?: boolean;
    includeRecordFields?: boolean;
    fieldsToInclude?: string[];  // e.g. ['No.', 'Name', 'Balance (LCY)']
  }
): Promise<PageSummaryResponse> {
  const params = new URLSearchParams({
    tenantId: this.config.tenantId,
    topRecords: (options.topRecords || 5).toString(),
    includeCount: (options.includeCount || false).toString(),
    includeRecordFields: (options.includeRecordFields || true).toString(),
  });

  options.filters?.forEach(f => params.append('filters', f));
  options.fieldsToInclude?.forEach(f => params.append('fieldsToInclude', f));
  if (options.sortField) {
    params.append('sortField', options.sortField);
    params.append('sortDirection', options.sortDirection || 'Ascending');
  }

  return this.fetch(`/v2.0/skills/pages/${pageId}/summary?${params}`);
}

// Usage:
const summary = await api.getPageSummary(22, {
  filters: ["'Balance (LCY)' = '>1000'"],
  topRecords: 5,
  includeCount: true,
  fieldsToInclude: ['No.', 'Name', 'Balance (LCY)']
});
// Returns: {
//   Caption: 'Customer List',
//   Url: 'http://...',
//   TotalRecordCount: 15,
//   Records: [
//     {
//       SystemId: '...',
//       Heading: 'Customer 10000',
//       Fields: [
//         { Caption: 'No.', FieldValue: '10000', FieldType: 'Code' },
//         { Caption: 'Name', FieldValue: 'Adatum Corporation', FieldType: 'String' },
//         { Caption: 'Balance (LCY)', FieldValue: '1500.00', FieldType: 'Decimal' }
//       ]
//     },
//     ...
//   ]
// }
```

### Get Complete Record Data (OData-style)
```typescript
async getRecordData(
  pageId: number,
  systemId: string,
  options?: {
    includeFields?: boolean;
    includeParts?: boolean;
    includeRelatedPages?: boolean;
  }
): Promise<any> {
  const params = new URLSearchParams({
    tenantId: this.config.tenantId,
    includeFields: 'true',
    includeParts: 'true',
    includeRelatedPages: 'true'
  });

  return this.fetch(`/v2.0/skills/pages/${pageId}/records/${systemId}/data?${params}`);
}

// Usage:
const recordData = await api.getRecordData(22, customerSystemId);
// Returns: Complete OData-style record with all fields, parts, and related pages
```

---

## Step 4: Complete Integration Example

```typescript
import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import { CopilotApiClient } from './copilot-api-client.js';

async function main() {
  // 1. Create WebSocket session
  const wsClient = new BCRawWebSocketClient(
    { baseUrl: 'http://Cronus27/BC', wsEndpoint: 'ws://Cronus27/BC' },
    'ADMIN',
    '',
    'default'
  );

  await wsClient.authenticateWeb();
  await wsClient.connect();
  await wsClient.openSession({
    interactionsToInvoke: [{ interactionName: 'OpenForm', namedParameters: { query: 'page=21' } }]
  });

  const serverSessionId = wsClient.getServerSessionId();
  if (!serverSessionId) {
    throw new Error('Failed to get session ID');
  }

  // 2. Create Copilot API client with session ID
  const copilotApi = new CopilotApiClient({
    baseUrl: 'http://Cronus27:7100/BC/copilot',
    apiKey: 'your-secret-key-here',
    tenantId: 'default',
    serverSessionId
  });

  // 3. Use Copilot API
  const pages = await copilotApi.searchPages('Customer', ['List']);
  const metadata = await copilotApi.getPageMetadata(22);
  const summary = await copilotApi.getPageSummary(22, {
    topRecords: 5,
    includeRecordFields: true
  });

  console.log('Pages:', pages.map(p => p.Name));
  console.log('Fields:', metadata.Fields.map(f => f.Name));
  console.log('Records:', summary.Records?.length);

  // 4. Cleanup
  await wsClient.disconnect();
}
```

---

## Step 5: MCP Server Integration

### Session Management Strategy

**Option A: Session Pool** (Recommended)
- Create multiple WebSocket sessions on startup
- Pool them for concurrent requests
- Refresh sessions periodically

**Option B: Session Per Tool Call**
- Create session on demand
- Use for single request
- Disconnect after

**Option C: Single Long-Lived Session**
- Create one session on startup
- Reuse for all requests
- Implement keep-alive

### MCP Tool Example

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

class BCMcpServer {
  private wsClient: BCRawWebSocketClient | null = null;
  private copilotApi: CopilotApiClient | null = null;

  async initialize() {
    // Create WebSocket session
    this.wsClient = new BCRawWebSocketClient(config, username, password, tenant);
    await this.wsClient.authenticateWeb();
    await this.wsClient.connect();
    await this.wsClient.openSession({
      interactionsToInvoke: [{ interactionName: 'OpenForm', namedParameters: { query: 'page=21' } }]
    });

    const sessionId = this.wsClient.getServerSessionId();

    // Create Copilot API client
    this.copilotApi = new CopilotApiClient({
      baseUrl: 'http://Cronus27:7100/BC/copilot',
      apiKey: 'your-secret-key-here',
      tenantId: 'default',
      serverSessionId: sessionId!
    });
  }

  registerTools(server: McpServer) {
    server.tool(
      'bc_search_pages',
      'Search for BC pages by name',
      {
        query: { type: 'string', description: 'Search query' },
        pageTypes: { type: 'array', items: { type: 'string' }, description: 'Page types to search' }
      },
      async (args) => {
        const pages = await this.copilotApi!.searchPages(args.query as string, args.pageTypes as string[]);
        return { pages };
      }
    );

    server.tool(
      'bc_get_page_metadata',
      'Get metadata for a specific page',
      {
        pageId: { type: 'number', description: 'Page ID' }
      },
      async (args) => {
        const metadata = await this.copilotApi!.getPageMetadata(args.pageId as number);
        return { metadata };
      }
    );

    server.tool(
      'bc_query_records',
      'Query records from a page',
      {
        pageId: { type: 'number', description: 'Page ID' },
        filters: { type: 'array', items: { type: 'string' }, description: 'Filters' },
        topRecords: { type: 'number', description: 'Number of records to return' }
      },
      async (args) => {
        const summary = await this.copilotApi!.getPageSummary(args.pageId as number, {
          filters: args.filters as string[],
          topRecords: args.topRecords as number || 5,
          includeRecordFields: true
        });
        return { summary };
      }
    );
  }
}
```

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
  Fields: FieldMetadata[];
  Controls: PageControlMetadata[];
  SubPages: InfoPartMetadata[];
  SupportedCapabilities: number;      // Flags for filtering, analysis
}
```

### FieldMetadata
```typescript
interface FieldMetadata {
  Id: number;
  Name: string;
  Type: string;                       // "Code", "String", "Integer", "Option"
  Description: string;
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
  Caption: string;
  Tooltip: string;
  HasDrillDown: boolean;
  HasLookup: boolean;
  Visible: boolean;
}
```

---

## Testing

### Test Session Creation
```bash
cd bc-poc
npx tsx test-websocket-session.ts
# Should output: Server Session ID: 0000Kq...5Agw==
```

### Test Copilot API with Session
```bash
curl -H "X-Copilot-ApiKey: your-secret-key-here" \
     -H "server-session-id: YOUR_SESSION_ID_HERE" \
     "http://Cronus27:7100/BC/copilot/v2.0/skills/pageMetadata/22?tenantId=default"
# Should return page metadata JSON
```

---

## Next Steps

1. ✅ **WebSocket session extraction** - DONE (`getServerSessionId()` method added)
2. ⏳ **Create Copilot API client** - Use provided implementation
3. ⏳ **Implement MCP server** - Use session pool strategy
4. ⏳ **Add MCP tools** - Search pages, get metadata, query records
5. ⏳ **Handle session lifecycle** - Keep-alive, refresh, error recovery

---

## Benefits of This Approach

✅ **Uses official BC APIs** - No custom endpoints needed
✅ **Rich metadata** - Complete page structure, fields, controls
✅ **Powerful querying** - Filters, sorting, field selection
✅ **Stateless for Copilot API** - Only WebSocket manages session
✅ **Extensible** - Easy to add more Skills API endpoints

---

## Files

- `src/BCRawWebSocketClient.ts` - ✅ Updated with `getServerSessionId()`
- `poc-websocket-copilot-api.ts` - POC implementation (use your credentials)
- `COPILOT-API-FINDINGS.md` - Detailed API documentation
- `INTEGRATION-GUIDE.md` - This file

---

## Support

If you encounter issues:
1. Verify WebSocket session is established (`serverSessionId` is not null)
2. Check Copilot API is accessible (`curl http://Cronus27:7100/BC/copilot/health`)
3. Verify API key is set (`BC_COPILOT_API_KEYS` environment variable)
4. Check session is valid (try Skills API endpoint with session ID)
