/**
 * Test all page types are correctly detected with ViewMode/FormStyle
 */

import { BCRawWebSocketClient } from './dist/connection/clients/BCRawWebSocketClient.js';
import { IntelligentMetadataParser } from './dist/parsers/intelligent-metadata-parser.js';

const baseUrl = 'http://Cronus27/BC/';
const username = 'sshadows';
const password = '1234';
const tenantId = 'default';

const TEST_PAGES = [
  { id: '21', name: 'Customer Card', expectedType: 'Card', expectedPurpose: 'View and edit' },
  { id: '22', name: 'Customer List', expectedType: 'List', expectedPurpose: 'Browse' },
  { id: '42', name: 'Sales Order', expectedType: 'Document', expectedPurpose: 'Create and process' },
  { id: '251', name: 'General Journal', expectedType: 'Worksheet', expectedPurpose: 'Enter and calculate' },
];

async function testAllPageTypes() {
  console.log('🧪 Testing All Page Types Detection\n');

  const client = new BCRawWebSocketClient(
    { baseUrl },
    username,
    password,
    tenantId
  );

  try {
    await client.authenticateWeb();
    await client.connect();
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '27.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });

    const roleCenterId = client.getRoleCenterFormId();
    const parser = new IntelligentMetadataParser();
    let passCount = 0;
    let failCount = 0;

    for (const testPage of TEST_PAGES) {
      console.log(`\n📄 Testing Page ${testPage.id} (${testPage.name})...`);

      const handlers = await client.invoke({
        interactionName: 'OpenForm',
        namedParameters: {
          query: `tenant=${tenantId}&company=CRONUS%20Danmark%20A%2FS&page=${testPage.id}&runinframe=1&dc=${Date.now()}`,
        },
        openFormIds: [roleCenterId],
      });

      const result = parser.parse(handlers);

      if (!result.ok) {
        console.error(`   ❌ Parser failed: ${result.error.message}`);
        failCount++;
        continue;
      }

      const metadata = result.value;
      const purposeMatches = metadata.summary.purpose.includes(testPage.expectedPurpose);

      console.log(`   Title: ${metadata.title}`);
      console.log(`   Purpose: ${metadata.summary.purpose}`);
      console.log(`   Capabilities: ${metadata.summary.capabilities.join(', ')}`);

      if (purposeMatches) {
        console.log(`   ✅ PASS: Detected as ${testPage.expectedType}`);
        passCount++;
      } else {
        console.log(`   ❌ FAIL: Expected purpose to include "${testPage.expectedPurpose}"`);
        failCount++;
      }
    }

    await client.disconnect();

    console.log(`\n\n📊 Test Summary:`);
    console.log(`   ✅ Passed: ${passCount}/${TEST_PAGES.length}`);
    console.log(`   ❌ Failed: ${failCount}/${TEST_PAGES.length}`);

    if (failCount === 0) {
      console.log('\n🎉 All page types correctly detected!');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some page types failed detection');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    await client.disconnect();
    process.exit(1);
  }
}

testAllPageTypes();
