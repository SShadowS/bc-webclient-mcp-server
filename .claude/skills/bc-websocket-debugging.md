# BC WebSocket Protocol Debugging Skill

Reference guide for debugging Business Central WebSocket protocol, packet structures, and field mappings.

## WebSocket Packet Structure

### Compressed Response Format

BC sends responses as **gzip-compressed, base64-encoded JSON**:

```
WebSocket Message → Base64 String → gzip decompress → JSON Array of Handlers
```

### Message Formats

BC uses several message formats:

```typescript
// Format 1: Async Message with compressedData (most common)
{
  "jsonrpc": "2.0",
  "method": "Message",
  "params": [{
    "sequenceNumber": 2,
    "telemetryTraceId": "...",
    "handler": "LogicalClientChange",  // Handler type hint
    "compressedData": "H4sIAAAAAAAA..."  // Base64 gzip
  }]
}

// Format 2: JSON-RPC Response with compressedResult
{
  "jsonrpc": "2.0",
  "id": 1,
  "compressedResult": "H4sIAAAAAAAA..."
}

// Format 3: Direct result array (already decompressed)
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [{ "handlerType": "...", "parameters": [...] }]
}

// Format 4: KeepAlive/Ping (no data - handle gracefully)
{ "jsonrpc": "2.0", "method": "KeepAlive" }
```

### Decompression Code Snippet

```typescript
import { gunzipSync } from 'zlib';

function decompressHandlers(base64: string): any[] {
  const compressed = Buffer.from(base64, 'base64');
  const decompressed = gunzipSync(compressed);
  const json = decompressed.toString('utf-8');
  return JSON.parse(json);
}

// Usage: Extract and decompress from any BC message format
function extractAndDecompress(message: any): any[] {
  let compressed: string | null = null;

  // Check all known formats
  if (message.params?.[0]?.compressedData) {
    compressed = message.params[0].compressedData;  // Async Message format
  } else if (message.params?.[0]?.compressedResult) {
    compressed = message.params[0].compressedResult;
  } else if (message.compressedResult) {
    compressed = message.compressedResult;  // Direct response format
  } else if (Array.isArray(message.result)) {
    return message.result; // Already decompressed
  } else if (message.method === 'KeepAlive') {
    return []; // System message, no data
  }

  return compressed ? decompressHandlers(compressed) : [];
}
```

### Quick Node.js Script to Dump Full Packet

Save WebSocket message as JSON text file (from Chrome DevTools → Network → WS → Copy Message):

```javascript
// dump-packet.mjs - Extract full packet structure (usually <1KB)
// NOTE: Input must be JSON text file, NOT binary frame data
import { gunzipSync } from 'zlib';
import fs from 'fs';

const raw = fs.readFileSync('captured-packet.json', 'utf8');
const packet = JSON.parse(raw);
const msg = packet.data || packet; // Handle wrapper format

const compressed = msg.compressedResult
  || msg.params?.[0]?.compressedResult
  || msg.params?.[0]?.compressedData;

if (compressed) {
  const handlers = JSON.parse(gunzipSync(Buffer.from(compressed, 'base64')).toString());
  console.log(JSON.stringify(handlers, null, 2));
} else if (Array.isArray(msg.result)) {
  console.log(JSON.stringify(msg.result, null, 2));
} else {
  console.log(JSON.stringify(msg, null, 2));
}
```

---

## Client Request Structures

### Invoke RPC (Full Structure)

All interactions (OpenForm, InvokeAction, SaveValue, LoadForm) use the same wrapper:

```json
{
  "jsonrpc": "2.0",
  "method": "Invoke",
  "id": 5,
  "params": [{
    "openFormIds": ["1F7F"],
    "sessionId": "DEFAULT...SESSION_ID",
    "sequenceNo": "spa-12345#3",
    "lastClientAckSequenceNumber": 42,
    "interactionsToInvoke": [{
      "interactionName": "InvokeAction",
      "namedParameters": "{\"systemAction\":0,\"key\":null,\"data\":{},\"repeaterControlTarget\":null}",
      "callbackId": "1",
      "controlPath": "server:c[0]/c[1]/c[1]/c[0]",
      "formId": "1F7F"
    }],
    "tenantId": "default",
    "company": "CRONUS Danmark A/S",
    "features": ["QueueInteractions", "MetadataCache", ...]
  }]
}
```

