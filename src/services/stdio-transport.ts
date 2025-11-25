/**
 * Stdio Transport for MCP Protocol
 *
 * Implements JSON-RPC 2.0 communication over stdio.
 * Handles reading requests from stdin and writing responses to stdout.
 *
 * Features:
 * - Line-by-line JSON-RPC message parsing
 * - Request routing to MCP server
 * - Response serialization
 * - Error handling
 * - Graceful shutdown
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { InternalError } from '../core/errors.js';
import type { ILogger } from '../core/interfaces.js';
import type { MCPServer } from './mcp-server.js';
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  InitializeParams,
  ToolCallParams,
} from './mcp-server.js';
import { toMCPError } from '../core/mcp-error-mapping.js';

// ============================================================================
// JSON-RPC Error Codes
// ============================================================================

const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ============================================================================
// Stdio Transport Implementation
// ============================================================================

/**
 * Options for stdio transport.
 */
export interface StdioTransportOptions {
  readonly logger?: ILogger;
  readonly enableDebugLogging?: boolean;
}

/**
 * Stdio transport for MCP protocol.
 *
 * Reads JSON-RPC requests from stdin, routes them to the server,
 * and writes responses to stdout.
 */
export class StdioTransport {
  private readonly reader: readline.Interface;
  private running = false;
  private stdoutClosed = false;
  private stdioLogStream?: fs.WriteStream;
  private messageCounter = 0;

