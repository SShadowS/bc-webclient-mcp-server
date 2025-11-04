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
  readonly recordSelector?: {
    systemId?: string;
    keys?: Record<string, unknown>;
    useCurrent?: boolean;
  };
  readonly fields: Record<string, unknown>;
  readonly save?: boolean; // Default: false
  readonly autoEdit?: boolean; // Auto-switch to edit mode if needed
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
  readonly pageContextId?: string; // Optional: reuse existing page context
  readonly dialogId?: string; // Optional: specific dialog ID if known
  readonly match?: {
    titleContains?: string;
    exactTitle?: string;
  };
  readonly fieldValues?: Record<string, string | number | boolean>;
  readonly action: string;
  readonly wait?: 'appear' | 'existing'; // Wait for dialog to appear or assume existing
  readonly timeoutMs?: number;
}

export interface UpdateRecordInput {
  readonly pageId?: string; // Optional if pageContextId provided
  readonly pageContextId?: string; // Optional: reuse existing page context
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

export interface ReadPageDataOutput {
  readonly pageId: string;
  readonly pageContextId: string; // Current page context (opaque - do not parse)
  readonly caption: string;
  readonly pageType: 'Card' | 'List';
  readonly records: readonly PageDataRecord[];
  readonly totalCount: number;
  readonly hasMore?: boolean;
  readonly currentRecord?: PageDataRecord; // If setCurrent was used
}

export interface PageDataRecord {
  readonly bookmark?: string;
  readonly fields: Record<string, PageFieldValue>;
}

export interface PageFieldValue {
  readonly value: string | number | boolean | null;
  readonly displayValue?: string;
  readonly type: 'string' | 'number' | 'boolean' | 'date';
}

export interface WritePageDataOutput {
  readonly success: boolean;
  readonly pageContextId: string; // Current page context (opaque - do not parse)
  readonly record?: PageDataRecord; // Updated record if save=true
  readonly saved: boolean; // Whether changes were saved
  readonly message?: string;
  readonly updatedFields?: string[];
  readonly failedFields?: string[];
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
  readonly pageContextId?: string; // If dialog was on a page
  readonly result: 'Closed' | 'Navigated' | 'DialogOpened';
  readonly action: string;
  readonly fieldsSet?: readonly string[];
  readonly navigation?: {
    pageContextId: string;
    pageId: string;
    caption: string;
  };
  readonly validationMessages?: readonly string[];
  readonly message?: string;
}

export interface UpdateRecordOutput {
  readonly success: boolean;
  readonly pageContextId: string; // Current page context
  readonly pageId: string;
  readonly record?: PageDataRecord; // Updated record
  readonly saved: boolean; // Whether changes were saved
  readonly updatedFields?: readonly string[];
  readonly failedFields?: readonly string[];
  readonly message?: string;
}

export interface CreateRecordOutput {
  readonly success: boolean;
  readonly pageContextId: string; // Current page context with new record
  readonly pageId: string;
  readonly record?: PageDataRecord; // Created record with systemId
  readonly saved: boolean; // Whether record was saved
  readonly setFields?: readonly string[];
  readonly failedFields?: readonly string[];
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
