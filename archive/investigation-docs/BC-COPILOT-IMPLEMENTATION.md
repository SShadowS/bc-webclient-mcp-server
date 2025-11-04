# Business Central Copilot Implementation - Complete Analysis

## 🎯 MAJOR DISCOVERY: BC's Exact AI Integration Architecture

This document contains the complete analysis of BC's Copilot implementation, extracted from the decompiled source code.

**Key Folders Analyzed**:
1. `Microsoft.Dynamics.Nav.ClientServer.JsonRpc` - JSON-RPC protocol over WebSocket
2. `Microsoft.BusinessCentral.AI.Abstractions` - AI function invocation framework
3. `Microsoft.BusinessCentral.CopilotService.AgentService.Client` - Agent execution
4. `Microsoft.BusinessCentral.CopilotService.Orchestrator.Client` - AI orchestration
5. `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client` - Skills execution

---

## 1. JSON-RPC Protocol Implementation

### How BC Uses JSON-RPC Over WebSocket

**File**: `Microsoft.Dynamics.Nav.ClientServer.JsonRpc\ClientServerJsonRpc.cs`

BC extends `StreamJsonRpc.JsonRpc` with custom message inspection:

```csharp
public class ClientServerJsonRpc : JsonRpc
{
    // Message inspection hooks
    protected override ValueTask SendAsync(message, cancellationToken)
    {
        // Call inspector.BeforeMessageSent()
        return base.SendAsync(message, cancellationToken);
    }

    protected override ValueTask<JsonRpcMessage> DispatchRequestAsync(request)
    {
        // Call inspector.AfterReceiveMessage()
        return base.DispatchRequestAsync(request);
    }

    // Response lifecycle hooks
    protected virtual void OnResponseReceived(JsonRpcMessage message) { }
    protected virtual void OnResponseSent(JsonRpcMessage message) { }
}
```

**File**: `Microsoft.Dynamics.Nav.ClientServer.JsonRpc\JsonRpcWebSocketConnection.cs`

WebSocket connection wrapper:

```csharp
public class JsonRpcWebSocketConnection : ICommunicationConnection
{
    private WebSocket webSocket;

    public CommunicationConnectionState State =>
        webSocket.State switch
        {
            WebSocketState.Connecting => CommunicationConnectionState.Opening,
            WebSocketState.Open => CommunicationConnectionState.Opened,
            WebSocketState.CloseSent => CommunicationConnectionState.Closing,
            WebSocketState.CloseReceived => CommunicationConnectionState.Closing,
            WebSocketState.Closed => CommunicationConnectionState.Closed,
            WebSocketState.Aborted => CommunicationConnectionState.Faulted,
            _ => CommunicationConnectionState.Faulted
        };

    public async Task CloseAsync(
        string disconnectionReason,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        await webSocket.CloseAsync(
            WebSocketCloseStatus.NormalClosure,
            disconnectionReason,
            cancellationToken
        );
    }
}
```

### Custom Data Serialization

**File**: `Microsoft.Dynamics.Nav.ClientServer.JsonRpc\NavDataSetConverter.cs`

BC uses custom JSON converter for large datasets:

```csharp
public class NavDataSetConverter : JsonConverter<NavDataSet>
{
    public override void WriteJson(writer, value, serializer)
    {
        // Write as: { compressed: bool, count: int, buffers: byte[][] }
        writer.WriteStartObject();
        writer.WritePropertyName("compressed");
        writer.WriteValue(value.IsCompressed);
        writer.WritePropertyName("count");
        writer.WriteValue(value.Count);
        writer.WritePropertyName("buffers");
        writer.WriteStartArray();

        // Use ArrayPool<byte> for buffer management
        foreach (var buffer in value.Buffers)
        {
            writer.WriteValue(buffer);
        }

        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    public override NavDataSet ReadJson(reader, type, existingValue, serializer)
    {
        // Read and decompress if needed
        var compressed = reader.ReadBool("compressed");
        var count = reader.ReadInt("count");
        var buffers = reader.ReadByteArrays("buffers");

        return new NavDataSet
        {
            IsCompressed = compressed,
            Count = count,
            Buffers = buffers
        };
    }
}
```

**File**: `Microsoft.Dynamics.Nav.ClientServer.JsonRpc\SharedJsonSettings.cs`

```csharp
public static class SharedJsonSettings
{
    public static JsonSerializerSettings CreateSettings()
    {
        return new JsonSerializerSettings
        {
            Converters = new List<JsonConverter>
            {
                new NavDataSetConverter(),
                new VersionConverter()
            },
            ContractResolver = new NavPolymorphicContractResolver
            {
                IgnoreShouldSerializeMembers = true,
                // Ignores "*IsSpecified" pattern members
                DefaultMembersSearchFlags = BindingFlags.Public | BindingFlags.Instance
            },
            TypeNameHandling = TypeNameHandling.Auto
        };
    }
}
```

---

## 2. AI Function Invocation Framework

