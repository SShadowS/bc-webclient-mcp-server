# Business Central AI Agent Framework Analysis

## Executive Summary

**MAJOR DISCOVERY**: Business Central v26.0 has a **built-in AI agent framework** that solves the exact problem we're tackling with the MCP server. BC provides structured APIs for exposing UI metadata to AI agents, avoiding the complexity of parsing WebSocket handler arrays.

**Key Insight**: Instead of parsing gzip-compressed handler arrays, we should use BC's structured metadata APIs (`IClientMetadataApi.GetMasterPage()`) to get clean, typed page metadata.

---

## 1. BC's Agent Architecture

### Location in Decompiled Code

**Agent Framework**: `Microsoft.Dynamics.Nav.Ncl\Microsoft\Dynamics\Nav\Runtime\Agents\`

Key files:
- `AgentMetadataProvider.cs` - Agent discovery and configuration
- `AgentALFunctions.cs` - AL functions agents can call
- `AgentDataSetHelper.cs` - Data structures exposed to agents
- `AgentConfigurationMetadata.cs` - Agent metadata definitions
- `IAgentInstructionsProvider.cs` - Custom prompt management

**Agent Service**: `Microsoft.Dynamics.Nav.Agents\Clients\AgentServiceClient.cs`
- Integrates with external Copilot service (Azure-hosted)

**Copilot Controller**: `Prod.Client.WebCoreApp\Controllers\CopilotController.cs`
- REST endpoints for Copilot features

### How BC Agents Work

```
┌─────────────────────────────────────────────────────────────┐
│  BC Server                                                  │
│                                                             │
│  ┌──────────────┐         ┌──────────────────────┐         │
│  │ Agent        │────────▶│ IClientMetadataApi   │         │
│  │ Framework    │         │ GetMasterPage()      │         │
│  └──────────────┘         └──────────────────────┘         │
│         │                          │                        │
│         │                          ▼                        │
│         │                  ┌──────────────────┐            │
│         │                  │ MasterPage       │            │
│         │                  │ - Actions        │            │
│         │                  │ - Fields         │            │
│         │                  │ - Permissions    │            │
│         │                  └──────────────────┘            │
│         │                                                   │
│         ▼                                                   │
│  ┌────────────────────────────────────┐                    │
│  │ AgentServiceClient                 │                    │
│  │ (calls external Copilot service)   │                    │
│  └────────────────────────────────────┘                    │
│         │                                                   │
└─────────┼───────────────────────────────────────────────────┘
          │
          ▼
   ┌────────────────────┐
   │ Azure Copilot      │
   │ Service            │
   │ (External LLM)     │
   └────────────────────┘
```

**Key Difference from MCP**:
- BC agents run **server-side** with full AL runtime access
- MCP server is **client-side** using WebSocket protocol
- BC delegates to external Copilot service, we use Claude directly

---

## 2. Structured Metadata APIs

### IClientMetadataApi Interface

**File**: `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\IClientMetadataApi.cs`

```csharp
public interface IClientMetadataApi
{
    // Get complete page structure
    Task<MasterPage> GetMasterPage(
        int pageId,
        DataSourceType dataSourceType = DataSourceType.Table,
        string personalizationId = null,
        bool applyPersonalization = true,
        bool withConfiguration = true,
        string viewName = null
    );

    // Get list of fields
    Task<IEnumerable<TableField>> GetFields(
        DataSourceType sourceType,
        int sourceNumber
    );

    // Get table metadata
    Task<TableMetadata> GetTableMetadata(int tableNo);

    // Search capabilities
    Task<IEnumerable<ClientObject>> SearchClientObjects(
        string searchTerm,
        ClientObjectType[] objectTypes
    );
}
```

**This is EXACTLY what we need!** Instead of parsing handler arrays, we should call `GetMasterPage()`.

---

## 3. MasterPage Structure

**File**: `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\Metadata\MasterPage.cs`

### Complete Structure

```csharp
public class MasterPage
{
    // Basic Information
    public int ID { get; set; }
    public string Name { get; set; }
    public string Caption { get; set; }
    public PageType PageType { get; set; }
    public int SourceTable { get; set; }
    public string SourceTableName { get; set; }

    // Permissions
    public PageProperties PageProperties { get; set; }
    // - InsertAllowed
    // - ModifyAllowed
    // - DeleteAllowed
    // - Editable

