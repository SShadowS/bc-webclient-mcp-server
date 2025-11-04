# How to Extract Page Metadata from BC via WebSocket

## Executive Summary

Based on deep analysis of BC v26.0 decompiled code, we now have the **exact method** to open pages and extract their metadata (UI elements, actions, field values) for AI agents.

## 🎯 The Solution: OpenForm Interaction

### 1. Request Format

To open a page (e.g., Page 21 - Customer Card):

```typescript
const result = await client.invoke({
  interactionName: 'OpenForm',
  namedParameters: {
    Page: '21',           // String, not number! Will be uppercased by BC
    LoadData: true,       // Optional, defaults to true - loads initial dataset
    IsReload: false,      // Optional, defaults to false
    InstanceId: null      // Optional, for reopening specific form instance
  }
});
```

**Source**: `OpenFormExecutionStrategy.cs:79-110`

#### How It Works Internally

From `OpenFormExecutionStrategy.cs:86-97`:
```csharp
if (string.Equals(key, "Page", StringComparison.OrdinalIgnoreCase))
{
  string upperInvariant = InteractionParameterHelper.GetNamedParameter<string>(namedParameters, key).ToUpperInvariant();
  if (string.IsNullOrEmpty(upperInvariant) || upperInvariant == "DEFAULT" || upperInvariant == "START")
  {
    propertyBag.AddItem("COMMAND", "defaultpage");
  }
  else
  {
    propertyBag.AddItem("COMMAND", "page");
    propertyBag.AddItem("ID", upperInvariant);  // Page ID goes here
  }
}
```

### 2. Response Handlers

BC returns an array of handlers. Key handlers for page metadata:

#### Handler 1: DN.CallbackResponseProperties
**Source**: `ResponseManager.cs:57-93`

Contains:
- `SequenceNumber` - Response sequence for tracking
- `CompletedInteractions` - Array of completed interactions with:
  - `InvocationId` - The callback ID you sent
  - `Duration` - Execution time in milliseconds
  - `Result` - Interaction result (e.g., form ID)

#### Handler 2: DN.LogicalClientEventRaisingHandler
**Source**: `ResponseManager.cs:268-275`

The **critical handler** containing page metadata:
```typescript
{
  handlerType: "DN.LogicalClientEventRaisingHandler",
  parameters: [
    "FormToShow",  // Event name
    {
      // Serialized LogicalForm with full page structure
      // This is the GOLD - contains fields, actions, data, permissions
    },
    {
      ParentForm: null,        // Parent form reference if embedded
      IsReload: false,         // Whether this is a reload
      Hash: "...",             // Cache hash
      CacheKey: "21:embedded(False)"  // Cache key format: pageId:embedded(bool)
    }
  ]
}
```

#### Handler 3: DN.LogicalClientChangeHandler
**Source**: `ResponseManager.cs:257` and `BrowserLogicalChangesCallbackResponseFactory.cs:17-30`

Contains form changes and control tree updates:
```typescript
{
  handlerType: "DN.LogicalClientChangeHandler",
  parameters: [
    "3F",  // Form ID (dynamic, assigned by BC)
    [
      // Array of logical changes to the form
      // Contains field value updates, control state changes, etc.
    ]
  ]
}
```

#### Handler 4: DN.EmptyPageStackHandler (Optional)
Sent if no forms are currently open before this one.

---

## 📋 Complete TypeScript Interfaces

### Request Interface

```typescript
interface InvokeOpenFormOptions {
  interactionName: 'OpenForm';
  namedParameters: {
    Page: string;              // Page ID as string (e.g., "21")
    LoadData?: boolean;        // Load initial dataset (default: true)
    IsReload?: boolean;        // Is this a reload (default: false)
    InstanceId?: string;       // Reopen specific instance (optional)
    ExpectedForm?: {           // For caching (optional)
      CacheKey: string;
      Hash: string;
    };
  };
}
```

### Response Interface

