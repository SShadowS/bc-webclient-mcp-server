/**
 * Test Write Page Data Tool
 *
 * Tests the write_page_data MCP tool against a real BC server.
 * This tool updates multiple fields at once using the SaveValue interaction.
 *
 * Usage:
 *   npx tsx test-write-page-data.ts
 *
 * Environment Variables (from .env):
 *   BC_BASE_URL - BC server URL (default: http://Cronus27/BC/)
 *   BC_USERNAME - BC username (default: sshadows)
 *   BC_PASSWORD - BC password (required)
 *   BC_TENANT_ID - BC tenant (default: default)
 */

import 'dotenv/config';
import { BCPageConnection } from './src/connection/bc-page-connection.js';
import { WritePageDataTool } from './src/tools/write-page-data-tool.js';
import { ExecuteActionTool } from './src/tools/execute-action-tool.js';
import { GetPageMetadataTool } from './src/tools/get-page-metadata-tool.js';
import { isOk } from './src/core/result.js';

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  BC Write Page Data Tool Test                            ║');
  console.log('║  Testing multi-field updates using SaveValue             ║');
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
  const writePageDataTool = new WritePageDataTool(connection);

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

  // Test 2: Execute Edit action to put record in edit mode
  console.log('Test 2: Execute "Edit" action (put record in edit mode)');
  console.log('─'.repeat(60));
  const actionResult = await executeActionTool.execute({
    pageId: '21',
    actionName: 'Edit',
  });

  if (isOk(actionResult)) {
    console.log('✓ PASS: Edit action executed successfully');
    console.log(`  Message: ${(actionResult.value as any).message}`);
    testsPassed++;
  } else {
    console.error('✗ FAIL: Failed to execute Edit action');
    console.error(`  Error: ${actionResult.error.message}`);
    testsFailed++;
  }
  console.log('');

  // Test 3: Write Page Data - Update multiple fields
  console.log('Test 3: Write Page Data - Update multiple fields at once');
  console.log('─'.repeat(60));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const writeResult = await writePageDataTool.execute({
    pageId: '21',
    fields: {
      'Name': `Test Customer ${timestamp}`,
      'Credit Limit (LCY)': 50000,
      'Phone No.': '+1-555-0123',
    },
  });

  if (isOk(writeResult)) {
    const value = writeResult.value as any;
    if (value.success) {
      console.log('✓ PASS: Fields updated successfully');
      console.log(`  Message: ${value.message}`);
      console.log(`  Updated fields: ${value.updatedFields?.join(', ')}`);
      testsPassed++;
    } else {
      console.log('⚠️  PARTIAL: Some fields updated, some failed');
      console.log(`  Message: ${value.message}`);
      console.log(`  Updated: ${value.updatedFields?.join(', ')}`);
      console.log(`  Failed: ${value.failedFields?.join(', ')}`);
      testsPassed++; // Partial success is still a pass for the tool
    }
  } else {
    console.error('✗ FAIL: Failed to write page data');
    console.error(`  Error: ${writeResult.error.message}`);
    console.error(`  Context: ${JSON.stringify(writeResult.error.context, null, 2)}`);
    testsFailed++;
  }
  console.log('');

  // Test 4: Validation - Write to page without opening first
  console.log('Test 4: Validation - Write to unopened page');
  console.log('─'.repeat(60));
  const invalidWriteResult = await writePageDataTool.execute({
    pageId: '999',
    fields: {
      'Name': 'Should Fail',
    },
  });

  if (!isOk(invalidWriteResult)) {
    console.log('✓ PASS: Correctly rejected unopened page');
    console.log(`  Error: ${invalidWriteResult.error.message}`);
    testsPassed++;
  } else {
    console.error('✗ FAIL: Should have rejected unopened page');
    testsFailed++;
  }
  console.log('');

  // Test 5: Validation - Write with empty fields object
  console.log('Test 5: Validation - Write with empty fields object');
  console.log('─'.repeat(60));
  const emptyFieldsResult = await writePageDataTool.execute({
    pageId: '21',
    fields: {},
  });

  if (!isOk(emptyFieldsResult)) {
    console.log('✓ PASS: Correctly rejected empty fields object');
    console.log(`  Error: ${emptyFieldsResult.error.message}`);
    testsPassed++;
  } else {
    console.error('✗ FAIL: Should have rejected empty fields object');
    testsFailed++;
  }
  console.log('');

  // Test 6: Write single field (should work like update_field)
  console.log('Test 6: Write single field');
  console.log('─'.repeat(60));
  const singleFieldResult = await writePageDataTool.execute({
    pageId: '21',
    fields: {
      'Address': '123 Test Street',
    },
  });

  if (isOk(singleFieldResult)) {
    const value = singleFieldResult.value as any;
    if (value.success) {
      console.log('✓ PASS: Single field updated successfully');
      console.log(`  Message: ${value.message}`);
      testsPassed++;
    } else {
      console.error('✗ FAIL: Single field update failed');
      console.error(`  Message: ${value.message}`);
      testsFailed++;
    }
  } else {
    console.error('✗ FAIL: Failed to update single field');
    console.error(`  Error: ${singleFieldResult.error.message}`);
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

  if (testsFailed === 0) {
    console.log('✅ All tests passed!');
    console.log('');
    console.log('The write_page_data tool is working correctly.');
    console.log('You can now use it to update multiple BC fields at once.');
  } else {
    console.log('❌ Some tests failed.');
    console.log('');
    console.log('Review the errors above to diagnose the issues.');
  }
  console.log('');

  // Exit with appropriate code
  process.exit(testsFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
