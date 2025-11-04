# Business Central Page Reference Guide

## Common Pages and Their IDs

This reference helps avoid confusion between similarly-named pages and reports in Business Central.

---

## Customer Management

| Page ID | Correct Name | Type | URL | Common Confusion |
|---------|--------------|------|-----|------------------|
| 21 | Customer Card | Card | `?page=21` | - |
| 22 | Customers | List | `?page=22` | ⚠️ "Customer List" is a **Report**, not this page |
| 23 | Vendor Card | Card | `?page=23` | - |
| 26 | Vendors | List | `?page=26` | Similar to customers |

## Item Management

| Page ID | Correct Name | Type | URL | Common Confusion |
|---------|--------------|------|-----|------------------|
| 30 | Item Card | Card | `?page=30` | - |
| 31 | Items | List | `?page=31` | - |

## Sales

| Page ID | Correct Name | Type | URL | Common Confusion |
|---------|--------------|------|-----|------------------|
| 42 | Sales Orders | List | `?page=42` | - |
| 43 | Sales Order | Document | `?page=43` | - |
| 44 | Sales Quotes | List | `?page=44` | - |
| 46 | Sales Invoice | Document | `?page=46` | - |
| 132 | Posted Sales Invoices | List | `?page=132` | - |

## Purchase

| Page ID | Correct Name | Type | URL | Common Confusion |
|---------|--------------|------|-----|------------------|
| 50 | Purchase Orders | List | `?page=50` | - |
| 51 | Purchase Order | Document | `?page=51` | - |
| 53 | Purchase Invoice | Document | `?page=53` | - |

## Finance

| Page ID | Correct Name | Type | URL | Common Confusion |
|---------|--------------|------|-----|------------------|
| 9 | Role Center (Home) | RoleCenter | `?page=9` | Landing page |
| 20 | General Ledger Entries | List | `?page=20` | - |
| 25 | Customer Ledger Entries | List | `?page=25` | - |
| 254 | G/L Account Card | Card | `?page=254` | - |

---

## Page Types Explained

### Card
- Single record view
- Used for detailed data entry and viewing
- Example: Customer Card (21), Item Card (30)

### List
- Multiple records in table format
- Used for browsing and selecting records
- Example: Customers (22), Items (31)

### Document
- Structured business document with header + lines
- Example: Sales Order (43), Purchase Invoice (53)

### Report
- **NOT a page** - generates output, not interactive
- Cannot be opened with `get_page_metadata`
- Must be run with report execution tools

### RoleCenter
- Landing page/dashboard
- Page 9 is the default role center

---

## How to Use This Reference

### In MCP Tools

**✅ RECOMMENDED - Use Page ID:**
```json
{
  "pageId": 22
}
```

**⚠️ RISKY - Use Page Name:**
```json
{
  "query": "Customers"  // Could match multiple results
}
```

### With search_pages Tool

When using `search_pages`, always check the `type` field:

```typescript
// Search result
{
  "pageId": "22",
  "caption": "Customers",
  "type": "List"  // ✅ This is a page
}

// vs

{
  "pageId": "101",
  "caption": "Customer List",
  "type": "Report"  // ❌ This is a report, not a page
}
```

### Filtering Search Results

Recommended: Filter `search_pages` results by type:

```typescript
const result = await search_pages({
  query: "customer",
  type: "List"  // Only return list pages
});
```

---

## Common Naming Pitfalls

### 1. "Customer List" vs "Customers"
- ❌ "Customer List" → **Report** (ID 101)
- ✅ "Customers" → **List Page** (ID 22)

### 2. "Sales Order" Ambiguity
- Page 42: "Sales Orders" (List of all orders)
- Page 43: "Sales Order" (Single order document)

### 3. Posted vs Unposted
- Page 43: Sales Order (unposted)
- Page 132: Posted Sales Invoices (historical)

---

## Best Practices

1. **Prefer Page IDs** for reliability in automation/tools
2. **Use exact captions** when searching (e.g., "Customers" not "Customer List")
3. **Filter by type** when using search to exclude reports
4. **Test page access** before building workflows - some pages may require specific permissions
5. **Document page IDs** in your workflow scripts for maintainability

---

## Quick Reference for Common Tasks

| Task | Page ID | Name |
|------|---------|------|
| View customer details | 21 | Customer Card |
| Browse all customers | 22 | Customers |
| Create sales order | 43 | Sales Order |
| View all sales orders | 42 | Sales Orders |
| View posted invoices | 132 | Posted Sales Invoices |
| Manage items | 31 | Items |
| View G/L entries | 20 | General Ledger Entries |

---

## Adding New Pages

When you discover a new page you want to reference:

1. Note the Page ID from the URL (`?page=XX`)
2. Note the exact caption from the page title
3. Identify the page type (Card/List/Document/Report)
4. Add to this reference guide
5. Update any related workflow documentation

---

## Related Documentation

- `/docs/NEW_TOOL_SPECIFICATIONS.md` - MCP tool specifications
- `/docs/TOOL_GAP_ANALYSIS.md` - Tool coverage analysis
- `/docs/tell-me-search-protocol.md` - Tell Me search protocol details
