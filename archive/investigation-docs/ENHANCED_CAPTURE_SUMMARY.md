# Enhanced BC Traffic Capture - Complete Guide

**Date**: 2025-11-01
**Status**: Enhanced capture ready for use
**Files**: `capture-all-traffic.mjs`, `analyze-enhanced-capture.mjs`

## Problem Statement

Previous capture attempts found NO ChangeField or InvokeAction interactions, despite the user performing field changes and button clicks. The user indicated: _"I did change fields and press actions like New Record and so. They might be called something else than you expect."_

## Solution: Enhanced Capture

Created a comprehensive capture script that records **both WebSocket AND HTTP traffic** to ensure we don't miss any interactions regardless of which protocol BC uses.

## What's New

### Previous Capture (capture-websocket-cdp.mjs)
- ✅ Captured WebSocket frames (both directions)
- ❌ Did NOT capture HTTP requests
- ❌ Filtered output to only Invoke messages (missed other patterns)

### Enhanced Capture (capture-all-traffic.mjs)
- ✅ Captures WebSocket frames (both directions)
- ✅ Captures HTTP POST/PUT/PATCH (requests + responses)
- ✅ Saves complete unfiltered data
- ✅ Parses JSON payloads automatically
- ✅ Separate output files for easier analysis

## Files Created

| File | Purpose | Usage |
|------|---------|-------|
| `capture-all-traffic.mjs` | Enhanced capture script | `node capture-all-traffic.mjs` |
| `analyze-enhanced-capture.mjs` | Analysis script for enhanced captures | `node analyze-enhanced-capture.mjs` |
| `RUN_ENHANCED_CAPTURE.md` | Detailed usage guide | Read for instructions |
| `ENHANCED_CAPTURE_SUMMARY.md` | This file - overview and strategy | Reference document |

## Quick Start

### 1. Run Enhanced Capture

```bash
cd "C:\bc4ubuntu\Decompiled\bc-poc"
node capture-all-traffic.mjs
```

### 2. Perform Actions

When you see **"📋 READY TO CAPTURE"**:

**Minimal Focused Test** (recommended first):
1. Click "Edit" button
2. Wait 2 seconds
3. Change "Name" field (type new value + Tab)
4. Wait 2 seconds
5. Press ENTER in terminal

**Extended Test** (if minimal test succeeds):
1. Repeat minimal test
2. Click "New" button
3. Wait 2 seconds
4. Change "Payment Terms Code" dropdown
5. Wait 2 seconds
6. Click "Delete" button (cancel if prompted)
7. Wait 2 seconds
8. Press ENTER in terminal

### 3. Analyze Results

```bash
node analyze-enhanced-capture.mjs
```

### 4. Check Output

The analysis script will tell you:
- ✅ If ChangeField/InvokeAction were found (and show examples)
- ⚠️ If HTTP traffic contains field updates instead
- ❌ If neither WebSocket nor HTTP captured target interactions

## Expected Outcomes

### Scenario 1: ✅ Found in WebSocket (Best Case)

**What you'll see**:
```
✅ SUCCESS! Found target interactions in WebSocket traffic!
  ✓ ChangeField interactions detected
  ✓ InvokeAction interactions detected
```

**Next steps**:
1. Review the interaction examples shown
2. Compare with tool implementations:
   - `src/tools/execute-action-tool.ts:147-155` (InvokeAction)
   - `src/tools/update-field-tool.ts:179-188` (ChangeField)
3. If protocols match → We're done! ✅
4. If protocols differ → Update tool implementations

### Scenario 2: ⚠️ Found in HTTP (Alternative Protocol)

**What you'll see**:
```
⚠️ Target interactions NOT found in WebSocket
However, field-related HTTP traffic was detected!
BC may be using HTTP POST/PUT/PATCH for field updates.
```

**Next steps**:
1. Review HTTP examples shown by analysis script
2. Determine if BC uses REST API for field updates
3. Consider implementing HTTP-based field update mechanism:
   - Extract HTTP endpoint patterns
   - Extract request/response formats
   - Implement new tool using HTTP instead of WebSocket

### Scenario 3: ❌ Not Found (Capture Issue)

