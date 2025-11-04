# Business Central Interaction Capture and Implementation Plan

## Overview

This document outlines the complete workflow for reverse engineering Business Central (BC) interactions through WebSocket traffic capture and implementing corresponding MCP tools.

## Background

BC uses a WebSocket-based protocol over SignalR for all client-server interactions. By capturing and analyzing this traffic, we can:
1. Understand the exact protocol format for each interaction type
2. Identify required parameters and their formats
3. Implement MCP tools that replicate BC client functionality

## Tools Created

### 1. capture-bc-interactions.mjs
**Purpose**: Interactive tool to capture BC WebSocket traffic for various user interactions.

**Features**:
- Opens BC in visible browser window (Playwright)
- Authenticates automatically with provided credentials
- Captures all WebSocket traffic via Chrome DevTools Protocol (CDP)
- Auto-saves captures every 30 seconds
- Runs for 5 minutes, giving user time to perform interactions
- Groups messages by interaction type for easier analysis

**Usage**:
```bash
cd "C:\bc4ubuntu\Decompiled\bc-poc"
node capture-bc-interactions.mjs
```

**Output**: JSON files in `./bc-interaction-captures/` directory

### 2. analyze-bc-interactions.mjs
**Purpose**: Analyzes captured JSON files to extract BC interaction patterns.

**Features**:
- Extracts unique interaction names from captures
- Shows request/response pairs for each interaction
- Identifies parameters used in each interaction
- Suggests MCP tool implementations based on patterns
- Displays pattern insights (control paths, form IDs, etc.)

**Usage**:
```bash
# Analyze all captures
node analyze-bc-interactions.mjs

# Analyze specific capture
node analyze-bc-interactions.mjs ./bc-interaction-captures/capture-1234567890.json
```

## Interaction Types to Capture

**Verification Status Legend**:
- 🔬 **HYPOTHESIZED**: Interaction name/protocol is hypothesized - needs capture to confirm
- ✅ **CONFIRMED**: Interaction captured and protocol verified

All interaction names below are HYPOTHESIZED until confirmed by actual WebSocket capture.

### Priority 1: Essential CRUD Operations

#### 1. Button/Action Click 🔬 HYPOTHESIZED
**Hypothesized Interaction Name**: `InvokeAction`
**Test Scenario**:
- Navigate to Customer Card (Page 21)
- Click "Edit" button
- Wait 2 seconds

**Expected Protocol**:
```json
{
  "interactionName": "InvokeAction",
  "namedParameters": {
    "actionName": "Edit"
  },
  "controlPath": "path:to:action:button",
  "formId": "XXX"
}
```

**MCP Tool**: `executeAction(pageId, actionName)`

#### 2. Text Field Update (ChangeField / UpdateControl)
**Test Scenario**:
- Open Customer Card
- Change "Name" field value
- Tab out of field
- Wait 2 seconds

**Expected Protocol**:
```json
{
  "interactionName": "ChangeField",
  "namedParameters": {
    "fieldName": "Name",
    "newValue": "Test Customer"
  },
  "controlPath": "path:to:name:field",
  "formId": "XXX"
}
```

**MCP Tool**: `updateField(pageId, fieldName, value)`

#### 3. Dropdown/Option Field (ChangeField with lookup)
**Test Scenario**:
- Open Customer Card
- Change "Payment Terms Code" dropdown
- Select an option
- Wait 2 seconds

**Expected Protocol**:
```json
{
  "interactionName": "ChangeField",
  "namedParameters": {
    "fieldName": "PaymentTermsCode",
    "newValue": "30 DAYS",
    "lookupValue": "code_or_id"
  },
  "controlPath": "path:to:dropdown",
  "formId": "XXX"
}
```

**MCP Tool**: `updateDropdown(pageId, fieldName, value)` or extend `updateField`

### Priority 2: Navigation and Filtering

#### 4. Record Navigation (Navigate)
**Test Scenario**:
- Open Customer Card
- Click "Next Record" navigation arrow
- Wait 2 seconds

**Expected Protocol**:
```json
{
  "interactionName": "Navigate",
  "namedParameters": {
    "direction": "next"
  },
  "controlPath": "navigation:control",
  "formId": "XXX"
}
```

**MCP Tool**: `navigateRecord(pageId, direction)` where direction = "next" | "previous" | "first" | "last"

#### 5. Filter Application (SetFilter / ApplyFilter)
**Test Scenario**:
- Navigate to Customer List (Page 22)
- Click filter icon on "Name" column
- Enter filter value
- Press Enter
- Wait 2 seconds

