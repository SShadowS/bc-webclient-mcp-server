# How BC Actually Sends Page Context to AI Agents

## CORRECTION: Autofill vs Full Page Description

**User Clarification**: Autofill is for **field-level suggestions** (IntelliSense-style autocomplete), NOT for describing complete pages to AI agents.

---

## What We Found

After searching the BC codebase, here's what BC **actually** sends to AI agents:

### 1. Orchestrator Ask Request - Minimal Context

**File**: `Microsoft.Dynamics.Nav.Client.UI\Nav\Client\CopilotService.cs` (lines 690-707)

BC sends **minimal page context** via simple key-value variables:

```csharp
private void AddChatRequestVariables(Dictionary<string, string> variables, ChatRequest request)
{
    // Page-specific variables from request
    foreach (KeyValuePair<string, string> variable in request.Context.Variables)
        variables[variable.Key] = variable.Value;

    // System context
    variables["chatId"] = request.Context.ChatId;
    variables["userId"] = this.userId;
    variables["entraTenantId"] = this.UISession.AadTenantId;
    variables["userName"] = this.UISession.UserName;
    variables["workDate"] = workDate.ToString("yyyy-MM-dd");
    variables["timeZoneId"] = this.UISession.TimeZone?.Id;
    variables["messageType"] = "message";
    variables["uiCulture"] = this.UISession.CurrentCultureContext.CurrentSessionUiCulture.ToString();
}
```

**Variables sent to Orchestrator**:
- `chatId` - Chat session ID
- `userId` - Current user ID
- `entraTenantId` - Azure tenant ID
- `userName` - User name
- `workDate` - Current work date (YYYY-MM-DD)
- `timeZoneId` - User's timezone
- `messageType` - "message"
- `uiCulture` - UI language/culture
- **Plus custom variables from `request.Context.Variables`** (added by client)

### 2. ChatRequest/ChatContext Structure

**File**: `Microsoft.Dynamics.Framework.UI\Dynamics\Framework\UI\ChatRequest.cs`

```csharp
public class ChatRequest
{
    [JsonProperty(PropertyName = "context")]
    public ChatContext Context { get; set; }

    [JsonProperty(PropertyName = "input")]
    public string Input { get; set; }
}

public class ChatContext
{
    [JsonProperty(PropertyName = "chatId")]
    public string ChatId { get; set; }

    [JsonProperty(PropertyName = "variables")]
    public IEnumerable<KeyValuePair<string, string>> Variables { get; set; }
}
```

### 3. What This Means

**BC does NOT send detailed page structure to the Orchestrator!**

No structured description of:
- ❌ Fields on the page
- ❌ Actions available
- ❌ Data visible
- ❌ Page type or structure
- ❌ Permissions

**BC only sends**:
- ✅ User context (who, when, where)
- ✅ System context (tenant, culture, timezone)
- ✅ Custom key-value variables (client can add page ID, etc.)

---

## Three Different Use Cases

### Use Case 1: Autofill (Field-Level Suggestions)

**Purpose**: IntelliSense-style autocomplete for a single field

**Data Structure**: `AutofillRequest` with full page structure
- Page metadata (name, caption, id)
- All containers (hierarchical)
- All fields (15+ properties per field)
- Current data values
- Fields to suggest

**Endpoint**: `SkillEngine.GetPageSuggestionAsync()`

**Example**: User types in "Customer Name" field, BC suggests "Acme Corporation"

---

### Use Case 2: Chat with Copilot (Generic AI Chat)

**Purpose**: General conversation with AI, minimal context

**Data Structure**: `Ask` request with simple variables
- User info (id, name, culture, timezone, workdate)
- Chat session info (chatId)
- Custom variables (optional)

**Endpoint**: `Orchestrator.ChatAsync()` or `ChatStreamedParsedAsync()`

**Example**: User asks "What's the exchange rate?" - AI doesn't need page structure

---

### Use Case 3: Agent Tasks (Automated Operations)

**Purpose**: AI agent performing automated tasks

**Data Structure**: Likely uses function invocation framework
- `IFunctionInvoker` with parameters
- `IFunctionResult` as return value
- Page context passed as function parameters