### Core Abstractions

**File**: `Microsoft.BusinessCentral.AI.Abstractions\IFunctionResult.cs`

Every AI operation returns this structured result:

```csharp
public interface IFunctionResult
{
    // Page Context
    string PageName { get; }           // Current page identifier
    string PageCaption { get; }        // Display name
    PageDetails AfterPrimaryPage { get; }  // State after operation
    PageDetails BeforePrimaryPage { get; } // State before operation

    // Operation Result
    bool Success { get; }              // Did operation succeed?
    string Description { get; }        // Human-readable description
    string InvokeReason { get; }       // Why was function called?
    object Details { get; }            // Structured response data

    // User Intervention
    bool RequiresUserIntervention { get; }
    InterventionReason InterventionReason { get; }

    // Metadata
    bool IgnorableInSummary { get; }   // Can be omitted from summaries
    string Context { get; }            // Optional context data
    IEnumerable<FileResult> Files { get; } // Generated files
    IReadOnlyCollection<FunctionLogEntry> LogEntries { get; } // Execution logs
}
```

**File**: `Microsoft.BusinessCentral.AI.Abstractions\PageDetails.cs`

```csharp
public record PageDetails
{
    public string Name { get; init; }     // Technical name
    public string Caption { get; init; }  // Display name
    public string Type { get; init; }     // "Card", "List", "Document", etc.
}
```

### Function Definition System

**File**: `Microsoft.BusinessCentral.AI.Abstractions\FunctionDefinition.cs`

BC uses reflection to discover AI-callable functions:

```csharp
public class FunctionDefinition
{
    public string Name { get; }
    public string Description { get; }
    public List<FunctionParameter> Parameters { get; }
    public MethodInfo Method { get; }

    public static FunctionDefinition Create(
        MethodInfo methodInfo,
        object target,
        ILoggerFactory loggerFactory)
    {
        // Extract [DisplayName] attribute for function name
        var displayName = methodInfo.GetCustomAttribute<DisplayNameAttribute>();
        var name = displayName?.DisplayName ?? methodInfo.Name;

        // Extract [Description] attribute for documentation
        var description = methodInfo.GetCustomAttribute<DescriptionAttribute>();

        // Create parameters from method signature
        var parameters = methodInfo.GetParameters()
            .Select(p => FunctionParameter.Create(p))
            .OrderBy(p => p.Order)  // reason (-int.MaxValue), positional, description (int.MaxValue)
            .ToList();

        // Implicit "stepDescription" parameter always added
        parameters.Add(new FunctionParameter
        {
            Name = "stepDescription",
            Description = "Description of what this step does",
            Type = typeof(string),
            IsOptional = true,
            Order = int.MaxValue
        });

        return new FunctionDefinition
        {
            Name = name,
            Description = description?.Description,
            Parameters = parameters,
            Method = methodInfo
        };
    }
}
```

**File**: `Microsoft.BusinessCentral.AI.Abstractions\FunctionParameter.cs`

```csharp
public class FunctionParameter
{
    public string Name { get; set; }
    public string Description { get; set; }
    public Type Type { get; set; }
    public string Schema { get; set; }  // Optional JSON schema
    public bool IsOptional { get; set; }
    public object DefaultValue { get; set; }
    public ParameterInfo ParameterInfo { get; set; }
    public int Order { get; set; }

    public static FunctionParameter Create(ParameterInfo paramInfo)
    {
        var description = paramInfo.GetCustomAttribute<DescriptionAttribute>();
        var schema = paramInfo.GetCustomAttribute<SchemaAttribute>();

        return new FunctionParameter
        {
            Name = paramInfo.Name,
            Description = description?.Description,
            Type = paramInfo.ParameterType,
            Schema = schema?.JsonSchema,
            IsOptional = paramInfo.IsOptional || paramInfo.HasDefaultValue,
            DefaultValue = paramInfo.DefaultValue,
            ParameterInfo = paramInfo,
            Order = GetParameterOrder(paramInfo)
        };
    }

    private static int GetParameterOrder(ParameterInfo paramInfo)
    {
        // "reason" parameter always first
        if (paramInfo.Name == "reason") return int.MinValue;
        // "stepDescription" always last
        if (paramInfo.Name == "stepDescription") return int.MaxValue;
        // Others by position
        return paramInfo.Position;
    }
}
```

### Function Invocation

**File**: `Microsoft.BusinessCentral.AI.Abstractions\FunctionInvokerBase.cs`

