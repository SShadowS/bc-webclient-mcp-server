/**
 * Test Page 9305 (Sales Orders) data extraction
 */

import { BCRawWebSocketClient } from './dist/connection/clients/BCRawWebSocketClient.js';
import { decompressResponse } from './dist/util/loadform-helpers.js';
import { writeFileSync } from 'fs';

const baseUrl = 'http://Cronus27/BC/';
const username = 'sshadows';
const password = '1234';
const tenantId = 'default';

async function testPage9305Data() {
  console.log('🧪 Testing Page 9305 (Sales Orders) data extraction\n');

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
    console.log('1. Opening Page 9305...');

    const openHandlers = await client.invoke({
      interactionName: 'OpenForm',
      namedParameters: {
        query: `tenant=${tenantId}&company=CRONUS%20Danmark%20A%2FS&page=9305&runinframe=1&dc=${Date.now()}`,
      },
      openFormIds: [roleCenterId],
    });

    console.log(`   Received ${openHandlers.length} handlers from OpenForm`);

    // Save OpenForm response
    writeFileSync('page9305-open-handlers.json', JSON.stringify(openHandlers, null, 2));
    console.log('   Saved to page9305-open-handlers.json\n');

    // Try RefreshForm
    console.log('2. Calling RefreshForm...');
    const refreshHandlers = await client.invoke({
      interactionName: 'RefreshForm',
      namedParameters: {},
      controlPath: 'server:c[0]',
      callbackId: '0',
    });

    console.log(`   Received ${refreshHandlers.length} handlers from RefreshForm`);

    // Check if compressed
    const decompressed = decompressResponse(refreshHandlers);
    if (decompressed) {
      console.log(`   ✓ Response was compressed, decompressed to ${decompressed.length} handlers`);
      writeFileSync('page9305-refresh-handlers.json', JSON.stringify(decompressed, null, 2));
    } else {
      console.log('   Response not compressed');
      writeFileSync('page9305-refresh-handlers.json', JSON.stringify(refreshHandlers, null, 2));
    }
    console.log('   Saved to page9305-refresh-handlers.json\n');

    // Analyze handlers
    const dataToProcess = decompressed || refreshHandlers;
    console.log('3. Analyzing handlers:');

    const handlerTypes = {};
    dataToProcess.forEach(h => {
      handlerTypes[h.handlerType] = (handlerTypes[h.handlerType] || 0) + 1;
    });

    for (const [type, count] of Object.entries(handlerTypes)) {
      console.log(`   ${type}: ${count}`);
    }

    // Look for data-containing handlers
    console.log('\n4. Looking for data handlers:');

    const changeHandler = dataToProcess.find(h => h.handlerType === 'DN.LogicalClientChangeHandler');
    if (changeHandler) {
      console.log('   ✓ Found LogicalClientChangeHandler');
      const changes = changeHandler.parameters?.[1];
      if (Array.isArray(changes)) {
        console.log(`   Changes array has ${changes.length} items:`);
        changes.forEach((c, i) => {
          console.log(`     [${i}] ${c.t} - controlPath: ${c.ControlReference?.controlPath}`);
          if (c.RowChanges) {
            console.log(`        RowChanges: ${c.RowChanges.length} rows`);
          }
        });
      }
    } else {
      console.log('   ❌ No LogicalClientChangeHandler found');
    }

    // Check FormToShow for LogicalForm
    const formToShow = dataToProcess.find(h =>
      h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      h.parameters?.[0] === 'FormToShow'
    );

    if (formToShow) {
      const logicalForm = formToShow.parameters[1];
      console.log('\n5. LogicalForm info:');
      console.log(`   Caption: ${logicalForm.Caption}`);
      console.log(`   ViewMode: ${logicalForm.ViewMode}`);
      console.log(`   FormStyle: ${logicalForm.FormStyle}`);

      // Check for repeater controls (list data)
      const controls = logicalForm?.LogicalForm?.Controls;
      if (controls) {
        console.log(`   Controls: ${controls.length}`);
        controls.forEach((ctrl, i) => {
          if (ctrl.type === 'repeater' || ctrl.type === 'Repeater') {
            console.log(`   [${i}] Repeater found: ${ctrl.id || ctrl.Id}`);
            if (ctrl.Value || ctrl.Properties?.Value) {
              const value = ctrl.Value || ctrl.Properties.Value;
              console.log(`      Value is array: ${Array.isArray(value)}, length: ${value?.length || 0}`);
            }
          }
        });
      }
    }

    await client.disconnect();

  } catch (error) {
    console.error('❌ Error:', error.message);
    await client.disconnect();
    process.exit(1);
  }
}

testPage9305Data();