**Endpoint**: `AgentService.BeginExecuteAgentTaskAsync()`

**Example**: Agent creates sales order - needs page context passed as function params

---

## So How Does BC's AI "See" the Page?

Based on the code, BC's AI integration works differently than we assumed:

### Hypothesis 1: AI Doesn't "See" the Page Directly

BC's Orchestrator/Chat doesn't receive detailed page structure. Instead:
1. User asks question in chat
2. BC sends minimal context (user, date, culture)
3. AI responds based on training/knowledge
4. **If AI needs page data** → BC calls specific functions that return structured data

### Hypothesis 2: Function Invocation Pattern

BC uses the **Function Invocation Framework** (`IFunctionInvoker`) where:
1. AI decides it needs page data
2. AI calls a function like `GetCustomerData(customerId)`
3. BC executes function and returns structured `IFunctionResult`
4. AI uses result to formulate response

**Example flow**:
```
User: "What's this customer's balance?"
  ↓
AI: (needs customer data)
  ↓
AI: Call function GetCustomerData(pageId=21, systemId="...")
  ↓
BC: Executes function, queries database
  ↓
BC: Returns { Success: true, Details: { Balance: 15000, ... } }
  ↓
AI: "The customer's balance is $15,000"
```

### Hypothesis 3: Page Summaries

**File**: `Microsoft.Dynamics.Nav.Ncl\Microsoft\Dynamics\Nav\Runtime\AgentPageSummaryProvider.cs`

BC maintains **cached page summaries**:
```csharp
public class AgentPageSummary
{
    public int PageId { get; set; }
    public string Bookmark { get; set; }
    public int TableNo { get; set; }
    public string Summary { get; set; }  // Plain text summary!
}
```

**Key insight**: BC may be sending **text summaries** of pages, not structured data!

Example:
```
"Customer Card for Acme Corporation (ID: CUST-001)
Balance: $15,000
Last Payment: 2024-01-15
Status: Active
3 open orders totaling $5,000"
```

This would be sent as a **string variable** in the Ask request!

---

## Implications for Our MCP Server

### What We Now Know

1. **BC doesn't send rich page structure to Orchestrator** - Just minimal context
2. **Autofill structure is for field suggestions** - Not full page description
3. **BC likely uses function invocation** - AI calls BC functions to get data
4. **Page summaries may be text-based** - Not structured JSON

### What We Should Do

#### Option A: Follow BC's Minimal Context Pattern
```typescript
// Send minimal context like BC does
{
  input: "Create a new customer",
  variables: [
    { key: "pageId", value: "21" },
    { key: "pageName", value: "Customer Card" },
    { key: "userId", value: "admin" },
    { key: "workDate", value: "2024-01-29" }
  ]
}
```

**Pros**: Matches BC pattern, simple
**Cons**: AI has no page context, can't understand structure

#### Option B: Use Autofill Structure (Rich Metadata)
```typescript
// Send rich page metadata (even though BC uses this for autofill)
{
  page: { name: "Customer", caption: "Customer Card", id: 21 },
  containers: [...],
  fields: [...]
}
```

**Pros**: AI fully understands page structure
**Cons**: Not how BC uses this structure

#### Option C: Hybrid - Context Variables + Rich Metadata
```typescript
{
  // Minimal context (BC pattern)
  pageId: 21,
  pageName: "Customer Card",

  // Rich metadata (our addition)
  pageStructure: {
    fields: [...],
    actions: [...],
    permissions: {...}
  }
}
```

**Pros**: Best of both worlds
**Cons**: More complex

#### Option D: Text Summary (May Match BC)
```typescript
{
  pageId: 21,
  pageName: "Customer Card",
  pageSummary: `
    Customer Card (Page 21)

    Current Record: Acme Corporation (CUST-001)

    Available Fields:
    - No. (Code, 20 chars, required)
    - Name (Text, 100 chars, required)
    - Balance (Decimal, read-only)
    - Email (Text, 80 chars)

    Available Actions:
    - New (creates new customer)
    - Delete (removes customer)
    - Statistics (view customer statistics)

    Current Data:
    - No.: CUST-001
    - Name: Acme Corporation
    - Balance: $15,000.00
    - Email: contact@acme.com
  `
}
```

