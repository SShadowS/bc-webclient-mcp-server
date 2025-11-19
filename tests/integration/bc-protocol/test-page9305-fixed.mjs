/**
 * Test Page 9305 (Sales Orders) list data extraction with event-driven pattern
 */

import { GetPageMetadataTool } from './dist/tools/get-page-metadata-tool.js';
import { ReadPageDataTool } from './dist/tools/read-page-data-tool.js';

const baseUrl = 'http://Cronus27/BC/';
const username = 'sshadows';
const password = '1234';
const tenantId = 'default';

async function testPage9305Fixed() {
  console.log('🧪 Testing Page 9305 (Sales Orders) with event-driven data extraction\n');

  const metadataTool = new GetPageMetadataTool({
    baseUrl,
    username,
    password,
    tenantId,
  });

  const readDataTool = new ReadPageDataTool({
    baseUrl,
    username,
    password,
    tenantId,
  });

  try {
    // Step 1: Get page metadata
    console.log('1. Getting page metadata...');
    const metadataResult = await metadataTool.execute({ pageId: '9305' });

    if (!metadataResult.ok) {
      console.error('❌ Failed to get metadata:', metadataResult.error.message);
      process.exit(1);
    }

    const metadata = metadataResult.value;
    console.log(`   ✓ Page: ${metadata.caption}`);
    console.log(`   ✓ Type: ${metadata.pageType}`);
    console.log(`   ✓ Page Context ID: ${metadata.pageContextId}\n`);

    // Step 2: Read page data (should now use event-driven pattern for DelayedControls)
    console.log('2. Reading page data (with event-driven pattern)...');
    const dataResult = await readDataTool.execute({
      pageContextId: metadata.pageContextId,
    });

    if (!dataResult.ok) {
      console.error('❌ Failed to read data:', dataResult.error.message);
      process.exit(1);
    }

    const data = dataResult.value;
    console.log(`   ✓ Records found: ${data.totalCount}`);

    if (data.totalCount > 0) {
      console.log(`\n3. Sample records:`);
      data.records.slice(0, 3).forEach((record, i) => {
        const fields = Object.keys(record.fields);
        console.log(`   Record ${i + 1}:`);
        console.log(`     Fields: ${fields.length}`);
        console.log(`     Sample: ${JSON.stringify(record.fields, null, 2).split('\n').slice(0, 5).join('\n')}`);
      });

      if (data.totalCount >= 9) {
        console.log('\n✅ SUCCESS: Found 9+ records (matches web client!)');
        process.exit(0);
      } else {
        console.log(`\n⚠️  Found ${data.totalCount} records, expected 9+`);
        process.exit(1);
      }
    } else {
      console.log('\n❌ FAILED: No records found (event-driven pattern may not have worked)');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testPage9305Fixed();
