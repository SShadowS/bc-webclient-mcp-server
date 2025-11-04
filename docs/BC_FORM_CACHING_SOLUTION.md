# Business Central Form Caching Solution

## Problem Statement
Business Central (BC) caches forms at the WebSocket connection level, causing all page requests within the same connection to return the same cached form data. This results in Pages 22 (Customer List) and 30 (Item Card) incorrectly returning Page 21 (Customer Card) data.

## Root Cause Analysis

### 1. Connection-Level Caching
BC maintains a form cache per WebSocket connection. When a form is opened via `OpenForm`, BC caches it at the connection level. Subsequent `OpenForm` requests on the same connection return the cached form, even if different page IDs are specified.

### 2. Real BC Client Behavior
Through WebSocket capture analysis (`capture-websocket-cdp.mjs`), we discovered that the real BC web client:
- Creates a **new WebSocket connection for each page navigation**
- Never reuses connections across different pages
- This prevents BC's connection-level caching from affecting different pages

## Solutions Implemented

### 1. LoadForm Pattern (✅ Implemented)
Implemented the complete LoadForm solution to properly load child forms and get complete page data:

```typescript
// Extract ServerIds from form hierarchy
const { shellFormId, childFormIds } = extractServerIds(dataToProcess);

// Filter child forms using BC's criteria
const formsToLoad = filterFormsToLoad(childFormIds);
// Criteria: Visible !== false AND (DelayedControls OR ExpressionProperties)

// Load each child form
for (const child of formsToLoad) {
  const loadFormInteraction = createLoadFormInteraction(child.serverId, callbackId);
  const response = await this.connection.invoke(loadFormInteraction);
  allHandlers.push(...response);
}
```

### 2. Proper Query String Format (✅ Fixed)
BC requires `namedParameters` in a specific format with a "query" property:

```typescript
// ❌ WRONG - BC rejects with "RPC Error"
namedParameters: {
  company: "CRONUS",
  tenant: "default",
  page: "21"
}

// ✅ CORRECT - BC protocol format
namedParameters: {
  query: "tenant=default&company=CRONUS%20International%20Ltd.&page=21&runinframe=1&dc=1761985418277&startTraceId=uuid&bookmark="
}
```

### 3. Unique Request Parameters (✅ Implemented)
Each request needs unique identifiers to prevent caching:

```typescript
// Generate unique UUID v4 for startTraceId
const startTraceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  const v = c === 'x' ? r : (r & 0x3) | 0x8;
  return v.toString(16);
});

// Unique timestamp for dc parameter
const dc = Date.now();

// Build query string with all parameters
const queryString = `tenant=${encodeURIComponent(tenant)}&company=${encodeURIComponent(company)}&page=${pageId}&runinframe=1&dc=${dc}&startTraceId=${startTraceId}&bookmark=`;
```

### 4. Form Lifecycle Management (✅ Implemented)
Aggressive form closing to try to prevent caching:

```typescript
// Close ALL open forms before opening new page
const allOpenForms = this.connection.getAllOpenFormIds();
for (const formId of allOpenForms) {
  await this.connection.invoke({
    interactionName: 'CloseForm',
    namedParameters: { FormId: formId }
  });
}
```

## Remaining Issue: Connection-Level Cache

Despite all the above fixes, BC still returns cached forms because we're reusing the same WebSocket connection. The only complete solution is to match the real BC client's behavior.

### Required Architectural Change (❌ Not Yet Implemented)

Create a new WebSocket connection for each page request:

```typescript
// Conceptual solution - requires major refactoring
class BCSessionConnection {
  async getPageMetadata(pageId: string) {
    // Create new connection for this page
    const connection = new BCRawWebSocketClient(...);
    await connection.connect();
    await connection.openSession();

    // Open the page
    const result = await connection.invoke({
      interactionName: 'OpenForm',
      namedParameters: { query: buildQueryString(pageId) }
    });

    // Close connection after getting data
    await connection.disconnect();

    return result;
  }
}
```

## Test Results

### Current State
- **Page 21 (Customer Card)**: ✅ Works correctly (formId: 398)
- **Page 22 (Customer List)**: ❌ Returns Page 21 data (cached formId: 398)
- **Page 30 (Item Card)**: ❌ Returns Page 21 data (cached formId: 398)

### Query Strings Generated (Correct)
```
Page 21: tenant=default&company=CRONUS%20Danmark%20A%2FS&page=21&runinframe=1&dc=1761985418277&startTraceId=0fc97f43-51d2-4538-9714-fe314b2cf0f0&bookmark=
Page 22: tenant=default&company=CRONUS%20Danmark%20A%2FS&page=22&runinframe=1&dc=1761985418427&startTraceId=381f5718-a51a-4f12-9e2f-ac81283ca7af&bookmark=
Page 30: tenant=default&company=CRONUS%20Danmark%20A%2FS&page=30&runinframe=1&dc=1761985418470&startTraceId=1f9b6a56-a535-458a-91e9-815bb69e0f66&bookmark=
```

## Lessons Learned

1. **BC Protocol Nuances**: The `namedParameters` must be in query string format within a "query" property, not as separate object properties.

2. **Connection Lifecycle**: BC's caching is tied to WebSocket connection lifecycle, not just request parameters.

3. **Real Client Behavior**: Always analyze real client behavior with tools like WebSocket capture to understand the actual protocol.

4. **LoadForm Necessity**: Child forms must be loaded separately using LoadForm to get complete page data.

## Recommendations

### Short-term Workaround
For MCP server usage where multiple pages aren't frequently accessed in sequence, the current implementation works for single page access.

### Long-term Solution
Implement connection pooling with a new connection per page request:
- Connection pool manager
- One connection per page navigation
- Automatic connection cleanup
- Connection reuse only for same page operations

### Alternative Approaches
1. **Server-side caching bypass**: Investigate if BC has any server-side flags to disable form caching
2. **Session reset**: Try sending session reset commands between page requests
3. **Navigate interaction**: Investigate if BC's Navigate interaction can switch pages without caching

## Files Modified

1. `src/tools/get-page-metadata-tool.ts` - Main implementation
2. `src/connection/bc-session-connection.ts` - Connection management
3. `src/util/loadform-helpers.ts` - LoadForm utilities
4. `src/core/interfaces.ts` - Interface definitions
5. `src/mocks/mock-bc-connection.ts` - Mock implementation

## Testing

Run the test with:
```bash
cd "C:\bc4ubuntu\Decompiled\bc-poc"
npm run test:mcp:real:client
```

Or with TypeScript directly:
```bash
npx tsx test-mcp-client-real.mjs
```