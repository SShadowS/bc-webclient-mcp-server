/**
 * Test script for read_page_data tool
 *
 * Tests both card and list pages to verify data extraction.
 */

import { BCPageConnection } from './src/connection/bc-page-connection.js';
import { ReadPageDataTool } from './src/tools/read-page-data-tool.js';

const BASE_URL = 'http://Cronus27/BC';
const USERNAME = 'sshadows';
const PASSWORD = '1234';
const TENANT = 'default';

async function testReadPageData() {
  console.error('\n=== Testing read_page_data Tool ===\n');

  const connection = new BCPageConnection({
    baseUrl: BASE_URL,
    username: USERNAME,
    password: PASSWORD,
    tenantId: TENANT,
  });

  try {
    // Connect
    console.error('[Test] Connecting to BC...');
    const sessionResult = await connection.connect();
    if (!sessionResult.ok) {
      throw new Error(`Failed to connect: ${sessionResult.error.message}`);
    }
    console.error('[Test] Connected successfully\n');

    const tool = new ReadPageDataTool(connection);

    // Test 1: Card Page (Customer Card - Page 21)
    console.error('\n' + '='.repeat(80));
    console.error('[Test 1] Reading Customer Card (Page 21) - Card Page');
    console.error('='.repeat(80) + '\n');

    const cardResult = await tool.execute({ pageId: '21' });

    if (!cardResult.ok) {
      console.error(`[Test 1] ERROR: ${cardResult.error.message}`);
    } else {
      const data = cardResult.value;
      console.error(`[Test 1] Success!`);
      console.error(`  Page ID: ${data.pageId}`);
      console.error(`  Caption: ${data.caption}`);
      console.error(`  Page Type: ${data.pageType}`);
      console.error(`  Records: ${data.totalCount}`);

      if (data.records.length > 0) {
        const record = data.records[0];
        const fieldNames = Object.keys(record.fields);
        console.error(`  Fields: ${fieldNames.length}`);
        console.error(`\n  Sample Fields (first 10):`);

        fieldNames.slice(0, 10).forEach((fieldName, index) => {
          const field = record.fields[fieldName];
          const valueStr = field.value !== null
            ? (typeof field.value === 'string' ? `"${field.value}"` : String(field.value))
            : '<null>';
          console.error(`    ${index + 1}. ${fieldName} (${field.type}): ${valueStr}`);
        });
      }
    }

    // Test 2: List Page (Customer List - Page 22)
    console.error('\n' + '='.repeat(80));
    console.error('[Test 2] Reading Customer List (Page 22) - List Page');
    console.error('='.repeat(80) + '\n');

    const listResult = await tool.execute({ pageId: '22' });

    if (!listResult.ok) {
      console.error(`[Test 2] ERROR: ${listResult.error.message}`);
    } else {
      const data = listResult.value;
      console.error(`[Test 2] Success!`);
      console.error(`  Page ID: ${data.pageId}`);
      console.error(`  Caption: ${data.caption}`);
      console.error(`  Page Type: ${data.pageType}`);
      console.error(`  Records: ${data.totalCount}`);

      if (data.records.length > 0) {
        console.error(`\n  Sample Records (first 3):`);

        data.records.slice(0, 3).forEach((record, index) => {
          const fieldNames = Object.keys(record.fields);
          console.error(`\n    Record ${index + 1} (Bookmark: ${record.bookmark || 'N/A'}):`);

          fieldNames.slice(0, 5).forEach(fieldName => {
            const field = record.fields[fieldName];
            const valueStr = field.value !== null
              ? (typeof field.value === 'string' ? `"${field.value}"` : String(field.value))
              : '<null>';
            console.error(`      ${fieldName} (${field.type}): ${valueStr}`);
          });
        });
      }
    }

    console.error('\n' + '='.repeat(80));
    console.error('[Test] All tests completed!');
    console.error('='.repeat(80) + '\n');

  } catch (error) {
    console.error(`\n[Test] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  } finally {
    await connection.close();
  }
}

// Run tests
testReadPageData().catch(console.error);