    // UI Structure
    public CommandBarDefinition CommandBar { get; set; }
    public ContentAreaDefinition ContentArea { get; set; }
    public FactBoxesDefinition InfopartsArea { get; set; }
    public NavigationAreaDefinition NavigationArea { get; set; }

    // Behavior
    public List<MethodDefinition> Methods { get; set; }
    public List<TriggerDefinition> Triggers { get; set; }
    public List<ViewDefinition> Views { get; set; }

    // Configuration
    public string PersonalizationId { get; set; }
    public bool IsModal { get; set; }
    public bool IsLookup { get; set; }
}
```

### CommandBar Definition

**File**: `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\Metadata\CommandBarDefinition.cs`

```csharp
public class CommandBarDefinition
{
    public List<ActionBaseDefinition> Actions { get; set; }
    public bool ShowQuickAccessPane { get; set; }
}

public class ActionDefinition : ActionBaseDefinition
{
    public int ID { get; set; }
    public string Name { get; set; }
    public string Caption { get; set; }
    public string Image { get; set; }  // Icon name

    // What the action does
    public RunObjectType RunObjectType { get; set; }  // Page, Report, Codeunit
    public int RunObjectId { get; set; }
    public RunPageMode RunPageMode { get; set; }  // Create, Edit, View

    // System actions
    public SystemActionType SystemActionType { get; set; }
    // - None, NewRecord, EditRecord, DeleteRecord, Post, Preview, etc.

    // Behavior
    public ActionTriggerDefinition Trigger { get; set; }
    public string ShortcutKey { get; set; }

    // State
    public bool Enabled { get; set; }
    public bool Visible { get; set; }
    public bool Promoted { get; set; }
    public PromotedCategory PromotedCategory { get; set; }
}
```

### ContentArea Definition

**File**: `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\Metadata\ContentAreaDefinition.cs`

```csharp
public class ContentAreaDefinition
{
    public List<GroupDefinition> Groups { get; set; }
}

public class GroupDefinition : ControlBaseDefinition
{
    public string Caption { get; set; }
    public GroupType GroupType { get; set; }  // Repeater, Group, FactBox
    public List<ControlBaseDefinition> Controls { get; set; }
}

public class ControlDataboundDefinition : ControlBaseDefinition
{
    public int FieldNo { get; set; }
    public string Name { get; set; }
    public string Caption { get; set; }

    // Data Type
    public NavTypeCode DataType { get; set; }
    // - Text, Code, Integer, Decimal, Date, DateTime, Boolean, Option, etc.
    public int Length { get; set; }
    public int DecimalPlaces { get; set; }

    // Behavior
    public bool Editable { get; set; }
    public bool Enabled { get; set; }
    public bool Visible { get; set; }
    public bool Required { get; set; }
    public bool QuickEntry { get; set; }

    // Validation
    public string OnValidateTrigger { get; set; }
    public bool HasOnValidate { get; set; }

    // Relations
    public int RelatedTable { get; set; }
    public string RelatedField { get; set; }
    public bool IsTableRelation { get; set; }