**What you'll see**:
```
⚠️ Target interactions NOT found in either WebSocket or HTTP
```

**Next steps**:
1. Run a NEW capture session with even more focused actions:
   - Capture ONE action at a time
   - Wait 5 seconds after action before stopping
   - Try different fields/actions
2. Check if BC is in edit mode BEFORE changing fields
3. Verify WebSocket connection is active (check browser DevTools)

## Why HTTP Capture Matters

BC might use different protocols for different operations:

| Operation | Likely Protocol | Reason |
|-----------|----------------|--------|
| Form loading | WebSocket (SignalR) | Real-time, bidirectional |
| Field updates | HTTP POST/PATCH | Simpler, stateless |
| Action buttons | WebSocket | Integrated with form lifecycle |
| Batch operations | HTTP POST | Easier to implement bulk updates |

By capturing BOTH, we cover all possibilities.

## Comparison with Previous Attempts

### Previous Capture Results
```
File: invoke-calls-captured.json
- 20 messages (filtered, sent only)
- 26 interactions total
- LoadForm: 15
- InvokeSessionAction: 8
- InvokeExtensibilityMethod: 3
- ChangeField: 0 ❌
- InvokeAction: 0 ❌
```

### Full Capture Results
```
File: websocket-cdp-capture.json
- 93 messages (24 sent, 69 received)
- 30 interactions total
- Same breakdown as above
- ChangeField: 0 ❌
- InvokeAction: 0 ❌
```

**Conclusion**: Previous captures DID include both directions, but the specific actions weren't triggered or use different names/protocols.

### Enhanced Capture (New)
```
Files: captured-websocket.json, captured-http.json
- All WebSocket messages (sent + received)
- All HTTP POST/PUT/PATCH (requests + responses)
- NO filtering - complete raw data
- Separate files for easier analysis
```

**Goal**: Capture interactions in whichever protocol BC actually uses.

## What We're Looking For

### Hypothesized WebSocket Protocol

**InvokeAction** (from execute-action-tool.ts:147-155):
```json
{
  "interactionName": "InvokeAction",
  "namedParameters": {
    "actionName": "Edit"
  },
  "callbackId": "",
  "formId": "21B",
  "controlPath": "server:"
}
```

**ChangeField** (from update-field-tool.ts:179-188):
```json
{
  "interactionName": "ChangeField",
  "namedParameters": {
    "fieldName": "Name",
    "newValue": "Updated Customer Name"
  },
  "callbackId": "",
  "formId": "21B",
  "controlPath": "..."
}
```

### Possible HTTP Protocol

**Field Update via REST API**:
```http
PATCH http://Cronus27/BC/api/v2.0/companies(...)/customers(...)?$select=name
Content-Type: application/json

{
  "name": "Updated Customer Name"
}
```

**Action Invocation via REST API**:
```http
POST http://Cronus27/BC/api/v2.0/companies(...)/customers(...)/edit
Content-Type: application/json

{
  "action": "Edit"
}
```

## Technical Details

### WebSocket Capture (CDP Events)

```javascript
cdpSession.on('Network.webSocketFrameReceived', (params) => {
  // Captures incoming messages from server
  const { opcode, payloadData } = params.response;
  // opcode 1 = text frame (JSON)
  // Parses and saves with direction: 'received'
});

cdpSession.on('Network.webSocketFrameSent', (params) => {
  // Captures outgoing messages to server
  const { opcode, payloadData } = params.response;
  // Parses and saves with direction: 'sent'
});
```

### HTTP Capture (CDP Events)

```javascript
cdpSession.on('Network.requestWillBeSent', ({ requestId, request }) => {
  // Captures request details
  const { url, method, postData } = request;
  // Filters to BC URLs only
  // Stores request with ID for later matching
});

cdpSession.on('Network.responseReceived', ({ requestId, response }) => {
  // Captures response metadata
  const { status, statusText, mimeType } = response;
  // Matches to pending request
});

cdpSession.on('Network.loadingFinished', async ({ requestId }) => {
  // Retrieves response body
  const result = await cdpSession.send('Network.getResponseBody', { requestId });
  // Parses JSON and saves complete request/response pair
});
```