```typescript
interface BCInvokeResponse {
  handlers: BCHandler[];
}

type BCHandler =
  | CallbackResponsePropertiesHandler
  | LogicalClientEventRaisingHandler
  | LogicalClientChangeHandler
  | EmptyPageStackHandler;

interface CallbackResponsePropertiesHandler {
  handlerType: 'DN.CallbackResponseProperties';
  parameters: [{
    SequenceNumber: number;
    CompletedInteractions: Array<{
      InvocationId: string;
      Duration: number;
      Result?: {
        Value?: string;  // Form ID
        Reason?: string;
      };
    }>;
  }];
}

interface LogicalClientEventRaisingHandler {
  handlerType: 'DN.LogicalClientEventRaisingHandler';
  parameters: [
    string,           // Event name: "FormToShow"
    LogicalForm,      // Serialized form structure (the gold!)
    {
      ParentForm?: string | null;
      IsReload: boolean;
      Hash?: string;
      CacheKey?: string;
    }
  ];
}

interface LogicalClientChangeHandler {
  handlerType: 'DN.LogicalClientChangeHandler';
  parameters: [
    string,              // Form ID
    LogicalChange[]      // Array of changes
  ];
}

interface EmptyPageStackHandler {
  handlerType: 'DN.EmptyPageStackHandler';
  parameters?: [];
}
```

---

## 🔍 Extracting Page Metadata

### Step 1: Open the Page

```typescript
async function openPageAndExtractMetadata(pageId: number): Promise<PageMetadata> {
  const result = await client.invoke({
    interactionName: 'OpenForm',
    namedParameters: {
      Page: pageId.toString(),
      LoadData: true
    }
  });

  return parseHandlersForMetadata(result);
}
```

### Step 2: Parse Handlers

```typescript
function parseHandlersForMetadata(handlers: any[]): PageMetadata {
  // Find the FormToShow event handler
  const formToShowHandler = handlers.find(h =>
    h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
    h.parameters?.[0] === 'FormToShow'
  );

  if (!formToShowHandler) {
    throw new Error('No FormToShow event found in response');
  }

  const logicalForm = formToShowHandler.parameters[1];
  const metadata = formToShowHandler.parameters[2];

  return {
    formId: extractFormId(handlers),
    cacheKey: metadata.CacheKey,
    hash: metadata.Hash,
    pageMetadata: parseLogicalForm(logicalForm)
  };
}
```

### Step 3: Parse LogicalForm Structure

```typescript
interface PageMetadata {
  formId: string;
  cacheKey: string;
  hash: string;
  pageMetadata: {
    pageId: number;
    pageName: string;
    pageType: string;
    sourceTable?: number;
    fields: FieldMetadata[];
    actions: ActionMetadata[];
    permissions: {
      insertAllowed: boolean;
      modifyAllowed: boolean;
      deleteAllowed: boolean;
    };
    currentData?: Record<string, any>;
  };
}

interface FieldMetadata {
  name: string;
  caption: string;
  dataType: string;
  length?: number;
  editable: boolean;
  required: boolean;
  visible: boolean;
  currentValue?: any;
  controlPath: string;  // For future interactions with this field
}

interface ActionMetadata {
  name: string;
  caption: string;
  systemAction?: number;  // System action code
  enabled: boolean;
  visible: boolean;
  controlPath: string;    // For invoking this action
}

function parseLogicalForm(logicalForm: any): PageMetadata['pageMetadata'] {
  // The logicalForm object structure needs to be determined by logging
  // actual responses, but based on BC's serialization, expect:

  return {
    pageId: extractPageId(logicalForm),
    pageName: logicalForm.caption || logicalForm.name,
    pageType: logicalForm.formType || 'Card',
    sourceTable: logicalForm.sourceTable,

    fields: extractFields(logicalForm),
    actions: extractActions(logicalForm),
    permissions: extractPermissions(logicalForm),
    currentData: extractCurrentData(logicalForm)
  };
}
```

---

## 🛠️ Implementation Plan

### Phase 1: Log and Understand (1 day)

1. **Create logging version**:
```typescript
async function openPageAndLog(pageId: number) {
  const result = await client.invoke({
    interactionName: 'OpenForm',
    namedParameters: { Page: pageId.toString() }
  });

  // Save to file for analysis
  fs.writeFileSync(
    `./responses/page-${pageId}-response.json`,
    JSON.stringify(result, null, 2)
  );

  // Log handler types
  result.forEach((handler: any, i: number) => {
    console.log(`Handler ${i}: ${handler.handlerType}`);
  });
}
```

