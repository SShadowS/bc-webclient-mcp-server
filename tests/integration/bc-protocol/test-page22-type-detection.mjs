/**
 * Test Page 22 type detection after ViewMode/FormStyle fix
 */

import { BCRawWebSocketClient } from './dist/connection/clients/BCRawWebSocketClient.js';
import { IntelligentMetadataParser } from './dist/parsers/intelligent-metadata-parser.js';

const baseUrl = 'http://Cronus27/BC/';
const username = 'sshadows';
const password = '1234';
const tenantId = 'default';

async function testPageTypeDetection() {
  console.log('🧪 Testing Page 22 Type Detection After Fix\n');

  const client = new BCRawWebSocketClient(
    { baseUrl },
    username,
    password,
    tenantId
  );

  try {
    console.log('1. Connecting to BC...');
    await client.authenticateWeb();
    await client.connect();
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '27.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });

    const roleCenterId = client.getRoleCenterFormId();
    console.log(`   Role Center ID: ${roleCenterId}\n`);

    // Open Page 22 (Customer List)
    console.log('2. Opening Page 22 (Customer List)...');
    const handlers = await client.invoke({
      interactionName: 'OpenForm',
      namedParameters: {
        query: `tenant=${tenantId}&company=CRONUS%20Danmark%20A%2FS&page=22&runinframe=1&dc=${Date.now()}`,
      },
      openFormIds: [roleCenterId],
    });

    console.log('3. Parsing with IntelligentMetadataParser...');
    const parser = new IntelligentMetadataParser();
    const result = parser.parse(handlers);

    if (!result.ok) {
      console.error('❌ Parser failed:', result.error);
      process.exit(1);
    }

    const metadata = result.value;

    console.log('\n📊 Detection Results:');
    console.log('  Page ID:', metadata.pageId);
    console.log('  Title:', metadata.title);
    console.log('  Purpose:', metadata.summary.purpose);
    console.log('  Capabilities:', metadata.summary.capabilities);

    // Verify page type is detected correctly
    const purpose = metadata.summary.purpose;
    const isListType = purpose.includes('Browse') || metadata.summary.capabilities.includes('filter');

    if (isListType) {
      console.log('\n✅ SUCCESS: Page 22 correctly detected as List type!');
      console.log('   (Purpose includes "Browse" or capabilities include filtering)');
    } else {
      console.log('\n❌ FAILED: Page 22 still incorrectly detected as Card type!');
      console.log('   Purpose should include "Browse" for List pages');
      process.exit(1);
    }

    await client.disconnect();

  } catch (error) {
    console.error('❌ Error:', error.message);
    await client.disconnect();
    process.exit(1);
  }
}

testPageTypeDetection();
