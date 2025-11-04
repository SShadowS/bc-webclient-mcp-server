# Business Central MCP Server - Architecture

## Overview

After extensive testing of BC's WebSocket protocol, we've determined the optimal architecture for the MCP server.

## 🎯 CRITICAL DISCOVERY: BC Has Built-in AI Agent Support!

**See**: [`BC-AI-AGENT-ANALYSIS.md`](./BC-AI-AGENT-ANALYSIS.md) for complete analysis.

### Key Findings

Business Central v26.0 includes a **native AI agent framework** that solves the exact problem we're addressing. BC provides:

1. **IClientMetadataApi Interface** - Structured APIs for page metadata
   - `GetMasterPage(pageId)` - Returns complete page structure
   - `SearchClientObjects(query)` - Search pages/tables
   - `GetFields(tableNo)` - Get field definitions
   - `GetTableMetadata(tableNo)` - Get table info

2. **MasterPage Class** - Clean, typed page descriptors with:
   - CommandBar (actions/buttons with systemAction codes)
   - ContentArea (fields with types, validation, tooltips)
   - PageProperties (permissions: Insert/Modify/Delete)
   - Methods and Triggers (callable procedures)

3. **External LLM Integration** - BC delegates to Azure Copilot service
   - Proves external AI integration is viable
   - Uses plain text instructions (no special schema)
   - Supports user intervention workflows

### Recommended Approach: Use BC's Metadata APIs

**Instead of parsing handler arrays**, we should:

✅ Call `GetMasterPage()` via WebSocket Invoke
✅ Get structured MasterPage with all metadata
✅ Convert to LLM-friendly JSON format
✅ Use BC OData/REST APIs for writes
✅ Follow BC's patterns for agent interaction

**Benefits**:
- **Stable** - APIs are versioned and documented
- **Clean** - No handler parsing needed
- **Maintained** - BC updates these APIs properly
- **Tested** - BC uses them internally
- **Complete** - All metadata in one call

**Next Step**: Test if we can call these metadata APIs via WebSocket Invoke from our external MCP server.

---

## Executive Summary

**Recommendation: Hybrid Approach (Option B)**

- ✅ **Read operations** via WebSocket Invoke protocol
- ✅ **Write operations** via official BC APIs (OData/REST)
- ✅ **Original simple tool design** preserved
- ✅ **LLM-friendly** interface maintained

## Why Hybrid?

### What We Discovered

BC's WebSocket protocol is an **internal, undocumented UI protocol**:

1. **ONE method for everything** - `Invoke` handles all operations
2. **Complex stateful protocol** - dynamic form IDs, control paths, sequence numbers
3. **Gzip-compressed handler arrays** - not standard JSON-RPC responses
4. **UI-centric design** - meant for browser, not programmatic access
5. **Fragile** - can change in minor BC updates without notice

### The Protocol Reality

```javascript
// What the browser sends
{
  "method": "Invoke",
  "params": [{
    "sessionId": "DEFAULTCRONUS Danmark A/SSR6389729...",
    "sessionKey": "sr6389729...",
    "company": "CRONUS Danmark A/S",
    "openFormIds": ["4E", "99"],
    "formId": "3F",
    "sequenceNo": "mhb9jot6#27",
    "lastClientAckSequenceNumber": 80,
    "interactionsToInvoke": [{
      "interactionName": "InvokeAction",
      "namedParameters": "{\"systemAction\":0,\"key\":null,\"expectedForm\":{\"cacheKey\":\"9300:embedded(False)\"}}",
      "controlPath": "server:c[2]/c[0]/c[0]",
      "formId": "3F",
      "callbackId": "19"
    }]
  }]
}

// BC responds with
{
  "jsonrpc": "2.0",
  "compressedResult": "H4sIAAAAAAAACuy96Y7j2LEu+ipC4hzYxk5mi..."  // Base64 gzip
}

// Decompressed: array of 11+ handlers
[
  {"handlerType": "DN.CachedSessionInitHandler", "parameters": [...]},
  {"handlerType": "DN.LogicalClientInitHandler", "parameters": [...]},
  {"handlerType": "DN.EmptyPageStackHandler", "parameters": [...]},
  // ... 8 more handlers
]
```

## Tool-by-Tool Feasibility Analysis

### 1. search_pages / list_pages ✅

**Status:** FEASIBLE via Invoke

**Implementation:**
- Use BC's "Tell Me" search (Ctrl+Q) via `InvokeSessionAction`
- Parse search results from handler responses
- Return list of discoverable pages for current user

**Complexity:** Medium (2-4 days)

