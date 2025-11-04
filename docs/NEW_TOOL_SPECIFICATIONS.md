# Business Central MCP Tool Technical Specifications

## Overview

This document provides detailed technical specifications for the new MCP tools to be implemented for Business Central integration. These tools fill critical gaps in data manipulation, filtering, dialog handling, and page discovery.

---

## Priority 0: Critical Primitives

### 1. `set_field_value`

**Purpose:** Set a field value on the currently open page

**MCP Tool Definition:**
```typescript
{
  name: "set_field_value",
  description: "Set the value of a field on the currently open Business Central page",
  inputSchema: {
    type: "object",
    properties: {
      controlPath: {
        type: "string",
        description: "Control path identifier (e.g., 'Name', 'Credit Limit (LCY)', 'server:c[5]')"
      },
      value: {
        type: ["string", "number", "boolean"],
        description: "The value to set (string, number, or boolean)"
      },
      waitForValidation: {
        type: "boolean",
        description: "Whether to wait for validation response before returning (default: true)",
        default: true
      }
    },
    required: ["controlPath", "value"]
  }
}
```

**WebSocket Protocol:**

1. **Send SaveValue Message:**
```typescript
{
  id: `${this.sessionId}#${++this.sequenceCounter}`,
  type: "Invoke",
  body: {
    type: "SaveValue",
    target: "server:c[controlIndex]", // Resolved from controlPath
    newValue: value.toString(),
    lastValidValue: currentValue // From read_page_data
  }
}
```

2. **Expected Responses:**
   - **Success:** `Message` with `ControlStateChanges` updating the field
   - **Validation Error:** `Message` with validation error notification
   - **Auto-Calculate:** Additional `ControlStateChanges` for calculated fields

**Implementation Details:**

```typescript
// src/tools/set-field-value-tool.ts

export async function setFieldValue(
  client: BCRawWebSocketClient,
  controlPath: string,
  value: string | number | boolean,
  waitForValidation: boolean = true
): Promise<SetFieldValueResult> {

  // 1. Resolve controlPath to control reference
  const currentPage = await client.getCurrentPageData();
  const control = findControlByPath(currentPage, controlPath);

  if (!control) {
    throw new Error(`Control not found: ${controlPath}`);
  }

  // 2. Get current value for lastValidValue
  const currentValue = control.value || "";

  // 3. Convert value to appropriate type
  const newValue = convertValueForBC(value, control.dataType);

  // 4. Send SaveValue message
  const sequenceNo = client.getNextSequenceNumber();

  await client.invoke({
    type: "SaveValue",
    target: control.controlReference,
    newValue: newValue,
    lastValidValue: currentValue
  }, sequenceNo);

  // 5. Wait for validation response if requested
  if (waitForValidation) {
    const response = await client.waitForHandlers(
      (handlers) => {
        // Check for ControlStateChanges or validation errors
        return handlers.some(h =>
          h.handlerType === "DN.LogicalClientChangeHandler" &&
          hasControlUpdate(h, control.controlReference)
        );
      },
      5000 // 5 second timeout
    );

    // 6. Parse response for validation errors
    const validationError = extractValidationError(response);
    if (validationError) {
      return {
        success: false,
        error: validationError,
        controlPath,
        attemptedValue: newValue
      };
    }
  }

  // 7. Return success
  return {
    success: true,
    controlPath,
    newValue: newValue,
    previousValue: currentValue
  };
}
```

**Control Path Resolution:**

Support multiple formats:
- **Caption-based:** `"Name"`, `"Credit Limit (LCY)"`
- **Server reference:** `"server:c[5]"`
- **Nested path:** `"General.Name"` (FastTab.Field)

**Data Type Conversion:**

```typescript
function convertValueForBC(
  value: string | number | boolean,
  dataType: string
): string {
  switch (dataType) {
    case "Text":
    case "Code":
      return String(value);

    case "Integer":
    case "Decimal":
      return String(Number(value));

    case "Boolean":
      if (typeof value === "boolean") {
        return value ? "Yes" : "No";
      }
      return String(value);

    case "Date":
    case "DateTime":
      // BC expects format: "MM/DD/YYYY" or "YYYY-MM-DD"
      return formatDateForBC(value);

    case "Option":
      // Return option value as string
      return String(value);

    default:
      return String(value);
  }
}
```

**Error Handling:**

- Control not found → Throw descriptive error
- Validation failure → Return error in result object
- Timeout waiting for response → Return timeout error
- Field is read-only → Throw error (check control metadata)

**Testing Strategy:**

```typescript
// Test cases
describe("set_field_value", () => {
  it("should update text field", async () => {
    // Open Customer Card
    // Set "Name" to "Test Customer"
    // Verify value updated
  });

  it("should update numeric field", async () => {
    // Open Customer Card
    // Set "Credit Limit (LCY)" to 50000
    // Verify value updated
  });

  it("should handle validation errors", async () => {
    // Open Customer Card
    // Set "Credit Limit (LCY)" to -1000
    // Verify validation error returned
  });

  it("should trigger auto-calculation", async () => {
    // Open Sales Order
    // Set "Quantity" on line
    // Verify "Line Amount" auto-calculated
  });
});
```

---

### 2. `filter_list`

**Purpose:** Apply filters to a list page to find specific records

**MCP Tool Definition:**
```typescript
{
  name: "filter_list",
  description: "Filter a Business Central list page by field criteria",
  inputSchema: {
    type: "object",
    properties: {
      field: {
        type: "string",
        description: "Field name to filter on (e.g., 'Name', 'No.', 'Balance')"
      },
      operator: {
        type: "string",
        enum: ["equals", "contains", "begins_with", "ends_with", "greater_than", "less_than", "range"],
        description: "Filter operator"
      },
      value: {
        type: ["string", "number"],
        description: "Filter value (or start of range)"
      },
      valueTo: {
        type: ["string", "number"],
        description: "End of range (only for 'range' operator)"
      },
      clearExisting: {
        type: "boolean",
        description: "Clear existing filters before applying (default: false)",
        default: false
      }
    },
    required: ["field", "operator", "value"]
  }
}
```

**WebSocket Protocol:**

BC list pages have a filter pane control. Filtering involves:

1. **Locate filter control** (usually `server:c[2]` or similar)
2. **Set filter expression** via SaveValue
3. **Apply filter** (may be automatic or require action)

```typescript
// Filter expression format
const filterExpression = buildFilterExpression(field, operator, value, valueTo);
// Examples:
// "Name" equals "Adatum" → "Adatum"
// "Name" contains "Corp" → "*Corp*"
// "Balance" greater than 1000 → ">1000"
// "No." range "10000".."20000" → "10000..20000"
```

**Implementation Details:**

```typescript
// src/tools/filter-list-tool.ts

