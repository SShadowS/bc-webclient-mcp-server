# Business Central `read_page_data` Tool - Implementation Plan

## Executive Summary

This document provides a comprehensive implementation plan for the `read_page_data` MCP tool based on analysis of the Business Central WebSocket protocol, existing codebase patterns, and captured LogicalForm data.

**Status**: Ready for implementation - all protocol patterns are understood and utilities exist.

---

## 1. How Field VALUES Are Stored in LogicalForm

### Analysis of Page 21 (Customer Card) LogicalForm

Field values are stored **directly in control properties**, not requiring additional interactions.

#### Value Storage Patterns by Control Type

| Control Type | Property | Example | Notes |
|--------------|----------|---------|-------|
| **String (sc)** | `StringValue` | `"Adatum Corporation"` | Direct string value |
| **Boolean (bc)** | `ObjectValue` | `true` / `false` | **Use ObjectValue, not StringValue** |
| **Decimal (dc)** | `StringValue` | `"0"` | Parse as float |
| **Integer (i32c)** | `StringValue` | `"0"` | Parse as integer |
| **Select/Enum (sec)** | `CurrentIndex` + `Items[]` | Find item at `CurrentIndex` in `Items` array | |
| **DateTime (dtc)** | `StringValue` | `"2025-01-02T00:00:00Z"` | ISO 8601 format |
| **Percent (pc)** | `StringValue` | `"0"` | Parse as decimal |

#### Example from Customer Card (Page 21)

```json
{
  "t": "sc",
  "Caption": "Name",
  "DesignName": "Name",
  "StringValue": "Adatum Corporation",
  "ObjectValue": "Adatum Corporation",
  "Editable": true,
  "Enabled": true
}
```

```json
{
  "t": "bc",
  "Caption": "Balance Due (LCY)",
  "DesignName": "Balance Due (LCY)",
  "StringValue": "",
  "ObjectValue": false,
  "Editable": false,
  "Enabled": false
}
```

**Critical Finding**: Boolean controls have BOTH `ObjectValue` (actual boolean) and `StringValue` (string representation). **Always use `ObjectValue` for booleans.**

---

## 2. How Repeater Controls Store Row Data

### Card Pages (Single Record) vs List Pages (Multiple Records)

| Page Type | Control Structure | Data Availability | Example |
|-----------|------------------|-------------------|---------|
| **Card** (Page 21) | Field controls with values | **In initial OpenForm response** | Customer Card |
| **List** (Page 22) | Repeater control (Type 11, `t: "rc"`) | **Via async DataRefreshChange events** | Customer List |

### List Page Data Protocol

List page data does NOT arrive in the initial LogicalForm. Instead:

1. **OpenForm response** contains:
   - LogicalForm structure with **empty repeater control**
   - Repeater control has `Type: 11` or `t: "rc"`
   - No row data yet

2. **Async DataRefreshChange handler** arrives after OpenForm:
   - Handler type: `DN.LogicalClientChangeHandler`
   - Contains `DataRefreshChange` with `RowChanges` array
   - Each row has `cells` object with typed values

### Example: Tell Me Search (Already Working Pattern)

The Tell Me search implementation in `src/protocol/logical-form-parser.ts` already demonstrates this pattern:

```typescript
export function extractTellMeResultsFromChangeHandler(handlers: any[]) {
  // Find LogicalClientChangeHandler
  const changeHandler = handlers.find(
    (h: any) => h.handlerType === 'DN.LogicalClientChangeHandler'
  );

  // Get changes array (parameters[1])
  const changes = changeHandler.parameters?.[1];

  // Find DataRefreshChange for repeater
  const dataChange = changes.find(
    (c: any) => c.t === 'DataRefreshChange' &&
                c.ControlReference?.controlPath === 'server:c[1]'
  );

  // Extract rows
  const results = dataChange.RowChanges
    .filter((row: any) => row.t === 'DataRowInserted')
    .map((row: any) => {
      const rowData = row.DataRowInserted?.[1];
      const cells = rowData?.cells;

      return {
        name: cells.Name?.stringValue,
        category: cells.DepartmentCategory?.stringValue,
        objectId: extractFromCacheKey(cells.CacheKey?.stringValue),
        key: rowData.bookmark
      };
    });
}
```

