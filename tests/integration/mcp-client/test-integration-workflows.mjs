/**
 * Integration Tests - Simulates Claude Desktop Workflows
 *
 * Tests complete workflows that Claude Desktop would execute,
 * including multi-step operations like searching, opening pages,
 * and reading data.
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

class MCPTestClient {
  constructor() {
    this.requestId = 0;
    this.pendingRequests = new Map();
  }

  async start() {
    console.log('Starting MCP server...');

    this.serverProcess = spawn('node', ['dist/stdio-server.js'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    this.readline = createInterface({
      input: this.serverProcess.stdout,
      crlfDelay: Infinity
    });

    this.readline.on('line', (line) => {
      try {
        const response = JSON.parse(line);
        if (response.id && this.pendingRequests.has(response.id)) {
          const resolve = this.pendingRequests.get(response.id);
          this.pendingRequests.delete(response.id);
          resolve(response);
        }
      } catch (error) {
        // Ignore non-JSON lines (logs)
      }
    });

    // Initialize
    const initResponse = await this.sendRequest({
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'Integration Test Client',
          version: '1.0.0'
        }
      }
    });

    if (initResponse.error) {
      throw new Error(`Initialization failed: ${initResponse.error.message}`);
    }

    console.log('✓ Server initialized\n');
    return initResponse;
  }

  async sendRequest(request) {
    const id = ++this.requestId;
    const fullRequest = { jsonrpc: '2.0', id, ...request };

    return new Promise((resolve) => {
      this.pendingRequests.set(id, resolve);
      this.serverProcess.stdin.write(JSON.stringify(fullRequest) + '\n');
    });
  }

  async callTool(toolName, args = {}) {
    const response = await this.sendRequest({
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    });

    if (response.error) {
      throw new Error(`Tool ${toolName} failed: ${response.error.message}`);
    }

    return response.result;
  }

  async stop() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.readline.close();
    }
  }
}

class IntegrationTests {
  constructor() {
    this.client = new MCPTestClient();
    this.passed = 0;
    this.failed = 0;
  }

  async run() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MCP Integration Tests - Claude Desktop Workflows');
    console.log('═══════════════════════════════════════════════════════════\n');

    try {
      await this.client.start();

      // Run workflow tests
      await this.testWorkflow1_FindCustomerByNumber();
      await this.testWorkflow2_ListSalesOrders();
      await this.testWorkflow3_SearchAndOpenPage();
      await this.testWorkflow4_FilterAndRead();

      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('  Test Results');
      console.log('═══════════════════════════════════════════════════════════\n');
      console.log(`✓ Passed: ${this.passed}`);
      if (this.failed > 0) {
        console.log(`✗ Failed: ${this.failed}`);
      }
      console.log('\n✨ All integration workflows tested!\n');

      process.exit(this.failed > 0 ? 1 : 0);

    } catch (error) {
      console.error('\n❌ Fatal error:', error.message);
      console.error(error.stack);
      process.exit(1);
    } finally {
      await this.client.stop();
    }
  }

  async test(name, fn) {
    process.stdout.write(`Testing: ${name}...`);
    try {
      await fn();
      console.log(' ✓ PASS');
      this.passed++;
    } catch (error) {
      console.log(' ✗ FAIL');
      console.log(`  ${error.message}`);
      this.failed++;
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  /**
   * WORKFLOW 1: "What is the customer name of customer no 20000"
   * Simulates Claude Desktop answering a customer lookup question
   */
  async testWorkflow1_FindCustomerByNumber() {
    console.log('\n📋 WORKFLOW 1: Find customer by number (like Claude Desktop)');
    console.log('   User asks: "What is the customer name of customer no 20000?"\n');

    let pageContextId;

    await this.test('Step 1: Search for customer pages', async () => {
      const result = await this.client.callTool('search_pages', {
        query: 'customer'
      });

      this.assert(result.content, 'No content in result');
      const data = JSON.parse(result.content[0].text);
      this.assert(data.pages && data.pages.length > 0, 'No pages found');
      console.log(`      Found ${data.pages.length} customer pages`);
    });

    await this.test('Step 2: Open Customer List (Page 22)', async () => {
      const result = await this.client.callTool('get_page_metadata', {
        pageId: '22'
      });

      this.assert(result.content, 'No content in result');
      const data = JSON.parse(result.content[0].text);
      this.assert(data.pageContextId, 'No pageContextId returned');
      this.assert(data.pageType === 'List', `Expected List page, got ${data.pageType}`);

      pageContextId = data.pageContextId;
      console.log(`      Opened: ${data.caption}`);
      console.log(`      Context: ${pageContextId}`);
    });

    await this.test('Step 3: Read customer data (with DelayedControls)', async () => {
      const result = await this.client.callTool('read_page_data', {
        pageContextId: pageContextId
      });

      this.assert(result.content, 'No content in result');
      const data = JSON.parse(result.content[0].text);
      this.assert(data.records, 'No records returned');
      this.assert(data.totalCount > 0, `Expected records, got ${data.totalCount}`);

      console.log(`      Read ${data.totalCount} records`);

      // Check if customer 20000 exists
      const customer20000 = data.records.find(r => r.fields['No.'] === '20000');
      if (customer20000) {
        console.log(`      ✓ Found customer 20000: ${customer20000.fields.Name || customer20000.fields.CustomerName || '(name field not found)'}`);
      }
    });
  }

  /**
   * WORKFLOW 2: "Who is the newest sales order for?"
   * Tests list page with async data loading
   */
  async testWorkflow2_ListSalesOrders() {
    console.log('\n📋 WORKFLOW 2: List sales orders (tests DelayedControls)');
    console.log('   User asks: "Who is the newest sales order for?"\n');

    let pageContextId;

    await this.test('Step 1: Search for sales order pages', async () => {
      const result = await this.client.callTool('search_pages', {
        query: 'sales order'
      });

      this.assert(result.content, 'No content in result');
      const data = JSON.parse(result.content[0].text);
      this.assert(data.pages && data.pages.length > 0, 'No pages found');
      console.log(`      Found ${data.pages.length} sales order pages`);
    });

    await this.test('Step 2: Open Sales Orders (Page 9305)', async () => {
      const result = await this.client.callTool('get_page_metadata', {
        pageId: '9305'
      });

      this.assert(result.content, 'No content in result');
      const data = JSON.parse(result.content[0].text);
      this.assert(data.pageContextId, 'No pageContextId returned');
      this.assert(data.pageType === 'List', `Expected List page, got ${data.pageType}`);

      pageContextId = data.pageContextId;
      console.log(`      Opened: ${data.caption}`);
    });

    await this.test('Step 3: Read sales orders (event-driven)', async () => {
      const result = await this.client.callTool('read_page_data', {
        pageContextId: pageContextId
      });

      this.assert(result.content, 'No content in result');
      const data = JSON.parse(result.content[0].text);
      this.assert(data.records, 'No records returned');
      this.assert(data.totalCount > 0, `Expected records from DelayedControls, got ${data.totalCount}`);

      console.log(`      ✓ Read ${data.totalCount} sales orders (async data extraction worked!)`);

      const newest = data.records[0];
      console.log(`      Newest order: ${newest.fields['No.'] || '(no number)'} for ${newest.fields['Sell-to Customer Name'] || newest.fields.CustomerName || '(no customer)'}`);

    });
  }

  /**
   * WORKFLOW 3: Search → Open → Read workflow
   */
  async testWorkflow3_SearchAndOpenPage() {
    console.log('\n📋 WORKFLOW 3: Generic search and open workflow\n');

    await this.test('Search → Open Item Card → Read fields', async () => {
      // Search for item pages
      const searchResult = await this.client.callTool('search_pages', {
        query: 'item'
      });
      const searchData = JSON.parse(searchResult.content[0].text);
      this.assert(searchData.pages.length > 0, 'No item pages found');

      // Open Item Card (Page 30)
      const metadataResult = await this.client.callTool('get_page_metadata', {
        pageId: '30'
      });
      const metadata = JSON.parse(metadataResult.content[0].text);
      this.assert(metadata.pageType === 'Card', `Expected Card page, got ${metadata.pageType}`);
      console.log(`      Opened ${metadata.caption} (${metadata.fields?.length || 0} fields)`);
    });
  }

  /**
   * WORKFLOW 4: Test metadata extraction
   */
  async testWorkflow4_FilterAndRead() {
    console.log('\n📋 WORKFLOW 4: Metadata extraction test\n');

    await this.test('Open multiple pages and extract metadata', async () => {
      // Open customer list
      const customerResult = await this.client.callTool('get_page_metadata', {
        pageId: '22'
      });
      const customerMeta = JSON.parse(customerResult.content[0].text);
      console.log(`      Customers: ${customerMeta.fields?.length || 0} fields`);
      this.assert(customerMeta.pageType === 'List', 'Expected List page');

      // Open item card
      const itemResult = await this.client.callTool('get_page_metadata', {
        pageId: '30'
      });
      const itemMeta = JSON.parse(itemResult.content[0].text);
      console.log(`      Item Card: ${itemMeta.fields?.length || 0} fields`);
      this.assert(itemMeta.pageType === 'Card', 'Expected Card page');
    });
  }
}

// Run tests
const tests = new IntegrationTests();
tests.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
