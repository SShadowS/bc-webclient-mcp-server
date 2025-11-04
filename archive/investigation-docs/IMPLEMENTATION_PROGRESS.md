# BC MCP Server - True User Simulation Implementation Progress

## Problem Summary

**Multi-Page Bug**: Requesting metadata for Pages 22 and 30 returns Page 21 (Customer Card) data instead of correct page data.

**Root Cause (Confirmed by GPT-5-Pro)**:
1. We use `OpenForm` interaction for EVERY page request
2. BC returns the SAME formId (1AE) for all OpenForm calls in a session
3. Real BC web clients use `Navigate` (menu) + `InvokeAction` (records), NOT repeated OpenForm
4. OpenForm returns/initializes the current top-level form/shell, not meant for opening multiple pages

## Completed Fixes ✅

### Fix #1: Deduplicate openFormIds
**File**: `src/connection/bc-session-connection.ts:249-252`
**Problem**: Multiple pages mapping to same formId caused `[1AE, 1AE]` duplicates
**Solution**:
```typescript
public getAllOpenFormIds(): string[] {
  // Use Set to deduplicate formIds (GPT-5-Pro fix: avoid [1AE, 1AE])
  return Array.from(new Set(this.openForms.values()));
}
```
**Impact**: Prevents confusing BC server with duplicate formIds in openFormIds array

### Fix #2: Add controlPath & formId Parameters
**Files**:
- `src/types/bc-types.ts:101-102` - Added to BCInteraction interface
- `src/connection/bc-session-connection.ts:120-121` - Pass through to client

**Problem**: We sent `controlPath: null`, real BC uses `controlPath: "server:c[0]"`
**Solution**:
```typescript
export interface BCInteraction {
  readonly interactionName: string;
  readonly namedParameters: Record<string, unknown>;
  readonly callbackId: string;
  readonly controlPath?: string; // GPT-5-Pro fix: e.g., "server:c[0]"
  readonly formId?: string; // For interactions on existing forms
}
```
**Impact**: Can now send proper container paths to BC server

### Fix #3: Navigate Interaction Type Definition
**File**: `src/types/bc-types.ts:134-143`
**Added**: NavigateInteraction interface matching Wireshark capture structure
```typescript
export interface NavigateInteraction extends BCInteraction {
  readonly interactionName: 'Navigate';
  readonly namedParameters: {
    readonly nodeId: string; // GUID from navigation tree
    readonly source?: unknown;
    readonly navigationTreeContext?: number; // 0 in captures
  };
  readonly formId: string; // Shell/container formId
  readonly controlPath: string; // e.g., "server:c[0]"
}
```

## Current Challenge: Navigate Requires nodeId 🔴

### The nodeId Problem

**From Wireshark**: `nodeId: "0000233e-2a58-0000-0c52-fd00836bd2d2"`

**GPT-5-Pro's Guidance**:
> "nodeIds are role/personalization/environment specific and map to menu entries, not page IDs directly. Mapping page IDs to nodeIds is not static and not 1:1."

### Proposed Solutions (from GPT-5-Pro)

**Option 1: Fetch Navigation Tree at Session Start**
- Use `InvokeSessionAction` to get Role Center navigation tree
- Traverse nodes to find list pages (Customers → page 22, Items → page 31)
- Capture nodeIds at runtime per session/role
- **Pros**: Dynamic, works across roles
- **Cons**: Complex, requires tree traversal logic

**Option 2: Use "Tell Me" Search**
- BC web client "Tell Me" search resolves objects to nodeIds
- Issue session action for search by name/ID
- **Pros**: Direct lookup
- **Cons**: Need to reverse-engineer "Tell Me" protocol

**Option 3: Hardcoded Test First**
- Use nodeId from Wireshark capture for initial test
- Proves Navigate works before building nodeId resolution
- **Pros**: Fast validation
- **Cons**: Not production-ready, role-specific

### Hybrid Approach for Card Pages

Even with nodeId resolution, Card pages require two steps:
1. **Navigate** to List page (e.g., Customers List)
   - Uses nodeId from nav tree
   - Returns formId for the list
2. **InvokeAction** on list row
   - Uses systemAction + key
   - Opens the Card (e.g., Customer Card)

**From Wireshark**:
```
Navigate → formId AB (Customers List)
InvokeAction (systemAction: 40, key: "...") → formId B4 (Customer Card)
```

## Test Results: Option 1A - controlPath Fix ❌ FAILED

**Date**: 2025-10-31
**Test**: Added `controlPath: "server:c[0]"` to OpenForm calls
**File Modified**: `src/tools/get-page-metadata-tool.ts:130`

### Results
```
Page 21: ✓ PASS - Returns "Customer Card" with formId 1CE
Page 22: ✗ FAIL - Returns "Customer Card" (wrong!) with formId 1CE (same!)
Page 30: ✗ FAIL - Returns "Customer Card" (wrong!) with formId 1CE (same!)
```

