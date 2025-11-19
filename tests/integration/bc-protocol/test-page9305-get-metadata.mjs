/**
 * Test Page 9305 (Sales Orders) type detection in get_page_metadata
 */

import { BCRawWebSocketClient } from './dist/connection/clients/BCRawWebSocketClient.js';
import { GetPageMetadataTool } from './dist/tools/get-page-metadata-tool.js';

const baseUrl = 'http://Cronus27/BC/';
const username = 'sshadows';
const password = '1234';
const tenantId = 'default';

async function testPage9305() {
  console.log('🧪 Testing Page 9305 (Sales Orders) with get_page_metadata\n');

  const client = new BCRawWebSocketClient(
    { baseUrl },
    username,
    password,
    tenantId
  );

  const tool = new GetPageMetadataTool(
    { baseUrl, username, password, tenantId }
  );

  try {
    console.log('1. Testing get_page_metadata for Page 9305...');

    const result = await tool.execute({ pageId: '9305' });

    if (!result.ok) {
      console.error('❌ Tool failed:', result.error.message);
      process.exit(1);
    }

    const content = JSON.parse(result.value.content[0].text);

    console.log('\n📊 Detection Results:');
    console.log('  Page ID:', content.pageId);
    console.log('  Caption:', content.caption);
    console.log('  Page Type:', content.pageType);
    console.log('  Field Count:', content.fields.length);
    console.log('  Action Count:', content.actions.length);

    if (content.pageType === 'List') {
      console.log('\n✅ SUCCESS: Page 9305 correctly detected as List!');
      process.exit(0);
    } else {
      console.log(`\n❌ FAILED: Page 9305 detected as "${content.pageType}" instead of "List"!`);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testPage9305();
