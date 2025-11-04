/**
 * Business Central MCP Server
 *
 * Main entry point for the MCP server that provides tools for
 * interacting with Microsoft Business Central via WebSocket protocol.
 *
 * This server implements the Model Context Protocol (MCP) to expose
 * Business Central operations as tools for AI assistants.
 */

export { MCPServer } from './services/mcp-server.js';
export { StdioTransport } from './services/stdio-transport.js';
export { BCPageConnection } from './connection/bc-page-connection.js';
export { ConnectionManager } from './connection/connection-manager.js';

// Export tools
export * from './tools/index.js';

// Export types
export type * from './types/mcp-types.js';
export type * from './types/bc-types.js';

// Export utilities
export { ok, err, isOk, isErr } from './core/result.js';
export { logger, createToolLogger, createConnectionLogger } from './core/logger.js';
export { newId, prefixedId, shortId } from './core/id.js';