**Pros**: May match BC's actual approach, LLM-friendly
**Cons**: Less structured

---

## Recommendation

**Use Option C: Hybrid Approach**

Provide Claude with:
1. **Minimal context** (like BC does)
   - pageId, pageName, userId, workDate, culture
2. **Rich metadata** (our addition)
   - All fields with types and current values
   - All actions with descriptions
   - Permissions (can insert/modify/delete)
3. **Text summary** (optional, for context)
   - Plain English description of page
   - Current record summary

This gives Claude maximum information while following BC's patterns where applicable.

---

## Example for MCP Tool: get_page_metadata

```typescript
async function getPageMetadata(pageId: number): Promise<PageMetadata> {
  // 1. Open page via Invoke
  const handlers = await client.invoke({
    interactionName: 'OpenForm',
    namedParameters: { pageId: pageId }
  });

  // 2. Extract metadata from handlers
  const metadata = parseHandlers(handlers);

  // 3. Return hybrid format
  return {
    // BC-style minimal context
    context: {
      pageId: metadata.pageId,
      pageName: metadata.name,
      pageCaption: metadata.caption,
      pageType: metadata.type,
      sourceTable: metadata.sourceTable
    },

    // Rich metadata (Autofill-inspired structure)
    structure: {
      fields: metadata.fields.map(f => ({
        name: f.name,
        caption: f.caption,
        dataType: f.dataType,
        length: f.length,
        editable: f.editable,
        required: f.required,
        value: f.currentValue
      })),

      actions: metadata.actions.map(a => ({
        name: a.name,
        caption: a.caption,
        systemAction: a.systemActionType,
        enabled: a.enabled
      })),

      permissions: {
        insertAllowed: metadata.insertAllowed,
        modifyAllowed: metadata.modifyAllowed,
        deleteAllowed: metadata.deleteAllowed
      }
    },

    // Optional text summary
    summary: generatePageSummary(metadata)
  };
}

function generatePageSummary(metadata: any): string {
  return `
${metadata.caption} (${metadata.type} Page)

Fields: ${metadata.fields.length} fields available
Actions: ${metadata.actions.length} actions available
Permissions: ${[
  metadata.insertAllowed && 'Insert',
  metadata.modifyAllowed && 'Modify',
  metadata.deleteAllowed && 'Delete'
].filter(Boolean).join(', ')}

Key Fields:
${metadata.fields.slice(0, 5).map(f =>
  `- ${f.caption} (${f.dataType}${f.required ? ', required' : ''})`
).join('\n')}
  `.trim();
}
```

---

## Conclusion

BC's AI integration is **simpler than we thought**:
- ❌ No rich page structure sent to Orchestrator
- ✅ Minimal context variables (user, date, culture)
- ✅ Function invocation for data access
- ✅ Text summaries for context

**For our MCP server**:
- Don't try to replicate BC's exact pattern (it's too minimal)
- Use Autofill structure as inspiration for rich metadata
- Provide Claude with comprehensive page information
- Let Claude decide what's relevant

**The key difference**: BC's AI has **function calling** to query data on demand. Our MCP server provides **all metadata upfront** since Claude can't call back into BC dynamically.

---

## File References

- `C:\bc4ubuntu\Decompiled\Microsoft.Dynamics.Nav.Client.UI\Nav\Client\CopilotService.cs` (lines 690-707)
- `C:\bc4ubuntu\Decompiled\Microsoft.Dynamics.Framework.UI\Dynamics\Framework\UI\ChatRequest.cs`
- `C:\bc4ubuntu\Decompiled\Microsoft.Dynamics.Framework.UI\Dynamics\Framework\UI\ChatContext.cs`
- `C:\bc4ubuntu\Decompiled\Microsoft.Dynamics.Nav.Agents\Models\AgentContext.cs`
- `C:\bc4ubuntu\Decompiled\Microsoft.Dynamics.Nav.Ncl\Microsoft\Dynamics\Nav\Runtime\AgentPageSummaryProvider.cs`
- `C:\bc4ubuntu\Decompiled\Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\Models\AutofillRequest.cs` (for field suggestions)
