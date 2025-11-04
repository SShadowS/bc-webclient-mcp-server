# ServerId Structure Discovery - Complete FormId Discovery Mechanism

**Date**: 2025-10-31
**Previous**: WEBSOCKET_CAPTURE_FINDINGS.md revealed LoadForm pattern but not how to discover formIds

## Executive Summary

**🎯 SOLUTION FOUND**: The first server response contains a **hierarchical form structure** with all ServerIds that need LoadForm calls.

**Pattern**:
```
response[9].parameters[1].ServerId = "269"  ← Root shell form
response[9].parameters[1].Children[N].Children[0].ServerId = Child forms to LoadForm
```

**For Page 22 (Customers List)**:
- Shell form: `269`
- Child forms requiring LoadForm: `263, 264, 265, 266, 267, 268`

---

## Discovery Methodology

### Script: find-server-id-structure.mjs

Recursive search through first decompressed server response (Page 22, 338KB):

```javascript
function findServerIds(obj, path = '', depth = 0) {
  if (key === 'ServerId') {
    results.push({ path: newPath, serverId: value });
  }
  // Recurse through objects and arrays
}
```

### Results

```
Found 7 ServerId references

First 20 ServerIds:

  269    @ [9].parameters[1].ServerId
  263    @ [9].parameters[1].Children[5].Children[0].ServerId
  264    @ [9].parameters[1].Children[7].Children[0].ServerId
  265    @ [9].parameters[1].Children[8].Children[0].ServerId
  266    @ [9].parameters[1].Children[10].Children[0].ServerId
  267    @ [9].parameters[1].Children[14].Children[0].ServerId
  268    @ [9].parameters[1].Children[15].Children[0].ServerId

Unique ServerIds: 269, 263, 264, 265, 266, 267, 268
```

---

## ServerId Structure Breakdown

### Handler Array Index

The decompressed response is an **array of handlers**. Handler index `[9]` contains the form structure:

```javascript
response[9] = {
  parameters: [
    ...,
    {  // parameters[1] = Root form object
      ServerId: "269",          // ← Shell/container form
      Children: [               // ← Array of child controls
        {
          Children: [
            { ServerId: "263" } // ← Actual child form at Children[0]
          ]
        },
        ...
      ]
    }
  ]
}
```

### Hierarchy Pattern

**Level 0** (Root):
```javascript
parameters[1].ServerId = "269"
```
- This is the **shell/container form** created by OpenForm
- Matches "Open Forms: [269]" from WebSocket capture

**Level 1** (Child Container):
```javascript
parameters[1].Children[N]
```
- Each element in Children array is a **control container**
- Not all Children entries have child forms (some are simple controls)

**Level 2** (Child Forms):
```javascript
parameters[1].Children[N].Children[0].ServerId
```
- The **actual child forms** that need LoadForm calls
- Pattern: `Children[N].Children[0]` contains the ServerId

### Child Form Indices

From the output:
- `Children[5].Children[0].ServerId = 263`
- `Children[7].Children[0].ServerId = 264`
- `Children[8].Children[0].ServerId = 265`
- `Children[10].Children[0].ServerId = 266`
- `Children[14].Children[0].ServerId = 267`
- `Children[15].Children[0].ServerId = 268`

**Observation**: Not every Children[N] entry has a child form (indices 5, 7, 8, 10, 14, 15 only).

---

## Correlation with WebSocket Capture

### From WEBSOCKET_CAPTURE_FINDINGS.md:

**Page 22 LoadForm Pattern**:
```
Open Forms: [269]  ← Shell/container form

LoadForm interactions:
  1. LoadForm formId=265
  2. LoadForm formId=264
  3. LoadForm formId=267
  4. LoadForm formId=268
```

### Analysis

**Server declares 6 child forms**: 263, 264, 265, 266, 267, 268
**Client LoadForm'd only 4**: 265, 264, 267, 268

**Missing from LoadForm**: 263, 266

**Hypothesis**: Not all declared ServerIds require immediate LoadForm. BC may use:
- **Lazy loading**: Some forms loaded only when interacted with
- **Optional controls**: Forms loaded based on user permissions or configuration
- **Delayed loading**: Forms with `delayed: true` parameter may skip certain children

**Key Insight**: The client **selectively** LoadForms only specific child forms, not all declared ServerIds.

---

## Implementation Strategy

### Step 1: Parse Response Structure

After OpenForm or initial connection, parse the first server response:

```typescript
function extractServerIds(response: any[]): {
  shellFormId: string;
  childFormIds: string[];
} {
  // Find handler with form structure (typically index 9)
  const formHandler = response.find(h =>
    h.parameters?.[1]?.ServerId &&
    h.parameters?.[1]?.Children
  );

  if (!formHandler) {
    throw new Error('Form structure handler not found');
  }

  const rootForm = formHandler.parameters[1];
  const shellFormId = rootForm.ServerId;

  // Extract child form ServerIds
  const childFormIds: string[] = [];
  for (const child of rootForm.Children || []) {
    if (child.Children?.[0]?.ServerId) {
      childFormIds.push(child.Children[0].ServerId);
    }
  }

  return { shellFormId, childFormIds };
}
```

