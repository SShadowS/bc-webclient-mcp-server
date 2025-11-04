/**
 * Test Event-Driven Tell Me Search
 *
 * Quick test to verify the new waitForHandlers approach works for Tell Me dialog.
 */

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import { extractTellMeResultsFromChangeHandler } from './src/protocol/logical-form-parser.js';
import { isOk } from './src/core/result.js';
import { bcConfig } from './src/core/config.js';

async function test() {
  console.error('═══════════════════════════════════════════════════════════');
  console.error('  Event-Driven Tell Me Search Test');
  console.error('═══════════════════════════════════════════════════════════\n');

  const { baseUrl, username, password, tenantId } = bcConfig;

  const client = new BCRawWebSocketClient(
    { baseUrl } as any,
    username,
    password,
    tenantId
  );

  try {
    console.error('[1/3] Authenticating and connecting...');
    await client.authenticateWeb();
    await client.connect();
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '27.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });
    console.error('✓ Connected\n');

    // Extract role center form
    const fs = await import('fs/promises');
    const openSessionData = JSON.parse(
      await fs.readFile('opensession-response.json', 'utf-8')
    );

    const formHandler = openSessionData.find((h: any) =>
      h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      h.parameters?.[0] === 'FormToShow'
    );

    if (!formHandler) {
      throw new Error('No role center form found');
    }

    const ownerFormId = formHandler.parameters[1].ServerId;
    console.error(`[2/3] Opening Tell Me dialog (ownerForm: ${ownerFormId})...\n`);

    // Define predicate to detect dialog
    const isTellMeDialogOpen = (handlers: any[]) => {
      // Look for FormToShow event with dialog form
      const legacy = handlers.find((h: any) =>
        h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
        h.parameters?.[0] === 'FormToShow' &&
        h.parameters?.[1]?.ServerId &&
        h.parameters?.[1]?.Caption?.includes('Tell me')
      );
      if (legacy) {
        console.error(`  → Event: FormToShow detected, ServerId=${legacy.parameters[1].ServerId}, Caption="${legacy.parameters[1].Caption}"`);
        return { matched: true, data: legacy.parameters[1].ServerId };
      }
      return { matched: false };
    };

    // Set up listener FIRST
    console.error('  Setting up event listener for Tell Me dialog...');

    // Trigger action AND wait for event
    console.error('  Sending InvokeSessionAction (systemAction: 220)...');
    const formIdPromise = client.waitForHandlers(isTellMeDialogOpen, 3000);

    const invokePromise = client.invoke({
      interactionName: 'InvokeSessionAction',
      namedParameters: {
        systemAction: 220,
        ownerForm: ownerFormId,
        data: { SearchValue: '' },
      },
      openFormIds: [ownerFormId],
    });

    // Wait for event
    let formId: string;
    try {
      formId = await formIdPromise;
      console.error(`  ✓ Event-driven wait caught Tell Me dialog! formId=${formId}\n`);
    } catch (error) {
      console.error(`  ✗ Event-driven wait timeout: ${error}\n`);

      // Check the invoke response as fallback
      const response = await invokePromise;
      console.error(`  Invoke response had ${Array.isArray(response) ? response.length : 0} handlers`);
      if (Array.isArray(response)) {
        const formToShow = response.find((h: any) =>
          h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
          h.parameters?.[0] === 'FormToShow'
        );
        if (formToShow) {
          formId = formToShow.parameters[1].ServerId;
          console.error(`  → Found Tell Me dialog in invoke response! formId=${formId}\n`);
        } else {
          throw new Error('No Tell Me dialog found in invoke response either');
        }
      } else {
        throw new Error('Invalid invoke response');
      }
    }

    console.error(`[3/3] Submitting search query "customer"...\n`);

    // Define predicate for search results
    const isSearchResults = (handlers: any[]) => {
      // Use the real parser to extract results!
      const bc27Results = extractTellMeResultsFromChangeHandler(handlers);
      if (isOk(bc27Results) && bc27Results.value.length > 0) {
        console.error(`  ✓ Event-driven predicate MATCHED! Found ${bc27Results.value.length} pages`);
        return { matched: true, data: bc27Results.value };
      }
      return { matched: false };
    };

    // Initialize search (required!)
    console.error('  Initializing search with empty value...');
    await client.invoke({
      interactionName: 'SaveValue',
      namedParameters: {
        newValue: '',
        isFilterAsYouType: true,
        alwaysCommitChange: true,
        isFilterOptimized: false,
        isSemanticSearch: false,
      },
      controlPath: 'server:c[0]/c[0]',
      formId: formId,
      openFormIds: [ownerFormId, formId],
    });

    // Submit search and wait for results
    console.error('  Sending search query...');
    const resultsPromise = client.waitForHandlers(isSearchResults, 3000);

    const searchPromise = client.invoke({
      interactionName: 'SaveValue',
      namedParameters: {
        newValue: 'customer',
        isFilterAsYouType: true,
        alwaysCommitChange: true,
        isFilterOptimized: false,
        isSemanticSearch: false,
      },
      controlPath: 'server:c[0]/c[0]',
      formId: formId,
      openFormIds: [ownerFormId, formId],
    });

    let results: any[];
    try {
      results = await resultsPromise;
      console.error(`  ✓ Event-driven wait caught search results!\n`);
    } catch (error) {
      console.error(`  ✗ Event-driven wait timeout: ${error}\n`);

      // Check the invoke response as fallback
      const response = await searchPromise;
      console.error(`  Search response had ${Array.isArray(response) ? response.length : 0} handlers`);
      throw new Error('No search results found');
    }

    console.error('═══════════════════════════════════════════════════════════');
    console.error(`✓ SUCCESS! Found ${results.length} pages via event-driven approach`);
    console.error('═══════════════════════════════════════════════════════════\n');

    await client.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('✗ FAILED:', error);
    await client.disconnect();
    process.exit(1);
  }
}

test();
