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
  // Consolidated from 9 tools to 5 core tools (44% context reduction)
  // FilterListTool removed - merged into read_page_data.filters
  // FindRecordTool removed - thin wrapper, users compose directly
  // CreateRecordTool, UpdateRecordTool - moved to optional (not in default registry)
  // UpdateFieldTool removed - merged into write_page_data
  // HandleDialogTool removed - was stub implementation
} from './tools/index.js';
// Use BCPageConnection for connection-per-page architecture (fixes BC caching issue)
import { BCPageConnection } from './connection/bc-page-connection.js';
import { isOk } from './core/result.js';
import { logger } from './core/logger.js';
import { bcConfig } from './core/config.js';
import { AuditLogger } from './services/audit-logger.js';
import { BCConnectionPool } from './services/connection-pool.js';
import { CacheManager } from './services/cache-manager.js';

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
  const logger = new ConsoleLogger();

  // Get BC connection config from centralized config
  const { baseUrl, username, password, tenantId } = bcConfig;

  if (!password) {
    logger.error('BC_PASSWORD environment variable not set');
    process.exit(1);
  }

  const connection = new BCPageConnection({
    baseUrl,
    username,
    password,
    tenantId,
    timeout: 30000,
  });

  const connectResult = await connection.connect();

  if (!isOk(connectResult)) {
    logger.error(`Failed to connect to BC: ${connectResult.error.message}`);
    process.exit(1);
  }

  // Create connection pool for Tell Me searches
  logger.info('Initializing connection pool...');
  const connectionPool = new BCConnectionPool(
    { baseUrl } as any,
    username,
    password,
    tenantId,
    {
      minConnections: 1, // Reduced to 1 to avoid BC rate limiting
      maxConnections: 10,
      idleTimeoutMs: 300000, // 5 minutes
      healthCheckIntervalMs: 60000, // 1 minute
      acquireTimeoutMs: 30000, // 30 seconds
    }
  );

  await connectionPool.initialize();
  logger.info(`Connection pool initialized (${connectionPool.getStats().available} connections ready)`);

  // Create cache manager
  logger.info('Initializing cache manager...');
  const cacheManager = new CacheManager({
    maxEntries: 1000,
    defaultTtlMs: 300000, // 5 minutes for searches
    cleanupIntervalMs: 60000, // 1 minute
    enableCoalescing: true,
  });
  logger.info('Cache manager initialized');

  // Create MCP server
  const server = new MCPServer(logger);

  // Create audit logger for tracking consent-required tool executions
  const auditLogger = new AuditLogger(logger, 10000); // Keep last 10k events

  // Register 5 Core MCP Tools (MCP best practice: 4-6 tools for context efficiency)
  //
  // Consolidated from 9 tools to reduce context pollution and improve composability.
  // See Refactor1.md for analysis and rationale.

  // Read-only tools (no audit logger needed)
  server.registerTool(new GetPageMetadataTool(connection, bcConfig));
  server.registerTool(new SearchPagesTool(bcConfig, connectionPool, cacheManager));
  server.registerTool(new ReadPageDataTool(connection, bcConfig)); // Now includes filtering

  // Write/mutation tools (with audit logger for consent tracking)
  server.registerTool(new WritePageDataTool(connection, bcConfig, auditLogger));
  server.registerTool(new ExecuteActionTool(connection, bcConfig, auditLogger));

  // Removed from default registry:
  // - FilterListTool: Functionality available via read_page_data.filters parameter
  // - FindRecordTool: Users compose with read_page_data + filters directly
  // - CreateRecordTool: Moved to optional/ (users can compose: get_page_metadata → execute_action("New") → write_page_data)
  // - UpdateRecordTool: Moved to optional/ (users can compose: get_page_metadata → execute_action("Edit") → write_page_data)

  // Initialize server
  const initResult = await server.initialize();

  if (!isOk(initResult)) {
    logger.error(`Failed to initialize server: ${initResult.error.message}`);
    cacheManager.shutdown();
    await connectionPool.shutdown();
    await connection.close();
    process.exit(1);
  }

  // Create stdio transport
  const transport = new StdioTransport(server, {
    logger,
    enableDebugLogging: false, // Set to true for verbose logging
  });

  const transportResult = await transport.start();

  if (!isOk(transportResult)) {
    logger.error(`Failed to start transport: ${transportResult.error.message}`);
    cacheManager.shutdown();
    await connectionPool.shutdown();
    await connection.close();
    process.exit(1);
  }

  // Start server
  const startResult = await server.start();

  if (!isOk(startResult)) {
    logger.error(`Failed to start server: ${startResult.error.message}`);
    cacheManager.shutdown();
    await connectionPool.shutdown();
    await connection.close();
    process.exit(1);
  }

  logger.info('BC MCP Server ready');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    await transport.stop();
    await server.stop();
    cacheManager.shutdown();
    await connectionPool.shutdown();
    await connection.close();
    logger.info('Shutdown complete');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await transport.stop();
    await server.stop();
    cacheManager.shutdown();
    await connectionPool.shutdown();
    await connection.close();
    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Server now runs until stdin closes or process exits
}

// Run main
main().catch(async (error) => {
  console.error('[ERROR] Fatal error', error);
  process.exit(1);
});