**Key points:**
- `namedParameters` is **stringified JSON**, not nested object
- `formId` must match current page's ServerId from FormToShow
- `controlPath` is the path to the action/field control
- `openFormIds` tracks all currently open forms

### Common interactionName Values

| interactionName | Purpose |
|----------------|---------|
| `OpenForm` | Open a BC page |
| `LoadForm` | Load form data (with `loadData: true`) |
| `InvokeAction` | Click button/action on page |
| `InvokeSessionAction` | Session-level action (systemAction codes) |
| `SaveValue` | Update field value |
| `SelectActiveRow` | Select row in list |
| `CloseForm` | Close a form |

**Note:** Multiple interactions can be batched in single `interactionsToInvoke` array.

---

## Handler Types Reference

### Common Handler Types

| Handler Type | Purpose |
|-------------|---------|
| `DN.LogicalClientEventRaisingHandler` | FormToShow, SessionInfo, navigation events |
| `DN.LogicalClientChangeHandler` | PropertyChanges, DataRefreshChange, field updates |
| `DN.CallbackResponseProperties` | InvokeAction results, CompletedInteractions |
| `DN.ErrorMessageProperties` | BC errors |
| `DN.ErrorDialogProperties` | BC error dialogs |

### Error Handler Structure

```json
{
  "handlerType": "DN.ErrorMessageProperties",
  "parameters": [
    "You do not have permission to modify this record.",
    1,
    "ServerId_1234"
  ]
}
```

Check for these in response handlers to detect failures.

### LogicalClientEventRaisingHandler Structure

```json
{
  "handlerType": "DN.LogicalClientEventRaisingHandler",
  "parameters": [
    "FormToShow",  // Event type
    {
      "ServerId": "1F7F",      // formId for this page
      "Caption": "Sales Order",
      "Form": { /* LogicalForm structure */ }
    }
  ]
}
```

### LogicalClientChangeHandler Structure

```json
{
  "handlerType": "DN.LogicalClientChangeHandler",
  "parameters": [
    "1F7F",  // formId
    [
      {
        "t": "PropertyChanges",
        "ControlReference": {
          "controlPath": "server:c[0]/c[1]/c[5]",
          "formId": "1F7F"
        },
        "Changes": {
          "StringValue": "Released",
          "ObjectValue": 1,
          "StyleView": 3
        }
      },
      {
        "t": "DataRefreshChange",
        "ControlReference": { "controlPath": "server:c[3]" },
        "RowChanges": [
          { "t": "DataRowInserted", "DataRowInserted": [0, { "cells": {...} }] }
        ]
      }
    ]
  ]
}
```

---

## Debug Scripts Reference

### Capture Scripts (`capture-*.mjs`)

| Script | Purpose |
|--------|---------|
| `capture-all-traffic.mjs` | Capture ALL WebSocket traffic to debug-dumps/ |
| `capture-page21-metadata.mjs` | Capture Customer Card page open |
| `capture-page42-metadata.mjs` | Capture Sales Order Document open |
| `capture-release-action.mjs` | Capture Release action execution |
| `capture-select-and-drilldown.mjs` | Capture List→Document drill-down |
| `capture-session-lifecycle.mjs` | Capture full session open/close |

### Analysis Scripts (`analyze-*.mjs`)

| Script | Purpose |
|--------|---------|
| `analyze-packets.mjs` | Statistics on message types, handler types |
| `analyze-field-mappings.mjs` | PropertyChanges → field name mapping |
| `analyze-property-changes.mjs` | Deep dive into property updates |
| `analyze-datarefresh.cjs` | List page DataRefreshChange analysis |
| `analyze-drilldown-capture.cjs` | Navigation handler analysis |
| `analyze-release-capture.mjs` | Action execution handler analysis |
| `analyze-select-drilldown.mjs` | Row selection + action analysis |

