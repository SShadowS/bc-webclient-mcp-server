# openFormIds Issue Analysis

**Date**: 2025-10-29
**Issue**: Tests for Pages 22 and 30 return Page 21 data
**Status**: Root cause identified, solution determined

---

## Problem

When requesting metadata for multiple pages in sequence:
1. ✅ Page 21 request → Returns Page 21 (Customer Card) with form ID "292"
2. ❌ Page 22 request → Returns Page 21 (Customer Card) with form ID "292"
3. ❌ Page 30 request → Returns Page 21 (Customer Card) with form ID "292"

Test failures:
```
Testing: Get REAL metadata for Page 22 (Customer List)...
 ✗ FAIL
  Wrong pageId: 21

Testing: Get REAL metadata for Page 30 (Item Card)...
 ✗ FAIL
  Wrong pageId: 21
```

---

## Root Cause

**BC maintains server-side session state for open forms**. When you open a form, it stays open on the server until explicitly closed.

### Evidence from Test Output

```bash
Step 2: Opening Page 21 (Customer Card)...
→ Sending: {"openFormIds":[],...}
✓ Received form ID: 292

Step 3: Opening Page 22 (Customer List)...
→ Sending: {"openFormIds":[],...}
✓ Received form ID: 292  ← SAME FORM!
  ✓ Page 22 - Caption: "Customer Card", CacheKey: "21:embedded(False)"
  ❌ WRONG CacheKey! Expected "22:embedded(False)"

Step 4: Opening Page 30 (Item Card)...
→ Sending: {"openFormIds":[],...}
✓ Received form ID: 292  ← SAME FORM AGAIN!
  ✓ Page 30 - Caption: "Customer Card", CacheKey: "21:embedded(False)"
  ❌ WRONG CacheKey! Expected "30:embedded(False)"
```

---

## What We Tried

### Attempt 1: Track openFormIds
**Approach**: Track form IDs from responses and pass them in subsequent requests

**Code**:
```typescript
private openFormIds: string[] = [];

const response = await this.client.invoke({
  interactionName: interaction.interactionName,
  namedParameters: interaction.namedParameters || {},
  openFormIds: this.openFormIds,  // Pass tracked form IDs
  lastClientAckSequenceNumber: -1,
});

// Extract and track form ID from response
this.extractAndTrackFormId(response);
```

**Result**: ❌ Failed - BC reuses existing form when it sees it in openFormIds

**Why it failed**: When BC sees `openFormIds: ["292"]` and you request a different page, BC assumes you want to keep form 292 open and just returns it instead of opening a new form.

---

### Attempt 2: Always pass empty openFormIds
**Approach**: Always pass `openFormIds: []` to tell BC no forms are open

**Code**:
```typescript
const response = await this.client.invoke({
  interactionName: interaction.interactionName,
  namedParameters: interaction.namedParameters || {},
  openFormIds: [],  // Always empty
  lastClientAckSequenceNumber: -1,
});
```

**Result**: ❌ Failed - BC still reuses existing form

**Why it failed**: BC maintains its own server-side state independent of what the client reports in `openFormIds`. The form is still open on the server side even though we say it's not open on our side.

---

## The Solution

**Close forms before opening new ones**. BC needs an explicit CloseForm interaction to release server-side form state.

### Required Changes

1. **Add CloseForm interaction type** (`src/types/bc-types.ts`):
```typescript
export interface CloseFormInteraction extends BCInteraction {
  readonly interactionName: 'CloseForm';
  readonly namedParameters: {
    readonly formId: string;  // The ServerId from the open form
  };
}
```

2. **Track open form IDs** (`src/connection/bc-session-connection.ts`):
```typescript
export class BCSessionConnection implements IBCConnection {
  private client: BCRawWebSocketClient | null = null;
  private session: BCSession | undefined;
  private readonly config: BCSessionConnectionConfig;
  private currentFormId: string | null = null;  // Track currently open form

  public async invoke(interaction: BCInteraction): Promise<Result<readonly Handler[], BCError>> {
    try {
      // Close previous form if opening a new one
      if (interaction.interactionName === 'OpenForm' && this.currentFormId) {
        await this.client.invoke({
          interactionName: 'CloseForm',
          namedParameters: { formId: this.currentFormId },
          openFormIds: [this.currentFormId],
          lastClientAckSequenceNumber: -1,
        });
        this.currentFormId = null;
      }

      // Open the new form
      const response = await this.client.invoke({
        interactionName: interaction.interactionName,
        namedParameters: interaction.namedParameters || {},
        openFormIds: this.currentFormId ? [this.currentFormId] : [],
        lastClientAckSequenceNumber: -1,
      });

      // Extract and track the new form ID
      if (interaction.interactionName === 'OpenForm') {
        this.currentFormId = this.extractFormId(response);
      }

      return ok(response as readonly Handler[]);
    } catch (error) {
      // ...
    }
  }

  private extractFormId(handlers: readonly Handler[]): string | null {
    const callbackHandler = handlers.find(
      (h: any) => h.handlerType === 'DN.CallbackResponseProperties'
    );
    const formId = (callbackHandler as any)?.parameters?.[0]?.CompletedInteractions?.[0]?.Result?.value;
    return typeof formId === 'string' ? formId : null;
  }
}
```

---

## Expected Behavior After Fix

```bash
Step 2: Opening Page 21...
  ✓ Opened form ID: 292 (Customer Card)

Step 3: Closing form 292...
  ✓ Closed form 292

Step 4: Opening Page 22...
  ✓ Opened form ID: 293 (Customer List)  ← NEW FORM!
  ✓ Page 22 - Caption: "Customer List", CacheKey: "22:embedded(False)"

Step 5: Closing form 293...
  ✓ Closed form 293

Step 6: Opening Page 30...
  ✓ Opened form ID: 294 (Item Card)  ← NEW FORM!
  ✓ Page 30 - Caption: "Item Card", CacheKey: "30:embedded(False)"
```

---

## Testing Required

1. ✅ Verify CloseForm interaction syntax with BC server
2. 🔲 Implement CloseForm type and logic
3. 🔲 Test with standalone script:
   - Open Page 21 → Close → Open Page 22 → Verify different form IDs
4. 🔲 Run full MCP test suite:
   - `npm run test:mcp:real:client`
   - All 8 tests should pass

---

## BC Protocol Behavior Summary

| Scenario | openFormIds | BC Behavior |
|----------|-------------|-------------|
| First OpenForm call | `[]` | Opens new form, returns form ID |
| Second OpenForm with same form ID | `["292"]` | Returns existing form 292 |
| Second OpenForm with empty array | `[]` | **Still returns existing form 292** (server-side state!) |
| CloseForm then OpenForm | `[]` | Opens NEW form with different ID |

**Key Insight**: The `openFormIds` parameter is for optimistic concurrency and client-side tracking, but BC's server maintains authoritative state. You must explicitly close forms to release them.

---

## Next Steps

1. Implement CloseForm interaction type
2. Add form tracking and auto-close logic to BCSessionConnection
3. Test with multiple page requests
4. Verify all MCP tests pass