```csharp
public abstract class FunctionInvokerBase : IFunctionInvoker
{
    public async Task<IFunctionResult> InvokeAsync(
        IReadOnlyDictionary<string, object> arguments)
    {
        try
        {
            // Prepare arguments array
            var parameters = PrepareParameters(arguments);

            // Invoke method via reflection
            var result = Method.Invoke(Target, parameters);

            // Await if async
            if (result is Task<IFunctionResult> asyncResult)
            {
                return await asyncResult;
            }

            return (IFunctionResult)result;
        }
        catch (Exception ex)
        {
            return new FunctionResult
            {
                Success = false,
                Description = ex.Message,
                RequiresUserIntervention = true,
                InterventionReason = InterventionReason.Error
            };
        }
    }

    public IReadOnlyDictionary<string, object> ResolveArguments(
        string toolCallArguments)
    {
        // Deserialize from JSON
        var jsonDoc = JsonDocument.Parse(toolCallArguments);
        var dict = new Dictionary<string, object>();

        foreach (var property in jsonDoc.RootElement.EnumerateObject())
        {
            dict[property.Name] = ConvertJsonElement(property.Value);
        }

        return dict;
    }

    private object ConvertJsonElement(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number => element.TryGetInt32(out var i) ? i : element.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Array => element.EnumerateArray().Select(ConvertJsonElement).ToList(),
            JsonValueKind.Object => element.EnumerateObject().ToDictionary(p => p.Name, p => ConvertJsonElement(p.Value)),
            _ => null
        };
    }
}
```

### Client Context

**File**: `Microsoft.BusinessCentral.AI.Abstractions\Microsoft\BusinessCentral\AI\Abstractions\Context\ClientContextCore.cs`

```csharp
public class ClientContextCore
{
    public string ResumeQuery { get; set; }  // UI query to resume
    public int? PageId { get; set; }         // Current page ID
    public int? SourceTableId { get; set; }  // Table being viewed
    public string Bookmark { get; set; }     // Record position

    public static ClientContextCore FromJson(string json)
    {
        // Deserializes from camelCase JSON
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };
        return JsonSerializer.Deserialize<ClientContextCore>(json, options);
    }
}
```

---

## 3. Copilot Service Clients

### Agent Service Client

**File**: `Microsoft.BusinessCentral.CopilotService.AgentService.Client\CopilotAgentServiceClient.cs`

```csharp
public class CopilotAgentServiceClient
{
    private readonly HttpPipeline _pipeline;
    private readonly Uri _endpoint;

    public CopilotAgentServiceClient(
        Uri endpoint,
        TokenCredential credential,
        CopilotAgentServiceClientOptions options = null)
    {
        _endpoint = endpoint;

        // Create HTTP pipeline with auth
        _pipeline = HttpPipelineBuilder.Build(
            options ?? new CopilotAgentServiceClientOptions(),
            new BearerTokenAuthenticationPolicy(credential, scopes)
        );
    }

    public virtual async Task<Response<object>> BeginExecuteAgentTaskAsync(
        string tenantId,
        Guid agentUserId,
        long agentTaskId,
        CancellationToken cancellationToken = default)
    {
        using var scope = _clientDiagnostics.CreateScope("CopilotAgentServiceClient.BeginExecuteAgentTask");
        scope.Start();

        try
        {
            // Build request
            var message = _pipeline.CreateMessage();
            message.Request.Method = RequestMethod.Post;
            message.Request.Uri.Reset(_endpoint);
            message.Request.Uri.AppendPath($"/v1.0/tenants/{tenantId}/agents/{agentUserId}/tasks/{agentTaskId}/execute", false);

            // Send request
            await _pipeline.SendAsync(message, cancellationToken);

            // Parse response
            var response = message.Response;
            if (response.Status == 200 || response.Status == 202)
            {
                var document = JsonDocument.Parse(response.ContentStream);
                return Response.FromValue(document.RootElement, response);
            }

            throw new RequestFailedException(response);
        }
        catch (Exception e)
        {
            scope.Failed(e);
            throw;
        }
    }
}
```

### Orchestrator Client

**File**: `Microsoft.BusinessCentral.CopilotService.Orchestrator.Client\CopilotOrchestratorClient.cs`

