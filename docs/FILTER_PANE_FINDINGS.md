# Filter Pane Capture Findings

## Date: 2025-11-01

## Summary

Successfully captured filter interactions from BC Web Client showing the correct protocol for applying column-based filters.

## Key Findings

### 1. Filter Interaction Structure

**Method**: `Invoke` (BC27+ protocol)

**Interaction**: `Filter`

```json
{
  "interactionName": "Filter",
  "formId": "680",
  "controlPath": "server:c[2]",
  "namedParameters": {
    "filterOperation": 1,
    "filterColumnId": "18_Customer.2"
  }
}
```

**Key Parameters**:
- `filterOperation`: `1` (appears to be "set filter" operation)
- `filterColumnId`: `"18_Customer.2"` - Canonical field ID format: `{tableId}_{entityName}.{fieldNumber}`

**Control Path**: `server:c[2]` - Points to the list/repeater control

### 2. SaveValue Interaction (Optional)

Used for type-ahead / quick filter:

```json
{
  "interactionName": "SaveValue",
  "formId": "680",
  "controlPath": "server:c[2]/c[2]/c[1]",
  "namedParameters": {
    "key": null,
    "newValue": "Adatum",
    "alwaysCommitChange": true,
    "ignoreForSavingState": true,
    "notifyBusy": 1,
    "telemetry": {
      "Control name": "Name",
      "QueuedTime": "2025-11-01T23:48:02.330Z"
    }
  }
}
```

**Note**: SaveValue uses a **different control path** (`server:c[2]/c[2]/c[1]`) pointing to the filter input control, not the list itself.

### 3. Canonical Field ID Format

**Pattern**: `{tableId}_{entityName}.{fieldNumber}`

**Example**: `18_Customer.2`
- `18` = Table ID (Customer table)
- `Customer` = Entity name
- `.2` = Field number in the table

### 4. Missing: Filter Picker Interaction

**Problem**: We did NOT capture the "Add filter" picker interaction showing how to discover the canonical field ID from a column caption like "Name".

**Reason**: The user likely used an existing filter or typed directly in a quick filter box, bypassing the picker.

**Next Step**: Need to capture the filter picker specifically:
1. Open filter pane (Shift+F3)
2. Click "Add filter" button
3. **Type a column name** (e.g., "Name")
4. **Select from dropdown** - This response should contain the canonical field IDs!

## Comparison with Previous Findings

### From `all-interactions.json` (Previous Capture)

```json
{
  "interactionName": "Filter",
  "namedParameters": {
    "filterOperation": 1,
    "filterColumnId": "18_Customer.2"
  },
  "controlPath": "server:c[2]",
  "formId": "601"
}
```

**Differences**:
- Different formId (`601` vs `680`) - confirms formIds are session-ephemeral ✅
- Different control path index possible (`c[2]` consistent) ✅
- Same canonical field ID format (`18_Customer.2`) ✅
- Same filterOperation (`1`) ✅

**Conclusion**: The Filter interaction structure is **stable and reliable** across sessions!

## BC27 Protocol Changes

### Old Protocol (BC < 27)
- Method: `InvokeInteractions`
- Interactions wrapped in `interactionsToInvoke` array

### New Protocol (BC27+)
- Method: `Invoke` or `Message`
- Direct interaction parameters in `params[0]`
- Still uses `interactionsToInvoke` array within params

## Implementation Strategy (Updated)

### Confirmed Working:
1. ✅ Filter interaction structure
2. ✅ Canonical field ID format
3. ✅ Control path pattern (list control)
4. ✅ Filter operation value (1)

### Still Need:
1. ❌ **How to discover canonical field ID from column caption**
2. ❌ Filter picker response structure
3. ❌ Column metadata that maps cell IDs to canonical IDs

### Recommended Approach

**Strategy B (GPT-5 Pro)**: Use filter picker to discover canonical IDs

1. Open Filter Pane command (need to identify)
2. Open "Add filter" picker (need to identify)
3. Type column caption (e.g., "Name")
4. **Parse picker response** for items containing:
   - Caption: "Name"
   - Canonical ID: "18_Customer.2"
5. Cache mapping per session
6. Use discovered ID in Filter interaction

## Files Created

- `capture-filter-pane.mjs` - Playwright-based capture script with iframe support
- `analyze-filter-pane-capture.mjs` - Analysis script for BC27+ protocol
- `filter-pane-capture.json` - Captured WebSocket traffic (37 messages)
- `filter-pane-analysis.json` - Detailed analysis output

## Next Steps

1. **Capture filter picker interactions**:
   - Run capture script again
   - Open Filter Pane (Shift+F3)
   - Click "Add filter" button explicitly
   - Type column name and observe dropdown
   - Select field from dropdown
   - Capture the DataRefreshChange or similar response containing picker items

2. **Analyze picker data structure**:
   - Find where canonical field IDs are sent
   - Determine how picker items are formatted
   - Verify caption → ID mapping is present

3. **Implement FilterPickerResolver**:
   - Class to open picker and extract field IDs
   - Session-scoped caching
   - Fallback strategies if picker unavailable

4. **Implement filter_list tool**:
   - Use FilterPickerResolver to get canonical ID
   - Send Filter interaction with discovered ID
   - Wait for DataRefreshChange confirmation
   - Return filtered results

## References

- Previous findings: `docs/FILTER_IMPLEMENTATION_FINDINGS.md`
- GPT-5 solution: `docs/FILTER_SOLUTION.md`
- Captured data: `filter-pane-capture.json`
- Analysis: `filter-pane-analysis.json`
