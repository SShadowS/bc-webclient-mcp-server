/**
 * Test Filter List Tool
 *
 * Tests the filter_list MCP tool implementation end-to-end with real BC connection.
 */

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import { FilterListTool } from './src/tools/filter-list-tool.js';
import { isOk } from './src/core/result.js';
import { bcConfig } from './src/core/config.js';

console.log('═══════════════════════════════════════════════════════════');
console.log('  Filter List Tool Test');
console.log('═══════════════════════════════════════════════════════════\n');

async function main() {
  // Get BC connection config from centralized config
  const { baseUrl, username, password, tenantId } = bcConfig;

  console.log('Step 1: Creating BC WebSocket client...');
  console.log(`  URL: ${baseUrl}`);
  console.log(`  User: ${tenantId}\\${username}\n`);

  const client = new BCRawWebSocketClient(
    { baseUrl },
    username,
    password,
    tenantId
  );

  try {
    // Authenticate first (required before connect)
    console.log('Step 2: Authenticating and connecting...');
    await client.authenticateWeb();
    await client.connect();
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '27.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });
    console.log('✓ Connected and session opened\n');

    // Create filter list tool
    console.log('Step 3: Testing filter_list tool...');
    console.log('─'.repeat(60));
    const filterTool = new FilterListTool(client);

    // Test filtering Customer List (page 22) by "Name" column
    console.log('\nTest Case: Filter Customer List (page 22) by "Name" column\n');

    const result = await filterTool.execute({
      pageId: 22,
      columnName: 'Name',
      filterValue: 'Adatum'
    });

    if (!isOk(result)) {
      console.error('❌ Filter failed:', result.error.message);
      if (result.error.context) {
        console.error('  Context:', result.error.context);
      }
      process.exit(1);
    }

    console.log('\n✓ Filter tool executed successfully!\n');
    console.log('Result:');
    console.log('─'.repeat(60));
    console.log(JSON.stringify(result.value, null, 2));
    console.log('');

    // Test with invalid column name
    console.log('\nTest Case: Invalid column name (should fail gracefully)\n');

    const invalidResult = await filterTool.execute({
      pageId: 22,
      columnName: 'InvalidColumnName',
    });

    if (!isOk(invalidResult)) {
      console.log('✓ Expected error:', invalidResult.error.message);
      console.log('');
    } else {
      console.error('❌ Should have failed with invalid column name');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  ✓ All tests passed!');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Error occurred:');
    console.error(error);
    process.exit(1);
  } finally {
    // Clean up - close connection
    try {
      await client.close();
      console.log('✓ Connection closed\n');
    } catch (cleanupError) {
      console.error('Warning: Failed to close connection:', cleanupError);
    }
  }
}

// Run the test
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