```csharp
public class CopilotOrchestratorClient
{
    // Streaming chat interface
    public virtual async IAsyncEnumerable<AskResult> ChatStreamedParsedAsync(
        string entraTenantId,
        string runtimeEnvId,
        string userId,
        string serverSessionId,
        Ask body,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var message = CreateChatRequest(entraTenantId, runtimeEnvId, userId, serverSessionId, body);

        await foreach (var item in _pipeline.ProcessMessageAsync(message, cancellationToken))
        {
            yield return AskResult.DeserializeAskResult(item.GetRawText());
        }
    }

    // Single response chat
    public virtual async Task<Response<AskResult>> ChatAsync(
        string entraTenantId,
        string runtimeEnvId,
        string userId,
        string serverSessionId,
        Ask body,
        CancellationToken cancellationToken = default)
    {
        var message = CreateChatRequest(entraTenantId, runtimeEnvId, userId, serverSessionId, body);
        await _pipeline.SendAsync(message, cancellationToken);

        var document = JsonDocument.Parse(message.Response.ContentStream);
        var result = AskResult.DeserializeAskResult(document.RootElement);
        return Response.FromValue(result, message.Response);
    }

    // Session management
    public virtual async Task<Response<ChatSession>> CreateChatSessionAsync(
        ChatSession body,
        CancellationToken cancellationToken = default)
    {
        var message = _pipeline.CreateMessage();
        message.Request.Method = RequestMethod.Post;
        message.Request.Uri.AppendPath("/v1.0/sessions");
        message.Request.Content = RequestContent.Create(Serialize(body));

        await _pipeline.SendAsync(message, cancellationToken);
        var document = JsonDocument.Parse(message.Response.ContentStream);
        return Response.FromValue(ChatSession.DeserializeChatSession(document.RootElement), message.Response);
    }

    // Text completion
    public virtual async Task<Response<ComposeResult>> TextCompletionAsync(
        TextComposeRequest textComposeRequest,
        CancellationToken cancellationToken = default)
    {
        var message = CreateComposeRequest(textComposeRequest);
        await _pipeline.SendAsync(message, cancellationToken);

        var document = JsonDocument.Parse(message.Response.ContentStream);
        return Response.FromValue(ComposeResult.DeserializeComposeResult(document.RootElement), message.Response);
    }

    // Embeddings
    public virtual async Task<Response<ComposeResult>> EmbeddingAsync(
        EmbeddingComposeRequest embeddingComposeRequest,
        CancellationToken cancellationToken = default)
    {
        // Similar to TextCompletionAsync
    }
}
```

### Skill Engine Client

**File**: `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\CopilotSkillEngineClient.cs`

```csharp
public class CopilotSkillEngineClient
{
    // Field-level suggestions
    public virtual async Task<Response<AutofillResult>> GetPageSuggestionAsync(
        string entraTenantId,
        string runtimeEnvId,
        string principalId,
        string publisher,
        string alAppId,
        string capability,
        AutofillRequest body,
        string serverSessionId = null,
        CancellationToken cancellationToken = default)
    {
        using var scope = _clientDiagnostics.CreateScope("CopilotSkillEngineClient.GetPageSuggestion");
        scope.Start();

        try
        {
            var message = _pipeline.CreateMessage();
            message.Request.Method = RequestMethod.Post;
            message.Request.Uri.AppendPath(
                $"/v2.0/entraTenants/{entraTenantId}/environments/{runtimeEnvId}/principals/{principalId}/publishers/{publisher}/alApps/{alAppId}/capabilities/{capability}/autofill/suggest",
                false);

            if (serverSessionId != null)
            {
                message.Request.Headers.Add("server-session-id", serverSessionId);
            }

            message.Request.Headers.Add("Accept", "application/json");
            message.Request.Headers.Add("Content-Type", "application/json");
            message.Request.Content = RequestContent.Create(Serialize(body));

            await _pipeline.SendAsync(message, cancellationToken);

            if (message.Response.Status == 200)
            {
                var document = JsonDocument.Parse(message.Response.ContentStream);
                return Response.FromValue(AutofillResult.DeserializeAutofillResult(document.RootElement), message.Response);
            }

            throw new RequestFailedException(message.Response);
        }
        catch (Exception e)
        {
            scope.Failed(e);
            throw;
        }
    }

    // Page summarization
    public virtual async Task<Response<SummarizationResult>> GetPageSummaryAsync(
        string entraTenantId,
        string runtimeEnvId,
        string principalId,
        string publisher,
        string alAppId,
        string capability,
        int pageId,
        Guid systemId,
        bool regenerateSummary = false,
        CancellationToken cancellationToken = default)
    {
        var message = _pipeline.CreateMessage();
        message.Request.Method = RequestMethod.Get;
        message.Request.Uri.AppendPath(
            $"/v2.0/entraTenants/{entraTenantId}/environments/{runtimeEnvId}/principals/{principalId}/publishers/{publisher}/alApps/{alAppId}/capabilities/{capability}/summarize/{pageId}/{systemId}",
            false);
        message.Request.Uri.AppendQuery("regenerateSummary", regenerateSummary, true);

        await _pipeline.SendAsync(message, cancellationToken);
        var document = JsonDocument.Parse(message.Response.ContentStream);
        return Response.FromValue(SummarizationResult.DeserializeSummarizationResult(document.RootElement), message.Response);
    }

    // Document processing
    public virtual InvoiceProcessingOutputBatchScoreResponseAsyncPredictOperation InvoiceProcessingPredictAsync(
        FormsBinaryContentBatchScoreRequest body,
        CancellationToken cancellationToken = default)
    {
        // Long-running operation for invoice processing
        // Returns operation handle for polling
    }
}
```

---

## 4. Request/Response Data Structures

### Ask/AskResult (Orchestrator)

**File**: `Microsoft.BusinessCentral.CopilotService.Orchestrator.Client\Models\Ask.cs`