**Expected Protocol**:
```json
{
  "interactionName": "SetFilter",
  "namedParameters": {
    "fieldName": "Name",
    "filterExpression": "A*",
    "operator": "contains"
  },
  "controlPath": "path:to:filter",
  "formId": "XXX"
}
```

**MCP Tool**: `applyFilter(pageId, fieldName, filterExpression)`

### Priority 3: Record Management

#### 6. Create New Record (InsertRecord / CreateNew)
**Test Scenario**:
- Open Customer List (Page 22)
- Click "New" button
- Wait 2 seconds

**Expected Protocol**:
```json
{
  "interactionName": "InsertRecord",
  "namedParameters": {},
  "controlPath": "new:record:action",
  "formId": "XXX"
}
```

**MCP Tool**: `createRecord(pageId, initialFields?)`

#### 7. Row Selection (SelectRow / SetSelection)
**Test Scenario**:
- Open Customer List (Page 22)
- Click on a customer row
- Wait 2 seconds

**Expected Protocol**:
```json
{
  "interactionName": "SelectRow",
  "namedParameters": {
    "rowIndex": 3,
    "recordId": "XXX"
  },
  "controlPath": "list:row:3",
  "formId": "XXX"
}
```

**MCP Tool**: `selectRow(pageId, rowIndex)` or `selectRecord(pageId, recordId)`

### Priority 4: Advanced Operations

#### 8. Delete Record (DeleteRecord)
**Test Scenario**:
- Open Customer Card
- Click "Delete" action
- Confirm deletion dialog (if shown)
- Wait 2 seconds

**MCP Tool**: `deleteRecord(pageId, recordId)`

#### 9. Related Entity Navigation (DrillDown / OpenRelated)
**Test Scenario**:
- Open Customer Card
- Click on "Balance (LCY)" field to drill down
- Wait 2 seconds

**MCP Tool**: `drilldown(pageId, fieldName)`

#### 10. FastTab Expand/Collapse
**Test Scenario**:
- Open Customer Card
- Expand/collapse a FastTab section
- Wait 2 seconds

**MCP Tool**: `toggleFasttab(pageId, fastTabName)`

## Capture Workflow

### Phase 1: Setup and Initial Capture
```bash
# 1. Start the capture tool
cd "C:\bc4ubuntu\Decompiled\bc-poc"
node capture-bc-interactions.mjs

# Browser will open and authenticate automatically
# You have 5 minutes to perform interactions
```

### Phase 2: Perform Test Interactions

**Recommended Order** (builds complexity gradually):

1. **Customer Card - Basic Actions** (2 minutes)
   - Navigate to Page 21
   - Click "Edit" button
   - Wait 2 seconds
   - Change "Name" field
   - Wait 2 seconds
   - Change "Payment Terms Code" dropdown
   - Wait 2 seconds
   - Click "Next Record" navigation
   - Wait 2 seconds

2. **Customer List - Filtering and Selection** (1 minute)
   - Navigate to Page 22
   - Apply filter on "Name" column
   - Wait 2 seconds
   - Click on a customer row
   - Wait 2 seconds

3. **Customer List - Create New** (1 minute)
   - Click "New" button
   - Wait 2 seconds
   - Fill in required fields
   - Wait 2 seconds

4. **Additional Interactions** (1 minute)
   - Any other interactions you want to test

**Tips**:
- Wait 2 seconds after each interaction (gives BC time to respond)
- Perform one interaction at a time (easier to analyze)
- Use well-known pages (21, 22, 30) that we've already tested
- Captures auto-save every 30 seconds

### Phase 3: Analysis
```bash
# Analyze all captured interactions
node analyze-bc-interactions.mjs

# Review output for:
# - Interaction names (InvokeAction, ChangeField, etc.)
# - Parameter structures (namedParameters, controlPath, formId)
# - Response patterns (handlers, callbacks)
# - Any error messages or special cases
```

### Phase 4: Documentation
For each interaction type discovered:

1. **Document the Protocol**:
   - Request format
   - Required parameters
   - Optional parameters
   - Response structure

2. **Identify Parameters**:
   - `interactionName`: The operation type
   - `namedParameters`: Operation-specific data
   - `controlPath`: UI element identifier
   - `formId`: Current form/page ID
   - `openFormIds`: Array of currently open forms

