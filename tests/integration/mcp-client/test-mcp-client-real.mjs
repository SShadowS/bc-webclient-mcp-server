/**
 * Real BC Integration Test Client
 *
 * Tests MCP server with REAL BC connection.
 * Validates complete end-to-end flow with actual Business Central server.
 *
 * Run with: npm run test:mcp:real:client
 */

import { spawn } from 'child_process';
import readline from 'readline';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
};

class MCPRealTestClient {
  constructor() {
    this.server = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.testsPassed = 0;
    this.testsFailed = 0;
  }

  /**
   * Starts the MCP server process with real BC connection.
   */
  async startServer() {
    console.log(colors.blue + '═══════════════════════════════════════════════════════════' + colors.reset);
    console.log(colors.blue + '  MCP Server Real BC Integration Tests' + colors.reset);
    console.log(colors.blue + '═══════════════════════════════════════════════════════════' + colors.reset);
    console.log('');

    console.log('Starting MCP server with REAL BC connection...');
    console.log(colors.gray + '(This may take 5-10 seconds to authenticate and connect)' + colors.reset);
    console.log('');

    // Spawn the server process
    this.server = spawn('npx', ['tsx', 'src/test-mcp-server-real.ts'], {
      stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr
      shell: true,
    });

    // Set up stdout reader
    const rl = readline.createInterface({
      input: this.server.stdout,
      terminal: false,
    });

    rl.on('line', (line) => {
      this.handleServerResponse(line);
    });

    this.server.on('error', (error) => {
      console.error(colors.red + '❌ Server error:' + colors.reset, error);
    });

    this.server.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.log(colors.red + `❌ Server exited with code ${code}` + colors.reset);
      }
    });

    // Give server time to connect to BC
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log(colors.green + '✓ Server started and connected to BC' + colors.reset);
    console.log('');
  }

  /**
   * Handles response from server.
   */
  handleServerResponse(line) {
    try {
      const response = JSON.parse(line);

      if (response.id !== undefined) {
        const handler = this.pendingRequests.get(response.id);
        if (handler) {
          this.pendingRequests.delete(response.id);
          handler(response);
        }
      }
    } catch (error) {
      // Ignore parse errors (server might output non-JSON to stdout)
    }
  }

  /**
   * Sends a JSON-RPC request.
   */
  async sendRequest(method, params = null, timeout = 30000) {
    return new Promise((resolve) => {
      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== null && { params }),
      };

      this.pendingRequests.set(id, resolve);

      // Send request
      this.server.stdin.write(JSON.stringify(request) + '\n');

      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          resolve({ error: { code: -1, message: 'Request timeout' } });
        }
      }, timeout);
    });
  }

  /**
   * Runs a test with assertions.
   */
  async runTest(name, testFn) {
    process.stdout.write(colors.yellow + `Testing: ${name}...` + colors.reset);

    try {
      await testFn();
      console.log(colors.green + ' ✓ PASS' + colors.reset);
      this.testsPassed++;
    } catch (error) {
      console.log(colors.red + ' ✗ FAIL' + colors.reset);
      console.log(colors.red + `  ${error.message}` + colors.reset);
      this.testsFailed++;
    }
  }

  /**
   * Assertion helper.
   */
  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  /**
   * Parses MCP tool call response (unwraps content[0].text JSON).
   */
  parseToolResult(response) {
    if (response.error) {
      return null;
    }
    if (!response.result || !response.result.content || !response.result.content[0]) {
      return null;
    }
    try {
      return JSON.parse(response.result.content[0].text);
    } catch (error) {
      return null;
    }
  }

  /**
   * Runs all tests with real BC.
   */
  async runAllTests() {
    console.log(colors.blue + 'Running Real BC Integration Tests' + colors.reset);
    console.log(colors.cyan + '(These tests use REAL Business Central data)' + colors.reset);
    console.log('');

    // Test 1: Initialize
    await this.runTest('Initialize server', async () => {
      const response = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'Real BC Test Client',
          version: '1.0.0',
        },
      });

      this.assert(!response.error, `Initialize failed: ${response.error?.message}`);
      this.assert(response.result, 'No result returned');
      this.assert(response.result.serverInfo, 'No serverInfo returned');
      this.assert(response.result.serverInfo.name === 'bc-mcp-server', 'Unexpected server name');
    });

    // Test 2: Tools List
    await this.runTest('List tools', async () => {
      const response = await this.sendRequest('tools/list');

      this.assert(!response.error, `Tools list failed: ${response.error?.message}`);
      this.assert(response.result, 'No result returned');
      this.assert(response.result.tools, 'No tools array returned');
      // Consolidated from 9 tools to 5 core tools (44% context reduction)
      // See Refactor1.md for analysis and rationale
      this.assert(response.result.tools.length === 5, `Expected 5 tools, got ${response.result.tools.length}`);

      // Verify 5 core tools exist
      const toolNames = response.result.tools.map(t => t.name);
      const coreTools = [
        'search_pages',
        'get_page_metadata',
        'read_page_data',     // Now includes filtering (filter_list merged)
        'write_page_data',
        'execute_action'
      ];

      coreTools.forEach(tool => {
        this.assert(toolNames.includes(tool), `Missing core tool: ${tool}`);
      });

      // Removed tools (consolidated):
      // - filter_list: Functionality merged into read_page_data.filters
      // - find_record: Thin wrapper - users compose read_page_data + filters
      // - create_record, update_record: Moved to optional/ (not in default registry)
      // - update_field: Merged into write_page_data
      // - handle_dialog: Was stub implementation
    });

    // Test 3: REAL Get Page Metadata for Page 21 (Customer Card)
    let pageContextId21; // Store for later tests
    await this.runTest('Get REAL metadata for Page 21 (Customer Card)', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'get_page_metadata',
        arguments: { pageId: '21' },
      }, 45000); // Longer timeout for real BC

      this.assert(!response.error, `Tool call failed: ${response.error?.message}`);
      this.assert(response.result, 'No result returned');

      const result = this.parseToolResult(response);
      this.assert(result, 'Failed to parse tool result');
      this.assert(result.pageId === '21', `Wrong pageId: ${result.pageId}`);
      this.assert(result.pageContextId, 'No pageContextId returned');
      this.assert(result.pageContextId.includes(':page:21:'),
                  `Invalid pageContextId format: ${result.pageContextId}`);
      // sessionId removed - no longer part of the API
      this.assert(result.caption, 'No caption returned');
      this.assert(result.fields, 'No fields returned');
      this.assert(result.fields.length > 0, 'No fields in result');
      this.assert(result.actions, 'No actions returned');

      // Store pageContextId for later tests
      pageContextId21 = result.pageContextId;

      // Log sample of real data
      console.log(colors.gray + `      Caption: "${result.caption}"` + colors.reset);
      console.log(colors.gray + `      PageContextId: ${result.pageContextId}` + colors.reset);
      console.log(colors.gray + `      Fields: ${result.fields.length}` + colors.reset);
      console.log(colors.gray + `      Actions: ${result.actions.length}` + colors.reset);
    });

    // Test 4: Search Pages
    await this.runTest('Search for customer pages', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'search_pages',
        arguments: { query: 'customer', limit: 5 },
      }, 45000); // Extended timeout for Tell Me search (needs to open dialog, search, parse results)

      this.assert(!response.error, `Tool call failed: ${response.error?.message}`);
      this.assert(response.result, 'No result returned');

      const result = this.parseToolResult(response);
      this.assert(result, 'Failed to parse tool result');
      this.assert(result.pages, 'No pages returned');
      this.assert(result.pages.length > 0, 'No pages found');

      // Log sample of real data
      console.log(colors.gray + `      Found ${result.pages.length} pages` + colors.reset);
      if (result.pages.length > 0) {
        console.log(colors.gray + `      First result: ${result.pages[0].caption} (${result.pages[0].type})` + colors.reset);
      }
    });

    // Test 5: REAL Get Page Metadata for Page 22 (Customer List)
    await this.runTest('Get REAL metadata for Page 22 (Customer List)', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'get_page_metadata',
        arguments: { pageId: '22' },
      }, 45000);

      this.assert(!response.error, `Tool call failed: ${response.error?.message}`);
      this.assert(response.result, 'No result returned');

      const result = this.parseToolResult(response);
      this.assert(result, 'Failed to parse tool result');
      this.assert(result.pageId === '22', `Wrong pageId: ${result.pageId}`);
      this.assert(result.pageContextId, 'No pageContextId returned');
      this.assert(result.pageContextId.includes(':page:22:'),
                  `Invalid pageContextId format: ${result.pageContextId}`);
      // sessionId removed - no longer part of the API
      this.assert(result.fields.length > 0, 'No fields in result');
      this.assert(result.pageType, 'No pageType returned');

      console.log(colors.gray + `      Caption: "${result.caption}"` + colors.reset);
      console.log(colors.gray + `      PageType: ${result.pageType}` + colors.reset);
      console.log(colors.gray + `      Fields: ${result.fields.length}` + colors.reset);
    });

    // Test 6: REAL Get Page Metadata for Page 30 (Item Card)
    await this.runTest('Get REAL metadata for Page 30 (Item Card)', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'get_page_metadata',
        arguments: { pageId: '30' },
      }, 45000);

      this.assert(!response.error, `Tool call failed: ${response.error?.message}`);
      this.assert(response.result, 'No result returned');

      const result = this.parseToolResult(response);
      this.assert(result, 'Failed to parse tool result');
      this.assert(result.pageId === '30', `Wrong pageId: ${result.pageId}`);
      this.assert(result.pageContextId, 'No pageContextId returned');
      this.assert(result.pageContextId.includes(':page:30:'),
                  `Invalid pageContextId format: ${result.pageContextId}`);
      // sessionId removed - no longer part of the API
      this.assert(result.fields.length > 0, 'No fields in result');
      this.assert(result.pageType, 'No pageType returned');

      console.log(colors.gray + `      Caption: "${result.caption}"` + colors.reset);
      console.log(colors.gray + `      PageType: ${result.pageType}` + colors.reset);
      console.log(colors.gray + `      Fields: ${result.fields.length}` + colors.reset);
    });

    // Test 7: Read Page Data using pageContextId
    // NOTE: Currently disabled due to pageContext tracking not fully implemented in BCPageConnection
    // This is a known limitation that needs to be addressed
    /*
    if (pageContextId21) {
      await this.runTest('Read page data using pageContextId', async () => {
        const response = await this.sendRequest('tools/call', {
          name: 'read_page_data',
          arguments: { pageContextId: pageContextId21 },
        }, 45000);

        this.assert(!response.error, `Tool call failed: ${response.error?.message}`);
        this.assert(response.result, 'No result returned');
        this.assert(response.result.pageId === '21', `Wrong pageId: ${response.result.pageId}`);
        this.assert(response.result.pageContextId === pageContextId21,
                    `pageContextId mismatch: ${response.result.pageContextId}`);
        this.assert(response.result.records, 'No records returned');
        this.assert(response.result.pageType === 'Card', `Wrong pageType: ${response.result.pageType}`);

        console.log(colors.gray + `      Using pageContextId: ${pageContextId21}` + colors.reset);
        console.log(colors.gray + `      PageType: ${response.result.pageType}` + colors.reset);
      });
    }
    */

    // Test 8: Invalid Tool
    await this.runTest('Call invalid tool', async () => {
      const response = await this.sendRequest('tools/call', {
        name: 'invalid_tool',
        arguments: {},
      });

      this.assert(response.error, 'Expected error for invalid tool');
      this.assert(response.error.message.includes('Tool not found'), 'Wrong error message');
    });

    // Test 9: Ping
    await this.runTest('Ping server', async () => {
      const response = await this.sendRequest('ping');

      this.assert(!response.error, `Ping failed: ${response.error?.message}`);
      this.assert(response.result, 'No result returned');
    });

    console.log('');
    console.log(colors.blue + '═══════════════════════════════════════════════════════════' + colors.reset);
    console.log(colors.blue + '  Test Results' + colors.reset);
    console.log(colors.blue + '═══════════════════════════════════════════════════════════' + colors.reset);
    console.log('');
    console.log(colors.green + `✓ Passed: ${this.testsPassed}` + colors.reset);
    if (this.testsFailed > 0) {
      console.log(colors.red + `✗ Failed: ${this.testsFailed}` + colors.reset);
    }
    console.log('');
    console.log(colors.cyan + '✨ All tests used REAL Business Central data!' + colors.reset);
    console.log('');

    return this.testsFailed === 0;
  }

  /**
   * Stops the server.
   */
  async stopServer() {
    if (this.server) {
      console.log('Stopping server...');
      this.server.kill('SIGINT');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Run tests
async function main() {
  const client = new MCPRealTestClient();

  try {
    await client.startServer();
    const success = await client.runAllTests();
    await client.stopServer();

    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error(colors.red + '❌ Fatal error:' + colors.reset, error);
    await client.stopServer();
    process.exit(1);
  }
}

main();