**Method:**
```typescript
async searchPages(query: string): Promise<Page[]> {
  // 1. Open Tell Me search pane
  // 2. Send search query
  // 3. Parse result handlers
  // 4. Return normalized page list
}
```

**Reliability:** High - Tell Me is a stable, documented user feature

---

### 2. get_page_metadata ✅

**Status:** FEASIBLE via Invoke (read-only)

**Implementation:**
- Use `OpenForm` interaction to open the page
- Parse handler responses for control tree, fields, actions
- Close form when done to avoid leaking resources

**Complexity:** High (1-2 weeks for initial parser)

**Method:**
```typescript
async getPageMetadata(pageId: number): Promise<PageMetadata> {
  // 1. Invoke OpenForm for page
  // 2. Parse handlers: CachedSessionInitHandler, LogicalClientInitHandler
  // 3. Extract: fields, actions, control tree, data types
  // 4. Close form
  // 5. Return normalized metadata
}
```

**Reliability:** Medium - Requires robust handler parsing, iterative hardening

---

### 3. read_page_data ⚠️

**Status:** PARTIALLY FEASIBLE via Invoke

**Implementation:**
- Open list page via `OpenForm`
- Extract initial dataset from handlers
- Optionally implement pagination via additional `InvokeAction` calls

**Complexity:** Medium-High (3-7 days)

**Method:**
```typescript
async readPageData(pageId: number, filters?: Filter[]): Promise<Record[]> {
  // 1. Open list page
  // 2. Parse dataset handlers
  // 3. Extract initial rows
  // 4. Optional: implement "load more"
  // 5. Return normalized records
}
```

**Limitations:**
- Initial dataset only (20-50 rows typically)
- Pagination requires replaying browser scroll/load interactions
- Filtering/sorting across all pages is complex

**Reliability:** Medium - Good for "preview" use cases, limited for full data access

---

### 4. write_page_data ❌ → Use BC APIs

**Status:** NOT FEASIBLE via Invoke (too fragile)

**Why Not:**
- Requires accurate `controlPath` discovery per field
- Must handle validation, triggers, partial saves
- Different `systemAction` codes per page type
- Fragile across BC updates and customizations

**Recommended Approach:** Use official BC APIs

**Implementation:**
```typescript
async writePageData(pageId: number, data: Record): Promise<void> {
  // 1. Map page ID to OData/API endpoint
  // 2. Use BC REST API v2.0 or OData
  // 3. POST/PATCH via HTTP
  // 4. Handle standard REST errors
}
```

**Complexity:** Low (BC APIs are well-documented)

**Reliability:** High - Official, stable, supported APIs

---

### 5. execute_page_action ⚠️

**Status:** PARTIALLY FEASIBLE via Invoke (curated subset)

**Implementation:**
- Support well-known actions: Refresh, New, Edit, Delete
- Parse action bar from metadata
- Execute via `InvokeAction` with correct `systemAction` code

**Complexity:** High (3-5 days for subset)

**Method:**
```typescript
async executePageAction(
  pageId: number,
  action: 'refresh' | 'new' | 'edit' | 'delete' | 'custom',
  context?: any
): Promise<ActionResult> {
  // 1. Get page metadata
  // 2. Find action in action bar
  // 3. Map to systemAction code or controlPath
  // 4. Invoke with appropriate parameters
  // 5. Parse result handlers (dialogs, navigation, etc.)
}
```

**Limitations:**
- Custom AL actions require per-page knowledge
- Dialog handling is complex
- Navigation results need special parsing

**Reliability:** Medium - Works for standard actions, risky for custom

**Recommended Policy:**
- Support curated subset (Refresh, New, Edit, Open Related)
- Block or require allowlist for custom actions
- Document which actions are supported

---

### 6. search_pages ✅

**Status:** FEASIBLE via Invoke

**Implementation:** Same as list_pages - use Tell Me search

---

## Recommended Architecture

### Layer 1: MCP Tools (LLM Interface)

Simple, page-centric tools as originally designed:

```typescript
interface MCPTools {
  search_pages(query: string): Page[]
  get_page_metadata(pageId: number): PageMetadata
  read_page_data(pageId: number, options?: ReadOptions): Record[]
  write_page_data(pageId: number, data: Record): void
  execute_page_action(pageId: number, action: string): ActionResult
}
```

### Layer 2: Protocol Router

Routes operations to appropriate backend:

```typescript
class ProtocolRouter {
  // Route read operations to WebSocket
  async readViaWebSocket(pageId: number): Promise<Record[]> {
    return this.wsClient.openFormAndParseDataset(pageId);
  }

  // Route write operations to BC APIs
  async writeViaAPI(entityType: string, data: Record): Promise<void> {
    return this.apiClient.postToOData(entityType, data);
  }
}
```