```csharp
public class Ask
{
    public string Input { get; set; }          // User query
    public List<Variable> Variables { get; set; }  // Context variables

    internal static void Write(Utf8JsonWriter writer, Ask model)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("input");
        writer.WriteStringValue(model.Input);

        if (model.Variables != null)
        {
            writer.WritePropertyName("variables");
            writer.WriteStartArray();
            foreach (var variable in model.Variables)
            {
                Variable.Write(writer, variable);
            }
            writer.WriteEndArray();
        }

        writer.WriteEndObject();
    }
}

public class Variable
{
    public string Key { get; set; }
    public object Value { get; set; }
}
```

**File**: `Microsoft.BusinessCentral.CopilotService.Orchestrator.Client\Models\AskResult.cs`

```csharp
public class AskResult
{
    public string Value { get; set; }          // Response text
    public List<Variable> Variables { get; set; }  // Output variables
    public ErrorDetails Error { get; set; }    // Error information
    public object Debug { get; set; }          // Diagnostic data

    internal static AskResult DeserializeAskResult(JsonElement element)
    {
        var result = new AskResult();

        foreach (var property in element.EnumerateObject())
        {
            if (property.NameEquals("value"))
            {
                result.Value = property.Value.GetString();
            }
            else if (property.NameEquals("variables"))
            {
                result.Variables = property.Value.EnumerateArray()
                    .Select(Variable.DeserializeVariable)
                    .ToList();
            }
            else if (property.NameEquals("error"))
            {
                result.Error = ErrorDetails.DeserializeErrorDetails(property.Value);
            }
            else if (property.NameEquals("debug"))
            {
                result.Debug = property.Value;
            }
        }

        return result;
    }
}
```

### AutofillRequest (Skill Engine)

**File**: `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\Models\AutofillRequest.cs`

This is THE KEY structure for describing pages to AI!

```csharp
public class AutofillRequest
{
    // Page metadata
    public PageData Page { get; set; }

    // System identifier for caching
    public Guid FieldsSystemId { get; set; }

    // UI structure (hierarchical)
    public List<ContainerData> Containers { get; set; }

    // All fields on the page
    public List<FieldData> Fields { get; set; }

    // Which fields need suggestions
    public List<string> FieldsToSuggest { get; set; }

    // Current field values
    public Dictionary<string, string> Data { get; set; }

    // Predictor models to use
    public List<string> PredictorNames { get; set; }

    // Additional configuration
    public AutofillConfiguration Configuration { get; set; }

    internal static void Write(Utf8JsonWriter writer, AutofillRequest model)
    {
        writer.WriteStartObject();

        writer.WritePropertyName("page");
        PageData.Write(writer, model.Page);

        writer.WritePropertyName("fieldsSystemId");
        writer.WriteStringValue(model.FieldsSystemId);

        if (model.Containers != null)
        {
            writer.WritePropertyName("containers");
            writer.WriteStartArray();
            foreach (var container in model.Containers)
            {
                ContainerData.Write(writer, container);
            }
            writer.WriteEndArray();
        }

        writer.WritePropertyName("fields");
        writer.WriteStartArray();
        foreach (var field in model.Fields)
        {
            FieldData.Write(writer, field);
        }
        writer.WriteEndArray();

        writer.WritePropertyName("fieldsToSuggest");
        writer.WriteStartArray();
        foreach (var fieldName in model.FieldsToSuggest)
        {
            writer.WriteStringValue(fieldName);
        }
        writer.WriteEndArray();

        if (model.Data != null)
        {
            writer.WritePropertyName("data");
            writer.WriteStartObject();
            foreach (var kvp in model.Data)
            {
                writer.WritePropertyName(kvp.Key);
                writer.WriteStringValue(kvp.Value);
            }
            writer.WriteEndObject();
        }

        // ... other properties

        writer.WriteEndObject();
    }
}
```

### PageData

**File**: `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\Models\PageData.cs`

```csharp
public class PageData
{
    public string Name { get; set; }         // Technical name (e.g., "Customer")
    public string Caption { get; set; }      // Display name (e.g., "Customer List")
    public int Id { get; set; }              // Page ID (e.g., 21)
    public string Description { get; set; }  // Page description

    internal static void Write(Utf8JsonWriter writer, PageData model)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("name");
        writer.WriteStringValue(model.Name);
        writer.WritePropertyName("caption");
        writer.WriteStringValue(model.Caption);
        writer.WritePropertyName("id");
        writer.WriteNumberValue(model.Id);
        if (model.Description != null)
        {
            writer.WritePropertyName("description");
            writer.WriteStringValue(model.Description);
        }
        writer.WriteEndObject();
    }
}
```

### ContainerData

**File**: `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\Models\ContainerData.cs`

