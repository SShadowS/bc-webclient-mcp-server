/**
 * MCP Server Implementation
 *
 * Implements the Model Context Protocol server for Business Central integration.
 * Handles JSON-RPC 2.0 communication over stdio with Claude Desktop.
 *
 * Features:
 * - Tool registration and execution
 * - Resource registration and serving
 * - Initialize/shutdown lifecycle
 * - Error handling and logging
 * - Protocol compliance
 */

import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { InternalError } from '../core/errors.js';
import type { IMCPServer, IMCPTool, IMCPResource, ILogger } from '../core/interfaces.js';
import { PageContextCache } from './page-context-cache.js';

// ============================================================================
// MCP Protocol Types
// ============================================================================

/**
 * JSON-RPC 2.0 request from client.
 */
export interface JSONRPCRequest {
  readonly jsonrpc: '2.0';
  readonly id?: string | number;
  readonly method: string;
  readonly params?: unknown;
}

/**
 * JSON-RPC 2.0 response to client.
 */
export interface JSONRPCResponse {
  readonly jsonrpc: '2.0';
  readonly id?: string | number;
  readonly result?: unknown;
  readonly error?: JSONRPCError;
}

/**
 * JSON-RPC 2.0 error.
 */
export interface JSONRPCError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/**
 * MCP initialize request parameters.
 */
export interface InitializeParams {
  readonly protocolVersion: string;
  readonly capabilities: {
    readonly tools?: Record<string, unknown>;
    readonly resources?: Record<string, unknown>;
  };
  readonly clientInfo: {
    readonly name: string;
    readonly version: string;
  };
}

/**
 * MCP initialize result.
 */
export interface InitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: {
    readonly tools?: Record<string, unknown>;
    readonly resources?: Record<string, unknown>;
  };
  readonly serverInfo: {
    readonly name: string;
    readonly version: string;
  };
}

/**
 * MCP tool call parameters.
 */
export interface ToolCallParams {
  readonly name: string;
  readonly arguments?: unknown;
}

/**
 * Tool list item for MCP protocol.
 */
export interface ToolListItem {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly annotations?: {
    readonly requiresConsent?: boolean;
    readonly consentPrompt?: string;
    readonly sensitivityLevel?: 'low' | 'medium' | 'high';
  };
}

/**
 * Resource list item for MCP protocol.
 */
export interface ResourceListItem {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

// ============================================================================
// MCP Server Implementation
// ============================================================================

/**
 * MCP Server for Business Central.
 *
 * Implements the Model Context Protocol server specification.
 * Communicates with Claude Desktop via JSON-RPC 2.0 over stdio.
 */
export class MCPServer implements IMCPServer {
  private readonly tools: Map<string, IMCPTool> = new Map();
  private readonly resources: Map<string, IMCPResource> = new Map();
  private initialized = false;
  private running = false;
  private clientInfo: { name: string; version: string } | undefined;

  public constructor(
    private readonly logger?: ILogger
  ) {}

  /**
   * Initializes the server.
   * Must be called before start().
   */
  public async initialize(): Promise<Result<void, BCError>> {
    try {
      if (this.initialized) {
        return err(
          new InternalError(
            'Server already initialized',
            { state: 'initialized', code: 'ALREADY_INITIALIZED' }
          )
        );
      }

      this.logger?.info('Initializing MCP server', {
        tools: this.tools.size,
        resources: this.resources.size,
      });

      this.initialized = true;

      this.logger?.info('MCP server initialized successfully');

      return ok(undefined);
    } catch (error) {
      return err(
        new InternalError(
          'Failed to initialize server',
          { code: 'INITIALIZATION_FAILED', error: String(error) }
        )
      );
    }
  }

  /**
   * Registers a tool with the server.
   * Tools can be registered before or after initialization.
   */
  public registerTool(tool: IMCPTool): void {
    if (this.tools.has(tool.name)) {
      this.logger?.warn('Tool already registered, overwriting', {
        toolName: tool.name,
      });
    }

    this.tools.set(tool.name, tool);

    this.logger?.debug('Tool registered', {
      toolName: tool.name,
      description: tool.description,
    });
  }