### Layer 3: WebSocket Client

Handles BC's Invoke protocol:

```typescript
class BCWebSocketClient {
  // Core protocol
  async authenticateWeb(): Promise<void>
  async connect(): Promise<void>
  async openSession(): Promise<SessionInfo>
  async invoke(params: InvokeParams): Promise<Handler[]>

  // High-level operations
  async tellMeSearch(query: string): Promise<SearchResult[]>
  async openFormAndParseMetadata(pageId: number): Promise<PageMetadata>
  async openFormAndParseDataset(pageId: number): Promise<Record[]>
}
```

### Layer 4: Handler Parser

Parses BC's handler responses:

```typescript
class HandlerParser {
  parseSearchResults(handlers: Handler[]): SearchResult[]
  parsePageMetadata(handlers: Handler[]): PageMetadata
  parseDataset(handlers: Handler[]): Record[]
  parseActionBar(handlers: Handler[]): Action[]
}
```

### Layer 5: BC API Client

Uses official BC REST APIs:

```typescript
class BCAPIClient {
  async getEntity(entityType: string, id: string): Promise<Record>
  async postEntity(entityType: string, data: Record): Promise<Record>
  async patchEntity(entityType: string, id: string, data: Record): Promise<Record>
  async deleteEntity(entityType: string, id: string): Promise<void>
}
```

## Data Flow Examples

### Example 1: Search Pages (WebSocket)

```
LLM calls: search_pages("customer")
  ↓
MCP Tool: search_pages
  ↓
Protocol Router: route to WebSocket
  ↓
WebSocket Client: tellMeSearch("customer")
  ↓
BC WebSocket: Invoke(interactionName="OpenForm", Tell Me pane)
  ↓
BC WebSocket: Invoke(interactionName="SetSearchQuery", "customer")
  ↓
BC Response: Handlers with search results
  ↓
Handler Parser: parseSearchResults()
  ↓
Return: [{id: 21, name: "Customer Card"}, {id: 22, name: "Customer List"}]
```

### Example 2: Write Customer (BC API)

```
LLM calls: write_page_data(21, {name: "Acme Corp"})
  ↓
MCP Tool: write_page_data
  ↓
Protocol Router: route to BC API
  ↓
Page Mapper: pageId 21 → OData entity "customers"
  ↓
BC API Client: POST /api/v2.0/companies(...)/customers
  ↓
BC REST API: Creates customer, returns record
  ↓
Return: {id: "uuid", name: "Acme Corp", ...}
```

## Implementation Priority

### Phase 1: Read-Only Foundation (Weeks 1-3)

1. ✅ **Week 1**: WebSocket connection working (DONE!)
   - Authentication, OpenSession, Invoke, gzip handling

2. **Week 2**: Handler parsing infrastructure
   - Handler router
   - Parser for search results
   - Parser for page metadata (basic)

3. **Week 3**: Implement read-only tools
   - `search_pages` via Tell Me
   - `get_page_metadata` via OpenForm
   - `read_page_data` (initial dataset only)

### Phase 2: Write via BC APIs (Week 4)

4. **Week 4**: BC API integration
   - Page ID → Entity type mapping
   - OData/REST client
   - `write_page_data` via BC APIs

### Phase 3: Actions (Week 5-6)

5. **Week 5-6**: Curated actions
   - Parse action bar from metadata
   - Implement Refresh, New, Edit
   - Handle dialogs and navigation

### Phase 4: MCP Server (Week 7-8)

6. **Week 7**: MCP server scaffolding
   - Session management
   - Connection pooling
   - Error handling

7. **Week 8**: Testing and refinement
   - Golden response tests
   - Documentation
   - Examples

## Technical Challenges & Solutions

### Challenge 1: Handler Parsing

**Problem:** BC returns deeply nested handler arrays with no schema.

**Solution:**
- Create handler type registry
- Implement recursive parser with pattern matching
- Add golden response tests to detect breaking changes
- Start with most common handlers, expand iteratively

### Challenge 2: Form Lifecycle Management

**Problem:** Dynamic form IDs, must track open forms, avoid leaks.

**Solution:**
- Maintain session state cache
- Track: `{formId, pageId, controlTree, dataset}`
- Close forms after operations
- Implement timeout-based cleanup

### Challenge 3: Control Path Discovery

**Problem:** No documented mapping from fields to control paths.

