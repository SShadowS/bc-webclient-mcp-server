# Handler Format Mismatch Analysis

## Problem Summary

The MCP server's page metadata extraction fails with error:
```
No FormToShow event found in handlers
```

**Root Cause**: Mismatch between expected and actual BC WebSocket handler format.

---

## Detailed Analysis

### Expected Format (Current Code)

The code in `src/parsers/handler-parser.ts:86-88` expects:

```typescript
interface LogicalClientEventRaisingHandler {
  t: 'DN.LogicalClientEventRaisingHandler';
  EventName: 'FormToShow';
  LogicalForm: { ... };
}
```

**Looking for**:
- Property: `h.t === 'DN.LogicalClientEventRaisingHandler'`
- Property: `h.EventName === 'FormToShow'`
- Property: `h.LogicalForm`

### Actual Format (Real BC Response)

The actual BC server response (from `responses/page-21-full-response.json`):

```json
{
  "handlerType": "DN.LogicalClientEventRaisingHandler",
  "parameters": [
    "FormToShow",
    {
      "ServerId": "12C",
      "Caption": "Customer Card",
      "CacheKey": "21:embedded(False)",
      ...
    },
    { ... }
  ]
}
```

**Actual structure**:
- Property: `handlerType` (not `t`)
- Event name: `parameters[0]` (not `EventName`)
- LogicalForm: `parameters[1]` (not `LogicalForm`)

---

## Evidence

### 1. Test Script Confirms Actual Format

From `test-open-page.ts:83-139`:

```typescript
handlers.forEach((handler: any, i: number) => {
  console.log(`${i + 1}. ${handler.handlerType}`);  // Uses handlerType

  if (handler.handlerType === 'DN.LogicalClientEventRaisingHandler') {
    const eventName = handler.parameters?.[0];  // Event name in parameters[0]
    console.log(`Event: ${eventName}`);

    if (eventName === 'FormToShow') {
      const logicalForm = handler.parameters?.[1];  // LogicalForm in parameters[1]
      // ...
    }
  }
});
```

### 2. Successful Test Pattern

The test script successfully finds FormToShow using:
```typescript
const formToShowHandler = handlers.find((h: any) =>
  h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
  h.parameters?.[0] === 'FormToShow'
);
```

### 3. Failed Parser Pattern

The parser fails using:
```typescript
const formToShowHandler = handlers.find(
  (h): h is LogicalClientEventRaisingHandler =>
    h.t === 'DN.LogicalClientEventRaisingHandler' &&  // ❌ Wrong property
    h.EventName === 'FormToShow'                       // ❌ Wrong property
);
```

---

## Impact

### Files Affected

1. **Type Definitions** (`src/types/bc-types.ts:135-169`)
   - Handler interfaces use wrong property names

2. **Handler Parser** (`src/parsers/handler-parser.ts:82-121`)
   - `extractLogicalForm()` looks for wrong properties
   - Also checks `h.t` in validation (line 187)

3. **Mock Connection** (`src/mocks/mock-bc-connection.ts`)
   - May use wrong format in test data

---

## Solution

### Option 1: Fix Type Definitions and Parser (Recommended)

Update types to match actual BC format:

```typescript
// bc-types.ts
export interface BCHandler {
  readonly handlerType: HandlerType;  // Changed from 't'
  readonly parameters: readonly unknown[];  // Add parameters array
}

export interface LogicalClientEventRaisingHandler extends BCHandler {
  readonly handlerType: 'DN.LogicalClientEventRaisingHandler';
  readonly parameters: readonly [
    eventName: string,
    logicalForm?: LogicalForm,
    metadata?: unknown
  ];
}
```

Update parser to use correct properties:

```typescript
// handler-parser.ts:extractLogicalForm()
const formToShowHandler = handlers.find(
  (h): h is LogicalClientEventRaisingHandler =>
    h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
    h.parameters?.[0] === 'FormToShow'
);

if (!formToShowHandler) {
  return err(
    new LogicalFormParseError('No FormToShow event found in handlers', {
      handlerCount: handlers.length,
      handlerTypes: handlers.map(h => h.handlerType),  // Changed from h.t
    })
  );
}

// Extract LogicalForm from parameters[1]
const logicalForm = formToShowHandler.parameters?.[1] as LogicalForm;
```

Update validation in `parseHandlers()` (line 187):

```typescript
if (!('handlerType' in item) || typeof item.handlerType !== 'string') {
  return err(
    new InvalidResponseError(`Handler at index ${i} missing 'handlerType' property`, {
      index: i,
      handler: item,
    })
  );
}
```

### Option 2: Create Adapter Layer

Keep existing types for compatibility, create adapter to transform real BC format to expected format. This is more complex and adds overhead.

---

## Testing Required

After fixing:

1. ✅ Run `npm run test:mcp:real:client` - Should pass all tests
2. ✅ Test metadata extraction for various page types:
   - Page 21 (Card)
   - Page 22 (List)
   - Page 30 (Item Card)
   - Page 42 (Sales Order - Document)
3. ✅ Verify mock tests still pass after type changes

---

## Additional Notes

### Why This Wasn't Caught Earlier

1. The mock connection likely used the old format
2. Real BC connection tests were not exercised until recently
3. Type system didn't catch it due to `any` types in test code

### BC Protocol Design

The actual BC WebSocket protocol uses a **positional parameters array** approach:
- Generic `handlerType` discriminator
- Flexible `parameters` array for handler-specific data
- More extensible than named properties

This is common in RPC protocols where handlers can have varying parameter counts and types.

---

## Recommendation

**Apply Option 1** - Fix the types and parser to match the actual BC protocol. This:
- ✅ Aligns code with reality
- ✅ Fixes the immediate issue
- ✅ Prevents future confusion
- ✅ More maintainable long-term

The fix is straightforward and localized to 3 files.
