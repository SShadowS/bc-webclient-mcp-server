# Business Central MCP Server - LLM Usage Guide

## Overview

You are connected to a Business Central MCP (Model Context Protocol) server that provides programmatic access to Microsoft Dynamics 365 Business Central. This ERP system manages financials, sales, purchasing, inventory, and more.

## What is Business Central?

Business Central is an enterprise resource planning (ERP) system with:
- **Pages**: UI forms for data entry and viewing (e.g., Customer Card, Sales Orders)
- **Records**: Database entries with fields
- **Actions**: Buttons and menu items that trigger business logic
- **Tables**: Underlying data structures (Customer, Item, Sales Header, etc.)

## Available Tools

### 1. `search_pages` - Find Pages by Name or Purpose
Search for pages using natural language queries.

**When to use**: User wants to find a specific page or doesn't know the exact page name.

**Examples**:
```
search_pages: "customer"
→ Returns: Customer Card (21), Customer List (22), Customer Statistics, etc.

search_pages: "sales order"
→ Returns: Sales Order (42), Sales Orders (9305), etc.

search_pages: "inventory"
→ Returns: Item Card (30), Item List (31), Inventory reports, etc.
```

### 2. `open_page` - Open and Load Page Data
Opens a specific page and retrieves its structure, fields, and current data.

**When to use**: User wants to view or interact with a specific page.

**Parameters**:
- `pageId`: Numeric page ID (required)
- `recordId`: Optional - specific record to open (e.g., "Customer:10000" for customer 10000)

**Examples**:
```
open_page: 21 (recordId: "Customer:10000")
→ Opens Customer Card for customer 10000

open_page: 42
→ Opens new Sales Order page

open_page: 22
→ Opens Customer List with all customers
```

**What you get back**:
- Page metadata (ID, name, type)
- All field names and current values
- Available actions (buttons)
- Repeater data (for lists)

### 3. `invoke_action` - Click Buttons and Execute Actions
Triggers actions (buttons, menu items) on an open page.

**When to use**: User wants to perform an action like saving, posting, printing, or running a business process.

**Examples**:
```
invoke_action: "New" (on Customer List)
→ Creates a new customer

invoke_action: "Post" (on Sales Order)
→ Posts the sales order

invoke_action: "Statistics" (on Customer Card)
→ Opens customer statistics dialog
```

**Best Practice**: After opening a page, list available actions to the user so they know what's possible.

### 4. `set_field_value` - Update Field Values
Sets the value of a field on the currently open page.

**When to use**: User wants to enter or modify data.

**Examples**:
```
set_field_value: "Name" = "Contoso Ltd."
→ Sets customer/vendor name

set_field_value: "Quantity" = "10"
→ Sets quantity on sales line

set_field_value: "Unit Price" = "99.99"
→ Sets price
```

**Important Notes**:
- Field names are case-sensitive
- Use exact field names as returned by `open_page`
- Some fields trigger validation or calculations (e.g., Item No. may auto-fill Description)

## Common Workflows

### Workflow 1: Finding and Viewing Data
1. User: "Show me customer Adatum Corporation"
2. `search_pages: "customer"` → Get page IDs
3. `open_page: 22` → Open Customer List
4. Look through repeater data for "Adatum"
5. `open_page: 21 (recordId: "Customer:10000")` → Open specific customer card

### Workflow 2: Creating a New Record
1. User: "Create a new customer called Fabrikam"
2. `search_pages: "customer"` → Find Customer List (22) or Customer Card (21)
3. `open_page: 21` → Open new Customer Card
4. `set_field_value: "Name" = "Fabrikam Inc."`
5. `set_field_value: "Address" = "123 Main St"`
6. `invoke_action: "Save"` or move to next record to trigger save

### Workflow 3: Processing a Transaction
1. User: "Create a sales order for customer 10000"
2. `open_page: 42` → Open Sales Order
3. `set_field_value: "Customer No." = "10000"`
4. Navigate to lines, add items
5. `invoke_action: "Post"` → Process the order

## Best Practices

### 1. **Always Search First**
If the user mentions a page by name (not number), use `search_pages` to find the correct page ID.

❌ Don't guess: "I'll open page 25"
✅ Do search: `search_pages: "customer"` → "Found Customer Card (21)"

### 2. **Show What's Available**
After opening a page, tell the user what actions are available.

Example: "Opened Sales Order page. Available actions: Post, Post and Send, Print, Customer, Statistics, Approve, Dimensions..."

### 3. **Handle Field Names Carefully**
- Use exact field names from the page structure
- Field names often have spaces: "Customer No.", "Unit Price", "Qty. to Ship"
- Don't invent field names

### 4. **Work Sequentially**
Business Central validates data as you enter it. Set fields in logical order:
1. Header fields first (Customer No., Document Date)
2. Then line details (Item No., Quantity)
3. Then calculated fields update automatically

### 5. **Explain What You're Doing**
Business Central can be complex. Narrate your actions:
- "Searching for customer pages..."
- "Opening Customer Card (page 21) for customer 10000..."
- "Setting the customer name to 'Fabrikam Inc.'..."
- "Available actions on this page are: New, Save, Delete..."

### 6. **Check for Errors**
Tool responses may contain error messages. Always check and report them clearly.

## Connection Information

- **URL**: http://Cronus27/BC/?tenant=default
- **Demo Company**: CRONUS International Ltd.
- **Sample Data**: Includes customers, vendors, items, sales orders, purchase orders, etc.

## Common Pages Reference

| Page ID | Name | Purpose |
|---------|------|---------|
| 21 | Customer Card | View/edit single customer |
| 22 | Customer List | Browse all customers |
| 26 | Vendor Card | View/edit single vendor |
| 27 | Vendor List | Browse all vendors |
| 30 | Item Card | View/edit single item |
| 31 | Item List | Browse all items |
| 42 | Sales Order | Create/edit sales order |
| 9305 | Sales Orders | List of all sales orders |
| 50 | Purchase Order | Create/edit purchase order |

## Example Interaction

**User**: "I need to create a new customer called Alpine Ski House"

**Your Response**:
"I'll help you create a new customer. Let me first find the customer page..."

*Use tool: `search_pages: "customer"`*

"Found the Customer Card (page 21). Opening a new customer card..."

*Use tool: `open_page: 21`*

"Customer Card opened. I can see fields like 'No.', 'Name', 'Address', 'City', 'Phone No.', etc. Setting the customer name to 'Alpine Ski House'..."

*Use tool: `set_field_value: "Name" = "Alpine Ski House"`*

"Customer name set successfully. Would you like me to fill in additional details like address, contact information, or payment terms?"

## Tips for Video Demonstrations

1. **Start Simple**: Begin with searching and viewing data
2. **Show Discovery**: Use search_pages to demonstrate finding functionality
3. **Explain Structure**: When you open a page, briefly describe what you see
4. **Demonstrate Validation**: Show how BC validates data (e.g., customer number must exist)
5. **Show Real Workflows**: Create a sales order end-to-end
6. **Handle Errors Gracefully**: If something fails, explain why

## Remember

- Business Central is a complex ERP system - users may not know exact page names or IDs
- Always validate data exists before referencing it
- Pages may have mandatory fields - check error messages
- Some actions open dialogs or sub-pages - handle these appropriately
- The system maintains business rules and validations - respect them

---

**Quick Start**: Try `search_pages: "customer"` to explore available customer-related pages!