### Key Evidence
```
[GetPageMetadataTool] 🆕 Opening new BC Page: "22"
  🔧 OpenForm: openFormIds=[1CE], tracked forms: 1
  📝 Tracking new form ID: 1CE, Handle: 4bff6514-9864-4fbb-9d8f-25eec1eac2a0
[PageMetadataParser] Selected form - ServerId: 1CE Caption: Customer Card
```

### Conclusion
**controlPath alone does NOT fix the issue**. BC still returns the same formId (1CE) for all OpenForm calls, regardless of:
- Page ID parameter (21, 22, 30)
- controlPath specification ("server:c[0]")
- Deduplicated openFormIds array

This definitively proves:
1. **OpenForm is fundamentally incompatible with multi-page sessions**
2. OpenForm returns/initializes the current top-level form shell, not a new form per page
3. GPT-5-Pro's analysis was correct: **We MUST switch to Navigate interaction**

### Next Action Required
Move to **Navigate implementation** with nodeId resolution. No further OpenForm testing needed.

**Test Log**: `test-controlpath-fix.txt`

## Recommended Next Steps

### Phase 1: Validate Navigate Works (Quick Test)
1. ~~Add controlPath to existing OpenForm calls: `controlPath: "server:c[0]"`~~ ✅ DONE
2. ~~Test if this alone fixes the formId reuse issue~~ ✅ TESTED - ❌ FAILED
3. **NEXT**: Try Navigate with hardcoded nodeId from Wireshark
4. Verify Navigate creates unique formIds

### Phase 2: Implement Simple nodeId Resolution
1. Create hardcoded map for common pages:
   ```typescript
   const PAGE_TO_NODEID: Record<string, string> = {
     '22': '0000233e-2a58-0000-0c52-fd00836bd2d2', // Customers List
     // Add more as discovered
   };
   ```
2. Test with Pages 21, 22, 30
3. Document which nodeIds work for which pages

### Phase 3: Dynamic nodeId Resolution (Future)
1. Implement InvokeSessionAction to fetch nav tree
2. Build nodeId catalog at session initialization
3. Create search/lookup functions
4. Handle Card pages with two-step Navigate → InvokeAction

## Files Modified

### Core Infrastructure
- `src/types/bc-types.ts` - Added controlPath, formId, NavigateInteraction
- `src/connection/bc-session-connection.ts` - Deduplication, pass-through parameters
- `src/BCRawWebSocketClient.ts` - Already supports controlPath (no changes needed)

### Analysis Tools
- `analyze-our-calls.mjs` - Extract MCP interactions from logs
- `analyze-wireshark-detailed.mjs` - Extract real BC interactions from captures
- `call-comparison.txt` - Side-by-side comparison document

### Documentation
- `our-bc-calls.txt` - Our OpenForm-based interactions
- `wireshark-bc-calls.txt` - Real BC Navigate/InvokeAction interactions
- `call-comparison.txt` - Root cause analysis
- `IMPLEMENTATION_PROGRESS.md` - This document

## GPT-5-Pro's Validation

✅ Root cause correct: OpenForm is wrong primitive
✅ Navigate/InvokeAction is correct approach
✅ controlPath must be provided (not null)
✅ openFormIds must be deduplicated
✅ nodeId resolution is session/role-specific, not static

### Open Questions (from GPT-5-Pro)
> "Can you share one raw pair of request/response for your OpenForm call (for Page 22) and one for the Navigate call from your Wireshark capture, including the full payloads?"

This would help confirm exact schema and ensure we're not missing required fields.

## Success Criteria

### Immediate Goal
- [ ] Page 22 request returns "Customers" or "Customer List" (NOT "Customer Card")
- [ ] Page 30 request returns "Items" or "Item Card" (NOT "Customer Card")
- [ ] Each page request creates unique formId (AB, B4, B6, etc.)
- [ ] openFormIds accumulates without duplicates: [] → [AB] → [AB, B4]

### Long-term Goal
- [ ] Dynamic nodeId resolution from navigation tree
- [ ] Two-step Card opening (Navigate → InvokeAction)
- [ ] Proper form tracking across session
- [ ] True user simulation matching real BC web client

## Technical Debt

1. **OpenForm still in use**: Need to replace with Navigate
2. **Hardcoded nodeIds**: Need dynamic resolution
3. **Card page handling**: Need InvokeAction implementation
4. **Form lifecycle**: CloseForm cleanup not tested
5. **Error handling**: Navigate failures not handled
6. **Session initialization**: Need InvokeSessionAction for nav tree

## References

- Wireshark capture: `WiresharkWebSocket2.txt`
- Test logs: `test-true-user-simulation.txt`
- Comparison analysis: `call-comparison.txt`
- GPT-5-Pro analysis: Chat continuation ID `1ebcecf4-7e0b-4d27-adfe-bc1c64588d60`
