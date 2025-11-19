/**
 * Test Page 5353 to see what event it returns
 */

import { BCRawWebSocketClient } from './dist/connection/clients/BCRawWebSocketClient.js';
import { writeFileSync } from 'fs';

const baseUrl = 'http://Cronus27/BC/';
const username = 'sshadows';
const password = '1234';
const tenantId = 'default';

async function testPage5353() {
  console.log('🧪 Testing Page 5353 handlers in detail\n');

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
    const handlers = await client.invoke({
      interactionName: 'OpenForm',
      namedParameters: {
        query: `tenant=${tenantId}&company=CRONUS%20Danmark%20A%2FS&page=5353&runinframe=1&dc=${Date.now()}`,
      },
      openFormIds: [roleCenterId],
    });

    console.log(`Received ${handlers.length} handlers:\n`);

    handlers.forEach((h, i) => {
      console.log(`[${i}] ${h.handlerType}`);
      if (h.handlerType === 'DN.LogicalClientEventRaisingHandler') {
        console.log(`    Event: ${h.parameters?.[0]}`);
        if (h.parameters?.[1]) {
          const param = h.parameters[1];
          if (typeof param === 'object') {
            console.log(`    Caption: ${param.Caption}`);
            console.log(`    Message: ${param.Message || param.message || 'N/A'}`);
          }
        }
      } else if (h.handlerType === 'DN.CallbackResponseProperties') {
        const result = h.parameters?.[0]?.CompletedInteractions?.[0]?.Result;
        console.log(`    Result reason: ${result?.reason} (0=Success, 1=Error/Navigation)`);
        console.log(`    Result value: ${JSON.stringify(result?.value)}`);
      }
    });

    // Save full handlers
    writeFileSync('page5353-handlers.json', JSON.stringify(handlers, null, 2));
    console.log('\n✓ Full handlers saved to page5353-handlers.json');

    await client.disconnect();

  } catch (error) {
    console.error('❌ Error:', error.message);
    await client.disconnect();
    process.exit(1);
  }
}

testPage5353();
