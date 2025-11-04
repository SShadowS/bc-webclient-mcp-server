/**
 * Real BC Integration Test Server
 *
 * Starts MCP server with REAL BC connection for end-to-end testing.
 * Communicates via JSON-RPC 2.0 over stdio.
 *
 * Usage:
 *   npm run test:mcp:real
 *   or
 *   tsx src/test-mcp-server-real.ts
 */

import { MCPServer, StdioTransport } from './services/index.js';
import {
  GetPageMetadataTool,
  SearchPagesTool,
  ReadPageDataTool,
  WritePageDataTool,
  ExecuteActionTool,
  FilterListTool,
  CreateRecordTool,
  UpdateRecordTool,
  FindRecordTool,
  // UpdateFieldTool removed - merged into write_page_data
  // HandleDialogTool removed - was stub implementation
} from './tools/index.js';
// Use BCPageConnection for connection-per-page architecture (fixes BC caching issue)
import { BCPageConnection } from './connection/bc-page-connection.js';
import { isOk } from './core/result.js';
import { logger } from './core/logger.js';
import { bcConfig } from './core/config.js';

// Console logger implementation
class ConsoleLogger {
  public debug(message: string, context?: Record<string, unknown>): void {
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    console.error(`[DEBUG] ${message}${contextStr}`);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    console.error(`[INFO] ${message}${contextStr}`);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    console.error(`[WARN] ${message}${contextStr}`);
  }

  public error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    const errorStr = error ? ` ${String(error)}` : '';
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    console.error(`[ERROR] ${message}${errorStr}${contextStr}`);
  }

  public child(context: Record<string, unknown>): ConsoleLogger {
    return this;
  }
}

