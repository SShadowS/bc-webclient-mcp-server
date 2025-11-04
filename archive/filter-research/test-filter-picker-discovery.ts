/**
 * Filter Picker Discovery Test
 *
 * Tests Strategy B from GPT-5 analysis:
 * Use the "Add filter" picker to discover canonical field IDs
 *
 * Steps:
 * 1. Open Customers page
 * 2. Open Filter Pane (Shift+F3)
 * 3. Open "Add filter" picker
 * 4. Type column name (e.g., "Name")
 * 5. Inspect picker items for canonical IDs
 */

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import { writeFile } from 'fs/promises';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Filter Picker Discovery Test');
  console.log('  Testing Strategy B: UI-Driven Column ID Discovery');
  console.log('═══════════════════════════════════════════════════════════\n');

  const baseUrl = process.env.BC_BASE_URL || 'http://Cronus27/BC';
  const username = process.env.BC_USERNAME || 'sshadows';
  const password = process.env.BC_PASSWORD || '1234';
  const tenantId = process.env.BC_TENANT_ID || 'default';

  const client = new BCRawWebSocketClient(
    { baseUrl } as any,
    username,
    password,
    tenantId
  );

  try {
    // Connect
    console.log('[1/5] Connecting to BC...');
    await client.authenticateWeb();
    await client.connect();
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '27.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });
    console.log('✓ Connected\n');

    // Open Customers page
    console.log('[2/5] Opening Customers page (Page 22)...');
    const queryString = `tenant=${tenantId}&page=22&runinframe=1&dc=${Date.now()}`;

    const openFormResult = await client.invoke({
      interactionName: 'OpenForm',
      namedParameters: {
        query: queryString,
      },
      controlPath: 'server:c[0]',
      callbackId: '1',
    } as any);

    const formHandler = openFormResult.find((h: any) =>
      h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      h.parameters?.[0] === 'FormToShow'
    );

    if (!formHandler || !formHandler.parameters?.[1]?.ServerId) {
      throw new Error('Could not extract formId');
    }

    const formId = formHandler.parameters[1].ServerId;
    console.log(`✓ Page opened, formId: ${formId}\n`);

    await new Promise(r => setTimeout(r, 2000));

    // Open Filter Pane (Shift+F3 equivalent)
    console.log('[3/5] Opening Filter Pane...');
    console.log('Note: Need to determine the correct command for opening filter pane\n');

    // For now, let's try to find the filter pane control in the response
    console.log('Analyzing page structure for filter pane controls...\n');

    // Save the full response for analysis
    await writeFile(
      'filter-pane-investigation.json',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        formId,
        openFormResponse: openFormResult,
      }, null, 2)
    );

    console.log('✓ Saved response to: filter-pane-investigation.json\n');

    // TODO: Implement filter pane opening
    console.log('[4/5] TODO: Open "Add filter" picker');
    console.log('  - Need to identify filter pane control path');
    console.log('  - Need to send appropriate command/interaction\n');

    console.log('[5/5] TODO: Inspect picker items for canonical IDs');
    console.log('  - Expected format: 18_Customer.2');
    console.log('  - Should include both caption and ID\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  NEXT STEPS');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('1. Analyze filter-pane-investigation.json for:');
    console.log('   - Filter pane control paths');
    console.log('   - "Add filter" button/control');
    console.log('   - Available commands for opening filter UI\n');

    console.log('2. Manual testing in browser:');
    console.log('   - Press Shift+F3 to open filter pane');
    console.log('   - Click "Add filter"');
    console.log('   - Capture the WebSocket messages\n');

    console.log('3. Implement the complete flow:');
    console.log('   - Open filter pane programmatically');
    console.log('   - Trigger "Add filter" picker');
    console.log('   - Parse picker items for canonical IDs');
    console.log('   - Select field and apply filter');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  } finally {
    if (client && client.websocket) {
      client.websocket.close();
    }
  }
}

main().catch(console.error);
