# Filter Implementation Findings

## Investigation Summary (2025-11-01)

### Critical Discovery: Control Paths Are Session-Ephemeral

**Problem Confirmed:**
- Manual browser session: Page 22 → formId `601`
- Programmatic session: Page 22 → formId `64C`
- Control path `c[2]/c[2]/c[1]` → **ArgumentOutOfRangeException** in programmatic session
- **BC immediately closes session** after invalid path

**Conclusion:** Hardcoded control paths from captured traffic **cannot** be used for programmatic automation.

---

## Dataset Structure Discovery

### DataRefreshChange Response

When opening Customers list (Page 22), BC sends a `DataRefreshChange` with:

```javascript
{
  "t": "DataRefreshChange",
  "ControlReference": {
    "controlPath": "server:c[3]",  // List control path (session-specific!)
    "formId": "664"                 // Form ID (session-specific!)
  },
  "RowChanges": [
    {
      "t": "DataRowInserted",
      "DataRowInserted": [
        0,  // Row index
        {
          "bookmark": "15_EgAAAAJ7BTEAMAAwADAAMA",
          "selected": true,
          "cells": {
            "140": {                          // Column ID (image)
              "type": "image",
              "stringValue": "3f15a5a6-9e97-430f-99fc-08962b4ed067"
            },
            "1295001522_c1": {                // Column ID (No.)
              "stringValue": "10000"
            },
            "1330459806_c2": {                // Column ID (Name)
              "stringValue": "Kontorcentralen A/S"
            },
            "1762306781_c8": {                // Column ID (Contact)
              "stringValue": "Robert Townes",
              "canInvoke": true
            }
          }
        }
      ]
    }
  ]
}
```

**Key Observations:**
1. **Column IDs** are numeric with `_c` suffix (e.g., `1330459806_c2` for Name)
2. **No explicit column metadata** in the DataRefreshChange
3. Column data appears in row cells with IDs as keys

---

## Filter Interaction Structure (from Manual Capture)

```javascript
{
  "interactionName": "Filter",
  "namedParameters": {
    "filterOperation": 1,
    "filterColumnId": "18_Customer.2"    // DIFFERENT format from cell IDs!
  },
  "controlPath": "server:c[2]",         // List control path
  "formId": "601"                       // Form ID
}
```

**Key Question:** How to map cell column IDs (`1330459806_c2`) to filter column IDs (`18_Customer.2`)?

**Hypothesis:**
- `18` = Table ID (Customer table)
- `.2` = Field number in table
- Need to discover this mapping from page metadata or LoadForm responses

---

## Recommended Implementation Strategy (from GPT-5 Pro)

### Primary: Dataset/Column Filter (Metadata-Driven)

**Why:**
- Uses stable metadata discovered at runtime
- Avoids volatile UI control paths
- Works across sessions, personalizations, BC versions

**Implementation Steps:**
1. **Open page** (OpenForm)
2. **Extract dataset metadata** from DataRefreshChange:
   - List control path (`ControlReference.controlPath`)
   - Available columns (from cell keys in first row)
3. **Map column IDs to filter format:**
   - Need to find metadata that maps `1330459806_c2` → `18_Customer.2`
   - Likely in GetPageMetadata response or LoadForm handlers
4. **Select searchable column:**
   - Priority: Name, Description, Display Name, No.
   - Filter by data type (text/code fields)
5. **Send Filter interaction:**
   ```javascript
   {
     interactionName: 'Filter',
     namedParameters: {
       filterOperation: 1,
       filterColumnId: discovered_filter_id  // e.g., "18_Customer.2"
     },
     controlPath: list_control_path,        // From ControlReference
     formId: current_form_id
   }
   ```
6. **Wait for DataRefreshChange** to confirm filter applied

**BC Filter Expression Syntax:**
- `@*term*` = Case-insensitive contains
- Escape special chars: `@`, `*`, `..`, `|`, `<`, `>`

### Fallback: Quick Search SaveValue (Runtime Discovery)

**Only if dataset filter unavailable.**

Requires:
- Control tree exploration to find quick-search input
- Path caching per session (formId scope)
- Probing with safe test values

---

## Next Steps

### Immediate (In Progress)
1. ✅ Confirmed control paths are session-ephemeral
2. ✅ Discovered DataRefreshChange structure
3. ✅ Identified column ID formats in responses
4. ⏳ **BLOCKED:** Need to find column ID → filter column ID mapping

### To Complete Dataset Filter Implementation
1. **Investigate GetPageMetadata response** for column mapping
   - Check if it contains `filterColumnId` or table/field numbers
   - Look for correlation between cell IDs and filter IDs
2. **Build dataset metadata parser:**
   - Extract list control path from DataRefreshChange
   - Map column IDs to filter column IDs
   - Select searchable text columns
3. **Implement Filter interaction sender:**
   - Use discovered metadata
   - Build BC filter expression (`@*term*`)
   - Wait for DataRefreshChange confirmation
4. **Test on multiple pages:**
   - Customers (Page 22)
   - Items (Page 31)
   - Vendors (Page 27)
   - Sales Orders (Page 9305)

---

## Open Questions

1. **Column ID Mapping:** How to convert `1330459806_c2` → `18_Customer.2`?
   - Check GetPageMetadata fields for `id` or `filterColumnId` property
   - Check LoadForm responses for column definitions
   - May need to parse table ID from page metadata

2. **List Control Path Discovery:** How to reliably find list control path?
   - Currently: Extract from DataRefreshChange.ControlReference.controlPath
   - Alternative: Search page metadata for repeater controls

3. **Column Selection Heuristics:** Which column to filter on?
   - Priority order: Name > Description > Display Name > No.
   - Filter by data type (Text/Code only)
   - Exclude special columns (images, actions)

---

## Files Created

- `validate-filter-paths.ts` - Proved control paths are not stable
- `investigate-dataset-metadata.ts` - Discovered DataRefreshChange structure
- `examine-dataset.mjs` - Analyzed column ID formats
- `dataset-metadata-investigation.json` - Full response capture
- `docs/FILTER_PROTOCOL.md` - Updated with findings and warnings

---

## Key Learnings

1. **Never hardcode control paths** - They change between sessions
2. **Never hardcode formIds** - They change between sessions
3. **Always discover metadata at runtime** - Use DataRefreshChange and page metadata
4. **Dataset-level filtering is more robust** - Avoids UI control volatility
5. **BC filter syntax is powerful** - `@*term*` for contains, wildcards supported

---

## References

- Captured filter interactions: `all-interactions.json`
- WebSocket capture: `filter-websocket-capture.json`
- Dataset investigation: `dataset-metadata-investigation.json`
- Expert analysis: GPT-5 Pro deep investigation (via thinkdeep tool)