export async function filterList(
  client: BCRawWebSocketClient,
  field: string,
  operator: FilterOperator,
  value: string | number,
  valueTo?: string | number,
  clearExisting: boolean = false
): Promise<FilterListResult> {

  // 1. Verify current page is a list page
  const currentPage = await client.getCurrentPageData();
  if (currentPage.pageType !== "List" && currentPage.pageType !== "Worksheet") {
    throw new Error(`Current page is not a list page (type: ${currentPage.pageType})`);
  }

  // 2. Find filter pane control
  const filterControl = findFilterPaneControl(currentPage);
  if (!filterControl) {
    throw new Error("Filter pane not found on current page");
  }

  // 3. Clear existing filters if requested
  if (clearExisting) {
    await clearAllFilters(client, filterControl);
  }

  // 4. Build filter expression
  const filterExpression = buildFilterExpression(field, operator, value, valueTo);

  // 5. Find field in filter pane
  const fieldFilterControl = findFieldFilterControl(filterControl, field);
  if (!fieldFilterControl) {
    throw new Error(`Field not available for filtering: ${field}`);
  }

  // 6. Set filter value
  await client.invoke({
    type: "SaveValue",
    target: fieldFilterControl.controlReference,
    newValue: filterExpression,
    lastValidValue: fieldFilterControl.value || ""
  });

  // 7. Wait for list refresh
  const response = await client.waitForHandlers(
    (handlers) => {
      // Look for DataRefreshChange on the repeater
      return handlers.some(h =>
        h.handlerType === "DN.LogicalClientChangeHandler" &&
        hasDataRefreshChange(h)
      );
    },
    5000
  );

  // 8. Parse refreshed data to get row count
  const rowCount = extractRowCountFromRefresh(response);

  return {
    success: true,
    field,
    operator,
    value,
    valueTo,
    rowCount,
    filterExpression
  };
}
```

**Filter Expression Builder:**

```typescript
function buildFilterExpression(
  field: string,
  operator: FilterOperator,
  value: string | number,
  valueTo?: string | number
): string {
  const val = String(value);
  const valTo = valueTo ? String(valueTo) : "";

  switch (operator) {
    case "equals":
      return val;

    case "contains":
      return `*${val}*`;

    case "begins_with":
      return `${val}*`;

    case "ends_with":
      return `*${val}`;

    case "greater_than":
      return `>${val}`;

    case "less_than":
      return `<${val}`;

    case "range":
      if (!valueTo) {
        throw new Error("valueTo required for range operator");
      }
      return `${val}..${valTo}`;

    default:
      throw new Error(`Unknown operator: ${operator}`);
  }
}
```

**Testing Strategy:**

```typescript
describe("filter_list", () => {
  it("should filter by equals", async () => {
    // Open Customer List
    // Filter "Name" equals "Adatum Corporation"
    // Verify 1 row returned
  });

  it("should filter by contains", async () => {
    // Open Customer List
    // Filter "Name" contains "Corp"
    // Verify multiple rows returned
  });

  it("should filter by range", async () => {
    // Open Customer List
    // Filter "No." range "10000".."20000"
    // Verify filtered rows
  });

  it("should clear existing filters", async () => {
    // Apply filter
    // Apply new filter with clearExisting=true
    // Verify only new filter active
  });
});
```

---

### 3. `handle_dialog`

**Purpose:** Interact with Business Central dialog windows (prompts, confirmations, wizards)

**MCP Tool Definition:**
```typescript
{
  name: "handle_dialog",
  description: "Interact with a Business Central dialog window by setting field values and clicking buttons",
  inputSchema: {
    type: "object",
    properties: {
      fieldValues: {
        type: "object",
        description: "Field values to set in the dialog (key: field name, value: field value)",
        additionalProperties: true
      },
      action: {
        type: "string",
        description: "Button to click (e.g., 'OK', 'Cancel', 'Yes', 'No', 'Finish')",
        default: "OK"
      },
      waitForDialog: {
        type: "boolean",
        description: "Whether to wait for dialog to appear (default: false, assumes already open)",
        default: false
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds to wait for dialog (default: 5000)",
        default: 5000
      }
    },
    required: ["action"]
  }
}
```

**WebSocket Protocol:**

Dialogs appear as new forms with `FormToShow` events:

```typescript
// Dialog detection
{
  handlerType: "DN.LogicalClientFormToShowHandler",
  parameters: [
    "formId", // Dialog form ID
    { /* dialog form data */ }
  ]
}
```

**Implementation Details:**

```typescript
// src/tools/handle-dialog-tool.ts

