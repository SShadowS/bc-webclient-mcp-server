/**
 * MCP Test Client for BC Integration Tests
 *
 * Reusable client that spawns MCP server and provides helper methods.
 */

import { spawn } from 'child_process';
import readline from 'readline';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
};

export class MCPTestClient {
  constructor() {
    this.server = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.initialized = false;
  }

  async start() {
    console.log(colors.blue + 'Starting MCP server with real BC connection...' + colors.reset);

    this.server = spawn('npx', ['tsx', 'src/test-mcp-server-real.ts'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: true,
      cwd: process.cwd(),
    });

    const rl = readline.createInterface({
      input: this.server.stdout,
      terminal: false,
    });

    rl.on('line', (line) => this.handleResponse(line));

    this.server.on('error', (error) => {
      console.error(colors.red + 'Server error:' + colors.reset, error);
    });

    // Wait for server to connect to BC
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Initialize MCP protocol
    const initResponse = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'BC Flow Tests', version: '1.0.0' },
    });

    if (initResponse.error) {
      throw new Error(`Initialize failed: ${initResponse.error.message}`);
    }

    this.initialized = true;
    console.log(colors.green + '✓ MCP server connected and initialized' + colors.reset);
  }

  async stop() {
    if (this.server) {
      this.server.kill();
      this.server = null;
    }
  }

  handleResponse(line) {
    try {
      const response = JSON.parse(line);
      if (response.id !== undefined) {
        const handler = this.pendingRequests.get(response.id);
        if (handler) {
          this.pendingRequests.delete(response.id);
          handler(response);
        }
      }
    } catch {
      // Non-JSON output, ignore
    }
  }

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
      this.server.stdin.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          resolve({ error: { code: -1, message: 'Request timeout' } });
        }
      }, timeout);
    });
  }

  /**
   * Call an MCP tool and return parsed result.
   */
  async callTool(name, args = {}, timeout = 45000) {
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    }, timeout);

    if (response.error) {
      throw new Error(`Tool ${name} failed: ${response.error.message}`);
    }

    // Parse the content[0].text JSON
    if (response.result?.content?.[0]?.text) {
      try {
        return JSON.parse(response.result.content[0].text);
      } catch {
        return response.result.content[0].text;
      }
    }

    return response.result;
  }

  /**
   * Get page metadata and return pageContextId.
   */
  async getPageMetadata(pageId) {
    return this.callTool('get_page_metadata', { pageId: String(pageId) });
  }

  /**
   * Read page data.
   */
  async readPageData(pageContextId, options = {}) {
    return this.callTool('read_page_data', { pageContextId, ...options });
  }

  /**
   * Write page data.
   */
  async writePageData(pageContextId, fields) {
    return this.callTool('write_page_data', { pageContextId, fields });
  }

  /**
   * Execute an action on a page.
   */
  async executeAction(pageContextId, actionName) {
    return this.callTool('execute_action', { pageContextId, actionName });
  }

  /**
   * Search for pages by query.
   */
  async searchPages(query) {
    return this.callTool('search_pages', { query });
  }
}

// Assertion helpers
export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual(actual, expected, field) {
  if (actual !== expected) {
    throw new Error(`${field}: expected "${expected}", got "${actual}"`);
  }
}

export function assertDefined(value, field) {
  if (value === undefined || value === null) {
    throw new Error(`${field} should be defined, got ${value}`);
  }
}

export function assertArrayLength(arr, minLength, message) {
  if (!Array.isArray(arr) || arr.length < minLength) {
    throw new Error(message || `Expected array with at least ${minLength} items, got ${arr?.length || 0}`);
  }
}

/**
 * Helper to restore record after test modification.
 */
export async function withRecordRestore(client, pageContextId, testFn) {
  // Read original data
  const original = await client.readPageData(pageContextId);

  try {
    return await testFn(original);
  } finally {
    // Restore original data
    try {
      if (original.data) {
        await client.writePageData(pageContextId, original.data);
      }
    } catch (restoreErr) {
      console.error(colors.yellow + `Warning: Failed to restore data: ${restoreErr.message}` + colors.reset);
    }
  }
}

// Test runner helpers
export async function runTest(name, testFn, stats) {
  process.stdout.write(colors.yellow + `  ${name}...` + colors.reset);

  try {
    await testFn();
    console.log(colors.green + ' ✓ PASS' + colors.reset);
    stats.passed++;
    return true;
  } catch (error) {
    console.log(colors.red + ' ✗ FAIL' + colors.reset);
    console.log(colors.red + `    ${error.message}` + colors.reset);
    stats.failed++;
    return false;
  }
}

export function printSummary(stats) {
  console.log('');
  console.log(colors.blue + '═══════════════════════════════════════════════════════════' + colors.reset);
  console.log(colors.blue + `  Results: ${stats.passed} passed, ${stats.failed} failed` + colors.reset);
  console.log(colors.blue + '═══════════════════════════════════════════════════════════' + colors.reset);

  if (stats.failed > 0) {
    process.exitCode = 1;
  }
}