2. **Test with known pages**:
   - Page 21 (Customer Card)
   - Page 22 (Customer List)
   - Page 27 (Item Card)
   - Page 30 (Item List)

3. **Analyze responses** to understand exact LogicalForm structure

### Phase 2: Build Parser (2-3 days)

1. **Create handler parser infrastructure**:
   - `HandlerParser` base class
   - `FormToShowParser` - extracts LogicalForm
   - `FormChangesParser` - extracts changes
   - `ResponsePropertiesParser` - extracts completion info

2. **Create LogicalForm parser**:
   - `FieldsParser` - extracts field definitions
   - `ActionsParser` - extracts action bar
   - `PermissionsParser` - extracts capabilities
   - `DataParser` - extracts current record data

3. **Build control path mapper**:
   - Map field names to control paths
   - Map action names to control paths
   - Store in session state for future interactions

### Phase 3: Test and Refine (2-3 days)

1. **Golden response tests**:
   - Capture real responses as test fixtures
   - Assert parser extracts expected metadata
   - Catch breaking changes across BC versions

2. **Error handling**:
   - Missing handlers
   - Unexpected structure
   - Permission errors

3. **Documentation**:
   - Document parsed structure
   - Create examples
   - Write usage guide

---

## 📊 What the Parsed Metadata Enables

Once you have the parsed metadata, AI agents can:

### 1. Understand Page Structure
```typescript
const metadata = await openPageAndExtractMetadata(21);

console.log(`Page: ${metadata.pageMetadata.pageName}`);
console.log(`Fields: ${metadata.pageMetadata.fields.length}`);
console.log(`Actions: ${metadata.pageMetadata.actions.length}`);
```

### 2. List Available Fields
```typescript
metadata.pageMetadata.fields
  .filter(f => f.visible && f.editable)
  .forEach(field => {
    console.log(`- ${field.caption} (${field.dataType})`);
    if (field.required) console.log(`  REQUIRED`);
    if (field.currentValue) console.log(`  Current: ${field.currentValue}`);
  });
```

### 3. List Available Actions
```typescript
metadata.pageMetadata.actions
  .filter(a => a.visible && a.enabled)
  .forEach(action => {
    console.log(`- ${action.caption}`);
    if (action.systemAction) {
      console.log(`  System Action: ${action.systemAction}`);
    }
  });
```

### 4. Generate Natural Language Description for LLM
```typescript
function generatePageDescription(metadata: PageMetadata): string {
  const page = metadata.pageMetadata;

  return `
Page: ${page.pageName} (ID: ${page.pageId})
Type: ${page.pageType}

Permissions:
${page.permissions.insertAllowed ? '✓' : '✗'} Can create new records
${page.permissions.modifyAllowed ? '✓' : '✗'} Can modify records
${page.permissions.deleteAllowed ? '✓' : '✗'} Can delete records

Available Fields (${page.fields.filter(f => f.visible).length}):
${page.fields
  .filter(f => f.visible)
  .map(f => `- ${f.caption} (${f.dataType}${f.required ? ', required' : ''}${f.editable ? '' : ', read-only'})`)
  .join('\n')}

Available Actions (${page.actions.filter(a => a.visible && a.enabled).length}):
${page.actions
  .filter(a => a.visible && a.enabled)
  .map(a => `- ${a.caption}`)
  .join('\n')}

${page.currentData ? 'Current Record:\n' + JSON.stringify(page.currentData, null, 2) : 'No record loaded'}
  `.trim();
}
```

---

## 🚀 Next Immediate Steps

### 1. Update BCRawWebSocketClient

Add helper method:
```typescript
async openForm(pageId: number, options?: {
  loadData?: boolean;
  isReload?: boolean;
}): Promise<any[]> {
  return this.invoke({
    interactionName: 'OpenForm',
    namedParameters: {
      Page: pageId.toString(),
      LoadData: options?.loadData ?? true,
      IsReload: options?.isReload ?? false
    }
  });
}
```