export async function handleDialog(
  client: BCRawWebSocketClient,
  fieldValues: Record<string, string | number | boolean>,
  action: string,
  waitForDialog: boolean = false,
  timeout: number = 5000
): Promise<HandleDialogResult> {

  let dialogFormId: string;
  let dialogData: any;

  // 1. Wait for dialog to appear if requested
  if (waitForDialog) {
    const dialogEvent = await client.waitForHandlers(
      (handlers) => {
        return handlers.some(h => h.handlerType === "DN.LogicalClientFormToShowHandler");
      },
      timeout
    );

    const formToShow = dialogEvent.find(h => h.handlerType === "DN.LogicalClientFormToShowHandler");
    if (!formToShow) {
      throw new Error("Dialog did not appear within timeout");
    }

    dialogFormId = formToShow.parameters[0];
    dialogData = formToShow.parameters[1];
  } else {
    // 2. Get current open forms and find dialog
    const openForms = client.getOpenForms();
    const dialogForm = openForms.find(f => isDialogForm(f));

    if (!dialogForm) {
      throw new Error("No dialog currently open");
    }

    dialogFormId = dialogForm.formId;
    dialogData = dialogForm.data;
  }

  // 3. Set field values in dialog
  const setResults: SetFieldResult[] = [];

  for (const [fieldName, fieldValue] of Object.entries(fieldValues)) {
    const control = findControlByCaption(dialogData, fieldName);
    if (!control) {
      throw new Error(`Field not found in dialog: ${fieldName}`);
    }

    // Use setFieldValue logic for each field
    const result = await setFieldValueInternal(
      client,
      control.controlReference,
      fieldValue,
      control.value || ""
    );

    setResults.push({ field: fieldName, ...result });
  }

  // 4. Find and click action button
  const actionControl = findActionButton(dialogData, action);
  if (!actionControl) {
    throw new Error(`Button not found in dialog: ${action}`);
  }

  // 5. Invoke action
  await client.invoke({
    type: "InvokeAction",
    target: actionControl.controlReference
  });

  // 6. Wait for dialog to close
  const closeEvent = await client.waitForHandlers(
    (handlers) => {
      // Dialog close may be FormToClose or just form removal
      return handlers.some(h =>
        h.handlerType === "DN.LogicalClientFormToCloseHandler" ||
        (h.handlerType === "DN.LogicalClientChangeHandler" &&
         hasFormClosed(h, dialogFormId))
      );
    },
    timeout
  );

  return {
    success: true,
    dialogFormId,
    fieldsSet: setResults,
    action,
    closed: true
  };
}
```

**Dialog Detection Helpers:**

```typescript
function isDialogForm(form: any): boolean {
  // Dialogs typically have:
  // - FormType: "Dialog" or "ConfirmationDialog"
  // - Smaller size
  // - Modal behavior
  return form.formType === "Dialog" ||
         form.formType === "ConfirmationDialog" ||
         form.isModal === true;
}

