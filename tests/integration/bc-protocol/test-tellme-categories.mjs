/**
 * Test Tell Me search to see what categories BC returns
 */

import { BCRawWebSocketClient } from './dist/connection/clients/BCRawWebSocketClient.js';
import { extractTellMeResultsFromChangeHandler } from './dist/protocol/logical-form-parser.js';
import { decompressResponse } from './dist/util/loadform-helpers.js';
import { writeFileSync } from 'fs';

const baseUrl = 'http://Cronus27/BC/';
const username = 'sshadows';
const password = '1234';
const tenantId = 'default';

async function testCategories() {
  console.log('🔍 Testing Tell Me categories for "sales order"\n');

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

    const sessionId = client.getSessionId();
    const spaInstanceId = sessionId.split('#')[0];

    // Open Tell Me dialog
    const dialogHandlers = await client.invoke({
      interactionName: 'InvokeSessionAction',
      namedParameters: { systemAction: 220 },
    });

    // Find Tell Me dialog formId
    const dialogFormId = dialogHandlers.find(h =>
      h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      h.parameters?.[0] === 'FormToShow'
    )?.parameters?.[1]?.ServerId;

    console.log(`Tell Me dialog FormId: ${dialogFormId}\n`);

    // Search for "sales order"
    await client.invoke({
      interactionName: 'SaveValue',
      namedParameters: { newValue: '' },
      controlPath: `server:${dialogFormId}:c[0]:c[0]`,
    });

    const searchHandlers = await client.invoke({
      interactionName: 'SaveValue',
      namedParameters: { newValue: 'sales order' },
      controlPath: `server:${dialogFormId}:c[0]:c[0]`,
    });

    const decompressed = decompressResponse(searchHandlers) || searchHandlers;
    const resultsResult = extractTellMeResultsFromChangeHandler(decompressed);

    if (!resultsResult.ok) {
      console.error('Failed to parse results:', resultsResult.error.message);
      process.exit(1);
    }

    const results = resultsResult.value;

    // Group by category
    const byCategory = {};
    results.forEach(r => {
      const cat = r.category || '(no category)';
      if (!byCategory[cat]) {
        byCategory[cat] = [];
      }
      byCategory[cat].push({
        name: r.name,
        objectId: r.objectId,
        context: r.context,
      });
    });

    console.log(`Found ${results.length} total results\n`);
    console.log('Results grouped by category:\n');

    for (const [category, items] of Object.entries(byCategory)) {
      console.log(`📁 "${category}": ${items.length} items`);
      items.slice(0, 3).forEach((item, i) => {
        console.log(`   ${i + 1}. ${item.name} (${item.objectId || 'no ID'})`);
        if (item.context) console.log(`      Context: ${item.context}`);
      });
      if (items.length > 3) {
        console.log(`   ... and ${items.length - 3} more`);
      }
      console.log('');
    }

    // Save full results
    writeFileSync('tellme-categories.json', JSON.stringify({ byCategory, allResults: results }, null, 2));
    console.log('✓ Full results saved to tellme-categories.json');

    await client.disconnect();

  } catch (error) {
    console.error('❌ Error:', error.message);
    await client.disconnect();
    process.exit(1);
  }
}

testCategories();
