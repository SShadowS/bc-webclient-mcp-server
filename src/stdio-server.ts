#!/usr/bin/env node
/**
 * MCP STDIO Server Entry Point
 *
 * This script starts the MCP server in STDIO mode for use with Claude Desktop
 * and other MCP clients that communicate via JSON-RPC over stdin/stdout.
 *
 * Usage:
 *   MCP_STDIO_LOG_FILE=./logs/mcp-stdio.log node stdio-server.js
 */

import { MCPServer } from './services/mcp-server.js';
import { StdioTransport } from './services/stdio-transport.js';
import { bcConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { AuditLogger } from './services/audit-logger.js';
import { CacheManager } from './services/cache-manager.js';
import { isOk } from './core/result.js';

// Import 5 core tools (consolidated from 9 for context efficiency)
import { GetPageMetadataTool } from './tools/get-page-metadata-tool.js';
import { SearchPagesTool } from './tools/search-pages-tool.js';
import { ReadPageDataTool } from './tools/read-page-data-tool.js';
import { WritePageDataTool } from './tools/write-page-data-tool.js';
import { ExecuteActionTool } from './tools/execute-action-tool.js';

// Optional/Advanced tools (not in default registry, but available for opt-in)
import { CreateRecordByFieldNameTool } from './tools/create-record-by-field-name-tool.js';
import { CreateRecordTool } from './tools/optional/create-record-tool.js';
import { UpdateRecordTool } from './tools/optional/update-record-tool.js';

/**
 * Main function to start the STDIO MCP server
 */
async function main(): Promise<void> {
  try {
    // Get BC connection config
    const { baseUrl, username, password, tenantId } = bcConfig;

    if (!password) {
      logger.error('BC_PASSWORD environment variable not set');
      process.exit(1);
    }

    // Create primary BC connection
    //  NOTE: Tools will use ConnectionManager for session reuse.
    // This initial connection is only used as a fallback/template for tools.
    const connection = new (await import('./connection/bc-page-connection.js')).BCPageConnection({
      baseUrl,
      username,
      password,
      tenantId,
      timeout: 30000,
    });

    // Don't connect immediately - let ConnectionManager handle it on-demand

    // Create cache manager
    const cacheManager = new CacheManager({
      maxEntries: 1000,
      defaultTtlMs: 300000,
      cleanupIntervalMs: 60000,
      enableCoalescing: true,
    });

    // Create MCP server
    const server = new MCPServer(logger);

    // Create audit logger
    const auditLogger = new AuditLogger(logger, 10000);

    // Register 5 Core MCP Tools (consolidated from 9 for context efficiency)
    // Read-only tools
    server.registerTool(new GetPageMetadataTool(connection, bcConfig));
    server.registerTool(new SearchPagesTool(bcConfig, undefined, cacheManager)); // Uses ConnectionManager directly
    server.registerTool(new ReadPageDataTool(connection, bcConfig)); // Now includes filtering (filter_list merged)

    // Write/mutation tools (with audit logger)
    server.registerTool(new WritePageDataTool(connection, bcConfig, auditLogger));
    server.registerTool(new ExecuteActionTool(connection, bcConfig, auditLogger));

    // Optional/Advanced tools (register if needed)
    // server.registerTool(new CreateRecordByFieldNameTool(connection, bcConfig, auditLogger));
    // server.registerTool(new CreateRecordTool(connection, bcConfig, auditLogger));
    // server.registerTool(new UpdateRecordTool(connection, bcConfig, auditLogger));

    // Create STDIO transport
    const transport = new StdioTransport(server, { logger });

    // Start transport
    const startResult = await transport.start();
    if (!isOk(startResult)) {
      logger.error(`Failed to start STDIO transport: ${startResult.error.message}`);
      process.exit(1);
    }

    logger.info('BC MCP STDIO Server ready');

    // Keep process alive
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully');
      await transport.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully');
      await transport.stop();
      process.exit(0);
    });
  } catch (error) {
    logger.error(`Fatal error starting STDIO server: ${String(error)}`);
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