function findActionButton(dialogData: any, actionName: string): any {
  // Look for button controls matching action name
  const buttons = extractAllControls(dialogData).filter(c =>
    c.controlType === "CommandButton" ||
    c.controlType === "Action"
  );

  return buttons.find(b =>
    b.caption?.toLowerCase() === actionName.toLowerCase() ||
    b.name?.toLowerCase() === actionName.toLowerCase()
  );
}
```

**Testing Strategy:**

```typescript
describe("handle_dialog", () => {
  it("should handle posting confirmation dialog", async () => {
    // Open Sales Order
    // Invoke "Post" action
    // handle_dialog({ "Posting Date": "01/15/2025" }, "OK", waitForDialog: true)
    // Verify order posted
  });

  it("should handle simple confirmation", async () => {
    // Trigger delete action
    // handle_dialog({}, "Yes", waitForDialog: true)
    // Verify record deleted
  });

  it("should set multiple fields in wizard", async () => {
    // Open setup wizard
    // handle_dialog({ "Company Name": "Test", "Country": "US" }, "Next")
    // Verify wizard advanced
  });
});
```

---

### 4. `get_page_metadata`

**Purpose:** Discover available actions, fields, and capabilities on the current page

**MCP Tool Definition:**
```typescript
{
  name: "get_page_metadata",
  description: "Get metadata about the current Business Central page including available actions, fields, and page type",
  inputSchema: {
    type: "object",
    properties: {
      includeFields: {
        type: "boolean",
        description: "Include field metadata (default: true)",
        default: true
      },
      includeActions: {
        type: "boolean",
        description: "Include available actions (default: true)",
        default: true
      },
      includeRepeaters: {
        type: "boolean",
        description: "Include repeater/list metadata (default: true)",
        default: true
      }
    }
  }
}
```

**Implementation Details:**

```typescript
// src/tools/get-page-metadata-tool.ts

export async function getPageMetadata(
  client: BCRawWebSocketClient,
  includeFields: boolean = true,
  includeActions: boolean = true,
  includeRepeaters: boolean = true
): Promise<PageMetadata> {

  // 1. Get current page data
  const pageData = await client.getCurrentPageData();

  if (!pageData) {
    throw new Error("No page currently open");
  }

  // 2. Extract basic page info
  const metadata: PageMetadata = {
    pageId: pageData.pageId,
    pageType: pageData.pageType, // Card, List, Document, Worksheet, etc.
    caption: pageData.caption,
    formId: pageData.formId
  };

  // 3. Extract fields if requested
  if (includeFields) {
    metadata.fields = extractFieldMetadata(pageData);
  }

  // 4. Extract actions if requested
  if (includeActions) {
    metadata.actions = extractActionMetadata(pageData);
  }

  // 5. Extract repeaters if requested
  if (includeRepeaters) {
    metadata.repeaters = extractRepeaterMetadata(pageData);
  }

  return metadata;
}