### Extract Scripts (`extract-*.mjs`)

| Script | Purpose |
|--------|---------|
| `extract-interactions.mjs` | Extract invoke() calls from capture |
| `extract-change-handler.mjs` | Extract LogicalClientChangeHandler |

---

## Async Handler Pattern (Critical!)

**BC sends important data via async `Message` events, NOT in the direct `Invoke` response.**

This is the most common source of "missing data" bugs. When you call `invoke()`, BC may return an empty/minimal response synchronously, then send the actual data (handlers, PropertyChanges, etc.) via separate `Message` events.

### When Async Handlers Are Required

| Operation | Direct Response | Async Message |
|-----------|----------------|---------------|
| `OpenForm` | FormToShow | PropertyChanges, DataRefresh |
| `LoadForm` | Minimal | **All list data** (DataRefreshChange) |
| `InvokeAction` | CallbackResponse | PropertyChanges, status updates |
| `SaveValue` | Minimal | Validation, search results |

### Implementation Pattern

```typescript
// WRONG: Only checks direct response (misses data!)
const result = await connection.invoke(interaction);
const handlers = result.value; // Often empty or minimal!

// CORRECT: Listen for async handlers BEFORE invoke
const rawClient = connection.getRawClient();
const accumulatedHandlers: any[] = [];

// Set up listener BEFORE calling invoke
const unsubscribe = rawClient.onHandlers((handlers) => {
  accumulatedHandlers.push(...handlers);
});

try {
  // Fire invoke and capture its response
  const result = await connection.invoke(interaction);
  if (isOk(result)) {
    accumulatedHandlers.push(...result.value);
  }

  // Wait for async handlers (BC sends multiple batches)
  await new Promise(r => setTimeout(r, 1000));

  // Now accumulatedHandlers has ALL data
  console.log(`Total handlers: ${accumulatedHandlers.length}`);
} finally {
  unsubscribe(); // Clean up listener
}
```

### Key Points

1. **Set up listener BEFORE invoke** - handlers can arrive immediately
2. **Accumulate, don't replace** - BC sends multiple Message batches
3. **Wait for completion** - 500-1000ms window catches most handlers
4. **Check both sources** - direct response AND async handlers

**Note:** 1000ms works for most cases. For slow operations (reports, large datasets), increase the timeout or implement idle-detection (no new handlers for 200ms).

### Reference Implementation

See `src/tools/execute-action-tool.ts` lines 206-255 for working async handler pattern.

---

## Common Debugging Workflows

### 1. Debug Field Mapping Issues

When a field shows wrong value (e.g., "ÅBEN" instead of "Open"):

```bash
# Step 1: Capture the page interaction
node capture-page42-metadata.mjs

# Step 2: Analyze PropertyChanges
node analyze-field-mappings.mjs

# Step 3: Check output
cat debug-dumps/field-mapping-analysis.json | jq '.statusRelatedUpdates'
```

### 2. Debug Navigation Issues

When drill-down doesn't work or uses wrong formId:

```bash
# Step 1: Capture drill-down
node capture-select-and-drilldown.mjs

# Step 2: Analyze handlers
node analyze-drilldown-capture.cjs

# Step 3: Check formId extraction
# Look for FormToShow events and their ServerId values
```

### 3. Debug Action Execution

When execute_action doesn't work:

```bash
# Step 1: Capture action execution
node capture-release-action.mjs

# Step 2: Analyze response handlers
node analyze-release-capture.mjs

# Step 3: Check:
#   - formId used in InvokeAction matches page's formId
#   - controlPath points to correct action button
#   - No DN.ErrorMessageProperties in response
```

---

## Quick Code Snippets

### Extract Full LogicalForm from Capture