**This exact pattern applies to list page data extraction!**

---

## 3. Data Extraction Logic

### Two-Pattern Value Access

BC uses two different patterns for value storage:

#### Pattern 1: LogicalForm Controls (Card pages, initial form data)
```json
{
  "t": "sc",
  "Caption": "Name",
  "StringValue": "Adatum Corporation",
  "ObjectValue": "Adatum Corporation"
}
```

Access: `control.StringValue` or `control.ObjectValue`

#### Pattern 2: DataRefreshChange Updates (List pages, dynamic data)
```json
{
  "cells": {
    "Name": { "stringValue": "Adatum Corporation" },
    "No.": { "stringValue": "10000" },
    "Balance (LCY)": { "decimalValue": 0 }
  }
}
```

Access: `cells.Name?.stringValue`

### Cell Value Types in DataRefreshChange

```typescript
interface CellValue {
  stringValue?: string;
  decimalValue?: number;
  intValue?: number;
  boolValue?: boolean;
  dateTimeValue?: string; // ISO 8601
}
```

---

## 4. BC Protocol Interactions Required

### Card Page (Single Record)

**Single interaction** - data is in OpenForm response:

```typescript
const openResult = await connection.invoke({
  interactionName: 'OpenForm',
  namedParameters: { query: queryString },
  controlPath: 'server:c[0]',
  callbackId: '0',
});

// Extract LogicalForm from response
// Walk control tree
// Extract field values directly from controls
```

### List Page (Multiple Records)

**Two-phase interaction** - OpenForm + wait for DataRefreshChange:

```typescript
// 1. Open page (creates repeater structure)
const openResult = await connection.invoke({
  interactionName: 'OpenForm',
  namedParameters: { query: queryString },
  controlPath: 'server:c[0]',
  callbackId: '0',
});

// 2. Wait for data to arrive via event-driven pattern
const dataHandlers = await connection.waitForHandlers(
  (handlers) => handlers.some(h =>
    h.handlerType === 'DN.LogicalClientChangeHandler' &&
    hasDataRefreshChange(h)
  ),
  5000 // timeout
);

// 3. Extract row data from DataRefreshChange
const records = extractRecordsFromDataRefresh(dataHandlers);
```

**Existing Infrastructure**: The event-driven pattern is already implemented in `BCRawWebSocketClient.waitForHandlers()` - used successfully for Tell Me search!

---

## 5. Implementation Design

### Input Schema

```typescript
interface ReadPageDataInput {
  pageId: string;              // Required: BC page ID
  filters?: Record<string, unknown>; // Optional: filter by field values
  maxRecords?: number;         // Optional: limit number of records
  bookmark?: string;           // Optional: start from specific record
}
```

### Output Schema

```typescript
interface ReadPageDataOutput {
  pageId: string;
  caption: string;
  pageType: 'card' | 'list';   // Detected from page structure
  records: PageRecord[];       // Array of records (1 for card, N for list)
  totalCount: number;          // Number of records returned
  hasMore?: boolean;           // True if pagination available
}

interface PageRecord {
  bookmark?: string;           // Unique record identifier (for updates)
  fields: Record<string, FieldValue>;
}

interface FieldValue {
  value: string | number | boolean | null;
  displayValue?: string;       // For enums, formatted decimals, etc.
  type: 'string' | 'number' | 'boolean' | 'date';
}
```

### Example Output

```json
{
  "pageId": "21",
  "caption": "Customer Card",
  "pageType": "card",
  "records": [
    {
      "fields": {
        "No.": { "value": "10000", "type": "string" },
        "Name": { "value": "Adatum Corporation", "type": "string" },
        "Balance (LCY)": { "value": 0, "displayValue": "0.00", "type": "number" },
        "Blocked": { "value": false, "type": "boolean" }
      }
    }
  ],
  "totalCount": 1
}
```

---

## 6. Step-by-Step Implementation Plan

### Phase 1: Card Page Support (Simpler)