```csharp
public class ContainerData
{
    public string Name { get; set; }            // Container name
    public string Caption { get; set; }         // Display caption
    public string Description { get; set; }     // Description
    public List<ContainerData> Containers { get; set; }  // Nested containers (recursive!)

    internal static void Write(Utf8JsonWriter writer, ContainerData model)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("name");
        writer.WriteStringValue(model.Name);
        writer.WritePropertyName("caption");
        writer.WriteStringValue(model.Caption);

        if (model.Description != null)
        {
            writer.WritePropertyName("description");
            writer.WriteStringValue(model.Description);
        }

        // Recursive containers
        if (model.Containers != null && model.Containers.Any())
        {
            writer.WritePropertyName("containers");
            writer.WriteStartArray();
            foreach (var container in model.Containers)
            {
                Write(writer, container);  // Recursive!
            }
            writer.WriteEndArray();
        }

        writer.WriteEndObject();
    }
}
```

### FieldData - THE MOST IMPORTANT STRUCTURE!

**File**: `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\Models\FieldData.cs`

```csharp
public class FieldData
{
    // Identity
    public string Name { get; set; }           // Field name (e.g., "No_")
    public string ContainerName { get; set; }  // Parent container
    public string Caption { get; set; }        // Display caption (e.g., "No.")

    // Documentation
    public string Description { get; set; }    // Field description
    public string TeachingTip { get; set; }    // Tooltip text

    // Current Value
    public string Value { get; set; }          // Current field value

    // Data Type
    public int Length { get; set; }            // Max length for text/code
    public string DataType { get; set; }       // "Text", "Code", "Integer", "Decimal", "Date", etc.
    public string ExtendedDataType { get; set; }  // Semantic type (e.g., "Email", "URL", "Phone")

    // Options
    public List<string> OptionValues { get; set; }         // For option fields
    public List<string> SelectionValues { get; set; }       // Lookup values
    public List<string> SelectionDescriptions { get; set; } // Lookup descriptions

    // Metadata
    public int TableFieldId { get; set; }      // Field ID in table
    public bool ValidateTableRelation { get; set; }  // Has table relation validation
    public bool HasLookup { get; set; }        // Has lookup page

    internal static void Write(Utf8JsonWriter writer, FieldData model)
    {
        writer.WriteStartObject();

        // Identity
        writer.WritePropertyName("name");
        writer.WriteStringValue(model.Name);

        if (model.ContainerName != null)
        {
            writer.WritePropertyName("containerName");
            writer.WriteStringValue(model.ContainerName);
        }

        writer.WritePropertyName("caption");
        writer.WriteStringValue(model.Caption);

        // Documentation
        if (model.Description != null)
        {
            writer.WritePropertyName("description");
            writer.WriteStringValue(model.Description);
        }

        if (model.TeachingTip != null)
        {
            writer.WritePropertyName("teachingTip");
            writer.WriteStringValue(model.TeachingTip);
        }

        // Value
        if (model.Value != null)
        {
            writer.WritePropertyName("value");
            writer.WriteStringValue(model.Value);
        }

        // Data Type
        writer.WritePropertyName("length");
        writer.WriteNumberValue(model.Length);

        writer.WritePropertyName("dataType");
        writer.WriteStringValue(model.DataType);

        if (model.ExtendedDataType != null)
        {
            writer.WritePropertyName("extendedDataType");
            writer.WriteStringValue(model.ExtendedDataType);
        }

        // Options
        if (model.OptionValues != null && model.OptionValues.Any())
        {
            writer.WritePropertyName("optionValues");
            writer.WriteStartArray();
            foreach (var option in model.OptionValues)
            {
                writer.WriteStringValue(option);
            }
            writer.WriteEndArray();
        }

        // Metadata
        writer.WritePropertyName("tableFieldId");
        writer.WriteNumberValue(model.TableFieldId);

        writer.WritePropertyName("validateTableRelation");
        writer.WriteBooleanValue(model.ValidateTableRelation);

        writer.WritePropertyName("hasLookup");
        writer.WriteBooleanValue(model.HasLookup);

        // ... other properties

        writer.WriteEndObject();
    }
}
```

### AutofillResult

**File**: `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\Models\AutofillResult.cs`

```csharp
public class AutofillResult
{
    public List<AutofillFieldSuggestion> Suggestions { get; set; }
    public List<AutofillFieldSuggestion> OtherSuggestions { get; set; }
    public Dictionary<string, object> PredictorsCache { get; set; }
    public DiagnosticDataProvider DiagnosticData { get; set; }
}

public class AutofillFieldSuggestion
{
    public string FieldName { get; set; }
    public string SuggestedValue { get; set; }
    public double Confidence { get; set; }
    public string Explanation { get; set; }
}
```

---

## 5. Complete Integration Flow

### How BC Describes a Page to AI (Example: Customer Card)