**Solution:**
- Parse control tree from metadata handlers
- Build map: `{fieldName → controlPath}`
- Use only for read metadata, not writes (too fragile)

### Challenge 4: BC API Entity Mapping

**Problem:** Page ID ≠ Entity name in APIs.

**Solution:**
- Create configuration mapping
- Allow user to override mappings
- Provide sensible defaults for standard pages:
  ```typescript
  const PAGE_TO_ENTITY = {
    21: 'customers',
    27: 'items',
    9300: 'items',  // Item List
    31: 'vendors',
    // ... etc
  }
  ```

### Challenge 5: Protocol Fragility

**Problem:** WebSocket protocol can change in BC updates.

**Solution:**
- Version detection during OpenSession
- Handler parsing with fallbacks
- Capture raw handlers when parsing fails
- Log warnings, don't crash
- Graceful degradation: "This operation is not available in your BC version"

## Configuration

```typescript
interface MCPServerConfig {
  bc: {
    baseUrl: string
    username: string
    password: string
    tenantId?: string
    company?: string
  }

  routing: {
    // When to use WebSocket vs API
    preferWebSocket: boolean  // false = use APIs when available

    // Page ID to OData entity mapping
    pageEntityMap?: Record<number, string>

    // Custom action allowlist
    allowedCustomActions?: string[]
  }

  session: {
    maxOpenForms: number  // Close oldest when exceeded
    formTimeout: number  // Auto-close after N seconds
    requestTimeout: number  // RPC timeout
  }

  parsing: {
    logHandlersOnFailure: boolean
    strictParsing: boolean  // false = return partial data on parse errors
  }
}
```

## Error Handling

### Read Operations (WebSocket)

```typescript
class ReadError extends Error {
  constructor(
    public code: 'HANDLER_PARSE_ERROR' | 'FORM_NOT_FOUND' | 'TIMEOUT',
    message: string,
    public handlers?: any[]  // Raw handlers for debugging
  ) {
    super(message);
  }
}
```

### Write Operations (BC API)

```typescript
class WriteError extends Error {
  constructor(
    public code: 'API_ERROR' | 'VALIDATION_ERROR' | 'NOT_MAPPED',
    message: string,
    public apiResponse?: any
  ) {
    super(message);
  }
}
```

## Testing Strategy

### Unit Tests
- Handler parsers with golden responses
- Entity mapping logic
- Control path discovery

### Integration Tests
- Full read flow (search → metadata → data)
- Full write flow (map → API call → verify)
- Error scenarios (invalid page, network failure, etc.)

### Golden Response Tests
- Capture real OpenSession response
- Capture real OpenForm responses for common pages
- Assert parser extracts expected fields
- Update when BC protocol changes

## Performance Considerations

### WebSocket Operations
- **OpenSession**: 1-2 seconds (one-time per session)
- **Search**: 200-500ms per query
- **Get Metadata**: 500ms-1s per page
- **Read Data**: 300-800ms for initial dataset

### BC API Operations
- **Write**: 100-300ms per record
- **Batch**: 500ms-2s for 10-100 records

### Optimization
- Reuse WebSocket session across MCP requests
- Cache page metadata (invalidate on session end)
- Batch API writes when possible

## Security Considerations

1. **Credentials**: Store encrypted, never log
2. **Session cookies**: Secure storage, proper cleanup
3. **Rate limiting**: Honor BC limits, implement backoff
4. **Input validation**: Sanitize page IDs, entity names
5. **Output sanitization**: Remove internal form IDs from responses

## Maintenance Plan

### Monthly
- Review BC update notes for protocol changes
- Update golden response tests if needed
- Check for new handler types in logs

### Quarterly
- Expand handler parser support
- Add newly discovered page→entity mappings
- Review and update action allowlist

### Per BC Major Version
- Full compatibility testing
- Update documentation
- Consider handler parsing changes

## Success Metrics

### For LLMs
- **Simplicity**: Can explain tool usage in <200 words
- **Reliability**: >95% success rate for supported operations
- **Clarity**: Clear error messages when operations fail

### For Developers
- **Maintainability**: <1 day to add support for new handler type
- **Debuggability**: Full handler logging when enabled
- **Extensibility**: Easy to add new page→entity mappings

## Conclusion

The hybrid approach provides the best balance:

✅ **Simple MCP interface** - Original design preserved
✅ **Reliable writes** - Official BC APIs
✅ **Rich reads** - WebSocket for discovery and metadata
✅ **LLM-friendly** - Clean abstractions
✅ **Maintainable** - Limited scope of fragile UI protocol parsing

**Next step:** Implement Phase 1 (read-only foundation) based on working WebSocket PoC.