    // Display
    public string ToolTip { get; set; }
    public string Format { get; set; }
    public int Width { get; set; }
}
```

---

## 4. How BC Exposes UI to Agents

### Step 1: Agent Requests Page Metadata

```csharp
// From AgentALFunctions.cs
var masterPage = await metadataApi.GetMasterPage(
    pageId: 21,  // Customer Card
    dataSourceType: DataSourceType.Table,
    applyPersonalization: true,
    withConfiguration: true
);
```

### Step 2: BC Returns Structured MasterPage

```json
{
  "ID": 21,
  "Name": "Customer Card",
  "Caption": "Customer Card",
  "PageType": "Card",
  "SourceTable": 18,
  "SourceTableName": "Customer",
  "PageProperties": {
    "InsertAllowed": true,
    "ModifyAllowed": true,
    "DeleteAllowed": true,
    "Editable": true
  },
  "CommandBar": {
    "Actions": [
      {
        "ID": 1,
        "Name": "NewRecord",
        "Caption": "New",
        "Image": "New",
        "SystemActionType": "NewRecord",
        "Enabled": true,
        "Visible": true,
        "Promoted": true
      },
      {
        "ID": 2,
        "Name": "DeleteRecord",
        "Caption": "Delete",
        "Image": "Delete",
        "SystemActionType": "DeleteRecord",
        "Enabled": true,
        "Visible": true
      },
      {
        "ID": 50,
        "Name": "Statistics",
        "Caption": "Statistics",
        "Image": "Statistics",
        "RunObjectType": "Page",
        "RunObjectId": 151,
        "RunPageMode": "View",
        "Enabled": true,
        "Visible": true
      }
    ]
  },
  "ContentArea": {
    "Groups": [
      {
        "Caption": "General",
        "GroupType": "Group",
        "Controls": [
          {
            "FieldNo": 1,
            "Name": "No.",
            "Caption": "No.",
            "DataType": "Code",
            "Length": 20,
            "Editable": true,
            "Required": true,
            "ToolTip": "Specifies the number of the customer."
          },
          {
            "FieldNo": 2,
            "Name": "Name",
            "Caption": "Name",
            "DataType": "Text",
            "Length": 100,
            "Editable": true,
            "Required": true
          },
          {
            "FieldNo": 21,
            "Name": "Customer Posting Group",
            "Caption": "Customer Posting Group",
            "DataType": "Code",
            "Length": 20,
            "IsTableRelation": true,
            "RelatedTable": 92,
            "Editable": true
          }
        ]
      }
    ]
  }
}
```

### Step 3: Agent Uses Structured Data

The external Copilot service receives clean JSON and can:
- **Understand** what fields are available
- **See** what actions can be performed
- **Know** what's editable, required, validated
- **Navigate** to related pages via action metadata
- **Respect** permissions (InsertAllowed, ModifyAllowed, etc.)

---

## 5. Agent Data Structures

**File**: `AgentDataSetHelper.cs`

BC provides agents with system tables listing available agents:

### Configured Agents Table

```csharp
public static class ConfiguredAgentsDataSet
{
    public const string AgentUserId = "Agent User ID";
    public const string AgentDisplayName = "Agent Display Name";
    public const string AgentType = "Agent Type";
    public const string State = "State";  // Enabled/Disabled
    public const string SetupPageId = "Setup Page ID";
    public const string SummaryPageId = "Summary Page ID";
    public const string TasksNeedingAttention = "Tasks Needing Attention";
    public const string Annotations = "Annotations";  // Feedback
    public const string CanConfigure = "Can User Configure Agent";
    public const string IsCapabilityEnabled = "Is Copilot Capability Enabled";
}
```

### Not Configured Agents Table

```csharp
public static class NotConfiguredAgentsDataSet
{
    public const string AgentType = "Agent Type";
    public const string FirstSetupPageId = "First Time Setup Page ID";
    public const string CopilotCapability = "Copilot Capability";
    public const string AppId = "App ID";
    public const string AppPublisher = "App Publisher";
}
```

### Agent Instructions

**File**: `IAgentInstructionsProvider.cs`

```csharp
public interface IAgentInstructionsProvider
{
    Task SetInstructionsAsync(
        ISession session,
        Guid agentUserId,
        string instructions  // Plain text prompt!
    );

    Task<string> GetInstructionsAsync(
        ISession session,
        Guid agentUserId
    );
}
```

**Key Insight**: Instructions are just **plain text strings** - no special schema! BC allows custom prompts per agent instance.

---

## 6. Copilot REST Endpoints

**File**: `Prod.Client.WebCoreApp\Controllers\CopilotController.cs`

BC exposes Copilot features via REST:

```csharp
// Chat interface
[HttpPost("ask")]
public async Task<IActionResult> Ask([FromBody] CopilotAskRequest request)

// Chat with page context
[HttpPost("askWithSummarize")]
public async Task<IActionResult> AskWithSummarize([FromBody] CopilotAskRequest request)

// Autofill suggestions
[HttpPost("suggest")]
public async Task<IActionResult> Suggest([FromBody] CopilotSuggestRequest request)

// Generate summaries
[HttpPost("summarize")]
public async Task<IActionResult> Summarize([FromBody] CopilotSummarizeRequest request)

