/**
 * Workflow Patterns Documentation Resource
 *
 * Provides common workflow patterns and best practices for BC MCP tools.
 * This resource helps AI assistants understand how to use tools effectively.
 */

import type { Result } from '../core/result.js';
import { ok } from '../core/result.js';
import type { IMCPResource } from '../core/interfaces.js';

/**
 * WorkflowPatternsDocResource provides documentation for common BC workflows.
 */
export class WorkflowPatternsDocResource implements IMCPResource {
  public readonly uri = 'bc://docs/workflow-patterns';
  public readonly name = 'BC MCP Workflow Patterns';
  public readonly description = 'Common workflow patterns and best practices for BC MCP tools.';
  public readonly mimeType = 'text/markdown';

  /**
   * Reads the workflow patterns documentation.
   * @returns Markdown documentation as a string
   */
  public async read(): Promise<Result<string, never>> {
    const markdown = `# BC MCP Workflow Patterns

## Overview

This document provides common workflow patterns for using BC MCP tools effectively.
Each pattern includes step-by-step instructions and best practices.

## Creating a New Customer

To create a new customer in Business Central:

1. **Search for Customer Page**
   \`\`\`
   Use \`search_pages\` with:
   - \`query\`: "customer"
   - \`pageType\`: "Card" (optional)
   \`\`\`

2. **Open Customer Card**
   \`\`\`
   Use \`get_page_metadata\` with:
   - \`pageId\` from step 1 (typically "21" for Customer Card)
   \`\`\`
   This returns a \`pageContextId\` that you'll use in subsequent operations.

3. **Create New Record**
   \`\`\`
   Use \`execute_action\` with:
   - \`pageContextId\` from step 2
   - \`actionName\`: "New"
   \`\`\`

4. **Set Customer Fields**
   \`\`\`
   Use \`write_page_data\` multiple times or once with multiple fields:
   - \`pageContextId\` from step 2
   - \`fields\`: { "Name": "Acme Corp", "E-Mail": "contact@acme.com", ... }
   \`\`\`

5. **Save the Record**
   \`\`\`
   Use \`execute_action\` with:
   - \`pageContextId\` from step 2
   - \`actionName\`: "Post" or "Save"
   \`\`\`

6. **Verify Creation**
   \`\`\`
   Use \`read_page_data\` with:
   - \`pageContextId\` from step 2
   - \`filters\`: { "Name": "Acme Corp" } (optional)
   \`\`\`

## Reading List Data

To read data from a list page (e.g., Customer List):

1. **Search for List Page**
   \`\`\`
   Use \`search_pages\` with:
   - \`query\`: "customer list"
   - \`pageType\`: "List" (optional)
   \`\`\`

2. **Open List Page**
   \`\`\`
   Use \`get_page_metadata\` with:
   - \`pageId\` from step 1 (typically "22" for Customer List)
   \`\`\`

3. **Read List Data**
   \`\`\`
   Use \`read_page_data\` with:
   - \`pageContextId\` from step 2
   - \`filters\`: { "City": "Atlanta" } (optional)
   \`\`\`
   This returns an array of records.

## Drilling Down from List to Detail Page

Use this pattern when a user wants to open the detail page for a specific record from a List page:

**Examples:** "Open customer 10000's card", "Show me sales order SO-001", "Edit vendor Fabrikam"

**When to use:**
- User wants to view/edit fields available on the Card/Document page (not just List)
- User explicitly asks to "open" or "view/edit the card/document"
- You have or can open a List page as a starting point

**Steps:**

1. **Obtain the List Page Context**
   \`\`\`
   Use \`get_page_metadata\` with:
   - \`pageId\`: The List page (e.g., "22" for Customer List, "43" for Sales Order List)
   \`\`\`

2. **Locate the Target Record**
   \`\`\`
   Use \`read_page_data\` with:
   - \`pageContextId\`: from step 1
   - \`filters\`: { "No.": "10000" } (or other criteria)
   \`\`\`
   Extract the \`bookmark\` from the matching row.

3. **Drill Down to Detail Page**
   \`\`\`
   Use \`select_and_drill_down\` with:
   - \`pageContextId\`: from step 1
   - \`bookmark\`: from step 2
   - \`action\`: "Edit" (to modify) or "View" (read-only)
   \`\`\`
   Returns \`targetPageContextId\` for the opened Card/Document.

4. **Work with the Detail Page**
   \`\`\`
   Use \`read_page_data\` or \`write_page_data\` with:
   - \`pageContextId\`: the targetPageContextId from step 3
   \`\`\`

**When NOT to use select_and_drill_down:**
- For read-only operations where List view fields are sufficient → use \`read_page_data\` on List page only
- When you can open a Card page directly without going through a List → use \`get_page_metadata\` directly

**Caveats:**
- Requires a valid bookmark from the List page row
- Only works with header actions (Edit, View) discoverable via HeaderActions (/ha[N] or /a[N])
- Fails if the requested action is not available on the page

## Updating Existing Records

To update an existing record:

1. **Open the Page**
   \`\`\`
   Use \`get_page_metadata\` with the appropriate \`pageId\`.
   \`\`\`

2. **Find the Record**
   \`\`\`
   Use \`read_page_data\` with filters to locate the record:
   - \`pageContextId\` from step 1
   - \`filters\`: { "No.": "10000" }
   \`\`\`

3. **Update Fields**
   \`\`\`
   Use \`write_page_data\` with:
   - \`pageContextId\` from step 1
   - \`fields\`: { "Name": "Updated Name", "Phone No.": "555-1234" }
   \`\`\`

4. **Save Changes**
   \`\`\`
   Use \`execute_action\` with:
   - \`pageContextId\` from step 1
   - \`actionName\`: "Post" or "Save"
   \`\`\`

**Alternative: Update via Drill-Down to Card**

You can also update records by drilling down from a List page to the Card/Document page:

1. Open the List page and find the record using \`read_page_data\`
2. Use \`select_and_drill_down\` with the record's \`bookmark\` and \`action: "Edit"\`
3. Apply updates using \`write_page_data\` on the returned \`targetPageContextId\`

Use this approach when:
- Fields you need to update are only available/editable on the Card page
- User explicitly asks to "open the card" for editing
- Working with complex documents that require the full detail view

## Using create_record_by_field_name

For creating records when you know field names but not control paths:

1. **Search for the Page**
   \`\`\`
   Use \`search_pages\` to find the appropriate card page.
   \`\`\`

2. **Create Record Directly**
   \`\`\`
   Use \`create_record_by_field_name\` with:
   - \`pageId\`: The page ID from step 1
   - \`fields\`: { "Name": "John Doe", "E-Mail": "john@example.com", ... }
   \`\`\`
   This tool handles opening the page, creating a new record, setting fields,
   and saving automatically.

## Best Practices

### Error Handling

- Always check tool results for errors before proceeding to the next step.
- If a validation error occurs, surface it to the user and ask for corrected input.
- For BC errors (e.g., "Field X is required"), explain the BC business rule clearly.

### Field Names

- Use exact BC field names (e.g., "No.", "E-Mail", "Phone No.").
- Field names are case-sensitive in some contexts.
- Check the page metadata (\`get_page_metadata\`) to see available fields.

### Page Context Reuse

- The \`pageContextId\` from \`get_page_metadata\` can be reused for multiple operations.
- You don't need to call \`get_page_metadata\` again for the same page in the same session.
- Page contexts are cached and persist across tool calls.

### Action Names

- Common actions: "New", "Post", "Save", "Delete", "Edit"
- Use \`get_page_metadata\` to see available actions for a page.
- Action names are case-sensitive.

### Filtering

- Use \`read_page_data\` with \`filters\` to narrow results.
- Filters use exact match by default: \`{ "City": "Atlanta" }\`
- For list pages, filtering is essential to avoid loading all records.

## Common Pitfalls

1. **Not checking errors**: Always verify tool results succeeded before continuing.
2. **Wrong field names**: Field names must match exactly (including special characters like ".").
3. **Missing required fields**: BC will reject records missing required fields - check page metadata.
4. **Forgetting to save**: After \`write_page_data\`, you must call \`execute_action\` with "Post" or "Save".
5. **Using card pages for lists**: Use list pages (page type "List") to read multiple records efficiently.

## Page Type Reference

- **Card**: Single record view (e.g., Customer Card, Item Card)
- **List**: Multiple records view (e.g., Customer List, Item List)
- **Document**: Complex documents with headers and lines (e.g., Sales Order)
- **Worksheet**: Data entry forms (e.g., Item Journal)

## Next Steps

- Use \`bc://schema/pages\` resource to see available BC pages
- Use \`bc://session/current\` resource to inspect active sessions and open pages
- Refer to BC documentation for business logic and field requirements
`;

    return ok(markdown);
  }
}
