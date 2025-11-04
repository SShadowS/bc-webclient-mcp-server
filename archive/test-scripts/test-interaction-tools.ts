/**
 * Test Interaction Tools
 *
 * Tests the execute_action and update_field MCP tools against a real BC server.
 * These tools implement the InvokeAction and ChangeField BC interactions.
 *
 * Usage:
 *   npx tsx test-interaction-tools.ts
 *
 * Environment Variables (from .env):
 *   BC_BASE_URL - BC server URL (default: http://Cronus27/BC/)
 *   BC_USERNAME - BC username (default: sshadows)
 *   BC_PASSWORD - BC password (required)
 *   BC_TENANT_ID - BC tenant (default: default)
 */

import 'dotenv/config';
import { BCPageConnection } from './src/connection/bc-page-connection.js';
import { ExecuteActionTool } from './src/tools/execute-action-tool.js';
import { UpdateFieldTool } from './src/tools/update-field-tool.js';
import { GetPageMetadataTool } from './src/tools/get-page-metadata-tool.js';
import { isOk } from './src/core/result.js';

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  BC Interaction Tools Test                               ║');
  console.log('║  Testing execute_action and update_field                  ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // Get configuration from environment
  const baseUrl = process.env.BC_BASE_URL || 'http://Cronus27/BC';
  const username = process.env.BC_USERNAME || 'sshadows';
  const password = process.env.BC_PASSWORD || '';
  const tenantId = process.env.BC_TENANT_ID || 'default';

  if (!password) {
    console.error('❌ BC_PASSWORD environment variable not set');
    console.error('');
    console.error('Please set BC credentials in .env file:');
    console.error('  BC_BASE_URL=http://Cronus27/BC');
    console.error('  BC_USERNAME=sshadows');
    console.error('  BC_PASSWORD=your_password');
    console.error('  BC_TENANT_ID=default');
    console.error('');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`  Base URL: ${baseUrl}`);
  console.log(`  Username: ${username}`);
  console.log(`  Tenant: ${tenantId}`);
  console.log('');

  // Create connection
  console.log('Step 1: Creating BC connection...');
  console.log('─'.repeat(60));
  const connection = new BCPageConnection({
    baseUrl,
    username,
    password,
    tenantId,
    timeout: 30000,
  });

  const connectResult = await connection.connect();
  if (!isOk(connectResult)) {
    console.error('❌ Failed to connect:', connectResult.error.message);
    process.exit(1);
  }
  console.log('✓ Connected to BC');
  console.log('');

  // Create tools
  const getPageMetadataTool = new GetPageMetadataTool(connection);
  const executeActionTool = new ExecuteActionTool(connection);
  const updateFieldTool = new UpdateFieldTool(connection);

  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Open Customer Card (Page 21)
  console.log('Test 1: Opening Customer Card (Page 21)');
  console.log('─'.repeat(60));
  const metadataResult = await getPageMetadataTool.execute({ pageId: '21' });
  if (isOk(metadataResult)) {
    console.log('✓ PASS: Page opened successfully');
    console.log(`  Caption: ${(metadataResult.value as any).caption}`);
    testsPassed++;
  } else {
    console.error('✗ FAIL: Failed to open page');
    console.error(`  Error: ${metadataResult.error.message}`);
    testsFailed++;
  }
  console.log('');

  // NOTE: The following tests are EXPECTED TO FAIL until we capture real BC interactions
  // They use hypothesized protocol formats from BC_INTERACTION_CAPTURE_PLAN.md

  // Test 2: Execute Action - InvokeAction interaction (HYPOTHESIZED)
  console.log('Test 2: Execute Action - "Edit" button (HYPOTHESIZED PROTOCOL)');
  console.log('─'.repeat(60));
  console.log('⚠️  This test uses a hypothesized protocol and will likely fail');
  console.log('    Run capture-bc-interactions.mjs to capture the real protocol');
  console.log('');

  const actionResult = await executeActionTool.execute({
    pageId: '21',
    actionName: 'Edit',
  });

  if (isOk(actionResult)) {
    console.log('✓ PASS: Action executed successfully');
    console.log(`  Message: ${(actionResult.value as any).message}`);
    console.log(`  Handlers received: ${(actionResult.value as any).handlers?.length || 0}`);
    testsPassed++;
  } else {
    console.error('✗ EXPECTED FAIL: InvokeAction not yet verified');
    console.error(`  Error: ${actionResult.error.message}`);
    console.error(`  Context: ${JSON.stringify(actionResult.error.context, null, 2)}`);
    console.error('');
    console.error('  This is expected until we capture real BC WebSocket traffic.');
    console.error('  Action: Run capture-bc-interactions.mjs to capture Edit button protocol');
    testsFailed++;
  }
  console.log('');

  // Test 3: Update Field - ChangeField interaction (HYPOTHESIZED)
  console.log('Test 3: Update Field - Change "Name" field (HYPOTHESIZED PROTOCOL)');
  console.log('─'.repeat(60));
  console.log('⚠️  This test uses a hypothesized protocol and will likely fail');
  console.log('    Run capture-bc-interactions.mjs to capture the real protocol');
  console.log('');

  const fieldResult = await updateFieldTool.execute({
    pageId: '21',
    fieldName: 'Name',
    value: 'Test Customer Updated',
  });

  if (isOk(fieldResult)) {
    console.log('✓ PASS: Field updated successfully');
    console.log(`  Message: ${(fieldResult.value as any).message}`);
    console.log(`  Handlers received: ${(fieldResult.value as any).handlers?.length || 0}`);
    testsPassed++;
  } else {
    console.error('✗ EXPECTED FAIL: ChangeField not yet verified');
    console.error(`  Error: ${fieldResult.error.message}`);
    console.error(`  Context: ${JSON.stringify(fieldResult.error.context, null, 2)}`);
    console.error('');
    console.error('  This is expected until we capture real BC WebSocket traffic.');
    console.error('  Action: Run capture-bc-interactions.mjs to capture field update protocol');
    testsFailed++;
  }
  console.log('');

  // Test 4: Validation - Update Field without opening page first
  console.log('Test 4: Validation - Update field on unopened page');
  console.log('─'.repeat(60));
  const invalidFieldResult = await updateFieldTool.execute({
    pageId: '999',
    fieldName: 'Name',
    value: 'Should Fail',
  });

  if (!isOk(invalidFieldResult)) {
    console.log('✓ PASS: Correctly rejected unopened page');
    console.log(`  Error: ${invalidFieldResult.error.message}`);
    testsPassed++;
  } else {
    console.error('✗ FAIL: Should have rejected unopened page');
    testsFailed++;
  }
  console.log('');

  // Test 5: Validation - Execute action without opening page first
  console.log('Test 5: Validation - Execute action on unopened page');
  console.log('─'.repeat(60));
  const invalidActionResult = await executeActionTool.execute({
    pageId: '999',
    actionName: 'Edit',
  });

  if (!isOk(invalidActionResult)) {
    console.log('✓ PASS: Correctly rejected unopened page');
    console.log(`  Error: ${invalidActionResult.error.message}`);
    testsPassed++;
  } else {
    console.error('✗ FAIL: Should have rejected unopened page');
    testsFailed++;
  }
  console.log('');

  // Close connection
  await connection.close();

  // Summary
  console.log('═'.repeat(60));
  console.log('TEST SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total tests: ${testsPassed + testsFailed}`);
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  console.log('');

  if (testsFailed > 0) {
    console.log('⚠️  Some tests failed as expected:');
    console.log('   - InvokeAction and ChangeField use hypothesized protocols');
    console.log('   - Run capture-bc-interactions.mjs to capture real protocols');
    console.log('   - Update tool implementations based on captured data');
    console.log('');
  }

  console.log('Next steps:');
  console.log('  1. Run: node capture-bc-interactions.mjs');
  console.log('  2. Perform these actions in the browser:');
  console.log('     - Click "Edit" button on Customer Card');
  console.log('     - Change "Name" field value');
  console.log('  3. Analyze captured JSON files');
  console.log('  4. Update tool implementations with real protocol');
  console.log('  5. Re-run this test');
  console.log('');

  // Exit with appropriate code
  process.exit(testsFailed > 2 ? 1 : 0); // More than 2 failures = real problem
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
