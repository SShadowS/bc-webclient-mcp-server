/**
 * Model Context Protocol (MCP) Types
 *
 * Type definitions for MCP tools, resources, and protocol interactions.
 * These types define how the BC MCP server exposes capabilities to Claude.
 */

// ============================================================================
// MCP Tool Types
// ============================================================================

export interface MCPToolParameter {
  readonly type: string;
  readonly description: string;
  readonly required?: boolean;
  readonly enum?: readonly string[];
  readonly items?: MCPToolParameter;
  readonly properties?: Record<string, MCPToolParameter>;
}

export interface MCPToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, MCPToolParameter>;
    readonly required?: readonly string[];
  };
}

export interface MCPToolRequest {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface MCPToolResponse {
  readonly content: readonly MCPContent[];
  readonly isError?: boolean;
}

export interface MCPContent {
  readonly type: 'text' | 'image' | 'resource';
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

// ============================================================================
// MCP Resource Types
// ============================================================================

export interface MCPResource {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

export interface MCPResourceRequest {
  readonly uri: string;
}

export interface MCPResourceResponse {
  readonly contents: readonly MCPResourceContent[];
}

export interface MCPResourceContent {
  readonly uri: string;
  readonly mimeType: string;
  readonly text?: string;
  readonly blob?: string;
}

// ============================================================================
// BC-Specific MCP Tool Inputs
// ============================================================================

export interface SearchPagesInput {
  readonly query: string;
  readonly limit?: number;
  readonly type?: 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report';
}

export interface GetPageMetadataInput {
  readonly pageId: string | number;
  readonly pageContextId?: string; // Optional: reuse existing page context (opaque - do not parse)
}

export interface ReadPageDataInput {
  readonly pageContextId: string; // Required: must have open page
  readonly filters?: Record<string, unknown>;
  readonly setCurrent?: boolean; // Set found record as current
  readonly limit?: number;
  readonly offset?: number;
}

export interface WritePageDataInput {
  readonly pageContextId: string; // Required: must have open page
  readonly fields: Record<string, { value: unknown; controlPath?: string }>;
  readonly stopOnError?: boolean; // Stop on first validation error (default: true)
  readonly immediateValidation?: boolean; // Parse handlers for validation errors (default: true)
}

export interface ExecuteActionInput {
  readonly pageContextId: string; // Required: must have open page
  readonly action: string | { actionId?: string; captionPath?: string };
  readonly target?: { partId?: string }; // For subpage actions
  readonly recordSelector?: {
    systemId?: string;
    keys?: Record<string, unknown>;
    useCurrent?: boolean;
  };
  readonly expectDialog?: boolean;
  readonly waitForDialogMs?: number;
}

export interface FilterListInput {
  readonly pageContextId: string; // Required: must have open page context
  readonly columnName: string;
  readonly filterValue?: string;
}

export interface HandleDialogInput {
  readonly pageContextId: string; // Required: page context to identify session
  readonly selection?: {
    bookmark?: string; // Currently only bookmark is supported (rowNumber/rowFilter reserved for future)
    rowNumber?: number; // Reserved for future implementation
    rowFilter?: Record<string, any>; // Reserved for future implementation
  };
  readonly action: string; // "OK" or "Cancel"
  readonly wait?: 'appear' | 'existing'; // Wait for dialog to appear or assume existing
  readonly timeoutMs?: number; // Timeout in milliseconds for wait="appear" (default: 5000)
  readonly workflowId?: string; // Optional: workflow ID for tracking dialog interactions
}

export interface UpdateRecordInput {
  readonly pageId?: string; // Optional if pageContextId provided
  readonly pageContextId?: string; // Optional: reuse existing page context to skip opening
  readonly recordSelector?: {
    systemId?: string;
    keys?: Record<string, unknown>;
    useCurrent?: boolean;
  };
  readonly fields: Record<string, unknown>;
  readonly autoEdit?: boolean; // Default: true
  readonly save?: boolean; // Default: true
}

export interface CreateRecordInput {
  readonly pageId?: string; // Optional if pageContextId provided
  readonly pageContextId?: string; // Optional: reuse existing page context
  readonly fields: Record<string, unknown>;
  readonly autoOpen?: boolean; // Default: true
  readonly save?: boolean; // Default: true
}

export interface FindRecordInput {
  readonly pageContextId: string; // Required: must have open page context
  readonly filter: string; // Filter expression
  readonly setCurrent?: boolean; // Default: true
  readonly requireUnique?: boolean; // Default: true
}

// ============================================================================
// BC-Specific MCP Tool Outputs
// ============================================================================

export interface SearchPagesOutput {
  readonly pages: readonly PageSearchResult[];
  readonly totalCount: number;
}

export interface PageSearchResult {
  readonly pageId: string;
  readonly caption: string;
  readonly type: string;
  readonly appName?: string;
}

export interface GetPageMetadataOutput {
  readonly pageId: string;
  readonly pageContextId: string; // Unique identifier for this page instance (opaque - do not parse)
  readonly caption: string;
  readonly description: string;
  readonly pageType: 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report';
  readonly fields: readonly FieldDescription[];
  readonly actions: readonly ActionDescription[];
  readonly repeaters: readonly RepeaterDescription[]; // Subpages/repeaters from main + child forms
}

export interface RepeaterDescription {
  readonly name: string;
  readonly caption: string;
  readonly controlPath: string;
  readonly formId: string; // Source form ID for routing subpage operations
  readonly columns: readonly RepeaterColumnDescription[];
}

/**
 * Repeater column metadata.
 *
 * Note: Columns may be progressively enriched as BC sends 'rcc' (Repeater Column Control)
 * messages during grid realization (e.g., when Lines/Edit actions are invoked or data is read).
 * Initial metadata from OpenForm/LoadForm may have empty columns array.
 */
export interface RepeaterColumnDescription {
  readonly name: string; // DesignName from rcc
  readonly caption: string;
  readonly controlPath?: string;
  readonly columnBinder?: string; // ColumnBinder.Name from rcc - used for data binding
  readonly editable?: boolean; // Whether the column is editable
  readonly tableEditable?: boolean; // Whether editable in table view
  readonly horizontalAlignment?: 'Left' | 'Right' | 'Center'; // From Formatter
  readonly controlIdentifier?: string; // Unique ID from BC
}

export interface FieldDescription {
  readonly name: string;
  readonly caption: string;
  readonly type: string;
  readonly required: boolean;
  readonly editable: boolean;
}

export interface ActionDescription {
  readonly name: string;
  readonly caption: string;
  readonly enabled: boolean;
  readonly description?: string;
}

export interface DocumentLinesBlock {
  readonly repeaterPath: string;
  readonly caption: string;
  readonly lines: readonly PageDataRecord[];
  readonly totalCount: number;
}

export interface ReadPageDataOutput {
  readonly pageId: string;
  readonly pageContextId: string; // Current page context (opaque - do not parse)
  readonly caption: string;
  readonly pageType: 'Card' | 'List' | 'Document';
  readonly records: readonly PageDataRecord[];
  readonly totalCount: number;
  readonly hasMore?: boolean;
  readonly currentRecord?: PageDataRecord; // If setCurrent was used
  // Document page specific fields
  readonly header?: PageDataRecord; // For Document pages: the header record
  readonly linesBlocks?: readonly DocumentLinesBlock[]; // For Document pages: line item blocks
}

export interface PageDataRecord {
  readonly bookmark?: string;
  readonly [key: string]: string | number | boolean | null | undefined;
}

export interface PageFieldValue {
  readonly value: string | number | boolean | null;
  readonly displayValue?: string;
  readonly type: 'string' | 'number' | 'boolean' | 'date';
}

export interface WritePageDataOutput {
  readonly success: boolean;
  readonly pageContextId: string; // Current page context (opaque - do not parse)
  readonly record?: PageDataRecord; // Updated record if caller invokes Save
  readonly saved: boolean; // Whether changes were saved (always false for this low-level tool)
  readonly message?: string;
  readonly updatedFields?: string[];
  readonly failedFields?: Array<{ field: string; error: string; validationMessage?: string }>; // Structured validation errors
}

export interface ExecuteActionOutput {
  readonly success: boolean;
  readonly pageContextId: string; // Current page context (opaque - do not parse)
  readonly message?: string;
  readonly result?: 'Closed' | 'Navigated' | 'DialogOpened' | 'ActionExecuted';
  readonly navigation?: {
    pageContextId: string; // New page context if navigated (opaque - do not parse)
    pageId: string;
    caption: string;
  };
  readonly dialog?: {
    dialogId: string;
    title: string;
  };
}

export interface FilterListOutput {
  readonly success: boolean;
  readonly pageContextId: string; // Current page context
  readonly pageId: string;
  readonly columnName: string;
  readonly filterValue?: string;
  readonly message?: string;
  readonly availableColumns?: readonly string[];
}

export interface HandleDialogOutput {
  readonly success: boolean;
  readonly pageContextId: string; // Page context where dialog appeared
  readonly sessionId: string; // BC session ID
  readonly dialogId: string; // Dialog form ID (ServerId)
  readonly result: 'Closed'; // v1: Always 'Closed' (navigation/validation detection reserved for future)
  readonly action: string; // "OK" or "Cancel"
  readonly selectedBookmark?: string; // Bookmark of selected row (if selection was provided)
  readonly message?: string; // Human-readable result message
}

export interface UpdateRecordOutput {
  readonly success: boolean;
  readonly pageContextId: string; // Current page context
  readonly pageId: string;
  readonly record?: PageDataRecord; // Updated record
  readonly saved: boolean; // Whether changes were saved
  readonly updatedFields?: readonly string[];
  readonly failedFields?: ReadonlyArray<{ field: string; error: string; validationMessage?: string }>; // Structured validation errors
  readonly message?: string;
}

export interface CreateRecordOutput {
  readonly success: boolean;
  readonly pageContextId: string; // Current page context with new record
  readonly pageId: string;
  readonly record?: PageDataRecord; // Created record with systemId
  readonly saved: boolean; // Whether record was saved
  readonly setFields?: readonly string[];
  readonly failedFields?: ReadonlyArray<{ field: string; error: string; validationMessage?: string }>; // Structured validation errors
  readonly message?: string;
}

export interface FindRecordOutput {
  readonly success: boolean;
  readonly pageContextId: string; // Current page context
  readonly pageId: string;
  readonly record?: PageDataRecord; // Found record (if requireUnique=true)
  readonly records?: readonly PageDataRecord[]; // All matches (if requireUnique=false)
  readonly totalMatches?: number;
  readonly message?: string;
}

// ============================================================================
// MCP Server Configuration
// ============================================================================

export interface MCPServerConfig {
  readonly name: string;
  readonly version: string;
  readonly capabilities: {
    readonly tools: boolean;
    readonly resources: boolean;
    readonly prompts?: boolean;
  };
}

export interface MCPServerInfo {
  readonly name: string;
  readonly version: string;
}

// ============================================================================
// MCP Protocol Messages
// ============================================================================

export interface MCPInitializeRequest {
  readonly protocolVersion: string;
  readonly clientInfo: {
    readonly name: string;
    readonly version: string;
  };
  readonly capabilities: {
    readonly tools?: boolean;
    readonly resources?: boolean;
  };
}

export interface MCPInitializeResponse {
  readonly protocolVersion: string;
  readonly serverInfo: MCPServerInfo;
  readonly capabilities: MCPServerConfig['capabilities'];
}

export interface MCPToolsListRequest {
  readonly method: 'tools/list';
}

export interface MCPToolsListResponse {
  readonly tools: readonly MCPToolDefinition[];
}

export interface MCPToolCallRequest {
  readonly method: 'tools/call';
  readonly params: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
}

export interface MCPToolCallResponse {
  readonly content: readonly MCPContent[];
  readonly isError?: boolean;
}

export interface MCPResourcesListRequest {
  readonly method: 'resources/list';
}

export interface MCPResourcesListResponse {
  readonly resources: readonly MCPResource[];
}

export interface MCPResourcesReadRequest {
  readonly method: 'resources/read';
  readonly params: {
    readonly uri: string;
  };
}

export interface MCPResourcesReadResponse {
  readonly contents: readonly MCPResourceContent[];
}
