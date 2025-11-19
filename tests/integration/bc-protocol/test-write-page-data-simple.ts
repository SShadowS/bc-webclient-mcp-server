/**
 * Simple test for write_page_data tool
 *
 * Tests basic write functionality on Customer Card (Page 21)
 */

import { BCPageConnection } from './src/connection/bc-page-connection.js';
import { WritePageDataTool } from './src/tools/write-page-data-tool.js';
import { ExecuteActionTool } from './src/tools/execute-action-tool.js';
import { GetPageMetadataTool } from './src/tools/get-page-metadata-tool.js';
import { ReadPageDataTool } from './src/tools/read-page-data-tool.js';
import { isOk } from './src/core/result.js';

const BASE_URL = 'http://Cronus27/BC';
const USERNAME = 'sshadows';
const PASSWORD = '1234';
const TENANT = 'default';

async function testWritePageData() {
  console.error('\n=== Testing write_page_data Tool ===\n');

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
    if (!isOk(sessionResult)) {
      throw new Error(`Failed to connect: ${sessionResult.error.message}`);
    }
    console.error('[Test] Connected successfully\n');

    const getMetadataTool = new GetPageMetadataTool(connection);
    const readDataTool = new ReadPageDataTool(connection);
    const executeActionTool = new ExecuteActionTool(connection);
    const writeDataTool = new WritePageDataTool(connection);

    // Test 1: Open Customer Card (Page 21)
    console.error('\n' + '='.repeat(80));
    console.error('[Test 1] Opening Customer Card (Page 21)');
    console.error('='.repeat(80) + '\n');

    const metadataResult = await getMetadataTool.execute({ pageId: '21' });
    if (!isOk(metadataResult)) {
      throw new Error(`Failed to open page: ${metadataResult.error.message}`);
    }

    const metadata = metadataResult.value;
    console.error(`[Test 1] Success! Page opened: ${metadata.caption}`);
    console.error(`[Test 1] Available fields: ${metadata.fields.length}`);
    console.error(`[Test 1] Available actions: ${metadata.actions.length}`);

    // Test 2: Read current data
    console.error('\n' + '='.repeat(80));
    console.error('[Test 2] Reading current record data');
    console.error('='.repeat(80) + '\n');

    const readResult = await readDataTool.execute({ pageId: '21' });
    if (!isOk(readResult)) {
      throw new Error(`Failed to read data: ${readResult.error.message}`);
    }

    const currentData = readResult.value;
    console.error(`[Test 2] Success! Read ${Object.keys(currentData.records[0].fields).length} fields`);

    // Show current values for fields we'll update
    const currentName = currentData.records[0].fields['Name']?.value;
    const currentPhone = currentData.records[0].fields['Phone No.']?.value;
    console.error(`[Test 2] Current Name: "${currentName}"`);
    console.error(`[Test 2] Current Phone: "${currentPhone}"`);

    // Test 3: Execute Edit action (required before writing)
    console.error('\n' + '='.repeat(80));
    console.error('[Test 3] Executing "Edit" action to enable editing');
    console.error('='.repeat(80) + '\n');

    const editResult = await executeActionTool.execute({
      pageId: '21',
      actionName: 'Edit',
    });

    if (!isOk(editResult)) {
      console.error(`[Test 3] WARNING: Edit action failed: ${editResult.error.message}`);
      console.error(`[Test 3] Continuing anyway - record may already be in edit mode`);
    } else {
      console.error(`[Test 3] Success! Record is now in edit mode`);
    }

    // Test 4: Write data (update multiple fields)
    console.error('\n' + '='.repeat(80));
    console.error('[Test 4] Writing data - Update multiple fields');
    console.error('='.repeat(80) + '\n');

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    const newName = `Test Customer ${timestamp}`;
    const newPhone = '+1-555-TEST';

    console.error(`[Test 4] Updating fields:`);
    console.error(`  Name: "${newName}"`);
    console.error(`  Phone No.: "${newPhone}"`);

    const writeResult = await writeDataTool.execute({
      pageId: '21',
      fields: {
        'Name': newName,
        'Phone No.': newPhone,
      },
    });

    if (!isOk(writeResult)) {
      console.error(`[Test 4] ERROR: ${writeResult.error.message}`);
      throw new Error(`Write failed: ${writeResult.error.message}`);
    }

    const writeData = writeResult.value;
    if (writeData.success) {
      console.error(`[Test 4] SUCCESS! ${writeData.message}`);
      console.error(`[Test 4] Updated fields: ${writeData.updatedFields?.join(', ')}`);
    } else {
      console.error(`[Test 4] PARTIAL SUCCESS: ${writeData.message}`);
      if (writeData.updatedFields) {
        console.error(`[Test 4] Updated: ${writeData.updatedFields.join(', ')}`);
      }
      if (writeData.failedFields) {
        console.error(`[Test 4] Failed: ${writeData.failedFields.join(', ')}`);
      }
    }

    // Test 5: Verify the changes by reading again
    console.error('\n' + '='.repeat(80));
    console.error('[Test 5] Verifying changes by re-reading data');
    console.error('='.repeat(80) + '\n');

    const verifyResult = await readDataTool.execute({ pageId: '21' });
    if (!isOk(verifyResult)) {
      console.error(`[Test 5] WARNING: Failed to verify: ${verifyResult.error.message}`);
    } else {
      const verifiedData = verifyResult.value;
      const verifiedName = verifiedData.records[0].fields['Name']?.value;
      const verifiedPhone = verifiedData.records[0].fields['Phone No.']?.value;

      console.error(`[Test 5] Verified Name: "${verifiedName}"`);
      console.error(`[Test 5] Verified Phone: "${verifiedPhone}"`);

      if (verifiedName === newName) {
        console.error(`[Test 5] ✓ Name update VERIFIED`);
      } else {
        console.error(`[Test 5] ✗ Name update NOT VERIFIED (expected "${newName}", got "${verifiedName}")`);
      }

      if (verifiedPhone === newPhone) {
        console.error(`[Test 5] ✓ Phone update VERIFIED`);
      } else {
        console.error(`[Test 5] ✗ Phone update NOT VERIFIED (expected "${newPhone}", got "${verifiedPhone}")`);
      }
    }

    console.error('\n' + '='.repeat(80));
    console.error('[Test] All tests completed!');
    console.error('='.repeat(80) + '\n');

  } catch (error) {
    console.error(`\n[Test] FATAL ERROR: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
    process.exit(1);
  } finally {
    await connection.close();
  }
}

// Run test
testWritePageData().catch(console.error);