```javascript
// extract-logicalform.mjs
import fs from 'fs';
import { gunzipSync } from 'zlib';

const capture = JSON.parse(fs.readFileSync('debug-dumps/packets/001-response.json'));
const compressed = capture.data.compressedResult;
const handlers = JSON.parse(gunzipSync(Buffer.from(compressed, 'base64')).toString());

// Find FormToShow
const formHandler = handlers.find(h =>
  h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
  h.parameters?.[0] === 'FormToShow'
);

if (formHandler) {
  const logicalForm = formHandler.parameters[1].Form;
  fs.writeFileSync('logicalform.json', JSON.stringify(logicalForm, null, 2));
  console.log('Saved LogicalForm to logicalform.json');
}
```

### Extract All PropertyChanges with Values

```javascript
// extract-all-property-changes.mjs
import fs from 'fs';
import path from 'path';
import { gunzipSync } from 'zlib';

const PACKETS_DIR = 'debug-dumps/packets';
const files = fs.readdirSync(PACKETS_DIR).filter(f => f.endsWith('.json'));

const allChanges = [];

files.forEach(file => {
  const packet = JSON.parse(fs.readFileSync(path.join(PACKETS_DIR, file)));
  const data = packet.data;

  // Get handlers
  let handlers = [];
  if (data.compressedResult) {
    handlers = JSON.parse(gunzipSync(Buffer.from(data.compressedResult, 'base64')).toString());
  } else if (Array.isArray(data.result)) {
    handlers = data.result;
  } else if (data.params?.[0]?.compressedResult) {
    handlers = JSON.parse(gunzipSync(Buffer.from(data.params[0].compressedResult, 'base64')).toString());
  }

  // Extract PropertyChanges
  handlers.forEach(h => {
    if (h.handlerType === 'DN.LogicalClientChangeHandler') {
      const [formId, changes] = h.parameters;
      changes?.filter(c => c.t === 'PropertyChanges').forEach(c => {
        allChanges.push({
          file,
          formId: c.ControlReference?.formId || formId,
          controlPath: c.ControlReference?.controlPath,
          changes: c.Changes
        });
      });
    }
  });
});

console.log(JSON.stringify(allChanges, null, 2));
```

### Inline Decompression for Console Debugging

```javascript
// Paste in Node REPL or browser console (with Buffer polyfill)
const decompress = (b64) => JSON.parse(require('zlib').gunzipSync(Buffer.from(b64, 'base64')).toString());

// Usage:
const handlers = decompress('H4sIAAAAAAAA...');
console.log(JSON.stringify(handlers, null, 2));
```

---

## Key Files in Codebase

| File | Purpose |
|------|---------|
| `src/protocol/decompression.ts` | Core decompression utilities |
| `src/connection/protocol/handlers.ts` | Handler extraction from multiple formats |
| `src/connection/protocol/BCProtocolAdapter.ts` | WebSocket message parsing |
| `src/protocol/logical-form-parser.ts` | LogicalForm structure parsing |
| `src/util/loadform-helpers.ts` | LoadForm response parsing |
| `src/parsers/control-path-parser.ts` | Control path resolution |

---

## FormId Management (Critical!)

**NEVER** use `getAllOpenFormIds()` when updating pageContext:

```typescript
// BAD: Overwrites with ALL open forms (includes other pages)
formIds: connection.getAllOpenFormIds()

// GOOD: Preserve existing formIds
formIds: existingFormIds || connection.getAllOpenFormIds()
```

**Why this matters:** When drilling from List→Document, BC opens the Document as a new form but keeps the List form "open" in the background. Both have different formIds:
- List (Page 9305): formId `1F2F`
- Document (Page 42): formId `1F7F`

If you call `getAllOpenFormIds()`, you get `["1F2F", "1F7F"]`. If execute_action accidentally uses the first one (`1F2F`), BC targets the wrong page and silently ignores your action.

**Debug tip:** Check logs for `Building interaction: formId=XXXX` and compare with `FormToShow ServerId` to ensure they match.

See `BC_PROTOCOL_PATTERNS.md` "FormId Preservation" section.