  /**
   * Registers a resource with the server.
   * Resources can be registered before or after initialization.
   */
  public registerResource(resource: IMCPResource): void {
    if (this.resources.has(resource.uri)) {
      this.logger?.warn('Resource already registered, overwriting', {
        resourceUri: resource.uri,
      });
    }

    this.resources.set(resource.uri, resource);

    this.logger?.debug('Resource registered', {
      resourceUri: resource.uri,
      resourceName: resource.name,
    });
  }

  /**
   * Starts the server.
   * Begins listening for JSON-RPC requests on stdin.
   */
  public async start(): Promise<Result<void, BCError>> {
    try {
      if (!this.initialized) {
        return err(
          new InternalError(
            'Server not initialized',
            { code: 'NOT_INITIALIZED', state: 'not_initialized' }
          )
        );
      }

      if (this.running) {
        return err(
          new InternalError(
            'Server already running',
            { code: 'ALREADY_RUNNING', state: 'running' }
          )
        );
      }

      this.logger?.info('Starting MCP server', {
        tools: this.tools.size,
        resources: this.resources.size,
      });

      // 💾 Initialize persistent pageContext cache
      try {
        const cache = PageContextCache.getInstance();
        await cache.initialize();
        this.logger?.info('✓ PageContext cache initialized');
      } catch (error) {
        this.logger?.error(`Failed to initialize PageContext cache: ${error}`);
        // Non-fatal: continue without persistent cache
      }

      this.running = true;

      // Note: Actual stdio processing handled by stdio-transport.ts
      // This method just marks the server as running

      this.logger?.info('MCP server started successfully');

      return ok(undefined);
    } catch (error) {
      return err(
        new InternalError(
          'Failed to start server',
          { code: 'START_FAILED', error: String(error) }
        )
      );
    }
  }

  /**
   * Stops the server gracefully.
   * Closes all connections and cleans up resources.
   */
  public async stop(): Promise<Result<void, BCError>> {
    try {
      if (!this.running) {
        return err(
          new InternalError(
            'Server not running',
            { code: 'NOT_RUNNING', state: 'stopped' }
          )
        );
      }

      this.logger?.info('Stopping MCP server');

      this.running = false;

      this.logger?.info('MCP server stopped successfully');

      return ok(undefined);
    } catch (error) {
      return err(
        new InternalError(
          'Failed to stop server',
          { code: 'STOP_FAILED', error: String(error) }
        )
      );
    }
  }

  /**
   * Gets all registered tools.
   */
  public getTools(): readonly IMCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Gets all registered resources.
   */
  public getResources(): readonly IMCPResource[] {
    return Array.from(this.resources.values());
  }

  // ============================================================================
  // Protocol Request Handlers
  // ============================================================================

  /**
   * Handles MCP initialize request.
   */
  public async handleInitialize(params: InitializeParams): Promise<Result<InitializeResult, BCError>> {
    try {
      this.logger?.info('Handling initialize request', {
        clientName: params.clientInfo.name,
        clientVersion: params.clientInfo.version,
        protocolVersion: params.protocolVersion,
      });

      // Store client info
      this.clientInfo = params.clientInfo;

      const result: InitializeResult = {
        protocolVersion: '2024-11-05', // MCP protocol version (Claude Desktop supports 2025-06-18)
        capabilities: {
          tools: this.tools.size > 0 ? {} : undefined,
          resources: this.resources.size > 0 ? {} : undefined,
        },
        serverInfo: {
          name: 'bc-mcp-server',
          version: '1.0.0',
        },
      };

      this.logger?.debug('Initialize response', {
        protocolVersion: result.protocolVersion,
        serverName: result.serverInfo.name,
        serverVersion: result.serverInfo.version,
      });

      return ok(result);
    } catch (error) {
      return err(
        new InternalError(
          'Failed to handle initialize request',
          { code: 'INITIALIZE_REQUEST_FAILED', error: String(error) }
        )
      );
    }
  }

