/**
 * Test opening Page 5353 (Sales Orders - Microsoft Dynamics 365 Sales)
 */

import { BCRawWebSocketClient } from './dist/connection/clients/BCRawWebSocketClient.js';

const baseUrl = 'http://Cronus27/BC/';
const username = 'sshadows';
const password = '1234';
const tenantId = 'default';

async function testPage5353() {
  console.log('🧪 Testing Page 5353 (Sales Orders - Microsoft Dynamics 365 Sales)\n');

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
    console.log('Opening Page 5353...');

    const handlers = await client.invoke({
      interactionName: 'OpenForm',
      namedParameters: {
        query: `tenant=${tenantId}&company=CRONUS%20Danmark%20A%2FS&page=5353&runinframe=1&dc=${Date.now()}`,
      },
      openFormIds: [roleCenterId],
    });

    console.log(`\nReceived ${handlers.length} handlers:`);
    handlers.forEach((h, i) => {
      console.log(`  [${i}] ${h.handlerType}`);
    });

    // Look for FormToShow
    const formToShow = handlers.find(h =>
      h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      h.parameters?.[0] === 'FormToShow'
    );

    if (formToShow) {
      console.log('\n✅ FormToShow found!');
      const logicalForm = formToShow.parameters[1];
      console.log(`   Caption: ${logicalForm.Caption}`);
      console.log(`   ViewMode: ${logicalForm.ViewMode}`);
      console.log(`   FormStyle: ${logicalForm.FormStyle}`);
    } else {
      console.log('\n❌ No FormToShow event found');
    }

    await client.disconnect();

  } catch (error) {
    console.error('❌ Error:', error.message);
    await client.disconnect();
    process.exit(1);
  }
}

testPage5353();