// Session management
[HttpPost("createSession")]
public async Task<IActionResult> CreateSession([FromBody] CopilotSessionRequest request)
```

These endpoints show BC provides:
- **Chat interface** with conversation history
- **Page summarization** for quick understanding
- **Field suggestions** based on context
- **Session persistence** across interactions

---

## 7. Agent Execution Flow

**File**: `AgentServiceClient.cs`

### External Execution Model

```csharp
// BC doesn't execute agents locally - delegates to Azure service
public async Task<AgentTaskResponse> BeginExecuteAgentTaskAsync(
    string tenantId,
    Guid agentUserId,
    Guid agentTaskId,
    CancellationToken cancellationToken
)
{
    var client = GetCopilotClient();

    return await client.BeginExecuteAgentTaskAsync(
        tenantId,
        agentUserId,
        agentTaskId,
        cancellationToken
    );
}
```

### User Intervention Support

```csharp
// When agent gets stuck, ask user for help
public async Task<List<Suggestion>> GetAgentTaskUserInterventionSuggestionsAsync(
    string tenantId,
    Guid agentUserId,
    Guid agentTaskId,
    string interventionReason,
    CancellationToken cancellationToken
)
```

**Pattern**: Agent tries → gets stuck → asks user → receives guidance → continues

---

## 8. Key Architectural Patterns

### Pattern 1: Agent as User Extension

```csharp
// From AgentMetadata.cs
public class AgentMetadata
{
    public Guid AgentUserId { get; set; }
    public string DisplayName { get; set; }
    public AgentType Type { get; set; }
    public int SetupPageId { get; set; }
    public int SummaryPageId { get; set; }
}
```

Agents have:
- **User ID** - Run with user's permissions
- **Setup page** - Configuration UI
- **Summary page** - Activity dashboard

### Pattern 2: Capability-Based Discovery

```csharp
// System Enum for agent types
public enum AgentType
{
    None = 0,
    EmailProcessor = 1,
    SalesOrderProcessor = 2,
    InvoiceProcessor = 3,
    // ... extensible via AL
}
```

Agents registered via AL code, not hardcoded.

### Pattern 3: Annotation/Feedback Loop

```csharp
// From AgentConfigurationMetadata.cs
public class AgentAnnotation
{
    public Guid Id { get; set; }
    public string Content { get; set; }
    public DateTime CreatedAt { get; set; }
    public AnnotationType Type { get; set; }  // Positive, Negative, Neutral
}
```

BC tracks agent performance via user feedback.

---

## 9. Comparison: BC Agents vs Our MCP Server

| Aspect | BC Native Agents | Our MCP Server |
|--------|------------------|----------------|
| **Execution** | Server-side AL runtime | Client-side WebSocket |
| **LLM** | External Azure Copilot | Claude via MCP |
| **Protocol** | Internal AL calls | WebSocket JSON-RPC |
| **Metadata** | `IClientMetadataApi.GetMasterPage()` | Parse handler arrays (current) |
| **Data Access** | Full database access | WebSocket + OData APIs |
| **Permissions** | User's AL permissions | User's web session |
| **State** | Server-maintained | Client-maintained |
| **Configuration** | BC pages + AL code | MCP tool parameters |
| **Deployment** | Integrated with BC | External MCP server |
| **Extensibility** | AL extensions | MCP tool additions |

### Our Advantages

✅ **Standard MCP protocol** - Works with Claude Desktop, not locked to Azure
✅ **External deployment** - No BC server changes required
✅ **Open source** - Transparent, auditable, customizable
✅ **Cross-platform** - Not tied to BC infrastructure

### Their Advantages

✅ **Direct AL access** - Can call any AL function
✅ **Full permissions** - Respects BC security exactly
✅ **No parsing needed** - Uses clean APIs
✅ **Integrated** - Built-in, supported, updated with BC

---

## 10. Critical Recommendations for MCP Server

### STOP Parsing Handler Arrays!

**Current Approach (Fragile)**:
```typescript
// Parse gzip-compressed handler arrays
const compressed = Buffer.from(response.compressedResult, 'base64');
const handlers = JSON.parse(gunzipSync(compressed).toString('utf-8'));

// Try to find metadata handlers
const metadataHandler = handlers.find(h => h.handlerType === 'DN.FormMetadataHandler');
// Parse nested structures...
// Hope BC didn't change handler format...
```

**Better Approach (Stable)**:
```typescript
// Call BC's structured metadata API
const masterPage = await bcClient.invoke({
  interactionName: 'InvokeMethod',
  namedParameters: {
    methodName: 'GetMasterPage',
    pageId: 21
  }
});

