/**
 * MCP Test Client for BC Integration Tests
 *
 * Reusable client that spawns MCP server and provides helper methods.
 */

import { spawn, execSync } from 'child_process';
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
    this.rl = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.initialized = false;
    this.serverCrashed = false;
  }

  async start() {
    console.log(colors.blue + 'Starting MCP server with real BC connection...' + colors.reset);

    this.server = spawn('npx', ['tsx', 'src/test-mcp-server-real.ts'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: true,
      cwd: process.cwd(),
    });

    this.rl = readline.createInterface({
      input: this.server.stdout,
      terminal: false,
    });

    this.rl.on('line', (line) => this.handleResponse(line));

    this.server.on('error', (error) => {
      console.error(colors.red + 'Server error:' + colors.reset, error);
    });

    // Handle unexpected server exit - reject all pending requests
    this.server.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(colors.red + `Server exited with code ${code}` + colors.reset);
        this.serverCrashed = true;
        // Reject all pending requests
        for (const [id, resolve] of this.pendingRequests) {
          resolve({ error: { code: -1, message: `Server crashed (exit code ${code})` } });
        }
        this.pendingRequests.clear();
      }
    });

    // Wait for server ready signal instead of fixed timeout
    // Server outputs '__MCP_SERVER_READY__' when BC connection is established
    await this.waitForReady(30000); // 30 second timeout (fallback)

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

  /**
   * Wait for server ready signal or timeout.
   * @param {number} timeoutMs - Maximum time to wait
   */
  async waitForReady(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const checkLine = (line) => {
        if (line === '__MCP_SERVER_READY__') {
          clearTimeout(timeout);
          this.rl.removeListener('line', checkLine);
          resolve();
        }
      };

      const timeout = setTimeout(() => {
        this.rl.removeListener('line', checkLine);
        reject(new Error('Server startup timeout - no ready signal received'));
      }, timeoutMs);

      // Listen for ready signal
      this.rl.on('line', checkLine);
    });
  }

  async stop() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.server) {
      // If server already crashed, just clean up
      if (this.serverCrashed || this.server.exitCode !== null) {
        this.server = null;
        return;
      }

      const pid = this.server.pid;
      // On Windows, kill the process tree using taskkill
      if (process.platform === 'win32' && pid) {
        try {
          execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
        } catch {
          // Process may already be dead
        }
      } else {
        this.server.kill();
      }

      // Wait for server process to fully exit (short timeout)
      await new Promise((resolve) => {
        if (this.server && this.server.exitCode === null) {
          this.server.on('exit', resolve);
          // Short timeout - process should exit quickly after kill
          setTimeout(resolve, 500);
        } else {
          resolve();
        }
      });

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

  async sendRequest(method, params = null, timeout = 120000) {
    // Fail fast if server has crashed
    if (this.serverCrashed) {
      return { error: { code: -1, message: 'Server has crashed - cannot send request' } };
    }

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
  async callTool(name, args = {}, timeout = 120000) {
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
   *
   * @param {string|number} pageId - Page ID to open
   * @param {object} filters - (LEGACY) Filter object for navigation (use bookmark instead)
   * @param {string} bookmark - (RECOMMENDED) BC bookmark for direct record navigation
   */
  async getPageMetadata(pageId, filters = null, bookmark = null) {
    const params = { pageId: String(pageId) };
    if (bookmark) {
      params.bookmark = bookmark;
    } else if (filters) {
      params.filters = filters;
    }
    return this.callTool('get_page_metadata', params);
  }

  /**
   * Read page data.
   */
  async readPageData(pageContextId, options = {}) {
    return this.callTool('read_page_data', { pageContextId, ...options });
  }

  /**
   * Write page data.
   *
   * @param {string} pageContextId - Page context ID
   * @param {object} params - Parameters object:
   *   - For line operations: { subpage: 'SubpageName', lineBookmark?: '...', lineNo?: 1, fields: { ... } }
   *   - For header fields with explicit wrapper: { fields: { 'Field Name': value, ... } }
   *   - For header fields legacy: { 'Field Name': value, ... }
   */
  async writePageData(pageContextId, params) {
    // Detect if params contains line operation parameters (subpage, lineBookmark, lineNo)
    const hasLineParams = params.subpage !== undefined || params.lineBookmark !== undefined || params.lineNo !== undefined;

    // Detect if params has explicit 'fields' key (and no line params)
    const hasExplicitFields = !hasLineParams && params.fields !== undefined;

    if (hasLineParams || hasExplicitFields) {
      // Case 1: Line operation format: { subpage, fields, ... }
      // Case 2: Explicit fields format: { fields: {...} }
      // Pass through as-is
      return this.callTool('write_page_data', { pageContextId, ...params });
    } else {
      // Case 3: Legacy header-only format: { 'Field Name': value, ... }
      // Wrap in 'fields' parameter
      return this.callTool('write_page_data', { pageContextId, fields: params });
    }
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

  async handleDialog(pageContextId, params = {}) {
    return this.callTool('handle_dialog', {
      pageContextId,
      ...params,
    });
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