  /**
   * Handles tools/list request.
   * Includes consent metadata via annotations for MCP 2025 compliance.
   */
  public async handleToolsList(): Promise<Result<{ tools: readonly ToolListItem[] }, BCError>> {
    try {
      this.logger?.debug('Handling tools/list request');

      const toolsList: ToolListItem[] = Array.from(this.tools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,

        // Include consent metadata in MCP response
        // MCP spec uses "annotations" for metadata extensions
        annotations: {
          requiresConsent: tool.requiresConsent ?? false,
          consentPrompt: tool.consentPrompt,
          sensitivityLevel: tool.sensitivityLevel ?? 'medium',
        },
      }));

      this.logger?.debug('Returning tools list', {
        count: toolsList.length,
        withConsent: toolsList.filter(t => t.annotations?.requiresConsent).length,
      });

      return ok({ tools: toolsList });
    } catch (error) {
      return err(
        new InternalError(
          'Failed to handle tools/list request',
          { code: 'TOOLS_LIST_FAILED', error: String(error) }
        )
      );
    }
  }

  /**
   * Handles tools/call request.
   */
  public async handleToolCall(params: ToolCallParams): Promise<Result<unknown, BCError>> {
    try {
      this.logger?.info('Handling tools/call request', {
        toolName: params.name,
      });

      // Get tool
      const tool = this.tools.get(params.name);
      if (!tool) {
        return err(
          new InternalError(
            `Tool not found: ${params.name}`,
            { code: 'TOOL_NOT_FOUND', toolName: params.name }
          )
        );
      }

      // Execute tool
      const result = await tool.execute(params.arguments);

      if (!isOk(result)) {
        this.logger?.error('Tool execution failed', result.error, {
          toolName: params.name,
          errorCode: result.error.code,
        });
        return result;
      }

      this.logger?.debug('Tool executed successfully', {
        toolName: params.name,
      });

      // Wrap result in MCP content format
      // According to MCP specification (2025-06-18):
      // - structuredContent: provides raw JSON for proper client rendering
      // - content (text): provides stringified JSON for backwards compatibility
      const mcpResponse = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result.value, null, 2),
          },
        ],
        structuredContent: result.value,
      };

      return ok(mcpResponse);
    } catch (error) {
      return err(
        new InternalError(
          'Failed to handle tools/call request',
          { code: 'TOOL_CALL_FAILED', toolName: params.name, error: String(error) }
        )
      );
    }
  }

  /**
   * Handles resources/list request.
   */
  public async handleResourcesList(): Promise<Result<{ resources: readonly ResourceListItem[] }, BCError>> {
    try {
      this.logger?.debug('Handling resources/list request');

      const resourcesList: ResourceListItem[] = Array.from(this.resources.values()).map(resource => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      }));

      this.logger?.debug('Returning resources list', { count: resourcesList.length });

      return ok({ resources: resourcesList });
    } catch (error) {
      return err(
        new InternalError(
          'Failed to handle resources/list request',
          { code: 'RESOURCES_LIST_FAILED', error: String(error) }
        )
      );
    }
  }

  /**
   * Handles resources/read request.
   */
  public async handleResourceRead(params: { uri: string }): Promise<Result<{ contents: string }, BCError>> {
    try {
      this.logger?.info('Handling resources/read request', {
        uri: params.uri,
      });

      // Get resource
      const resource = this.resources.get(params.uri);
      if (!resource) {
        return err(
          new InternalError(
            `Resource not found: ${params.uri}`,
            { code: 'RESOURCE_NOT_FOUND', uri: params.uri }
          )
        );
      }

      // Read resource
      const contentResult = await resource.read();

      if (!isOk(contentResult)) {
        this.logger?.error('Resource read failed', contentResult.error, {
          uri: params.uri,
          errorCode: contentResult.error.code,
        });
        return contentResult as Result<never, BCError>;
      }

      this.logger?.debug('Resource read successfully', {
        uri: params.uri,
        contentLength: contentResult.value.length,
      });

      return ok({ contents: contentResult.value });
    } catch (error) {
      return err(
        new InternalError(
          'Failed to handle resources/read request',
          { code: 'RESOURCE_READ_FAILED', uri: params.uri, error: String(error) }
        )
      );
    }
  }

  /**
   * Checks if server is initialized.
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Checks if server is running.
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Gets client information (available after initialize).
   */
  public getClientInfo(): { name: string; version: string } | undefined {
    return this.clientInfo;
  }
}
