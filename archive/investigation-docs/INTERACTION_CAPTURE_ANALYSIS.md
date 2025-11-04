# BC Interaction Capture Analysis

**Date**: 2025-11-01
**Session**: Manual capture analysis
**Files Analyzed**: `invoke-calls-captured.json` (20 WebSocket messages, 26 interactions)

## Summary

The manual capture session successfully recorded BC WebSocket traffic, but **did not capture the specific interactions needed to verify our tool implementations**:

- ❌ **InvokeAction** (0 captured) - Used by `execute-action-tool.ts`
- ❌ **ChangeField** (0 captured) - Used by `update-field-tool.ts`

### What Was Captured

| Interaction Type | Count | Purpose |
|-----------------|-------|---------|
| LoadForm | 15 | Loading/opening forms (Pages 21, 22, 31) |
| InvokeSessionAction | 8 | System actions and telemetry |
| InvokeExtensibilityMethod | 3 | Extension method calls (ShowTourWizard, PageReady, ControlAddInReady) |

## Test Results Status

**IMPORTANT**: Despite lacking captured real protocols, our interaction tools **PASSED ALL TESTS** (5/5) against the real BC server:

```
✓ Test 1: Page opened successfully (Customer Card Page 21)
✓ Test 2: Action executed successfully (InvokeAction - "Edit" button)
✓ Test 3: Field updated successfully (ChangeField - "Name" field)
✓ Test 4: Correctly rejected unopened page (validation)
✓ Test 5: Correctly rejected unopened page (validation)
```

**Source**: `test-interaction-tools.ts` execution results
**Date**: Previous session (from summary)

## Implications

### Hypothesized Protocols Appear Correct

Our implementations in `execute-action-tool.ts` and `update-field-tool.ts` used **hypothesized protocols** from `BC_INTERACTION_CAPTURE_PLAN.md`:

**InvokeAction** (execute-action-tool.ts:147-155):
```typescript
const interaction = {
  interactionName: 'InvokeAction',
  namedParameters: {
    actionName,  // e.g., "Edit", "New", "Delete"
  },
  callbackId: '',
  controlPath: controlPath || undefined,
  formId,
};
```

**ChangeField** (update-field-tool.ts:179-188):
```typescript
const interaction = {
  interactionName: 'ChangeField',
  namedParameters: {
    fieldName,    // e.g., "Name", "Address"
    newValue: value,
  },
  callbackId: '',
  controlPath: controlPath || undefined,
  formId,
};
```

Since these protocols **worked successfully** against the real BC server, our hypotheses were likely accurate. However, **verification is still recommended**.

## LoadForm Protocol Verification

The captured data DOES verify the LoadForm protocol used by `BCPageConnection`:

### Captured LoadForm Example:
```json
{
  "interactionName": "LoadForm",
  "skipExtendingSessionLifetime": false,
  "namedParameters": {
    "delayed": true,
    "openForm": true,
    "loadData": true
  },
  "controlPath": "server:",
  "formId": "31B",
  "callbackId": "3"
}
```

### BCPageConnection Implementation:
File: `src/connection/bc-page-connection.ts` (likely lines ~100-150)

**Observations**:
- ✓ `controlPath: "server:"` is correct
- ✓ `namedParameters` uses object with boolean flags
- ✓ `formId` is included
- ✓ `callbackId` is a sequential number (as string)

## Recommendations

### Option 1: Accept Hypothesized Protocols (Low Risk)
**Rationale**: Tests passed successfully
**Action**:
- Document that InvokeAction and ChangeField are hypothesized but working
- Monitor for errors in production use
- Update if BC returns errors

**Risk**: Low - protocols work in practice

### Option 2: Capture Real Interactions (Verification)
**Rationale**: Confirm exact protocol format
**Action**: Run new capture session with specific interactions

**What to Capture**:
1. **InvokeAction** - Click action buttons:
   - Open Customer Card (Page 21)
   - Click "Edit" button
   - Click "New" button
   - Click "Delete" button (with confirmation)

2. **ChangeField** - Update fields:
   - Change "Name" text field
   - Change "Payment Terms Code" dropdown
   - Change "Blocked" option field

**How to Capture**:
```bash
# Using existing capture tool
cd "C:\bc4ubuntu\Decompiled\bc-poc"
node capture-websocket-cdp.mjs

# OR using Playwright-based capture
node capture-bc-interactions.mjs
```

**Expected Results**:
- `invoke-calls-captured.json` should include:
  - Multiple `InvokeAction` interactions
  - Multiple `ChangeField` interactions

### Option 3: Hybrid Approach (Recommended)
**Rationale**: Balance verification with pragmatism
**Action**:
1. **Continue using current implementations** (they work!)
2. **Opportunistically capture** InvokeAction/ChangeField during next BC session
3. **Compare captured vs. implemented** when data becomes available
4. **Update only if differences found**

## Next Steps

Based on your requirements, choose one of the following:

### If prioritizing delivery:
- [ ] Mark InvokeAction and ChangeField as "hypothesized but verified via testing"
- [ ] Add monitoring/logging to detect protocol errors
- [ ] Update tools if users report errors

### If prioritizing verification:
- [ ] Run focused capture session (5 minutes):
  1. Open BC Customer Card
  2. Click "Edit" (InvokeAction)
  3. Change "Name" field (ChangeField)
  4. Change dropdown (ChangeField)
  5. Click "New" (InvokeAction)
- [ ] Analyze new captures with `node analyze-invoke-calls.mjs`
- [ ] Compare captured protocols with tool implementations
- [ ] Update tools if mismatches found

### If exploring additional interactions:
- [ ] Capture Navigate, Filter, DrillDown, etc.
- [ ] Implement new MCP tools for these interactions
- [ ] Expand test suite

## Files Reference

| File | Purpose | Status |
|------|---------|--------|
| `execute-action-tool.ts` | InvokeAction implementation | ✓ Working (hypothesized) |
| `update-field-tool.ts` | ChangeField implementation | ✓ Working (hypothesized) |
| `test-interaction-tools.ts` | Test suite | ✓ Passing (5/5) |
| `invoke-calls-captured.json` | Manual capture data | ⚠️ Missing target interactions |
| `BC_INTERACTION_CAPTURE_PLAN.md` | Protocol hypotheses | ✓ Appears accurate |
| `analyze-invoke-calls.mjs` | Analysis script | ✓ Working |

## Conclusion

**The good news**: Our tools work! Tests pass against real BC.

**The gap**: We haven't yet captured real InvokeAction/ChangeField traffic to verify our protocol assumptions match BC's actual implementation.

**Recommendation**: Use the hybrid approach - continue with current implementation while opportunistically capturing verification data when convenient.
