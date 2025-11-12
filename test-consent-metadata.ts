/**
 * Quick Test: Verify Consent Metadata in tools/list Response
 *
 * Tests that:
 * 1. All tools have consent metadata
 * 2. Read-only tools have requiresConsent = false
 * 3. Write tools have requiresConsent = true
 * 4. Consent prompts are present where required
 */

import { MCPServer } from './src/services/mcp-server.js';
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
} from './src/tools/index.js';
import { BCPageConnection } from './src/connection/bc-page-connection.js';
import { AuditLogger } from './src/services/audit-logger.js';
import { bcConfig } from './src/core/config.js';

console.log('🧪 Testing Consent Metadata Implementation\n');

// Mock logger
const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => logger,
};

// Create mock connection (we don't need real BC for this test)
const connection = new BCPageConnection({
  baseUrl: bcConfig.baseUrl,
  username: bcConfig.username,
  password: bcConfig.password || 'test',
  tenantId: bcConfig.tenantId,
  timeout: 30000,
});

// Create audit logger
const auditLogger = new AuditLogger(logger, 10000);

// Create MCP server
const server = new MCPServer(logger);

// Register tools (same as real server)
server.registerTool(new GetPageMetadataTool(connection, bcConfig));
server.registerTool(new SearchPagesTool(bcConfig));
server.registerTool(new ReadPageDataTool(connection, bcConfig));
server.registerTool(new FilterListTool(connection, bcConfig));
server.registerTool(new FindRecordTool(connection, bcConfig));
server.registerTool(new WritePageDataTool(connection, bcConfig, auditLogger));
server.registerTool(new CreateRecordTool(connection, bcConfig, auditLogger));
server.registerTool(new UpdateRecordTool(connection, bcConfig, auditLogger));
server.registerTool(new ExecuteActionTool(connection, bcConfig, auditLogger));

// Initialize server
await server.initialize();

// Get tools/list response
const result = await server.handleToolsList();

if (!result.ok) {
  console.error('❌ Failed to get tools list:', result.error);
  process.exit(1);
}

const { tools } = result.value;

console.log(`✅ Found ${tools.length} tools\n`);

// Define expected tool classifications
const expectedReadOnly = ['search_pages', 'get_page_metadata', 'read_page_data', 'find_record', 'filter_list'];
const expectedWriteOps = ['write_page_data', 'create_record', 'update_record'];
const expectedDangerous = ['execute_action'];

let testsPassed = 0;
let testsFailed = 0;

// Test each tool
for (const tool of tools) {
  console.log(`\n📋 Testing: ${tool.name}`);
  console.log(`   Description: ${tool.description.substring(0, 60)}...`);

  // Check if annotations exist
  if (!tool.annotations) {
    console.log('   ❌ FAIL: Missing annotations object');
    testsFailed++;
    continue;
  }

  const { requiresConsent, consentPrompt, sensitivityLevel } = tool.annotations;

  // Check sensitivity level exists
  if (!sensitivityLevel) {
    console.log('   ❌ FAIL: Missing sensitivityLevel');
    testsFailed++;
    continue;
  }

  console.log(`   Sensitivity: ${sensitivityLevel}`);
  console.log(`   Requires Consent: ${requiresConsent}`);

  // Test read-only tools
  if (expectedReadOnly.includes(tool.name)) {
    if (requiresConsent !== false) {
      console.log(`   ❌ FAIL: Read-only tool should have requiresConsent = false`);
      testsFailed++;
    } else if (sensitivityLevel !== 'low') {
      console.log(`   ❌ FAIL: Read-only tool should have sensitivityLevel = 'low'`);
      testsFailed++;
    } else {
      console.log(`   ✅ PASS: Correctly classified as read-only (no consent)`);
      testsPassed++;
    }
  }
  // Test write operation tools
  else if (expectedWriteOps.includes(tool.name)) {
    if (requiresConsent !== true) {
      console.log(`   ❌ FAIL: Write tool should have requiresConsent = true`);
      testsFailed++;
    } else if (sensitivityLevel !== 'medium') {
      console.log(`   ❌ FAIL: Write tool should have sensitivityLevel = 'medium'`);
      testsFailed++;
    } else if (!consentPrompt) {
      console.log(`   ❌ FAIL: Write tool missing consentPrompt`);
      testsFailed++;
    } else {
      console.log(`   ✅ PASS: Correctly classified as write operation (consent required)`);
      console.log(`   Consent Prompt: "${consentPrompt.substring(0, 50)}..."`);
      testsPassed++;
    }
  }
  // Test dangerous operation tools
  else if (expectedDangerous.includes(tool.name)) {
    if (requiresConsent !== true) {
      console.log(`   ❌ FAIL: Dangerous tool should have requiresConsent = true`);
      testsFailed++;
    } else if (sensitivityLevel !== 'high') {
      console.log(`   ❌ FAIL: Dangerous tool should have sensitivityLevel = 'high'`);
      testsFailed++;
    } else if (!consentPrompt) {
      console.log(`   ❌ FAIL: Dangerous tool missing consentPrompt`);
      testsFailed++;
    } else if (!consentPrompt.includes('WARNING') && !consentPrompt.includes('irreversible')) {
      console.log(`   ⚠️  WARN: Dangerous tool should mention risk in prompt`);
    } else {
      console.log(`   ✅ PASS: Correctly classified as dangerous operation (high risk)`);
      console.log(`   Consent Prompt: "${consentPrompt.substring(0, 60)}..."`);
      testsPassed++;
    }
  }
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary');
console.log('='.repeat(60));
console.log(`Total Tools: ${tools.length}`);
console.log(`Tests Passed: ${testsPassed} ✅`);
console.log(`Tests Failed: ${testsFailed} ❌`);
console.log('='.repeat(60));

if (testsFailed === 0) {
  console.log('\n🎉 All tests passed! Consent metadata is correctly implemented.\n');
  process.exit(0);
} else {
  console.log(`\n❌ ${testsFailed} test(s) failed. Please review the implementation.\n`);
  process.exit(1);
}
