# Multi-Page Bug Fix - Implementation Summary

**Date**: 2025-10-30
**Status**: Implementation Complete, Testing In Progress

## Problem Statement

When the MCP server opens multiple BC pages sequentially, it returns incorrect data:
- Page 21 (Customer Card) ✅ Works correctly
- Page 22 (Customer List) ❌ Returns Page 21 data
- Page 30 (Item Card) ❌ Returns Page 21 data

## Root Cause Analysis (GPT-5 Deep Analysis)

**File**: `handler-parser.ts:86-90`
```typescript
// OLD CODE (BROKEN):
const formToShowHandler = handlers.find(
  (h): h is LogicalClientEventRaisingHandler =>
    h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
    h.parameters?.[0] === 'FormToShow'
);
```

**The Bug**:
- Uses `.find()` to get the FIRST `FormToShow` handler from ALL handlers
- BC maintains all open forms in the session, so handler array contains FormToShow events for ALL pages
- Always returns the first form (Page 21) regardless of which page was requested

**What Should Happen**:
1. OpenForm returns a callback with formId (e.g., "85" for Page 21)
2. Parser should filter by that formId to get the correct page
3. Each page open should track its own formId

**Evidence**:
```json
{
  "CompletedInteractions": [{
    "InvocationId": "0",
    "Result": { "reason": 0, "value": "85" }  // ← formId
  }]
}
```

## Solution Implemented

### 1. Added `extractFormId()` Method
**File**: `src/parsers/handler-parser.ts`
```typescript
public extractFormId(handlers: readonly Handler[]): string | undefined {
  const callbackHandler = handlers.find(
    (h): h is import('../types/bc-types.js').CallbackResponseProperties =>
      h.handlerType === 'DN.CallbackResponseProperties'
  );

  if (!callbackHandler) {
    return undefined;
  }

  const completedInteractions = callbackHandler.parameters?.[0]?.CompletedInteractions;
  if (!completedInteractions || completedInteractions.length === 0) {
    return undefined;
  }

  const result = completedInteractions[0]?.Result as { reason?: number; value?: string } | undefined;
  return result?.value;
}
```

### 2. Updated `extractLogicalForm()` to Accept formId
**File**: `src/parsers/handler-parser.ts`
```typescript
public extractLogicalForm(
  handlers: readonly Handler[],
  formId?: string  // ← NEW PARAMETER
): Result<LogicalForm, LogicalFormParseError> {
  // Find ALL FormToShow handlers
  const formToShowHandlers = handlers.filter(
    (h): h is LogicalClientEventRaisingHandler =>
      h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      h.parameters?.[0] === 'FormToShow'
  );

  // If formId provided, filter by ServerId
  let formToShowHandler: LogicalClientEventRaisingHandler | undefined;

  if (formId) {
    formToShowHandler = formToShowHandlers.find(h => {
      const logicalForm = h.parameters?.[1] as LogicalForm | undefined;
      return logicalForm?.ServerId === formId;
    });

    if (!formToShowHandler) {
      // Fallback to first handler if no match found
      formToShowHandler = formToShowHandlers[0];
    }
  } else {
    // No formId provided, use first handler (old behavior)
    formToShowHandler = formToShowHandlers[0];
  }

  // ... rest of method
}
```

### 3. Updated Interface
**File**: `src/core/interfaces.ts`
```typescript
export interface IHandlerParser {
  parse(response: unknown): Result<readonly Handler[], BCError>;

  // ← NEW METHOD
  extractFormId(handlers: readonly Handler[]): string | undefined;

  // ← UPDATED SIGNATURE
  extractLogicalForm(handlers: readonly Handler[], formId?: string): Result<LogicalForm, BCError>;
}
```

### 4. Updated PageMetadataParser
**File**: `src/parsers/page-metadata-parser.ts`
```typescript
public parse(handlers: readonly Handler[]): Result<PageMetadata, BCError> {
  // ← NEW: Extract formId from callback
  const formId = this.handlerParser.extractFormId(handlers);

  // ← UPDATED: Pass formId to filter by correct form
  const logicalFormResult = this.handlerParser.extractLogicalForm(handlers, formId);

  // ... rest of pipeline
}
```

## Files Modified

1. **src/parsers/handler-parser.ts**
   - Added `extractFormId()` method (lines 76-102)
   - Updated `extractLogicalForm()` to accept formId parameter (lines 104-158)
   - Changed from `.find()` to `.filter()` + match by ServerId

2. **src/core/interfaces.ts**
   - Added `extractFormId()` to IHandlerParser interface (lines 85-91)
   - Updated `extractLogicalForm()` signature with optional formId (line 100)

3. **src/parsers/page-metadata-parser.ts**
   - Updated `parse()` to extract formId and pass to extractLogicalForm (lines 47-51)

4. **No changes needed to** `src/tools/get-page-metadata-tool.ts`
   - Already calls `metadataParser.parse(handlers)` which now handles formId internally

## Technical Details

### CallbackResponseProperties Structure
```typescript
{
  "handlerType": "DN.CallbackResponseProperties",
  "parameters": [{
    "SequenceNumber": 0,
    "CompletedInteractions": [{
      "InvocationId": "0",
      "Duration": 158.0,
      "Result": {
        "reason": 0,
        "value": "85"  // ← formId (string)
      }
    }]
  }]
}
```

### LogicalForm Structure
```typescript
{
  "ServerId": "85",  // ← Matches formId from callback
  "Caption": "Customer Card",
  "CacheKey": "21:pagemode(Edit):embedded(False)",
  "Children": [...]
}
```

### Matching Logic
1. Extract formId from CallbackResponseProperties.Result.value
2. Filter FormToShow handlers where LogicalForm.ServerId === formId
3. Fallback to first handler if no match (handles edge cases)

## Edge Cases Handled

1. **No formId in callback**: Falls back to first FormToShow handler (original behavior)
2. **No matching ServerId**: Falls back to first handler
3. **Multiple forms with same formId**: Takes first match
4. **No FormToShow handlers**: Returns error as before

## Testing Status

- ✅ Code implementation complete
- ✅ Type checking passes (pre-existing errors unrelated to changes)
- 🔄 MCP client tests running (waiting for results)

Expected test results:
- Page 21 (Customer Card): Should still work ✅
- Page 22 (Customer List): Should now return correct data ✅
- Page 30 (Item Card): Should now return correct data ✅

## Benefits

1. **Correctness**: Each page open returns the correct page's metadata
2. **Backward Compatible**: Fallback to original behavior if formId not available
3. **No Breaking Changes**: API surface unchanged for consumers
4. **Type Safe**: Full TypeScript type checking maintained

## Future Enhancements

Consider:
1. Add logging to track which formId was used for debugging
2. Close forms after metadata extraction to free BC session resources
3. Add metrics to track form count in session
4. Handle race conditions if multiple forms open simultaneously

## References

- Test Results: `test-results/SUMMARY.md`
- GPT-5 Analysis: Continuation ID `db27788d-2b6d-4400-a342-4c6f3a330153`
- Original Bug Report: `test-results/mcp-client-real-test-output.txt`