```json
{
  "page": {
    "name": "Customer",
    "caption": "Customer Card",
    "id": 21,
    "description": "View and edit detailed information about a customer"
  },
  "fieldsSystemId": "12345678-1234-1234-1234-123456789abc",
  "containers": [
    {
      "name": "General",
      "caption": "General",
      "description": "Basic customer information",
      "containers": []
    },
    {
      "name": "Communication",
      "caption": "Communication",
      "description": "Contact details",
      "containers": []
    }
  ],
  "fields": [
    {
      "name": "No_",
      "containerName": "General",
      "caption": "No.",
      "description": "Unique customer identifier",
      "teachingTip": "Enter a unique number to identify the customer",
      "value": "CUST-001",
      "length": 20,
      "dataType": "Code",
      "extendedDataType": "CustomerNumber",
      "optionValues": [],
      "tableFieldId": 1,
      "validateTableRelation": false,
      "hasLookup": false,
      "selectionValues": [],
      "selectionDescriptions": []
    },
    {
      "name": "Name",
      "containerName": "General",
      "caption": "Name",
      "description": "Customer name",
      "teachingTip": "Enter the customer's full name",
      "value": "Acme Corporation",
      "length": 100,
      "dataType": "Text",
      "extendedDataType": null,
      "optionValues": [],
      "tableFieldId": 2,
      "validateTableRelation": false,
      "hasLookup": false,
      "selectionValues": [],
      "selectionDescriptions": []
    },
    {
      "name": "E_Mail",
      "containerName": "Communication",
      "caption": "Email",
      "description": "Customer email address",
      "teachingTip": "Enter the primary email address for this customer",
      "value": "contact@acme.com",
      "length": 80,
      "dataType": "Text",
      "extendedDataType": "Email",
      "optionValues": [],
      "tableFieldId": 102,
      "validateTableRelation": false,
      "hasLookup": false,
      "selectionValues": [],
      "selectionDescriptions": []
    },
    {
      "name": "Customer_Posting_Group",
      "containerName": "General",
      "caption": "Customer Posting Group",
      "description": "Specifies the posting group for this customer",
      "teachingTip": "Select the posting group that defines how transactions are posted",
      "value": "DOMESTIC",
      "length": 20,
      "dataType": "Code",
      "extendedDataType": null,
      "optionValues": [],
      "tableFieldId": 21,
      "validateTableRelation": true,
      "hasLookup": true,
      "selectionValues": ["DOMESTIC", "FOREIGN", "EU"],
      "selectionDescriptions": ["Domestic customers", "Foreign customers", "EU customers"]
    }
  ],
  "fieldsToSuggest": ["Name", "E_Mail"],
  "data": {
    "No_": "CUST-001",
    "Name": "Acme Corporation",
    "E_Mail": "contact@acme.com",
    "Customer_Posting_Group": "DOMESTIC"
  },
  "predictorNames": ["CustomerNamePredictor", "EmailPredictor"],
  "configuration": {}
}
```

### The Complete Flow

```
1. User opens Customer Card (Page 21)
   ↓
2. BC Web Client constructs AutofillRequest
   - Gathers page metadata
   - Lists all containers (FastTabs, groups)
   - Lists all fields with full metadata
   - Includes current field values
   ↓
3. Serializes to JSON via System.Text.Json
   ↓
4. Sends to CopilotSkillEngineClient.GetPageSuggestionAsync()
   POST /v2.0/entraTenants/{tenant}/environments/{env}/principals/{user}/...
        /publishers/{publisher}/alApps/{appId}/capabilities/{capability}/autofill/suggest
   ↓
5. Skill Engine processes request
   - Analyzes page structure
   - Considers field types and current values
   - Applies predictor models
   ↓
6. Returns AutofillResult
   {
     "suggestions": [
       {
         "fieldName": "Name",
         "suggestedValue": "Acme Corporation Inc.",
         "confidence": 0.92,
         "explanation": "Based on company registration data"
       },
       {
         "fieldName": "E_Mail",
         "suggestedValue": "info@acmecorp.com",
         "confidence": 0.85,
         "explanation": "Common email pattern for this company"
       }
     ]
   }
   ↓
7. BC displays suggestions to user
```

---

## 6. Key Patterns & Best Practices

### Pattern 1: Hierarchical Page Structure

BC uses recursive ContainerData to represent UI hierarchy:
- Page → Containers → Sub-containers → Fields
- Preserves FastTab structure, groups, repeaters
- Helps AI understand field organization

### Pattern 2: Rich Field Metadata

Every field includes:
- **Identity**: Name, Caption, Container
- **Documentation**: Description, TeachingTip
- **Type**: DataType, ExtendedDataType, Length
- **Validation**: ValidateTableRelation, HasLookup
- **Options**: OptionValues, SelectionValues
- **Current State**: Value

### Pattern 3: Extended Data Types

BC uses ExtendedDataType for semantic understanding:
- "Email" → AI knows format
- "URL" → AI knows structure
- "Phone" → AI knows pattern
- "CustomerNumber" → AI knows uniqueness

### Pattern 4: Selection Values

Fields with table relations include:
- SelectionValues: Actual values (["DOMESTIC", "FOREIGN"])
- SelectionDescriptions: Human descriptions (["Domestic customers", "Foreign customers"])

### Pattern 5: Confidence Scoring

AI suggestions include confidence scores (0.0-1.0):
- 0.9-1.0: Very confident
- 0.7-0.9: Confident
- 0.5-0.7: Possible
- <0.5: Uncertain

