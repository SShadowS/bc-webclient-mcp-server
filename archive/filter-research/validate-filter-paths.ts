/**
 * Validate Filter Control Paths
 *
 * This script tests different control path patterns for the filter control
 * on the Customers list page and examines their metadata to determine:
 *
 * 1. Which path pattern is correct
 * 2. What control properties are available for verification
 * 3. How to identify search/filter controls programmatically
 */

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import { writeFile } from 'fs/promises';
import * as dotenv from 'dotenv';

dotenv.config();

interface ControlMetadata {
  path: string;
  exists: boolean;
  properties?: any;
  controlType?: string;
  templateKey?: string;
  error?: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Filter Control Path Validation');
  console.log('  Testing Customers List (Page 22, formId 601)');
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
    // Connect and authenticate
    console.log('[1/4] Connecting to BC...');
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
    console.log('[2/4] Opening Customers page (Page 22)...');

    // Navigate to page 22 using query string (matching real BC protocol)
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

    // Wait for form to stabilize
    await new Promise(r => setTimeout(r, 2000));

    // Extract formId from response
    let formId: string | null = null;

    // Look for DN.LogicalClientEventRaisingHandler with FormToShow
    const formHandler = openFormResult.find((h: any) =>
      h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      h.parameters?.[0] === 'FormToShow'
    );

    if (formHandler && formHandler.parameters?.[1]?.ServerId) {
      formId = formHandler.parameters[1].ServerId;
      console.log(`✓ Page loaded, formId: ${formId}\n`);
    } else {
      console.error('⚠️ Could not extract formId from OpenForm response');
      console.error('Using default formId: 601\n');
      formId = '601';
    }

    // Test different control path patterns
    console.log('[3/4] Testing control path patterns...\n');

    const pathsToTest = [
      'server:c[2]/c[2]/c[1]',  // From captured interaction
      'server:c[2]/c[1]',       // Simpler variant
      'server:c[1]/c[2]/c[1]',  // Different parent
      'server:c[2]/c[2]/c[2]',  // Different index
      'server:c[2]',            // List control itself
      'server:c[2]/c[1]',       // First child of list
      'server:c[2]/c[2]',       // Second child of list (filter container?)
    ];

    const results: ControlMetadata[] = [];

    for (const path of pathsToTest) {
      console.log(`Testing: ${path}`);

      try {
        // Try to get control metadata by sending a GetControlMetadata or ReadProperty interaction
        // Since we don't have a direct metadata API, we'll try to interact with it

        // Strategy: Try to read a property from the control
        const testResult = await client.invoke({
          interactionName: 'SaveValue',
          skipExtendingSessionLifetime: false,
          namedParameters: {
            key: null,
            newValue: '',  // Empty value to test if control accepts input
            alwaysCommitChange: false,
            ignoreForSavingState: true,
            notifyBusy: 0,
            telemetry: {
              'Control name': 'FilterValidationTest',
              'QueuedTime': new Date().toISOString(),
            },
          },
          controlPath: path,
          formId,
          callbackId: `test_${path.replace(/[^a-z0-9]/gi, '_')}`,
        } as any);

        // If no error, the control exists and accepts SaveValue
        console.log(`  ✓ Control exists and accepts SaveValue`);

        results.push({
          path,
          exists: true,
          properties: testResult,
        });

      } catch (error: any) {
        console.log(`  ✗ Error: ${error.message?.substring(0, 100)}`);

        results.push({
          path,
          exists: false,
          error: error.message,
        });
      }

      console.log('');
      await new Promise(r => setTimeout(r, 500)); // Small delay between tests
    }

    // Now try the known working path with an actual filter value
    console.log('[4/4] Testing actual filter operation...\n');

    const workingPath = 'server:c[2]/c[2]/c[1]'; // From capture

    console.log(`Applying filter "Adatum" to: ${workingPath}`);

    const filterResult = await client.invoke({
      interactionName: 'SaveValue',
      skipExtendingSessionLifetime: false,
      namedParameters: {
        key: null,
        newValue: 'Adatum',
        alwaysCommitChange: true,
        ignoreForSavingState: true,
        notifyBusy: 1,
        telemetry: {
          'Control name': 'Name',
          'QueuedTime': new Date().toISOString(),
        },
      },
      controlPath: workingPath,
      formId,
      callbackId: 'filter_test',
    } as any);

    console.log(`✓ Filter applied, received ${filterResult.length} handler responses\n`);

    // Analyze the responses for dataset changes
    const datasetChanges = filterResult.filter((h: any) =>
      h.handlerType === 'DN.LogicalClientChangeHandler' &&
      h.parameters?.[1]?.some((change: any) =>
        change.t === 'DataRefreshChange' ||
        change.t === 'DataSetUpdate' ||
        change.t === 'ReplaceData' ||
        change.t === 'ViewPortUpdate'
      )
    );

    console.log(`Dataset changes detected: ${datasetChanges.length}`);
    if (datasetChanges.length > 0) {
      const changeTypes = datasetChanges.flatMap((h: any) =>
        h.parameters[1]
          .filter((c: any) => c.t)
          .map((c: any) => c.t)
      );
      console.log(`Change types: ${[...new Set(changeTypes)].join(', ')}`);
    }

    // Save results
    console.log('\n[5/5] Saving results...');

    await writeFile(
      'filter-path-validation.json',
      JSON.stringify({
        timestamp: new Date().toISOString(),
        formId,
        pathTests: results,
        filterTest: {
          path: workingPath,
          responses: filterResult,
          datasetChanges: datasetChanges.map((h: any) => ({
            handlerType: h.handlerType,
            changeTypes: h.parameters[1]
              .filter((c: any) => c.t)
              .map((c: any) => c.t),
          })),
        },
      }, null, 2)
    );

    console.log('✓ Results saved to: filter-path-validation.json\n');

    // Summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  VALIDATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');

    const working = results.filter(r => r.exists);
    const failing = results.filter(r => !r.exists);

    console.log(`Working paths: ${working.length}/${results.length}`);
    working.forEach(r => console.log(`  ✓ ${r.path}`));
    console.log('');

    if (failing.length > 0) {
      console.log(`Failed paths: ${failing.length}/${results.length}`);
      failing.forEach(r => console.log(`  ✗ ${r.path}`));
      console.log('');
    }

    console.log('Next steps:');
    console.log('1. Review filter-path-validation.json for detailed results');
    console.log('2. Examine control properties in working paths');
    console.log('3. Identify patterns for control type verification');
    console.log('4. Implement robust path resolution with verification');

  } catch (error) {
    console.error('\n❌ Validation failed:', error);
    throw error;
  } finally {
    // Close WebSocket connection
    if (client && client.websocket) {
      client.websocket.close();
    }
  }
}

main().catch(console.error);
