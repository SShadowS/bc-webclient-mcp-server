# CloseForm Investigation Summary

**Date**: 2025-10-29
**Status**: Need to capture real WebSocket traffic from BC web client

---

## Problem Statement

When opening multiple pages sequentially, BC returns the SAME form for all requests:
- Request Page 21 → Returns form "39A" with Page 21 data ✓
- Request Page 22 → Returns form "39A" with Page 21 data ❌
- Request Page 30 → Returns form "39A" with Page 21 data ❌

BC is explicitly telling us it's reusing a cached form via the `CacheKey: "21:embedded(False)"` response.

---

## What We Tried

### Attempt 1: CloseForm with FormId parameter
```typescript
await this.client.invoke({
  interactionName: 'CloseForm',
  namedParameters: { FormId: this.currentFormId },
  openFormIds: [this.currentFormId],
  lastClientAckSequenceNumber: -1,
});
```
**Result**: ❌ No effect - BC still returns same form

### Attempt 2: CloseForm with ServerId parameter
```typescript
await this.client.invoke({
  interactionName: 'CloseForm',
  namedParameters: { ServerId: this.currentFormId },
  openFormIds: [],
  lastClientAckSequenceNumber: -1,
});
```
**Result**: ❌ No effect - BC still returns same form

### Attempt 3: CloseForm with ServerFormHandle (GUID)
```typescript
await this.client.invoke({
  interactionName: 'CloseForm',
  namedParameters: { ServerFormHandle: this.currentFormHandle },
  openFormIds: [],
  lastClientAckSequenceNumber: -1,
});
```
**Result**: ❌ No effect - BC still returns same form

### Attempt 4: DisposeForm with ServerFormHandle
```typescript
await this.client.invoke({
  interactionName: 'DisposeForm',
  namedParameters: { ServerFormHandle: this.currentFormHandle },
  openFormIds: [],
  lastClientAckSequenceNumber: -1,
});
```
**Result**: ❌ No effect - BC still returns same form

### Attempt 5: OpenForm with empty openFormIds
```typescript
const response = await this.client.invoke({
  interactionName: 'OpenForm',
  namedParameters: { Page: '22' },
  openFormIds: [],  // Tell BC nothing is open
  lastClientAckSequenceNumber: -1,
});
```
**Result**: ❌ No effect - BC maintains its own server-side state

### Attempt 6: OpenForm with previous form in openFormIds
```typescript
const response = await this.client.invoke({
  interactionName: 'OpenForm',
  namedParameters: { Page: '22' },
  openFormIds: [previousFormId],  // Tell BC which form we're leaving
  lastClientAckSequenceNumber: -1,
});
```
**Result**: ❌ BC reuses the existing form when it sees it in openFormIds

---

## Key Observations

1. **BC accepts all our close/dispose calls without errors**
   - This suggests the interaction name and parameters are "valid"
   - But they don't have the desired effect

2. **Form identifiers are tracked correctly**
   - `ServerId`: "39A" (string)
   - `ServerFormHandle`: "0caf82ac-05b2-402c-b702-18a3ea1b24aa" (GUID)
   - Both are extracted from the response successfully

3. **BC maintains authoritative server-side state**
   - The `CacheKey` in responses explicitly shows BC is reusing cached forms
   - Client-reported `openFormIds` doesn't override server state

4. **Session is configured correctly**
   - Multitasking feature is enabled
   - WebSocket connection is stable
   - Authentication and session initialization work correctly

---

## Hypotheses Considered

### ❌ Wrong parameter name
Tried: `FormId`, `ServerId`, `ServerFormHandle`
None worked.

### ❌ Wrong interaction name
Tried: `CloseForm`, `DisposeForm`
Both accepted but no effect.

### ❌ Wrong openFormIds usage
Tried: empty array `[]`, previous form ID `[previousFormId]`
Neither worked.

### ❓ Missing parameter or interaction
**Most likely**: We're missing something that the real BC web client sends.

---

## Next Step: Capture Real Traffic

The only reliable way forward is to observe what the official BC web client actually sends.

**See**: `CAPTURE-WEBSOCKET-TRAFFIC.md` for detailed procedure.

### What We Need to Discover:

1. **The correct close interaction**
   - Exact method name
   - Exact parameter names and values
   - Any additional parameters we're missing

2. **The correct OpenForm parameters for multi-page scenarios**
   - Is there a `forceNew: true` flag?
   - Is there a `clientInstanceId` or unique identifier?
   - What should `openFormIds` contain?

3. **Any intermediate messages**
   - Does BC send automatic messages after closing?
   - Are there session state updates we need to acknowledge?

---

## Files Modified

1. `src/types/bc-types.ts` - Added `CloseFormInteraction` interface
2. `src/connection/bc-session-connection.ts` - Added form tracking and close logic
3. `test-multiple-pages.ts` - Created test script
4. `OPENFORMIDS-ISSUE-ANALYSIS.md` - Original analysis document
5. `CAPTURE-WEBSOCKET-TRAFFIC.md` - Procedure for capturing real traffic

---

## External Model Insights (Gemini 2.5 Pro)

Key points from consultation with external AI model:

1. **CacheKey confirms the issue**: BC is explicitly telling us it's reusing cached forms
2. **Most likely causes**:
   - Wrong interaction name (not `CloseForm` or `DisposeForm`)
   - Missing parameter in `OpenForm` to force new instance
   - Session mode or context issue

3. **Best path forward**:
   > "The most direct path to a solution is to observe the behavior of the official Business Central web client and replicate its WebSocket traffic. This removes all guesswork."

---

## Current Test Results

```
Testing: Get REAL metadata for Page 21 (Customer Card)...
 ✓ PASS - Caption: "Customer Card", CacheKey: "21:embedded(False)"

Testing: Get REAL metadata for Page 22 (Customer List)...
 ✗ FAIL - Caption: "Customer Card", CacheKey: "21:embedded(False)"
  Expected CacheKey: "22:embedded(False)"

Testing: Get REAL metadata for Page 30 (Item Card)...
 ✗ FAIL - Caption: "Customer Card", CacheKey: "21:embedded(False)"
  Expected CacheKey: "30:embedded(False)"
```

**Tests Passing**: 6/8 (75%)
**Tests Failing**: 2/8 (25%) - Both related to multi-page handling
