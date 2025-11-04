/**
 * Dataset Metadata Investigation
 *
 * Opens Customers page and examines LoadForm responses to discover:
 * 1. Dataset structure (dataSetId)
 * 2. Column metadata (fieldIds, names, types)
 * 3. Control paths for list controls
 *
 * This will inform the implementation of dataset-driven filtering.
 */

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import { writeFile } from 'fs/promises';
import { bcConfig } from './src/core/config.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Dataset Metadata Investigation');
  console.log('  Target: Customers List (Page 22)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const { baseUrl, username, password, tenantId } = bcConfig;

  const client = new BCRawWebSocketClient(
    { baseUrl } as any,
    username,
    password,
    tenantId
  );

  try {
    // Connect and authenticate
    console.log('[1/3] Connecting to BC...');
    await client.authenticateWeb();
    await client.connect();
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '27.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });
    console.log('✓ Connected\n');

    // Open Customers list page
    console.log('[2/3] Opening Customers page (Page 22)...');

    const queryString = `tenant=${tenantId}&page=22&runinframe=1&dc=${Date.now()}`;

    const openFormResult = await client.invoke({
      interactionName: 'OpenForm',
      namedParameters: {
        query: queryString,
      },
      controlPath: 'server:c[0]',
      callbackId: '1',
    } as any);

    console.log(`✓ OpenForm returned ${openFormResult.length} handlers\n`);

    // Extract formId
    const formHandler = openFormResult.find((h: any) =>
      h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      h.parameters?.[0] === 'FormToShow'
    );

    if (!formHandler || !formHandler.parameters?.[1]?.ServerId) {
      throw new Error('Could not extract formId from OpenForm response');
    }

    const formId = formHandler.parameters[1].ServerId;
    console.log(`Form ID: ${formId}\n`);

    // Wait for page to stabilize
    await new Promise(r => setTimeout(r, 2000));

    console.log('[3/3] Analyzing handlers for dataset metadata...\n');

    // Look for LogicalClientChangeHandler with dataset information
    const changeHandlers = openFormResult.filter((h: any) =>
      h.handlerType === 'DN.LogicalClientChangeHandler'
    );

    console.log(`Found ${changeHandlers.length} LogicalClientChangeHandler(s)\n`);

    // Analyze each change handler
    const datasetInfo: any[] = [];

    for (let i = 0; i < changeHandlers.length; i++) {
      const handler = changeHandlers[i];
      const changes = handler.parameters?.[1] || [];

      console.log(`\nHandler ${i + 1}:`);
      console.log(`  FormId: ${handler.parameters?.[0]}`);
      console.log(`  Changes: ${changes.length}`);

      // Look for dataset-related changes
      changes.forEach((change: any, idx: number) => {
        const changeType = change.t;
        console.log(`    [${idx}] Type: ${changeType}`);

        if (changeType === 'DataSetUpdate' || changeType === 'DataRefreshChange' ||
            changeType === 'ReplaceData' || changeType === 'ViewPortUpdate') {
          console.log(`      ✓ Dataset change detected!`);

          // Extract dataset metadata
          const metadata = {
            changeType,
            controlReference: change.ControlReference,
            dataSetId: change.DataSetId,
            columns: change.Columns,
            rowChanges: change.RowChanges,
            updates: change.Updates,
            rawChange: change,
          };

          datasetInfo.push(metadata);

          if (change.Columns) {
            console.log(`      Columns: ${change.Columns.length}`);
            change.Columns.slice(0, 3).forEach((col: any, colIdx: number) => {
              console.log(`        [${colIdx}] ${col.caption || col.name || 'unknown'}: ${col.id || col.fieldId || '?'}`);
            });
          }
        }
      });
    }

    // Save results
    console.log('\n\n[4/4] Saving results...\n');

    const results = {
      timestamp: new Date().toISOString(),
      formId,
      pageId: '22',
      handlers: {
        total: openFormResult.length,
        changeHandlers: changeHandlers.length,
      },
      datasetInfo,
      fullResponse: openFormResult,
    };

    await writeFile(
      'dataset-metadata-investigation.json',
      JSON.stringify(results, null, 2)
    );

    console.log('✓ Results saved to: dataset-metadata-investigation.json\n');

    // Summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  INVESTIGATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`Form ID: ${formId}`);
    console.log(`Dataset changes found: ${datasetInfo.length}`);

    if (datasetInfo.length > 0) {
      console.log('\nDataset structures:');
      datasetInfo.forEach((ds, idx) => {
        console.log(`  ${idx + 1}. Type: ${ds.changeType}`);
        if (ds.dataSetId) console.log(`     DataSetId: ${ds.dataSetId}`);
        if (ds.columns) console.log(`     Columns: ${ds.columns.length}`);
      });
    }

    console.log('\nNext steps:');
    console.log('1. Review dataset-metadata-investigation.json for full structure');
    console.log('2. Identify column naming conventions (id vs fieldId)');
    console.log('3. Determine how to select searchable columns');
    console.log('4. Implement dataset filter with discovered column IDs');

  } catch (error) {
    console.error('\n❌ Investigation failed:', error);
    throw error;
  } finally {
    // Close WebSocket connection
    if (client && client.websocket) {
      client.websocket.close();
    }
  }
}

main().catch(console.error);