### Step 2: Issue LoadForm for Child Forms

```typescript
for (const formId of childFormIds) {
  await connection.invoke({
    interactionName: 'LoadForm',
    formId: formId,
    controlPath: 'server:',
    callbackId: String(callbackIdCounter++),
    namedParameters: {
      delayed: true,
      openForm: true,
      loadData: true
    }
  });
}
```

### Step 3: Handle LoadForm Responses

Each LoadForm response will contain:
- Form metadata (caption, controls, etc.)
- Data records (for list pages)
- Additional child forms (recursive structure)

---

## Open Questions

### Q1: Why didn't BC LoadForm 263 and 266?

**Possible Reasons**:
1. **Conditional loading**: Forms 263/266 may be conditional (e.g., Factbox panes shown only when record selected)
2. **Lazy initialization**: Loaded on-demand when user interacts with specific UI elements
3. **Permission-based**: User may not have permission to see certain forms
4. **UI state**: Some forms only load after certain actions (e.g., drill-down)

**Testing Needed**: Capture WebSocket traffic with different user interactions to see when 263/266 are LoadForm'd.

### Q2: How to determine which ServerIds to LoadForm?

**Options**:

**A) LoadForm ALL child ServerIds** (simple but may be inefficient):
```typescript
// LoadForm every child form discovered
for (const formId of childFormIds) {
  await loadForm(formId);
}
```

**B) Parse form metadata** (more complex but accurate):
```typescript
// Check form properties to determine if LoadForm needed
for (const child of rootForm.Children) {
  const childForm = child.Children?.[0];
  if (childForm?.ServerId && shouldLoadForm(childForm)) {
    await loadForm(childForm.ServerId);
  }
}

function shouldLoadForm(form: any): boolean {
  // Check properties like:
  // - form.Type (e.g., "Page", "Part", etc.)
  // - form.Visible
  // - form.LoadOnDemand
  return form.Type === 'Page' && form.Visible === true;
}
```

**Recommendation**: Start with Option A (LoadForm all), then optimize with Option B based on observed patterns.

### Q3: Does LoadForm order matter?

**From WebSocket capture**:
```
Page 22 LoadForm sequence: 265, 264, 267, 268 (not sequential)
```

**Hypothesis**: Order may not matter, or BC processes them asynchronously.

**Testing Needed**: Issue LoadForm in different orders and compare results.

---

## Next Steps

### Immediate: Implement Response Parser

1. **Modify page-metadata-parser.ts**:
   - Add `extractServerIds()` function
   - Parse handler array structure
   - Extract shell + child form ServerIds

2. **Test with decompressed-responses.json**:
   - Verify parser extracts correct ServerIds for Page 22
   - Test with Pages 30 and 31 responses
   - Validate Children[N].Children[0] pattern holds

### Follow-up: Implement LoadForm-Based Approach

1. **Modify get-page-metadata-tool.ts**:
   - After OpenForm (or initial connection), parse response
   - Extract child form ServerIds
   - Issue LoadForm for each child form
   - Collect and aggregate metadata from LoadForm responses

2. **Add Response Decompression**:
   - Modify BCRawWebSocketClient to decompress gzip responses
   - Parse `compressedResult` and `compressedData` fields
   - Return decompressed JSON to handlers

3. **Test with Multi-Page Scenario**:
   - Test Pages 22, 30, 31 with new approach
   - Verify correct metadata returned for each page
   - Compare with browser capture to validate accuracy

---

## Files Generated

- `serverid-structure.json` - Complete ServerId paths for Page 22
- `find-server-id-structure.mjs` - Recursive ServerId extraction script
- `SERVERID_STRUCTURE_DISCOVERY.md` - This document

---

## Conclusion

We now have the **complete formId discovery mechanism**:

✅ **Server declares all ServerIds** in first response handler structure
✅ **Hierarchical pattern**: `parameters[1].Children[N].Children[0].ServerId`
✅ **Shell form** (269) at `parameters[1].ServerId`
✅ **Child forms** (263-268) at `Children[N].Children[0].ServerId`
✅ **Parsing strategy** defined to extract ServerIds programmatically

**Remaining Work**:
1. Implement parser in TypeScript
2. Add response decompression to WebSocket client
3. Implement LoadForm-based page opening
4. Test and validate with all pages

**Critical Path**:
```
OpenForm/Connect → Parse Response → Extract ServerIds → LoadForm Each → Aggregate Metadata
```

This approach matches how the real BC web client works and should solve the multi-page bug.
