/**
 * Test Page 5353 via get_page_metadata tool (should now show clear error)
 */

import { GetPageMetadataTool } from './dist/tools/get-page-metadata-tool.js';

const baseUrl = 'http://Cronus27/BC/';
const username = 'sshadows';
const password = '1234';
const tenantId = 'default';

async function testPage5353MCP() {
  console.log('🧪 Testing Page 5353 via get_page_metadata (should show clear dialog error)\n');

  const tool = new GetPageMetadataTool({
    baseUrl,
    username,
    password,
    tenantId,
  });

  try {
    const result = await tool.execute({ pageId: '5353' });

    if (!result.ok) {
      console.log('❌ Tool returned error (EXPECTED):');
      console.log(`   Message: ${result.error.message}`);
      console.log(`   Type: ${result.error.constructor.name}`);
      if (result.error.context) {
        console.log(`   Dialog Caption: ${result.error.context.dialogCaption}`);
        console.log(`   Dialog Message: ${result.error.context.dialogMessage}`);
      }
      console.log('\n✅ SUCCESS: Error message is now clear and helpful!');
      process.exit(0);
    } else {
      console.log('❌ UNEXPECTED: Tool succeeded when it should have failed');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    process.exit(1);
  }
}

testPage5353MCP();
