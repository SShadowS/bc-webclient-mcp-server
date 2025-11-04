# Business Central "Tell Me" Search Protocol

## Overview

The Tell Me search feature in Business Central uses a specialized WebSocket protocol to search for pages, reports, and other objects. This document describes the protocol captured from real BC client interactions.

## Protocol Flow

### 1. Open Search Dialog

**Client sends:**
```json
{
  "message": {
    "source": "control",
    "control": "System::__SystemAction",
    "notification": "InvokeSessionAction",
    "payload": {
      "systemAction": 220
    }
  }
}
```

**Server responds:**
- Opens the Tell Me search dialog (Form ID from LogicalForm response)
- Returns a `LogicalForm` with search input control and filter options

### 2. Submit Search Query

**Client sends:**
```json
{
  "message": {
    "source": "control",
    "control": "[Form::TellMeSearchControlAddIn]::[Field::SearchControl]",
    "notification": "SaveValue",
    "payload": {
      "stringValue": "customer",
      "arrayValue": [
        { "stringValue": "ShowPages" },
        { "stringValue": "ShowReports" },
        { "stringValue": "ShowDocumentation" }
      ]
    }
  }
}
```

**Payload structure:**
- `stringValue`: The search query text
- `arrayValue`: Array of filter flags
  - `ShowPages`: Include pages in results
  - `ShowReports`: Include reports in results
  - `ShowDocumentation`: Include documentation/help links
  - Other possible values: `ShowAll`, `ShowActions`, etc.

### 3. Receive Search Results

**Server responds with:**
```json
{
  "source": "websocket",
  "direction": "incoming",
  "messageData": {
    "message": "compressed",
    "payload": "[compressed binary data]"
  }
}
```

**Notes:**
- Search results are **compressed** using a proprietary BC compression scheme
- Once decompressed, results are in `LogicalForm` format
- Each result contains:
  - Page/Report ID
  - Display name
  - Object type
  - Action command to invoke

### 4. Navigate to Result

**Client sends:**
```json
{
  "message": {
    "source": "control",
    "control": "[result control ID]",
    "notification": "InvokeAction",
    "payload": {
      "actionName": "OnClick"
    }
  }
}
```

**Server responds:**
- Closes Tell Me dialog
- Navigates to selected page/report

## Implementation Challenges

### 1. Response Compression

The biggest challenge is that BC compresses search result responses using a proprietary compression scheme. The compression:
- Is not standard gzip/deflate
- Appears to be custom BC protocol compression
- Requires deep protocol knowledge to decompress
- No public documentation available

Example compressed response:
```json
{
  "message": "compressed",
  "payload": "H4sIAAAAAAAAC+1d..."
}
```

### 2. LogicalForm Parsing

Even after decompression, results are in BC's `LogicalForm` format, which:
- Uses nested control structures
- Contains BC-specific metadata
- Requires understanding of BC form model
- Changes between BC versions

### 3. Session State Management

The search dialog is a modal form that:
- Must be opened with systemAction: 220
- Has its own form lifecycle
- Requires form ID tracking
- Must be closed properly after selection

## Observed Search Results Format

From captured traffic (before compression), search results appear to contain:

```
Customer Card (Page 21)
Customer List (Page 22)
Customer Ledger Entries (Page 25)
...
```

Each result includes:
- Object type (Page/Report)
- Object ID (numeric)
- Display name
- Object category/area

## Alternative Approaches

### 1. OData Metadata Query

Instead of using Tell Me search, could query OData $metadata endpoint:
```
GET http://Cronus27/BC/ODataV4/$metadata
```

Pros:
- Standard OData protocol
- Well-documented format
- No compression issues
- Returns all available entities

Cons:
- Only returns OData-exposed objects
- Doesn't include reports
- Missing friendly names
- No search/ranking

### 2. Expanded Hardcoded List

Maintain a comprehensive list of common BC pages:
```typescript
const WELL_KNOWN_PAGES = [
  { pageId: "21", name: "Customer Card" },
  { pageId: "22", name: "Customer List" },
  // ... 200+ common pages
];
```

Pros:
- No protocol complexity
- Works immediately
- Deterministic results
- No BC version dependencies

Cons:
- Incomplete coverage
- Requires manual maintenance
- No custom pages
- No extension pages

### 3. Hybrid Approach

Combine hardcoded list with OData metadata discovery:
1. Use hardcoded list for common pages
2. Query OData for additional entities
3. Document Tell Me protocol for future full implementation

## Future Work

To implement full Tell Me search integration:

1. **Reverse Engineer Compression**
   - Analyze BC client DLLs for compression algorithm
   - Or capture more traffic to identify compression patterns
   - Implement decompression in TypeScript/Node.js

2. **LogicalForm Parser**
   - Build parser for BC LogicalForm structure
   - Extract search results from parsed form data
   - Handle different result types (pages, reports, docs)

3. **Session Manager**
   - Track Tell Me form lifecycle
   - Manage form opening/closing
   - Handle concurrent searches

4. **Result Ranking**
   - Implement client-side ranking if BC doesn't provide it
   - Consider fuzzy matching
   - Cache search results for performance

## Code References

Related source files:
- `Microsoft.Dynamics.Nav.Client.TellMe.dll` - Client-side Tell Me implementation
- `Microsoft.Dynamics.Nav.Service.TellMeService` - Server-side search service (if exists)
- `bc-poc/captured-websocket.json` - Captured protocol examples
- `bc-poc/src/tools/search-pages-tool.ts` - Current MCP tool implementation

## Example: Captured Search Interaction

See `bc-poc/captured-websocket.json` for complete example of searching "customer" in Tell Me.

Key message sequence:
1. Message 0-10: Initial page load
2. Message 50: InvokeSessionAction(220) - Open Tell Me
3. Message 51: SaveValue("customer", [...filters]) - Submit search
4. Message 52-55: Compressed responses with search results
5. Message 60: InvokeAction - Navigate to selected page

## References

- Business Central WebSocket Protocol (internal)
- LogicalForm specification (BC client model)
- OData V4 specification: https://www.odata.org/documentation/