3. **Plan MCP Tool**:
   - Tool name (e.g., `execute_action`)
   - Input parameters
   - Return value structure
   - Error handling

## Implementation Phases

### Phase 1: Core CRUD Operations (Week 1)
**Tools to Implement**:
- `execute_action(pageId, actionName)` - Button clicks
- `updateField(pageId, fieldName, value)` - Text field updates
- `updateDropdown(pageId, fieldName, value)` - Dropdown/option fields

**Success Criteria**:
- Can edit customer name
- Can change dropdown values
- Can click action buttons

### Phase 2: Navigation and Filtering (Week 2)
**Tools to Implement**:
- `navigateRecord(pageId, direction)` - Record navigation
- `applyFilter(pageId, fieldName, filterExpression)` - List filtering
- `clearFilter(pageId, fieldName?)` - Clear filters

**Success Criteria**:
- Can navigate between records
- Can filter lists by field values
- Can clear applied filters

### Phase 3: Record Management (Week 3)
**Tools to Implement**:
- `createRecord(pageId, fields)` - Create new records
- `deleteRecord(pageId, recordId)` - Delete records
- `selectRow(pageId, rowIndex)` - Row selection in lists

**Success Criteria**:
- Can create new customers
- Can delete records
- Can select rows in lists

### Phase 4: Advanced Operations (Week 4)
**Tools to Implement**:
- `drilldown(pageId, fieldName)` - Navigate to related data
- `toggleFasttab(pageId, fastTabName)` - Expand/collapse sections
- `executeReport(reportId, filters)` - Run reports
- `postDocument(pageId, documentId)` - Post sales/purchase documents

**Success Criteria**:
- Can drill down to related entities
- Can expand/collapse UI sections
- Can run basic reports
- Can post documents

## Testing Strategy

### Unit Tests
For each MCP tool:
```typescript
describe('execute_action', () => {
  it('should invoke Edit action on Customer Card', async () => {
    const result = await executeAction('21', 'Edit');
    expect(isOk(result)).toBe(true);
  });

  it('should return error for invalid action', async () => {
    const result = await executeAction('21', 'InvalidAction');
    expect(isErr(result)).toBe(true);
  });
});
```

### Integration Tests
Test complete workflows:
```typescript
describe('Customer Management Workflow', () => {
  it('should complete full customer edit workflow', async () => {
    // Open Customer Card
    await getPageMetadata('21');

    // Click Edit
    await executeAction('21', 'Edit');

    // Update name
    await updateField('21', 'Name', 'Test Customer Updated');

    // Save
    await executeAction('21', 'Save');

    // Verify
    const data = await readPageData('21');
    expect(data.fields.Name).toBe('Test Customer Updated');
  });
});
```

### Real BC Tests
Test against actual BC server:
```bash
# Run integration tests against real BC
npm run test:mcp:real:client
```

## Protocol Insights (From Existing Captures)

### Common Patterns

**1. All Interactions Include**:
```json
{
  "interactionName": "...",
  "namedParameters": { ... },
  "formId": "...",
  "openFormIds": ["...", "..."],
  "lastClientAckSequenceNumber": -1
}
```

**2. Optional Fields**:
- `controlPath`: UI element path (e.g., "server:1:2:3")
- `systemAction`: Boolean flag for system-level actions
- `callbackId`: Unique ID for tracking async operations

**3. Response Structure**:
```json
[
  {
    "handlerType": "DN.CallbackResponseProperties",
    "parameters": [
      {
        "CompletedInteractions": [ ... ],
        "FormInteractionHandlers": [ ... ]
      }
    ]
  },
  {
    "handlerType": "DN.UpdateFormProperties",
    "parameters": [ ... ]
  }
]
```

### Query String Format (OpenForm)
```javascript
const queryString = [
  `tenant=${encodeURIComponent(tenant)}`,
  `company=${encodeURIComponent(company)}`,
  `page=${pageId}`,
  `runinframe=1`,
  `dc=${Date.now()}`,
  `startTraceId=${generateUUID()}`,
  `bookmark=`
].join('&');

// Result:
// tenant=default&company=CRONUS%20Danmark%20A%2FS&page=21&runinframe=1&dc=1761985418277&startTraceId=0fc97f43-51d2-4538-9714-fe314b2cf0f0&bookmark=
```

## Success Metrics

### Immediate Goals (After Capture)
- ✅ Captured at least 7 different interaction types
- ✅ Documented protocol format for each interaction
- ✅ Identified all required parameters