### Pattern 6: Diagnostic Data

All responses include DiagnosticDataProvider:
- Execution time
- Model versions used
- Cache hit/miss
- Error details

---

## 7. Implementation Recommendations for MCP Server

### Use BC's Exact Data Structures

**DO THIS**:
```typescript
interface PageMetadata {
  page: {
    name: string;
    caption: string;
    id: number;
    description: string;
  };
  containers: ContainerData[];
  fields: FieldData[];
}

interface FieldData {
  name: string;
  containerName: string;
  caption: string;
  description: string;
  teachingTip: string;
  value: string;
  length: number;
  dataType: string;
  extendedDataType: string;
  optionValues: string[];
  tableFieldId: number;
  validateTableRelation: boolean;
  hasLookup: boolean;
  selectionValues: string[];
  selectionDescriptions: string[];
}
```

**NOT THIS**:
```typescript
// Too simplified - loses critical metadata
interface Field {
  name: string;
  type: string;
  value: string;
}
```

### Follow BC's JSON Naming

BC uses **camelCase** for JSON serialization:
- Property names: `fieldName`, `dataType`, `containerName`
- Nested objects: `page.caption`, `fields[0].teachingTip`

### Include All Metadata

Don't omit fields! AI needs:
- TeachingTips for context
- Descriptions for understanding
- ExtendedDataTypes for semantic meaning
- SelectionValues for validation
- OptionValues for enums

### Use Hierarchical Containers

Preserve UI structure:
```json
{
  "containers": [
    {
      "name": "General",
      "caption": "General",
      "containers": [
        {
          "name": "CustomerInfo",
          "caption": "Customer Information",
          "containers": []
        }
      ]
    }
  ]
}
```

### Include Current Values

Always send current field values in `data` dictionary:
```json
{
  "data": {
    "No_": "CUST-001",
    "Name": "Acme Corp",
    "Balance": "15000.00"
  }
}
```

---

## 8. Critical Files Reference

### JSON-RPC (6 files):
- `Microsoft.Dynamics.Nav.ClientServer.JsonRpc\ClientServerJsonRpc.cs` - Core JSON-RPC
- `Microsoft.Dynamics.Nav.ClientServer.JsonRpc\JsonRpcWebSocketConnection.cs` - WebSocket wrapper
- `Microsoft.Dynamics.Nav.ClientServer.JsonRpc\NavDataSetConverter.cs` - Data serialization
- `Microsoft.Dynamics.Nav.ClientServer.JsonRpc\SharedJsonSettings.cs` - JSON config
- `Microsoft.Dynamics.Nav.ClientServer.JsonRpc\IJsonRpcMessageInspector.cs` - Message hooks
- `Microsoft.Dynamics.Nav.ClientServer.JsonRpc\AssemblyInfo.cs` - v26.0.0.0

### AI Abstractions (21 files):
- `Microsoft.BusinessCentral.AI.Abstractions\IFunctionResult.cs` - Operation result
- `Microsoft.BusinessCentral.AI.Abstractions\IFunctionInvoker.cs` - Invocation
- `Microsoft.BusinessCentral.AI.Abstractions\FunctionDefinition.cs` - Metadata
- `Microsoft.BusinessCentral.AI.Abstractions\FunctionInvokerBase.cs` - Base invoker
- `Microsoft.BusinessCentral.AI.Abstractions\FunctionParameter.cs` - Parameter metadata
- `Microsoft.BusinessCentral.AI.Abstractions\PageDetails.cs` - Page info
- `Microsoft.BusinessCentral.AI.Abstractions\Microsoft\BusinessCentral\AI\Abstractions\Context\ClientContextCore.cs` - Navigation context
- Plus 14 more supporting files

### Skill Engine Client (63+ files):
- `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\CopilotSkillEngineClient.cs` - Main client
- `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\Models\AutofillRequest.cs` - **CRITICAL**
- `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\Models\AutofillResult.cs` - **CRITICAL**
- `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\Models\PageData.cs` - **CRITICAL**
- `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\Models\ContainerData.cs` - **CRITICAL**
- `Microsoft.BusinessCentral.CopilotService.SkillEngine.Client\Models\FieldData.cs` - **CRITICAL**
- Plus 57 more supporting files

---

## 9. Conclusion

**BC's Copilot implementation provides the EXACT blueprint for our MCP server!**

Key takeaways:
1. ✅ Use JSON-RPC 2.0 over WebSocket (we already do this!)
2. ✅ Structure page metadata exactly like AutofillRequest (PageData + ContainerData + FieldData)
3. ✅ Include ALL field metadata (don't simplify!)
4. ✅ Use hierarchical containers for UI structure
5. ✅ Provide current values in data dictionary
6. ✅ Use camelCase JSON naming convention
7. ✅ Include diagnostic data for debugging

**Next Step**: Implement TypeScript interfaces matching BC's exact data structures, then build parser to extract this from BC's WebSocket responses!