// Get clean, typed structure
const pageMetadata = {
  id: masterPage.ID,
  name: masterPage.Name,
  caption: masterPage.Caption,
  actions: masterPage.CommandBar.Actions.map(a => ({
    id: a.ID,
    name: a.Name,
    caption: a.Caption,
    systemAction: a.SystemActionType
  })),
  fields: masterPage.ContentArea.Groups.flatMap(g =>
    g.Controls.map(c => ({
      name: c.Name,
      caption: c.Caption,
      dataType: c.DataType,
      editable: c.Editable,
      required: c.Required
    }))
  )
};
```

### Use BC's Metadata APIs

**Available via WebSocket Invoke**:

1. **GetMasterPage(pageId)** → Complete page structure
2. **GetFields(sourceType, sourceNo)** → List of fields
3. **GetTableMetadata(tableNo)** → Table info
4. **SearchClientObjects(query, types)** → Search pages/tables

These are **stable, documented, tested APIs** that BC itself uses!

---

## 11. Recommended MCP Architecture (Revised)

### Layer 1: MCP Tools (Unchanged)

```typescript
interface MCPTools {
  search_pages(query: string): Page[]
  get_page_metadata(pageId: number): PageMetadata
  read_page_data(pageId: number, options?: ReadOptions): Record[]
  write_page_data(pageId: number, data: Record): void
  execute_page_action(pageId: number, action: string): ActionResult
}
```

### Layer 2: Metadata Client (NEW)

```typescript
class BCMetadataClient {
  // Use BC's structured APIs instead of parsing handlers
  async getMasterPage(pageId: number): Promise<MasterPage> {
    const result = await this.wsClient.invoke({
      interactionName: 'InvokeMethod',
      namedParameters: {
        methodName: 'GetMasterPage',
        pageId: pageId
      }
    });
    return this.parseMasterPage(result);
  }

  async searchPages(query: string): Promise<PageReference[]> {
    const result = await this.wsClient.invoke({
      interactionName: 'InvokeMethod',
      namedParameters: {
        methodName: 'SearchClientObjects',
        searchTerm: query,
        objectTypes: ['Page']
      }
    });
    return this.parseSearchResults(result);
  }

  async getFields(tableNo: number): Promise<FieldMetadata[]> {
    const result = await this.wsClient.invoke({
      interactionName: 'InvokeMethod',
      namedParameters: {
        methodName: 'GetFields',
        sourceType: 'Table',
        sourceNumber: tableNo
      }
    });
    return this.parseFields(result);
  }
}
```

### Layer 3: Protocol Router (Simplified)

```typescript
class ProtocolRouter {
  constructor(
    private metadataClient: BCMetadataClient,
    private apiClient: BCAPIClient
  ) {}

  // Use metadata APIs for reads
  async getPageMetadata(pageId: number): Promise<PageMetadata> {
    const masterPage = await this.metadataClient.getMasterPage(pageId);
    return this.normalizeMetadata(masterPage);
  }