## Output File Formats

### captured-websocket.json
```json
[
  {
    "source": "websocket",
    "direction": "sent",
    "timestamp": 1730505600000,
    "iso": "2025-11-01T12:00:00.000Z",
    "url": "ws://Cronus27/BC/signalr?...",
    "opcode": 1,
    "masked": true,
    "payloadText": "{\"method\":\"Invoke\",...}",
    "payload": {
      "method": "Invoke",
      "params": [...]
    }
  },
  ...
]
```

### captured-http.json
```json
[
  {
    "source": "http",
    "direction": "request",
    "timestamp": 1730505600000,
    "iso": "2025-11-01T12:00:00.000Z",
    "requestId": "12345.1",
    "method": "POST",
    "url": "http://Cronus27/BC/api/...",
    "postData": "{\"name\":\"value\"}",
    "postDataParsed": {
      "name": "value"
    },
    "responseStatus": 200,
    "responseStatusText": "OK",
    "responseMimeType": "application/json",
    "responseBody": {
      "result": "success"
    }
  },
  ...
]
```

## Analysis Script Features

The `analyze-enhanced-capture.mjs` script:

1. **Loads both capture files** (WebSocket + HTTP)
2. **Analyzes WebSocket**:
   - Counts messages by direction
   - Extracts all interactions from Invoke messages
   - Groups interactions by type
   - Searches for ChangeField/InvokeAction
   - Shows examples if found
   - Keyword search across all payloads
3. **Analyzes HTTP**:
   - Counts requests by method
   - Counts responses by status code
   - Searches for field-related keywords
   - Shows examples of field updates
   - Keyword search across all requests/responses
4. **Generates summary**:
   - Reports if target interactions were found
   - Provides specific next steps based on findings
   - Recommends re-capture if needed

## Success Criteria

We consider the capture successful if ANY of these are true:

1. ✅ **ChangeField found in WebSocket** → Verify protocol matches tool
2. ✅ **InvokeAction found in WebSocket** → Verify protocol matches tool
3. ✅ **Field updates found in HTTP** → Implement HTTP-based tools
4. ✅ **Alternative interaction names found** → Update tool implementations

## Risk Mitigation

### Risk 1: Capture timing issues
**Mitigation**:
- Wait 2 seconds between actions
- Wait 5 seconds after last action before stopping
- Perform actions slowly and deliberately

### Risk 2: BC not sending expected interactions
**Mitigation**:
- Capture both WebSocket AND HTTP
- Save unfiltered data
- Keyword search across all traffic

### Risk 3: Different interaction names than expected
**Mitigation**:
- Analysis script searches for partial matches
- Keyword search includes variations (field, Field, action, Action)
- Manual review of all captured interactions

### Risk 4: BC batching interactions
**Mitigation**:
- Wait longer before stopping capture
- Perform multiple actions to see patterns
- Check both sent and received messages

## Current Status

| Item | Status |
|------|--------|
| Enhanced capture script | ✅ Created (`capture-all-traffic.mjs`) |
| Analysis script | ✅ Created (`analyze-enhanced-capture.mjs`) |
| Usage documentation | ✅ Created (`RUN_ENHANCED_CAPTURE.md`) |
| Tools implementation | ✅ Completed (5/5 tests passed) |
| Protocol verification | ⏳ **Pending** - Need capture session |

## Next Action Required

**You need to run the enhanced capture**:

```bash
cd "C:\bc4ubuntu\Decompiled\bc-poc"
node capture-all-traffic.mjs

# When ready, perform actions in browser
# Press ENTER when done

# Then analyze
node analyze-enhanced-capture.mjs
```

This will tell us definitively:
1. What protocol BC actually uses (WebSocket, HTTP, or both)
2. What the exact interaction format is
3. Whether our tool implementations need updates

## References

- Previous analysis: `INTERACTION_CAPTURE_ANALYSIS.md`
- Tool implementations:
  - `src/tools/execute-action-tool.ts`
  - `src/tools/update-field-tool.ts`
- Test results: 5/5 tests passed (tools work with hypothesized protocols)