1. **Open page** using existing `get_page_metadata` pattern
2. **Extract LogicalForm** from FormToShow event
3. **Walk control tree** using `ControlWalker`
4. **Extract field values**:
   ```typescript
   function extractFieldValue(control: any): FieldValue | null {
     const FIELD_TYPES = ['sc', 'dc', 'bc', 'i32c', 'sec', 'dtc', 'pc'];

     if (!FIELD_TYPES.includes(control.t)) {
       return null;
     }

     // Type-specific extraction
     switch (control.t) {
       case 'bc': return { value: control.ObjectValue, type: 'boolean' };
       case 'dc': case 'pc': return {
         value: parseFloat(control.StringValue || '0'),
         type: 'number'
       };
       case 'i32c': return {
         value: parseInt(control.StringValue || '0'),
         type: 'number'
       };
       case 'sec': return extractSelectValue(control);
       case 'dtc': return { value: control.StringValue, type: 'date' };
       default: return { value: control.StringValue, type: 'string' };
     }
   }
   ```

5. **Build output** with single record

### Phase 2: List Page Support (Event-Driven)

1. **Open page** (same as card)
2. **Detect page type**:
   ```typescript
   function isListPage(logicalForm: any): boolean {
     // Look for repeater control in main content area
     return hasRepeaterControl(logicalForm.Children);
   }
   ```

3. **Wait for DataRefreshChange** using existing `waitForHandlers`:
   ```typescript
   const dataHandlers = await client.waitForHandlers(
     (handlers) => handlers.some(h =>
       h.handlerType === 'DN.LogicalClientChangeHandler' &&
       hasDataRefreshChange(h)
     ),
     5000
   );
   ```

4. **Extract rows** using Tell Me pattern:
   ```typescript
   function extractRowsFromDataRefresh(handlers: any[]): PageRecord[] {
     const changeHandler = handlers.find(
       h => h.handlerType === 'DN.LogicalClientChangeHandler'
     );

     const changes = changeHandler.parameters?.[1] || [];
     const dataChange = changes.find(c => c.t === 'DataRefreshChange');

     return dataChange.RowChanges
       .filter(row => row.t === 'DataRowInserted')
       .map(row => extractRecord(row.DataRowInserted[1]));
   }

   function extractRecord(rowData: any): PageRecord {
     const fields: Record<string, FieldValue> = {};

     for (const [fieldName, cellValue] of Object.entries(rowData.cells)) {
       fields[fieldName] = extractCellValue(cellValue);
     }

     return {
       bookmark: rowData.bookmark,
       fields
     };
   }

   function extractCellValue(cell: any): FieldValue {
     if (cell.stringValue !== undefined) {
       return { value: cell.stringValue, type: 'string' };
     }
     if (cell.decimalValue !== undefined) {
       return { value: cell.decimalValue, type: 'number' };
     }
     if (cell.intValue !== undefined) {
       return { value: cell.intValue, type: 'number' };
     }
     if (cell.boolValue !== undefined) {
       return { value: cell.boolValue, type: 'boolean' };
     }
     return { value: null, type: 'string' };
   }
   ```

### Phase 3: Filtering Support (Future)

Apply filters using BC's query syntax:
```typescript
// This would require additional research into BC filter protocol
// For now, filter can be applied client-side after extraction
```

---

## 7. Reusable Code Patterns

### From Tell Me Search (`src/protocol/logical-form-parser.ts`)

- `extractTellMeResultsFromChangeHandler()` - **Direct template for list extraction**
- Event-driven data waiting pattern
- Row extraction from DataRefreshChange

### From Page Metadata (`src/parsers/control-parser.ts`)

- `ControlWalker.walk()` - Tree traversal
- `ControlParser.walkControls()` - Flat control list
- Field type detection

### From Get Page Metadata (`src/tools/get-page-metadata-tool.ts`)

- OpenForm interaction pattern
- LogicalForm extraction from handlers
- Form ID tracking

### From BCRawWebSocketClient (`src/BCRawWebSocketClient.ts`)

- `waitForHandlers()` - Event-driven async data
- `onHandlers()` - Event listener registration
- Handler decompression

---

## 8. Error Handling