  // Use OData for writes
  async writeData(entityType: string, data: Record): Promise<void> {
    return this.apiClient.postEntity(entityType, data);
  }
}
```

### Benefits of This Approach

✅ **No handler parsing** - Use BC's own APIs
✅ **Stable across BC versions** - APIs are versioned and stable
✅ **Clean, typed data** - MasterPage class is well-defined
✅ **Less code** - No need to parse 11+ handler types
✅ **Maintainable** - BC documents API changes
✅ **Testable** - Can mock structured responses easily

---

## 12. Implementation Priority (Revised)

### Phase 1: Metadata Client (Week 2)

1. **Implement BCMetadataClient**
   - `getMasterPage()` via InvokeMethod
   - `searchPages()` via SearchClientObjects
   - `getFields()` via GetFields

2. **Test with real BC instance**
   - Verify InvokeMethod works over WebSocket
   - Validate response structure matches MasterPage
   - Handle errors gracefully

3. **Create normalizers**
   - MasterPage → LLM-friendly JSON
   - Include actions, fields, permissions
   - Add helpful descriptions

### Phase 2: MCP Tools (Week 3)

4. **Implement read-only tools**
   - `search_pages` using metadata client
   - `get_page_metadata` using metadata client
   - `read_page_data` via OpenForm (for initial dataset)

5. **Test with Claude**
   - Verify LLM can understand page structures
   - Test action discovery and execution
   - Validate field type understanding

### Phase 3: Write Operations (Week 4)

6. **Implement BC API client**
   - Page ID → OData entity mapping
   - `write_page_data` via REST API
   - Handle validation errors

### Phase 4: Refinement (Week 5-6)

7. **Polish and harden**
   - Error handling
   - Connection pooling
   - Caching strategy
   - Documentation

---

## 13. Open Questions

1. **Can we call IClientMetadataApi methods via WebSocket Invoke?**
   - Need to test if InvokeMethod with methodName='GetMasterPage' works
   - Or if we need to use a different interactionName
   - May need to investigate how BC web client calls these methods

2. **What's the exact format of metadata API responses over WebSocket?**
   - Are they in handler arrays or direct results?
   - Do we need special deserialization?
   - Can we get TypeScript interfaces from BC?

3. **Do metadata APIs respect user permissions?**
   - Can users only see pages they have access to?
   - Are field-level permissions included?
   - How do we handle restricted data?

4. **Are there rate limits or caching recommendations?**
   - Should we cache MasterPage responses?
   - How often do page structures change?
   - What's the invalidation strategy?

---

## 14. Next Steps

### Immediate Actions

1. **Test metadata API access via WebSocket**
   - Try calling GetMasterPage via Invoke
   - Document request/response format
   - Compare to handler array approach

2. **Update architecture document**
   - Add metadata client layer
   - Revise implementation plan
   - Update complexity estimates

3. **Create proof-of-concept**
   - Implement basic BCMetadataClient
   - Get metadata for one page (Customer Card)
   - Convert to LLM-friendly format

### Research Tasks

4. **Find how BC web client calls metadata APIs**
   - Search for GetMasterPage calls in decompiled web client
   - Check network traffic in browser DevTools
   - Document the exact protocol

5. **Map systemAction codes to actions**
   - Create enum/mapping of all SystemActionType values
   - Document which actions are safe for LLMs
   - Create allowlist/denylist

---

## 15. Conclusion

**BC solved this problem!** Their AI agent framework proves:

1. **Structured metadata APIs work** - No need to parse handlers
2. **External LLM integration is viable** - BC delegates to Azure Copilot
3. **Simple prompts are effective** - Just plain text instructions
4. **User intervention is necessary** - Agents need help sometimes
5. **Permissions matter** - Agents run with user credentials

**For our MCP server**:

✅ Adopt BC's metadata approach (IClientMetadataApi)
✅ Keep our WebSocket foundation (proven to work)
✅ Use BC APIs for writes (more stable)
✅ Model page descriptors on MasterPage (proven structure)
✅ Support user intervention workflows (follow BC pattern)

**This discovery changes everything!** We can build a much more robust MCP server by following BC's own patterns instead of reverse-engineering their UI protocol.

---

## File References

All files referenced in this analysis:

### Agent Framework
- `Microsoft.Dynamics.Nav.Ncl\Microsoft\Dynamics\Nav\Runtime\Agents\AgentMetadataProvider.cs`
- `Microsoft.Dynamics.Nav.Ncl\Microsoft\Dynamics\Nav\Runtime\Agents\AgentALFunctions.cs`
- `Microsoft.Dynamics.Nav.Ncl\Microsoft\Dynamics\Nav\Runtime\Agents\AgentDataSetHelper.cs`
- `Microsoft.Dynamics.Nav.Ncl\Microsoft\Dynamics\Nav\Runtime\Agents\IAgentInstructionsProvider.cs`
- `Microsoft.Dynamics.Nav.Ncl\Microsoft\Dynamics\Nav\Runtime\Agents\AgentMetadata.cs`
- `Microsoft.Dynamics.Nav.Agents\Clients\AgentServiceClient.cs`

### Metadata APIs
- `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\IClientMetadataApi.cs`
- `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\Metadata\MasterPage.cs`
- `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\Metadata\CommandBarDefinition.cs`
- `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\Metadata\ActionDefinition.cs`
- `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\Metadata\ControlDataboundDefinition.cs`
- `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\Metadata\ContentAreaDefinition.cs`

### Web Client
- `Prod.Client.WebCoreApp\Controllers\CopilotController.cs`
- `Prod.Client.WebCoreApp\Controllers\ClientServiceHub.cs`

### Documentation
- `ai-agent.md` - BC AI agent workflow documentation
- `bc-poc\ARCHITECTURE.md` - Our MCP architecture
- `bc-poc\README.md` - PoC documentation