function extractFieldMetadata(pageData: any): FieldMetadata[] {
  const fields: FieldMetadata[] = [];
  const controls = extractAllControls(pageData);

  for (const control of controls) {
    if (isFieldControl(control)) {
      fields.push({
        name: control.name || control.caption,
        caption: control.caption,
        dataType: control.dataType,
        controlPath: control.controlReference,
        editable: control.editable !== false,
        visible: control.visible !== false,
        mandatory: control.mandatory === true,
        currentValue: control.value
      });
    }
  }

  return fields;
}

function extractActionMetadata(pageData: any): ActionMetadata[] {
  const actions: ActionMetadata[] = [];
  const controls = extractAllControls(pageData);

  for (const control of controls) {
    if (isActionControl(control)) {
      actions.push({
        name: control.name,
        caption: control.caption,
        controlPath: control.controlReference,
        enabled: control.enabled !== false,
        visible: control.visible !== false,
        actionType: control.actionType || "Action"
      });
    }
  }

  return actions;
}

function extractRepeaterMetadata(pageData: any): RepeaterMetadata[] {
  const repeaters: RepeaterMetadata[] = [];
  const controls = extractAllControls(pageData);

  for (const control of controls) {
    if (control.controlType === "Repeater") {
      repeaters.push({
        name: control.name,
        caption: control.caption,
        controlPath: control.controlReference,
        rowCount: control.rowCount || 0,
        columns: extractRepeaterColumns(control)
      });
    }
  }

  return repeaters;
}
```

**Return Type:**

```typescript
interface PageMetadata {
  pageId: string;
  pageType: string; // "Card" | "List" | "Document" | "Worksheet" | etc.
  caption: string;
  formId: string;

  fields?: FieldMetadata[];
  actions?: ActionMetadata[];
  repeaters?: RepeaterMetadata[];
}

interface FieldMetadata {
  name: string;
  caption: string;
  dataType: string; // "Text" | "Integer" | "Decimal" | "Boolean" | "Date" | etc.
  controlPath: string;
  editable: boolean;
  visible: boolean;
  mandatory: boolean;
  currentValue?: any;
}

interface ActionMetadata {
  name: string;
  caption: string;
  controlPath: string;
  enabled: boolean;
  visible: boolean;
  actionType: string; // "Action" | "ActionGroup" | etc.
}

interface RepeaterMetadata {
  name: string;
  caption: string;
  controlPath: string;
  rowCount: number;
  columns: ColumnMetadata[];
}

interface ColumnMetadata {
  name: string;
  caption: string;
  dataType: string;
}
```

**Testing Strategy:**

```typescript
describe("get_page_metadata", () => {
  it("should get metadata for Customer Card", async () => {
    // Open Customer Card (page 21)
    const metadata = await getPageMetadata(client);

    expect(metadata.pageType).toBe("Card");
    expect(metadata.fields).toContainEqual(
      expect.objectContaining({ caption: "Name" })
    );
    expect(metadata.actions).toContainEqual(
      expect.objectContaining({ caption: "Statistics" })
    );
  });

  it("should get metadata for Customer List", async () => {
    // Open Customer List (page 22)
    const metadata = await getPageMetadata(client);

    expect(metadata.pageType).toBe("List");
    expect(metadata.repeaters).toHaveLength(1);
  });
});
```

---

## Priority 1: Convenience Helpers

### 5. `find_record`

**Purpose:** Composite helper to search for and locate a specific record

**MCP Tool Definition:**
```typescript
{
  name: "find_record",
  description: "Find a specific Business Central record by searching and filtering",
  inputSchema: {
    type: "object",
    properties: {
      entityName: {
        type: "string",
        description: "Entity type to search for (e.g., 'Customer', 'Item', 'Sales Order')"
      },
      searchField: {
        type: "string",
        description: "Field name to search on (e.g., 'Name', 'No.')"
      },
      searchValue: {
        type: ["string", "number"],
        description: "Value to search for"
      },
      operator: {
        type: "string",
        enum: ["equals", "contains", "begins_with"],
        description: "Search operator (default: 'equals')",
        default: "equals"
      },
      preferredPageType: {
        type: "string",
        enum: ["List", "Card"],
        description: "Preferred page type to open (default: 'List')",
        default: "List"
      }
    },
    required: ["entityName", "searchField", "searchValue"]
  }
}
```

**Implementation:**

```typescript
// src/tools/find-record-tool.ts

