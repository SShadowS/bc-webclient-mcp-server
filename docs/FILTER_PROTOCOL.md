# Business Central Filter Protocol

## CRITICAL DISCOVERY: Control Paths Are Not Stable

**Validation Test Results (2025-11-01):**

| Session Type | Page 22 (Customers) | Control Path `c[2]/c[2]/c[1]` | Result |
|--------------|---------------------|-------------------------------|--------|
| Manual Browser | formId: `601` | ✅ Works | Filter applied successfully |
| Programmatic | formId: `64C` | ❌ **ArgumentOutOfRangeException** | Session closed by BC |

**KEY INSIGHT:** FormIds and control paths are **session-ephemeral** and vary between sessions. Hardcoded paths from captured traffic **CANNOT** be used for programmatic access.

---

## Recommended Implementation Strategy

### ✅ PRIMARY: Dataset/Column Filter (Metadata-Driven, STABLE)

**Why this approach:**
- Uses stable metadata (dataSetId + fieldId) discovered at runtime
- Avoids volatile UI control paths entirely
- Works regardless of personalization or BC version

**Implementation:**
1. After LoadForm, extract dataset metadata (dataSetId, columns)
2. Select searchable text column (Name, Description, No.)
3. Send Filter interaction with BC expression: `@*term*`
4. Wait for DataRefreshChange to confirm

### ⚠️ FALLBACK: Quick Search SaveValue (Runtime Discovery Required)

**Only use when:**
- Dataset filter unavailable
- Need "global search" semantics across multiple columns

**Implementation:**
1. After LoadForm, build control tree index
2. Discover quick-search control path via metadata/probing
3. Cache path in-memory for session (formId scope only)
4. Send SaveValue with term
5. Wait for DataRefreshChange

---

## Captured Evidence (Historical Reference Only)

**Test scenario:** Filtered "Customers" page (Page 22, formId 601)
- Applied filter: "Adatum" on Name column
- Cleared filter
- Applied filter: "Dee*" with wildcard
- Cleared filter again

**Captured interactions:**
- 1x `Filter` interaction (column filter)
- 4x `SaveValue` interactions (filter box typing)

**⚠️ WARNING:** These paths are from a specific session and should NOT be hardcoded.

---

## Method 1: Column Filter (Dataset-Driven, RECOMMENDED)

### When to use:
- Filtering a specific column by discovered fieldId
- Robust approach that works across sessions

### Protocol:

```javascript
{
  "interactionName": "Filter",
  "skipExtendingSessionLifetime": false,
  "namedParameters": {
    "filterOperation": 1,              // Operation type (1 = filter)
    "filterColumnId": "18_Customer.2"  // Column ID (MUST be discovered at runtime)
  },
  "controlPath": "server:c[2]",        // List control path (MUST be discovered)
  "formId": "64C",                     // Form ID (varies per session)
  "callbackId": "7"                    // Callback ID for response
}