### Short-term Goals (Week 1-2)
- ✅ Implemented core CRUD MCP tools
- ✅ All tools work with real BC server
- ✅ Unit tests pass for all new tools

### Long-term Goals (Month 1)
- ✅ Full MCP server with 10+ BC interaction tools
- ✅ Complete customer management workflow working
- ✅ Documentation for all tools
- ✅ Integration tests for common workflows

## Known Issues and Limitations

### Issue 1: Connection-Level Caching
**Status**: ✅ SOLVED
**Solution**: BCPageConnection creates new connection per page
**Details**: See BC_FORM_CACHING_SOLUTION.md

### Issue 2: LoadForm for Child Forms
**Status**: ✅ SOLVED
**Solution**: Implemented LoadForm after OpenForm
**Details**: See LOADFORM_SOLUTION_COMPLETE.md

### Issue 3: Control Path Discovery
**Status**: 🔄 IN PROGRESS
**Challenge**: Need to discover controlPath values for each UI element
**Solution**: Capture and analyze controlPath patterns from real client

### Issue 4: Dialog Handling
**Status**: ⏳ NOT YET ADDRESSED
**Challenge**: BC shows confirmation dialogs for destructive actions
**Solution**: Need to capture and implement dialog response protocol

## Next Steps

### Immediate (Today)
1. ✅ Create capture tool (capture-bc-interactions.mjs)
2. ✅ Create analysis tool (analyze-bc-interactions.mjs)
3. ✅ Document plan (this file)
4. ⏳ Run first capture session
5. ⏳ Analyze captured data
6. ⏳ Document first 3 interaction types

### This Week
1. Implement `execute_action` tool
2. Implement `updateField` tool
3. Add tests for new tools
4. Update MCP server with new tools
5. Test against real BC

### This Month
1. Complete all 10 interaction types
2. Full integration tests
3. Update documentation
4. Demo complete workflow

## References

- **BC_FORM_CACHING_SOLUTION.md**: Connection-per-page architecture
- **LOADFORM_SOLUTION_COMPLETE.md**: Child form loading details
- **capture-websocket-cdp.mjs**: Original WebSocket capture tool
- **src/connection/bc-page-connection.ts**: Connection implementation
- **src/tools/get-page-metadata-tool.ts**: Example MCP tool

## Appendix: Example Capture Output

### Sample capture-1234567890.json
```json
{
  "capturedAt": "2025-01-09T21:30:00.000Z",
  "requestId": "ABC123.1",
  "totalMessages": 47,
  "interactionCount": 5,
  "interactions": [
    [
      {
        "direction": "sent",
        "timestamp": 1234567890.123,
        "payload": {
          "type": 1,
          "target": "InteractionManagement",
          "arguments": [
            {
              "interactionName": "InvokeAction",
              "namedParameters": {
                "actionName": "Edit"
              },
              "controlPath": "server:1:23:456",
              "formId": "42B"
            }
          ]
        }
      },
      {
        "direction": "received",
        "timestamp": 1234567890.456,
        "payload": {
          "type": 1,
          "target": "InteractionManagement",
          "arguments": [
            [
              {
                "handlerType": "DN.CallbackResponseProperties",
                "parameters": [ ... ]
              }
            ]
          ]
        }
      }
    ]
  ]
}
```

### Sample Analysis Output
```
🔍 BC Interaction Analysis
════════════════════════════════════════════════════════════

Found 1 capture file(s)

📄 Analyzing: capture-1234567890.json
────────────────────────────────────────────────────────────
Captured at: 2025-01-09T21:30:00.000Z
Total messages: 47
Interaction groups: 5

🎯 Interaction Types Found:
   - InvokeAction
   - ChangeField
   - Navigate
   - SetFilter
   - SelectRow

📋 Detailed Analysis:

════════════════════════════════════════════════════════════
Interaction: InvokeAction
════════════════════════════════════════════════════════════

📤 Sent:
{
  "interactionName": "InvokeAction",
  "namedParameters": {
    "actionName": "Edit"
  },
  "controlPath": "server:1:23:456",
  "formId": "42B"
}

📥 Responses:
  Response 1:
  {
    "handlerType": "DN.CallbackResponseProperties",
    "parameters": [ ... ]
  }

💡 Pattern Insights:
   🔘 Button/Action Click
   MCP Tool: execute_action(pageId, actionName)
   Uses namedParameters: actionName
   Control path: server:1:23:456
   Requires formId: 42B
```