async function main() {
  // Log to stderr so it doesn't interfere with JSON-RPC on stdout
  console.error('═══════════════════════════════════════════════════════════');
  console.error('  Business Central MCP Server - Real BC Integration');
  console.error('  Using REAL BC Server Connection');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('');

  const logger = new ConsoleLogger();

  // Get BC connection config from centralized config
  const { baseUrl, username, password, tenantId } = bcConfig;

  if (!password) {
    logger.error('❌ ERROR: BC_PASSWORD environment variable not set');
    logger.error('');
    logger.error('Please set BC credentials in .env file:');
    logger.error('  BC_BASE_URL=http://Cronus27/BC');
    logger.error('  BC_USERNAME=sshadows');
    logger.error('  BC_PASSWORD=your_password');
    logger.error('  BC_TENANT_ID=default');
    logger.error('');
    process.exit(1);
  }

  logger.error('Step 1: Creating BC page connection...');
  logger.error('  Using connection-per-page architecture to prevent BC caching');
  logger.error(`  URL: ${baseUrl}`);
  logger.error(`  User: ${tenantId}\\${username}`);
  logger.error('');

  const connection = new BCPageConnection({
    baseUrl,
    username,
    password,
    tenantId,
    timeout: 30000,
  });

  logger.error('Step 2: Connecting to BC server...');
  logger.error('  (This may take a few seconds...)');
  const connectResult = await connection.connect();

  if (!isOk(connectResult)) {
    logger.error('❌ Failed to connect', connectResult.error.message);
    logger.error('  Error details', undefined, connectResult.error.context);
    logger.error('');
    logger.error('Common issues:');
    logger.error('  - BC server not running');
    logger.error('  - Wrong credentials');
    logger.error('  - Network connectivity');
    logger.error('  - Wrong base URL');
    logger.error('');
    process.exit(1);
  }

  logger.error('✓ Connected to BC server successfully');
  logger.error('');

  // Create MCP server
  logger.error('Step 3: Creating MCP server...');
  const server = new MCPServer(logger);

  // Register tools
  logger.error('  Registering tools...');
  // Core tools (connection-per-page)
  server.registerTool(new GetPageMetadataTool(connection, bcConfig));
  server.registerTool(new SearchPagesTool());
  server.registerTool(new ReadPageDataTool(connection, bcConfig));
  server.registerTool(new WritePageDataTool(connection, bcConfig));
  server.registerTool(new ExecuteActionTool(connection, bcConfig));
  server.registerTool(new FilterListTool(connection, bcConfig));
  // Convenience helpers (ConnectionManager-based)
  server.registerTool(new CreateRecordTool(connection, bcConfig));
  server.registerTool(new UpdateRecordTool(connection, bcConfig));
  server.registerTool(new FindRecordTool(connection, bcConfig));
  // UpdateFieldTool removed - functionality merged into write_page_data
  // HandleDialogTool removed - was stub/placeholder implementation violating NO STUBS policy
  logger.error('  ✓ Registered 9 tools (6 core + 3 convenience helpers)');
  logger.error('');

  // Initialize server
  logger.error('Step 4: Initializing server...');
  const initResult = await server.initialize();

  if (!isOk(initResult)) {
    logger.error('❌ Failed to initialize', initResult.error.message);
    await connection.close();
    process.exit(1);
  }

  logger.error('✓ Server initialized');
  logger.error('');

  // Create stdio transport
  logger.error('Step 5: Starting stdio transport...');
  const transport = new StdioTransport(server, {
    logger,
    enableDebugLogging: false, // Set to true for verbose logging
  });

  const transportResult = await transport.start();

  if (!isOk(transportResult)) {
    logger.error('❌ Failed to start transport', transportResult.error.message);
    await connection.close();
    process.exit(1);
  }

  logger.error('✓ Stdio transport started');
  logger.error('');

  // Start server
  logger.error('Step 6: Starting MCP server...');
  const startResult = await server.start();

  if (!isOk(startResult)) {
    logger.error('❌ Failed to start server', startResult.error.message);
    await connection.close();
    process.exit(1);
  }

  logger.error('✓ MCP server started');
  logger.error('');
  logger.error('═══════════════════════════════════════════════════════════');
  logger.error('  Server ready - Connected to REAL BC server!');
  logger.error('  Listening on stdin, responding on stdout');
  logger.error('═══════════════════════════════════════════════════════════');
  logger.error('');
  logger.error('Available tools:');
  logger.error('  - get_page_metadata (pageId) - ✓ REAL BC DATA');
  logger.error('  - search_pages (query, limit?, type?)');
  logger.error('  - read_page_data (pageId, filters?) - Not implemented');
  logger.error('  - write_page_data (pageId, fields, recordId?) - Not implemented');
  logger.error('  - execute_action (pageId, actionName, controlPath?) - ✓ NEW');
  logger.error('  - update_field (pageId, fieldName, value, controlPath?) - ✓ NEW');
  logger.error('');
  logger.error('Test with real BC pages:');
  logger.error('  Page 21 - Customer Card');
  logger.error('  Page 22 - Customer List');
  logger.error('  Page 30 - Item Card');
  logger.error('  Page 42 - Sales Order');
  logger.error('');
  logger.error('Example requests:');
  logger.error('  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"Test","version":"1.0.0"}}}');
  logger.error('  {"jsonrpc":"2.0","id":2,"method":"tools/list"}');
  logger.error('  {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_page_metadata","arguments":{"pageId":"21"}}}');
  logger.error('  {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"search_pages","arguments":{"query":"customer","limit":5}}}');
  logger.error('');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.error('');
    logger.error('Received SIGINT, shutting down...');
    await transport.stop();
    await server.stop();
    await connection.close();
    logger.error('✓ Shutdown complete');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.error('');
    logger.error('Received SIGTERM, shutting down...');
    await transport.stop();
    await server.stop();
    await connection.close();
    logger.error('✓ Shutdown complete');
    process.exit(0);
  });

  // Server now runs until stdin closes or process exits
}

// Run main
main().catch(async (error) => {
  console.error('[ERROR] Fatal error', error);
  process.exit(1);
});