export async function findRecord(
  client: BCRawWebSocketClient,
  entityName: string,
  searchField: string,
  searchValue: string | number,
  operator: FilterOperator = "equals",
  preferredPageType: "List" | "Card" = "List"
): Promise<FindRecordResult> {

  // 1. Search for pages matching entity name
  const pages = await searchPages(client, entityName);

  // 2. Find preferred page type (List or Card)
  const targetPage = pages.find(p =>
    p.pageType === preferredPageType
  ) || pages[0];

  if (!targetPage) {
    return {
      found: false,
      error: `No page found for entity: ${entityName}`
    };
  }

  // 3. Open the page
  await openPage(client, targetPage.pageId);

  // 4. Apply filter (if List page)
  if (targetPage.pageType === "List") {
    const filterResult = await filterList(
      client,
      searchField,
      operator,
      searchValue
    );

    if (filterResult.rowCount === 0) {
      return {
        found: false,
        pageId: targetPage.pageId,
        pageType: targetPage.pageType,
        searchField,
        searchValue
      };
    }

    // 5. Read filtered data
    const pageData = await readPageData(client);

    // 6. Get bookmark of first matching record
    const firstRow = pageData.repeaters?.[0]?.rows?.[0];
    if (!firstRow) {
      return {
        found: false,
        pageId: targetPage.pageId,
        pageType: targetPage.pageType
      };
    }

    return {
      found: true,
      pageId: targetPage.pageId,
      pageType: targetPage.pageType,
      bookmark: firstRow.bookmark,
      record: firstRow.data
    };

  } else {
    // Card page - just return current record
    const pageData = await readPageData(client);

    return {
      found: true,
      pageId: targetPage.pageId,
      pageType: targetPage.pageType,
      bookmark: pageData.bookmark,
      record: pageData.fields
    };
  }
}
```

**Testing Strategy:**

```typescript
describe("find_record", () => {
  it("should find customer by name", async () => {
    const result = await findRecord(
      client,
      "Customer",
      "Name",
      "Adatum Corporation"
    );

    expect(result.found).toBe(true);
    expect(result.bookmark).toBeDefined();
    expect(result.record.Name).toBe("Adatum Corporation");
  });

  it("should return not found for missing record", async () => {
    const result = await findRecord(
      client,
      "Customer",
      "Name",
      "Nonexistent Customer"
    );

    expect(result.found).toBe(false);
  });
});
```

---

### 6. `create_record`

**Purpose:** Composite helper to create a new record with initial field values

**MCP Tool Definition:**
```typescript
{
  name: "create_record",
  description: "Create a new Business Central record with initial field values",
  inputSchema: {
    type: "object",
    properties: {
      pageId: {
        type: ["string", "number"],
        description: "Page ID to use for creation (e.g., 21 for Customer Card, 43 for Sales Order)"
      },
      initialFields: {
        type: "object",
        description: "Initial field values to set (key: field name, value: field value)",
        additionalProperties: true
      },
      waitForValidation: {
        type: "boolean",
        description: "Wait for validation after setting each field (default: true)",
        default: true
      }
    },
    required: ["pageId", "initialFields"]
  }
}
```

**Implementation:**

```typescript
// src/tools/create-record-tool.ts

