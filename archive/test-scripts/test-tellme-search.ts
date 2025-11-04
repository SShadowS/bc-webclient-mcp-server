/**
 * Test script for Tell Me search protocol
 *
 * Demonstrates end-to-end Tell Me search using BCRawWebSocketClient.
 * Tests the decompression and LogicalForm parsing utilities.
 *
 * Usage:
 *   npx tsx test-tellme-search.ts [search-query]
 */

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import { decompressIfNeeded } from './src/protocol/decompression.js';
import {
  extractTellMeResults,
  extractTellMeResultsFromChangeHandler,
  convertToPageSearchResults,
} from './src/protocol/logical-form-parser.js';
import { isOk } from './src/core/result.js';

const BASE_URL = 'http://Cronus27/BC';
const USERNAME = 'sshadows';
const PASSWORD = '1234';
const TENANT_ID = 'default';

async function testTellMeSearch(searchQuery: string) {
  console.log('='.repeat(70));
  console.log('Tell Me Search Test');
  console.log('='.repeat(70));
  console.log(`Query: "${searchQuery}"`);
  console.log();

  // Create client
  const client = new BCRawWebSocketClient(
    { baseUrl: BASE_URL },
    USERNAME,
    PASSWORD,
    TENANT_ID
  );

  try {
    // Step 1: Authenticate
    console.log('[1/5] Authenticating...');
    await client.authenticateWeb();
    console.log('✓ Authenticated');
    console.log();

    // Step 2: Connect WebSocket
    console.log('[2/5] Connecting WebSocket...');
    await client.connect();
    console.log('✓ Connected');
    console.log();

    // Step 3: Open BC session
    console.log('[3/5] Opening BC session...');
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '27.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });
    console.log('✓ Session opened');
    console.log();

    // Step 4: Extract role center form ID from OpenSession response
    // OpenSession automatically creates a role center form that we can use as owner
    console.log('[4/6] Extracting role center form ID from session...');
    const fs = await import('fs/promises');
    const openSessionData = JSON.parse(
      await fs.readFile('opensession-response.json', 'utf-8')
    );

    const formHandler = openSessionData.find((h: any) =>
      h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      h.parameters?.[0] === 'FormToShow'
    );

    if (!formHandler) {
      console.error('✗ No role center form in OpenSession response');
      return;
    }

    const ownerFormId = formHandler.parameters[1].ServerId;
    console.log(`✓ Found role center form: ${ownerFormId} (${formHandler.parameters[1].Caption})`);
    console.log();


    // Step 5: Open Tell Me dialog (systemAction: 220)
    console.log('[5/6] Opening Tell Me dialog...');
    const openResponse = await client.invoke({
      interactionName: 'InvokeSessionAction',
      namedParameters: {
        systemAction: 220,
        ownerForm: ownerFormId,
        data: { SearchValue: '' },
      },
      openFormIds: [ownerFormId],
      callbackId: 'open-tellme',
    });

    // Decompress response
    const decompressedOpen = decompressIfNeeded(openResponse);
    if (!isOk(decompressedOpen)) {
      console.error('✗ Failed to decompress open response:', decompressedOpen.error.message);
      return;
    }

    // Find the LogicalClientEventRaisingHandler with FormToShow
    const handlers = decompressedOpen.value;
    const tellMeFormHandler = Array.isArray(handlers)
      ? handlers.find((h: any) =>
          h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
          h.parameters?.[0] === 'FormToShow'
        )
      : null;

    const formId = tellMeFormHandler?.parameters?.[1]?.ServerId;
    if (!formId) {
      console.error('✗ No form ID in Tell Me response');
      console.log('Response:', JSON.stringify(decompressedOpen.value, null, 2).substring(0, 1000));
      return;
    }

    console.log(`✓ Tell Me dialog opened (FormId: ${formId})`);
    console.log();

    // Step 6a: Initialize search with empty value (required!)
    console.log('[6a/7] Initializing search...');
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
    console.log('✓ Search initialized');
    console.log();

    // Step 6b: Submit actual search query
    console.log(`[6b/7] Searching for "${searchQuery}"...`);
    const searchResponse = await client.invoke({
      interactionName: 'SaveValue',
      namedParameters: {
        newValue: searchQuery,
        isFilterAsYouType: true,
        alwaysCommitChange: true,
        isFilterOptimized: false,
        isSemanticSearch: false,
      },
      controlPath: 'server:c[0]/c[0]',
      formId: formId,
      openFormIds: [ownerFormId, formId],
    });

    // Decompress search results
    const decompressedSearch = decompressIfNeeded(searchResponse);
    if (!isOk(decompressedSearch)) {
      console.error('✗ Failed to decompress search response:', decompressedSearch.error.message);
      return;
    }

    const searchHandlers = decompressedSearch.value;
    console.log(`✓ Search response received (${Array.isArray(searchHandlers) ? searchHandlers.length : 0} handlers)`);

    // Save full search response for analysis (reuse fs from above)
    await fs.writeFile(
      'search-response.json',
      JSON.stringify(searchHandlers, null, 2)
    );
    console.log('  (Saved full search response to search-response.json)');
    console.log();

    // Try BC27+ format first (LogicalClientChangeHandler with DataRefreshChange)
    console.log('Parsing results (BC27+ format)...');
    let tellMeResults = extractTellMeResultsFromChangeHandler(searchHandlers);

    // Fall back to older format if needed (LogicalForm with Value array)
    if (isOk(tellMeResults) && tellMeResults.value.length === 0) {
      console.log('  No results in BC27+ format, trying legacy format...');
      const searchFormHandler = Array.isArray(searchHandlers)
        ? searchHandlers.find((h: any) =>
            h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
            h.parameters?.[0] === 'FormToShow'
          )
        : null;

      const logicalForm = searchFormHandler?.parameters?.[1];
      if (logicalForm) {
        tellMeResults = extractTellMeResults({ LogicalForm: logicalForm });
      }
    }

    if (!isOk(tellMeResults)) {
      console.error('✗ Failed to parse search results:', tellMeResults.error.message);
      console.error('Error context:', JSON.stringify(tellMeResults.error.context, null, 2));
      console.log('  Check search-response.json for full response structure');
      return;
    }

    // Convert to page results
    const pages = convertToPageSearchResults(tellMeResults.value);

    console.log(`✓ Found ${pages.length} pages`);
    console.log();

    // Display results
    console.log('='.repeat(70));
    console.log('Search Results');
    console.log('='.repeat(70));

    if (pages.length === 0) {
      console.log('No pages found');
    } else {
      pages.forEach((page, index) => {
        console.log(`${index + 1}. ${page.caption}`);
        console.log(`   Page ID: ${page.pageId}`);
        console.log(`   Type: ${page.type}`);
        console.log();
      });
    }

    // Close connection
    await client.disconnect();
    console.log('Connection closed');
  } catch (error) {
    console.error('✗ Error:', error);
    await client.disconnect();
    process.exit(1);
  }
}

// Get search query from command line or use default
const searchQuery = process.argv[2] || 'customer';

testTellMeSearch(searchQuery).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