  public constructor(
    private readonly server: MCPServer,
    private readonly options: StdioTransportOptions = {}
  ) {
    this.reader = readline.createInterface({
      input: process.stdin,
      output: undefined, // Don't echo input
      terminal: false,
    });

    // Initialize STDIO logging if enabled via environment variable
    this.initializeStdioLogging();

    // Handle stdout errors (EPIPE when client disconnects)
    process.stdout.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') {
        this.options.logger?.info('Client disconnected (EPIPE), marking stdout as closed');
        this.stdoutClosed = true;
        void this.stop();
      } else {
        this.options.logger?.error('Stdout error', error);
      }
    });

    // Handle stdout close
    process.stdout.on('close', () => {
      this.options.logger?.info('Stdout closed');
      this.stdoutClosed = true;
      void this.stop();
    });
  }

  /**
   * Initializes STDIO logging to file if MCP_STDIO_LOG_FILE environment variable is set.
   * @private
   */
  private initializeStdioLogging(): void {
    const logFile = process.env.MCP_STDIO_LOG_FILE;
    if (!logFile) {
      return;
    }

    try {
      // Ensure directory exists
      const logDir = path.dirname(logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // Create write stream (append mode)
      this.stdioLogStream = fs.createWriteStream(logFile, { flags: 'a' });

      // Write session start marker
      const startTime = new Date().toISOString();
      this.stdioLogStream.write(`\n${'='.repeat(80)}\n`);
      this.stdioLogStream.write(`MCP STDIO Session Started: ${startTime}\n`);
      this.stdioLogStream.write(`${'='.repeat(80)}\n\n`);

      this.options.logger?.info('STDIO logging enabled', { logFile });
    } catch (error) {
      this.options.logger?.error('Failed to initialize STDIO logging', error, { logFile });
    }
  }

  /**
   * Logs a message to the STDIO log file.
   * @private
   */
  private logStdioMessage(direction: 'RECV' | 'SEND', message: string | object): void {
    if (!this.stdioLogStream) {
      return;
    }

    try {
      this.messageCounter++;
      const timestamp = new Date().toISOString();
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message, null, 2);

      this.stdioLogStream.write(`[${this.messageCounter}] ${timestamp} ${direction}\n`);
      this.stdioLogStream.write(`${'-'.repeat(80)}\n`);
      this.stdioLogStream.write(`${messageStr}\n`);
      this.stdioLogStream.write(`\n`);
    } catch (error) {
      this.options.logger?.error('Failed to write STDIO log', error);
    }
  }

  /**
   * Starts the transport.
   * Begins listening for JSON-RPC requests on stdin.
   */
  public async start(): Promise<Result<void, BCError>> {
    try {
      if (this.running) {
        return err(
          new InternalError(
            'Transport already running',
            { code: 'TRANSPORT_ALREADY_RUNNING' }
          )
        );
      }

      this.options.logger?.info('Starting stdio transport');

      this.running = true;

      // Listen for lines from stdin
      this.reader.on('line', (line: string) => {
        void this.handleLine(line);
      });

      // Handle stdin close
      this.reader.on('close', () => {
        this.options.logger?.info('Stdin closed, stopping transport');
        void this.stop();
      });

      // Handle process signals
      process.on('SIGINT', () => {
        this.options.logger?.info('Received SIGINT, shutting down');
        void this.stop();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        this.options.logger?.info('Received SIGTERM, shutting down');
        void this.stop();
        process.exit(0);
      });

      this.options.logger?.info('Stdio transport started');

      return ok(undefined);
    } catch (error) {
      return err(
        new InternalError(
          'Failed to start stdio transport',
          { code: 'TRANSPORT_START_FAILED', error: String(error) }
        )
      );
    }
  }

  /**
   * Stops the transport gracefully.
   */
  public async stop(): Promise<Result<void, BCError>> {
    try {
      if (!this.running) {
        return ok(undefined);
      }

      this.options.logger?.info('Stopping stdio transport');

      this.running = false;
      this.reader.close();

      // Close STDIO log stream if open
      if (this.stdioLogStream) {
        try {
          const endTime = new Date().toISOString();
          this.stdioLogStream.write(`\n${'='.repeat(80)}\n`);
          this.stdioLogStream.write(`MCP STDIO Session Ended: ${endTime}\n`);
          this.stdioLogStream.write(`Total Messages: ${this.messageCounter}\n`);
          this.stdioLogStream.write(`${'='.repeat(80)}\n\n`);
          this.stdioLogStream.end();
          this.stdioLogStream = undefined;
        } catch (error) {
          this.options.logger?.error('Failed to close STDIO log stream', error);
        }
      }

      this.options.logger?.info('Stdio transport stopped');

      return ok(undefined);
    } catch (error) {
      return err(
        new InternalError(
          'Failed to stop stdio transport',
          { code: 'TRANSPORT_STOP_FAILED', error: String(error) }
        )
      );
    }
  }

  /**
   * Handles a line from stdin.
   */
  private async handleLine(line: string): Promise<void> {
    if (!line.trim()) {
      return; // Skip empty lines
    }

    // Don't process requests if we're shutting down
    if (!this.running || this.stdoutClosed) {
      this.options.logger?.debug('Transport not running, skipping request');
      return;
    }

    if (this.options.enableDebugLogging) {
      this.options.logger?.debug('Received request', { line });
    }

    try {
      // Parse JSON-RPC request
      const request = JSON.parse(line) as JSONRPCRequest;

      // Log incoming request
      this.logStdioMessage('RECV', request);

      // Validate JSON-RPC format
      if (request.jsonrpc !== '2.0') {
        await this.sendError(
          request.id,
          JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          'Invalid JSON-RPC version'
        );
        return;
      }

      if (!request.method) {
        await this.sendError(
          request.id,
          JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          'Missing method field'
        );
        return;
      }

      // Route request to handler
      await this.routeRequest(request);
    } catch (error) {
      // Parse error
      this.options.logger?.error('Failed to parse JSON-RPC request', error, { line });
      await this.sendError(
        undefined,
        JSON_RPC_ERROR_CODES.PARSE_ERROR,
        'Parse error',
        { originalLine: line }
      );
    }
  }

  /** Known notification methods that don't require a response */
  private static readonly NOTIFICATION_METHODS = new Set([
    'initialized',
    'notifications/initialized',
    'notifications/cancelled',
    '$/cancelRequest',
  ]);

  /** Method to handler lookup table */
  private readonly methodHandlers: Record<string, (request: JSONRPCRequest) => Promise<void>> = {
    'initialize': (req) => this.handleInitialize(req),
    'tools/list': (req) => this.handleToolsList(req),
    'tools/call': (req) => this.handleToolCall(req),
    'resources/list': (req) => this.handleResourcesList(req),
    'resources/read': (req) => this.handleResourceRead(req),
    'prompts/list': (req) => this.handlePromptsList(req),
    'prompts/get': (req) => this.handlePromptGet(req),
    'ping': (req) => this.handlePing(req),
  };

  /**
   * Routes a request to the appropriate handler.
   */
  private async routeRequest(request: JSONRPCRequest): Promise<void> {
    try {
      this.options.logger?.debug('Routing request', {
        method: request.method,
        id: request.id,
      });

      // Check for known notification methods
      if (StdioTransport.NOTIFICATION_METHODS.has(request.method)) {
        this.options.logger?.debug('Received notification', { method: request.method });
        return;
      }

      // Look up handler in dispatch table
      const handler = this.methodHandlers[request.method];
      if (handler) {
        await handler(request);
        return;
      }

      // Unknown method
      await this.handleUnknownMethod(request);
    } catch (error) {
      this.options.logger?.error('Request routing failed', error, {
        method: request.method,
      });
      // Only send error for requests (not notifications)
      if (request.id !== undefined) {
        await this.sendError(
          request.id,
          JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
          'Internal error',
          { error: String(error) }
        );
      }
    }
  }

  /** Handle unknown method - notification vs request */
  private async handleUnknownMethod(request: JSONRPCRequest): Promise<void> {
    if (request.id === undefined) {
      // Notification - do not respond (JSON-RPC 2.0 spec)
      this.options.logger?.debug('Unknown notification', { method: request.method });
    } else {
      // Request - send error response
      this.options.logger?.warn('Unknown method', { method: request.method });
      await this.sendError(
        request.id,
        JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
        `Method not found: ${request.method}`
      );
    }
  }

  /**
   * Handles initialize request.
   */
  private async handleInitialize(request: JSONRPCRequest): Promise<void> {
    const params = request.params as InitializeParams;
    const result = await this.server.handleInitialize(params);

    if (!isOk(result)) {
      await this.sendErrorFromBCError(request.id, result.error);
      return;
    }

    await this.sendSuccess(request.id, result.value);
  }

  /**
   * Handles tools/list request.
   */
  private async handleToolsList(request: JSONRPCRequest): Promise<void> {
    const result = await this.server.handleToolsList();

    if (!isOk(result)) {
      await this.sendErrorFromBCError(request.id, result.error);
      return;
    }

    await this.sendSuccess(request.id, result.value);
  }

  /**
   * Handles tools/call request.
   */
  private async handleToolCall(request: JSONRPCRequest): Promise<void> {
    const params = request.params as ToolCallParams;
    const result = await this.server.handleToolCall(params);

    if (!isOk(result)) {
      await this.sendErrorFromBCError(request.id, result.error);
      return;
    }

    await this.sendSuccess(request.id, result.value);
  }

  /**
   * Handles resources/list request.
   */
  private async handleResourcesList(request: JSONRPCRequest): Promise<void> {
    const result = await this.server.handleResourcesList();

    if (!isOk(result)) {
      await this.sendErrorFromBCError(request.id, result.error);
      return;
    }

    await this.sendSuccess(request.id, result.value);
  }

  /**
   * Handles resources/read request.
   */
  private async handleResourceRead(request: JSONRPCRequest): Promise<void> {
    const params = request.params as { uri: string };
    const result = await this.server.handleResourceRead(params);

    if (!isOk(result)) {
      await this.sendErrorFromBCError(request.id, result.error);
      return;
    }

    await this.sendSuccess(request.id, result.value);
  }

  /**
   * Handles prompts/list request.
   */
  private async handlePromptsList(request: JSONRPCRequest): Promise<void> {
    const result = await this.server.handlePromptsList();

    if (!isOk(result)) {
      await this.sendErrorFromBCError(request.id, result.error);
      return;
    }

    await this.sendSuccess(request.id, result.value);
  }

  /**
   * Handles prompts/get request.
   */
  private async handlePromptGet(request: JSONRPCRequest): Promise<void> {
    const params = request.params as { name: string; arguments?: Record<string, string> };
    const result = await this.server.handlePromptGet(params);

    if (!isOk(result)) {
      await this.sendErrorFromBCError(request.id, result.error);
      return;
    }

    await this.sendSuccess(request.id, result.value);
  }

  /**
   * Handles ping request (keepalive).
   */
  private async handlePing(request: JSONRPCRequest): Promise<void> {
    await this.sendSuccess(request.id, { message: 'pong' });
  }

  /**
   * Sends a success response.
   */
  private async sendSuccess(id: string | number | undefined, result: unknown): Promise<void> {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };

    await this.sendResponse(response);
  }

  /**
   * Sends an error response from BCError.
   * Uses centralized error mapping to convert BCError to appropriate JSON-RPC error codes.
   */
  private async sendErrorFromBCError(
    id: string | number | undefined,
    error: BCError
  ): Promise<void> {
    const mcpError = toMCPError(error);
    await this.sendError(
      id,
      mcpError.code,
      mcpError.message,
      mcpError.data
    );
  }

  /**
   * Sends an error response.
   */
  private async sendError(
    id: string | number | undefined,
    code: number,
    message: string,
    data?: unknown
  ): Promise<void> {
    const error: JSONRPCError = {
      code,
      message,
      data,
    };

    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      error,
    };

    await this.sendResponse(response);
  }

  /**
   * Sends a JSON-RPC response to stdout.
   */
  private async sendResponse(response: JSONRPCResponse): Promise<void> {
    try {
      // Check if stdout is still writable
      if (this.stdoutClosed || !process.stdout.writable) {
        this.options.logger?.debug('Stdout not writable, skipping response', {
          stdoutClosed: this.stdoutClosed,
          writable: process.stdout.writable,
        });
        return;
      }

      const json = JSON.stringify(response);

      if (this.options.enableDebugLogging) {
        this.options.logger?.debug('Sending response', { response });
      }

      // Log outgoing response
      this.logStdioMessage('SEND', response);

      // Write to stdout with newline
      process.stdout.write(json + '\n');
    } catch (error) {
      this.options.logger?.error('Failed to send response', error, { response });
      // Mark stdout as closed if we get an EPIPE or similar write error
      if (error instanceof Error && 'code' in error && error.code === 'EPIPE') {
        this.stdoutClosed = true;
      }
    }
  }

  /**
   * Checks if transport is running.
   */
  public isRunning(): boolean {
    return this.running;
  }
}
