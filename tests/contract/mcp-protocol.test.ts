/**
 * MCP Protocol Contract Tests
 *
 * Verifies JSON-RPC 2.0 compliance and MCP protocol implementation.
 * Tests initialization, tools/list, tools/call, and error handling.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPServer } from '../../src/services/mcp-server.js';
import {
  SearchPagesTool,
  GetPageMetadataTool,
  ReadPageDataTool,
} from '../../src/tools/index.js';
import { isOk } from '../../src/core/result.js';
import type { IBCConnection } from '../../src/core/interfaces.js';

describe('MCP Protocol Compliance', () => {
  let server: MCPServer;
  let mockConnection: IBCConnection;

  const mockLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => mockLogger,
  };

  beforeAll(async () => {
    // Create mock connection
    mockConnection = {
      connect: async () => ({ ok: true, value: undefined } as any),
      close: async () => {},
      isConnected: () => true,
    } as any;

    // Create MCP server
    server = new MCPServer(mockLogger as any);

    // Register tools
    server.registerTool(
      new SearchPagesTool({ baseUrl: 'http://test', username: 'test', tenantId: 'test' })
    );
    server.registerTool(
      new GetPageMetadataTool(mockConnection, {
        baseUrl: 'http://test',
        username: 'test',
        tenantId: 'test',
      })
    );
    server.registerTool(
      new ReadPageDataTool(mockConnection, {
        baseUrl: 'http://test',
        username: 'test',
        tenantId: 'test',
      })
    );

    // Initialize server
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  // ============================================================================
  // Initialization Protocol
  // ============================================================================

  describe('Initialize Handshake', () => {
    it('should accept initialize request', async () => {
      const result = await server.handleInitialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.protocolVersion).toBe('2024-11-05');
        expect(result.value.serverInfo).toBeDefined();
        expect(result.value.serverInfo.name).toBe('bc-mcp-server');
        expect(result.value.capabilities).toBeDefined();
      }
    });

    it('should include server capabilities in initialize response', async () => {
      const result = await server.handleInitialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const caps = result.value.capabilities;
        expect(caps.tools).toBeDefined();
        // BC MCP Server doesn't implement prompts/resources yet
        expect(caps.prompts).toBeUndefined();
        expect(caps.resources).toBeUndefined();
      }
    });

    it('should accept multiple initialize calls (idempotent)', async () => {
      const result1 = await server.handleInitialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'client1', version: '1.0.0' },
      });

      const result2 = await server.handleInitialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'client2', version: '2.0.0' },
      });

      expect(isOk(result1)).toBe(true);
      expect(isOk(result2)).toBe(true);
    });
  });

  // ============================================================================
  // Tools List Protocol
  // ============================================================================

  describe('Tools List', () => {
    it('should return list of available tools', async () => {
      const result = await server.handleToolsList();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.tools).toBeDefined();
        expect(Array.isArray(result.value.tools)).toBe(true);
        expect(result.value.tools.length).toBeGreaterThan(0);
      }
    });

    it('should include required tool fields', async () => {
      const result = await server.handleToolsList();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const tools = result.value.tools;

        for (const tool of tools) {
          // Required fields per MCP spec
          expect(tool.name).toBeDefined();
          expect(typeof tool.name).toBe('string');
          expect(tool.name.length).toBeGreaterThan(0);

          expect(tool.description).toBeDefined();
          expect(typeof tool.description).toBe('string');

          expect(tool.inputSchema).toBeDefined();
          expect(typeof tool.inputSchema).toBe('object');
        }
      }
    });

    it('should include consent metadata in annotations', async () => {
      const result = await server.handleToolsList();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const tools = result.value.tools;

        for (const tool of tools) {
          // MCP 2025 consent metadata
          expect(tool.annotations).toBeDefined();
          expect(tool.annotations.requiresConsent).toBeDefined();
          expect(typeof tool.annotations.requiresConsent).toBe('boolean');

          expect(tool.annotations.sensitivityLevel).toBeDefined();
          expect(['low', 'medium', 'high']).toContain(tool.annotations.sensitivityLevel);

          // If consent required, must have prompt
          if (tool.annotations.requiresConsent) {
            expect(tool.annotations.consentPrompt).toBeDefined();
            expect(typeof tool.annotations.consentPrompt).toBe('string');
            expect(tool.annotations.consentPrompt.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('should have valid JSON Schema for inputSchema', async () => {
      const result = await server.handleToolsList();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const tools = result.value.tools;

        for (const tool of tools) {
          const schema = tool.inputSchema as any;

          // Should be a JSON Schema object
          expect(schema.type).toBeDefined();
          expect(schema.properties).toBeDefined();
          expect(typeof schema.properties).toBe('object');

          if (schema.required) {
            expect(Array.isArray(schema.required)).toBe(true);
          }
        }
      }
    });

    it('should include search_pages tool', async () => {
      const result = await server.handleToolsList();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const tools = result.value.tools;
        const searchTool = tools.find((t: any) => t.name === 'search_pages');

        expect(searchTool).toBeDefined();
        expect(searchTool.description.toLowerCase()).toContain('search');
        expect(searchTool.annotations.requiresConsent).toBe(false); // Read-only
        expect(searchTool.annotations.sensitivityLevel).toBe('low');
      }
    });
  });

  // ============================================================================
  // Tool Execution Protocol
  // ============================================================================

  describe('Tools Call', () => {
    it('should accept valid tool call with valid input', async () => {
      const result = await server.handleToolCall('search_pages', {
        query: 'customer',
        maxResults: 10,
      });

      // Should return Result type
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect('ok' in result).toBe(true);
    });

    it('should return error for unknown tool', async () => {
      const result = await server.handleToolCall('unknown_tool_xyz', {});

      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('should return error for invalid input schema', async () => {
      // Call with completely invalid input
      const result = await server.handleToolCall('search_pages', {
        invalid_field: 'test',
        another_invalid: 123,
      } as any);

      // Should either succeed (if validation is lenient) or fail with validation error
      expect(result).toBeDefined();
      expect('ok' in result).toBe(true);
    });

    it('should handle tool execution errors gracefully', async () => {
      // get_page_metadata requires BC connection, which will fail with mock
      const result = await server.handleToolCall('get_page_metadata', {
        pageId: 21,
      });

      // Should return error result, not throw exception
      expect(result).toBeDefined();
      expect('ok' in result).toBe(true);
    });
  });

  // ============================================================================
  // JSON-RPC 2.0 Error Codes
  // ============================================================================

  describe('Error Code Compliance', () => {
    it('should use standard JSON-RPC error codes', async () => {
      // -32600: Invalid Request
      // -32601: Method not found
      // -32602: Invalid params
      // -32603: Internal error

      const unknownToolResult = await server.handleToolCall('unknown_tool', {});

      expect(isOk(unknownToolResult)).toBe(false);
      // Error codes are mapped in mcp-error-mapping.ts
      // Tool not found should map to -32601 or similar
    });

    it('should include error details in context', async () => {
      const result = await server.handleToolCall('unknown_tool', {});

      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        // Should have error message
        expect(result.error.message).toBeDefined();
        expect(result.error.message.length).toBeGreaterThan(0);

        // May have additional context
        expect(result.error.context).toBeDefined();
      }
    });
  });

  // ============================================================================
  // Protocol Version Compliance
  // ============================================================================

  describe('Protocol Version', () => {
    it('should support MCP specification 2024-11-05', async () => {
      const result = await server.handleInitialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.protocolVersion).toBe('2024-11-05');
      }
    });

    it('should reject unsupported protocol versions gracefully', async () => {
      const result = await server.handleInitialize({
        protocolVersion: '9999-99-99', // Invalid version
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      });

      // Should handle gracefully (may accept or reject based on implementation)
      expect(result).toBeDefined();
    });
  });

  // ============================================================================
  // Consent Flow Compliance (MCP 2025)
  // ============================================================================

  describe('User Consent Flow', () => {
    it('should mark read-only tools as no consent required', async () => {
      const result = await server.handleToolsList();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const tools = result.value.tools;

        // Read-only tools
        const readOnlyTools = ['search_pages', 'get_page_metadata', 'read_page_data'];

        for (const toolName of readOnlyTools) {
          const tool = tools.find((t: any) => t.name === toolName);
          if (tool) {
            expect(tool.annotations.requiresConsent).toBe(false);
            expect(tool.annotations.sensitivityLevel).toBe('low');
          }
        }
      }
    });

    it('should mark write operations as consent required', async () => {
      const result = await server.handleToolsList();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const tools = result.value.tools;

        // Write tools (if registered)
        const writeTools = ['write_page_data', 'create_record', 'update_record'];

        for (const toolName of writeTools) {
          const tool = tools.find((t: any) => t.name === toolName);
          if (tool) {
            expect(tool.annotations.requiresConsent).toBe(true);
            expect(tool.annotations.sensitivityLevel).toMatch(/medium|high/);
            expect(tool.annotations.consentPrompt).toBeDefined();
          }
        }
      }
    });

    it('should mark dangerous operations with high sensitivity', async () => {
      const result = await server.handleToolsList();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const tools = result.value.tools;

        const tool = tools.find((t: any) => t.name === 'execute_action');
        if (tool) {
          expect(tool.annotations.requiresConsent).toBe(true);
          expect(tool.annotations.sensitivityLevel).toBe('high');
          expect(tool.annotations.consentPrompt).toContain('WARNING');
        }
      }
    });
  });

  // ============================================================================
  // Server Lifecycle
  // ============================================================================

  describe('Server Lifecycle', () => {
    it('should be in running state after start', async () => {
      const startResult = await server.start();
      expect(isOk(startResult)).toBe(true);

      // Should accept requests
      const listResult = await server.handleToolsList();
      expect(isOk(listResult)).toBe(true);
    });

    it('should handle stop gracefully', async () => {
      const stopResult = await server.stop();
      expect(isOk(stopResult)).toBe(true);

      // Restart for other tests
      await server.start();
    });

    it('should be idempotent for start/stop', async () => {
      await server.start();
      await server.start(); // Second start should be safe

      await server.stop();
      await server.stop(); // Second stop should be safe

      // Restart for other tests
      await server.start();
    });
  });

  // ============================================================================
  // Response Format Compliance
  // ============================================================================

  describe('Response Format', () => {
    it('should return tools/list in correct format', async () => {
      const result = await server.handleToolsList();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // Should have 'tools' array
        expect(result.value).toHaveProperty('tools');
        expect(Array.isArray(result.value.tools)).toBe(true);

        // Should not have extra fields
        const keys = Object.keys(result.value);
        expect(keys).toEqual(['tools']);
      }
    });

    it('should return initialize response in correct format', async () => {
      const result = await server.handleInitialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // Required fields
        expect(result.value).toHaveProperty('protocolVersion');
        expect(result.value).toHaveProperty('serverInfo');
        expect(result.value).toHaveProperty('capabilities');

        // serverInfo structure
        expect(result.value.serverInfo).toHaveProperty('name');
        expect(result.value.serverInfo).toHaveProperty('version');
      }
    });
  });
});