### 2. Create Test Script

**File**: `test-open-page.ts`
```typescript
import { BCRawWebSocketClient } from './src/BCRawWebSocketClient';
import * as fs from 'fs';

async function main() {
  const client = new BCRawWebSocketClient(
    { baseUrl: 'http://Cronus27/BC/', tenantId: 'default' },
    'admin',
    'YourPassword123'
  );

  await client.authenticateWeb();
  await client.connect();
  await client.openSession({
    clientType: 'WebClient',
    clientVersion: '26.0.0.0',
    clientCulture: 'en-US',
    clientTimeZone: 'UTC'
  });

  console.log('Opening Customer Card (Page 21)...');
  const handlers = await client.openForm(21);

  // Save raw response
  fs.writeFileSync(
    './responses/page-21-handlers.json',
    JSON.stringify(handlers, null, 2)
  );

  console.log(`\nReceived ${handlers.length} handlers:`);
  handlers.forEach((h: any, i: number) => {
    console.log(`  ${i + 1}. ${h.handlerType}`);
  });

  // Look for FormToShow
  const formToShow = handlers.find((h: any) =>
    h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
    h.parameters?.[0] === 'FormToShow'
  );

  if (formToShow) {
    console.log('\n✓ Found FormToShow event!');
    console.log('Cache Key:', formToShow.parameters[2]?.CacheKey);
    console.log('Hash:', formToShow.parameters[2]?.Hash);

    // Save LogicalForm for analysis
    fs.writeFileSync(
      './responses/page-21-logical-form.json',
      JSON.stringify(formToShow.parameters[1], null, 2)
    );
    console.log('\nLogicalForm saved to: ./responses/page-21-logical-form.json');
  }

  await client.close();
}

main().catch(console.error);
```

### 3. Run and Analyze

```bash
npm run test:open-page
```

Then analyze `./responses/page-21-logical-form.json` to understand the structure.

---

## 🎓 Key Learnings

### Discovery 1: Page Parameter is String
BC converts it to uppercase and uses it in a PropertyBag. Always pass as string!

### Discovery 2: Handlers are Typed
Each handler has a `handlerType` that determines its structure. We can route to specific parsers.

### Discovery 3: FormToShow Contains Everything
The `DN.LogicalClientEventRaisingHandler` with event "FormToShow" contains the complete serialized LogicalForm with all metadata we need.

### Discovery 4: Form IDs are Dynamic
BC assigns form IDs dynamically per session (e.g., "3F", "4E"). We must track the mapping: `pageId → formId`.

### Discovery 5: Control Paths are Key
To interact with fields/actions later, we need their `controlPath` (e.g., `"server:c[2]/c[0]/c[0]"`). These should be extracted during metadata parsing.

---

## 📚 References

### Key Files Analyzed

- `OpenFormExecutionStrategy.cs:79-110` - namedParameters processing
- `OpenFormInteraction.cs:24-62` - OpenForm execution flow
- `InteractionManager.cs:47-177` - Interaction invocation flow
- `ResponseManager.cs:193-355` - Handler generation
- `InteractionNames.cs:12` - OpenForm constant
- `BrowserLogicalChangesCallbackResponseFactory.cs:17-30` - Change handler creation

### Related Documentation

- `BC-AI-AGENT-ANALYSIS.md` - BC's native AI agent framework
- `BC-COPILOT-IMPLEMENTATION.md` - How BC Copilot uses these APIs
- `BC-PAGE-CONTEXT-FOR-AI.md` - How BC sends context to AI
- `ARCHITECTURE.md` - MCP server architecture
- `NEXT-STEPS.md` - Implementation roadmap

---

## 🎯 Success Criteria

You'll know this is working when:

1. ✅ `openForm(21)` returns handlers including "FormToShow"
2. ✅ LogicalForm contains recognizable field names (No, Name, Address, etc.)
3. ✅ Actions include New, Edit, Delete, Statistics
4. ✅ Current record data is extractable
5. ✅ Can generate natural language description for Claude

---

**Next Action**: Run `test-open-page.ts` and analyze the LogicalForm structure to complete the parser implementation.