export async function createRecord(
  client: BCRawWebSocketClient,
  pageId: string | number,
  initialFields: Record<string, any>,
  waitForValidation: boolean = true
): Promise<CreateRecordResult> {

  // 1. Open page
  await openPage(client, pageId);

  // 2. Invoke "New" action
  // Note: May need to find "New" action by name
  const metadata = await getPageMetadata(client, false, true, false);
  const newAction = metadata.actions?.find(a =>
    a.name === "New" || a.caption === "New"
  );

  if (!newAction) {
    throw new Error("'New' action not found on page");
  }

  await invokeAction(client, newAction.name);

  // 3. Wait for new record form to appear
  await client.waitForHandlers(
    (handlers) => {
      // New record may trigger form changes or new form
      return handlers.some(h =>
        h.handlerType === "DN.LogicalClientChangeHandler" ||
        h.handlerType === "DN.LogicalClientFormToShowHandler"
      );
    },
    5000
  );

  // 4. Set initial field values
  const setResults: SetFieldResult[] = [];

  for (const [fieldName, fieldValue] of Object.entries(initialFields)) {
    const result = await setFieldValue(
      client,
      fieldName,
      fieldValue,
      waitForValidation
    );

    setResults.push({ field: fieldName, ...result });

    // Stop if validation error
    if (!result.success) {
      return {
        success: false,
        error: `Failed to set field '${fieldName}': ${result.error}`,
        fieldsSet: setResults
      };
    }
  }

  // 5. Read resulting record data
  const pageData = await readPageData(client);

  return {
    success: true,
    pageId,
    bookmark: pageData.bookmark,
    record: pageData.fields,
    fieldsSet: setResults
  };
}
```

---

### 7. `update_record`

**Purpose:** Composite helper to update an existing record

**MCP Tool Definition:**
```typescript
{
  name: "update_record",
  description: "Update an existing Business Central record with new field values",
  inputSchema: {
    type: "object",
    properties: {
      pageId: {
        type: ["string", "number"],
        description: "Page ID to use (e.g., 21 for Customer Card)"
      },
      bookmark: {
        type: "string",
        description: "Bookmark of the record to update"
      },
      fieldUpdates: {
        type: "object",
        description: "Field updates to apply (key: field name, value: new value)",
        additionalProperties: true
      },
      waitForValidation: {
        type: "boolean",
        description: "Wait for validation after each update (default: true)",
        default: true
      }
    },
    required: ["pageId", "bookmark", "fieldUpdates"]
  }
}
```

**Implementation:**

```typescript
// src/tools/update-record-tool.ts

export async function updateRecord(
  client: BCRawWebSocketClient,
  pageId: string | number,
  bookmark: string,
  fieldUpdates: Record<string, any>,
  waitForValidation: boolean = true
): Promise<UpdateRecordResult> {

  // 1. Open record by bookmark
  await openPage(client, pageId, bookmark);

  // 2. Set field values
  const setResults: SetFieldResult[] = [];

  for (const [fieldName, fieldValue] of Object.entries(fieldUpdates)) {
    const result = await setFieldValue(
      client,
      fieldName,
      fieldValue,
      waitForValidation
    );

    setResults.push({ field: fieldName, ...result });

    // Continue on error but track it
  }

  // 3. Read updated record data
  const pageData = await readPageData(client);

  // 4. Check if all updates succeeded
  const allSuccess = setResults.every(r => r.success);

  return {
    success: allSuccess,
    pageId,
    bookmark,
    record: pageData.fields,
    fieldsSet: setResults,
    errors: setResults.filter(r => !r.success).map(r => r.error)
  };
}
```

---

## Implementation Checklist

### Phase 1: Core Primitives
- [ ] Implement `set_field_value`
  - [ ] Control path resolution
  - [ ] Data type conversion
  - [ ] Validation handling
  - [ ] Tests

- [ ] Implement `filter_list`
  - [ ] Filter expression builder
  - [ ] Filter pane detection
  - [ ] Multiple operator support
  - [ ] Tests

- [ ] Implement `handle_dialog`
  - [ ] Dialog detection
  - [ ] Field setting in dialogs
  - [ ] Button invocation
  - [ ] Tests

- [ ] Implement `get_page_metadata`
  - [ ] Field extraction
  - [ ] Action extraction
  - [ ] Repeater extraction
  - [ ] Tests

### Phase 2: Convenience Helpers
- [ ] Implement `find_record`
  - [ ] Composite flow
  - [ ] Error handling
  - [ ] Tests

- [ ] Implement `create_record`
  - [ ] New action detection
  - [ ] Field setting
  - [ ] Tests

- [ ] Implement `update_record`
  - [ ] Bookmark navigation
  - [ ] Field updates
  - [ ] Tests

### Integration
- [ ] Update MCP server tool definitions
- [ ] Add integration tests for each workflow
- [ ] Update documentation
- [ ] Create usage examples

---

## Notes

1. **Session State:** All tools must properly track and update:
   - Sequence numbers
   - Open form IDs
   - Last acknowledgment numbers

2. **Error Handling:** Each tool should:
   - Validate preconditions (correct page type, control exists, etc.)
   - Return structured error objects
   - Include retry logic where appropriate

3. **Event-Driven:** Use event emitter pattern for:
   - Waiting for validation responses
   - Detecting dialog appearance
   - Monitoring list refreshes

4. **Testing:** Each tool needs:
   - Unit tests for helper functions
   - Integration tests with real BC instance
   - Error case coverage

5. **Documentation:** Provide:
   - MCP tool descriptions
   - Usage examples
   - Common workflows
   - Troubleshooting guide