```typescript
// 1. Page not found
if (!isOk(openResult)) {
  return err(new PageNotFoundError(`Page ${pageId} not found`));
}

// 2. Timeout waiting for data (list pages)
if (!dataHandlers) {
  return err(new DataTimeoutError(
    `Timeout waiting for data from page ${pageId}. ` +
    `Page may require filters or record selection.`
  ));
}

// 3. No data available
if (records.length === 0) {
  return ok({
    pageId,
    caption,
    pageType,
    records: [],
    totalCount: 0
  });
}

// 4. Invalid field values
try {
  const value = parseFieldValue(control);
} catch (error) {
  console.warn(`Failed to parse field ${fieldName}: ${error.message}`);
  // Continue with null value
}
```

---

## 9. Testing Strategy

### Test Cases

1. **Card page with data** (Page 21 - Customer Card with existing customer)
2. **Card page without data** (Page 21 - Customer Card, new record)
3. **List page with rows** (Page 22 - Customer List)
4. **List page empty** (Page 22 - Customer List with filter that returns nothing)
5. **All field types** (Verify string, decimal, boolean, integer, enum, datetime, percent)
6. **Large dataset** (Performance test with 100+ rows)

### Test Script

```typescript
// test-read-page-data.ts
async function testReadPageData() {
  const tool = new ReadPageDataTool(connection);

  // Test card page
  const cardResult = await tool.execute({ pageId: '21' });
  assert(cardResult.ok);
  assert(cardResult.value.pageType === 'card');
  assert(cardResult.value.records.length === 1);

  // Test list page
  const listResult = await tool.execute({ pageId: '22' });
  assert(listResult.ok);
  assert(listResult.value.pageType === 'list');
  assert(listResult.value.records.length > 0);

  // Verify field types
  const record = listResult.value.records[0];
  assert(typeof record.fields['No.'].value === 'string');
  assert(typeof record.fields['Balance (LCY)'].value === 'number');
  assert(typeof record.fields['Blocked'].value === 'boolean');
}
```

---

## 10. Implementation Files

### New Files

- `src/parsers/page-data-extractor.ts` - Core extraction logic
- `test-read-page-data.ts` - Integration test

### Modified Files

- `src/tools/read-page-data-tool.ts` - Replace NotImplementedError with implementation
- `src/types/mcp-types.ts` - Add ReadPageDataOutput interface

### Reused Files

- `src/protocol/logical-form-parser.ts` - Pattern reference
- `src/parsers/control-parser.ts` - Control walking
- `src/BCRawWebSocketClient.ts` - Event infrastructure
- `src/connection/bc-page-connection.ts` - Page opening

---

## 11. Next Steps

1. **Implement Phase 1** (Card pages):
   - Create `PageDataExtractor` class
   - Implement `extractCardPageData()`
   - Test with Page 21 (Customer Card)

2. **Implement Phase 2** (List pages):
   - Implement `extractListPageData()`
   - Add event-driven data waiting
   - Test with Page 22 (Customer List)

3. **Integration**:
   - Update `ReadPageDataTool.executeInternal()`
   - Add type detection logic
   - Route to appropriate extractor

4. **Testing**:
   - Create comprehensive test suite
   - Verify all field types
   - Test error cases

5. **Documentation**:
   - Update tool description
   - Add usage examples
   - Document limitations

---

## 12. Open Questions

1. **Pagination**: How to request additional records beyond initial page?
   - Likely via `ScrollRepeater` or similar interaction
   - Can be added in future iteration

2. **Filtering**: BC's filter query syntax?
   - May require FilterPane interaction analysis
   - Client-side filtering can work initially

3. **Performance**: Large datasets (1000+ rows)?
   - May need chunking/streaming
   - Monitor memory usage

4. **Record Context**: FactBoxes, parts, related data?
   - Card pages have child forms with related data
   - Requires LoadForm for child forms (already supported in get_page_metadata)

---

## Conclusion

The `read_page_data` tool implementation is **ready to proceed** with high confidence:

- All BC protocol patterns are understood
- Event-driven infrastructure already exists and works (Tell Me search)
- Extraction patterns are proven and reusable
- Clear implementation path for both card and list pages

**Estimated effort**: 4-6 hours for complete implementation + testing

**Risk level**: Low - building on proven patterns

**Dependencies**: None - all required infrastructure exists
