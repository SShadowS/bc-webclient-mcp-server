/**
 * Test Tell Me Search for "Customers"
 */

import { BCRawWebSocketClient } from './src/connection/clients/BCRawWebSocketClient.js';
import { bcConfig } from './src/core/config.js';
import { extractTellMeResultsFromChangeHandler, convertToPageSearchResults } from './src/protocol/logical-form-parser.js';
import { isOk } from './src/core/result.js';

async function test() {
  console.error('═══════════════════════════════════════════════════════════');
  console.error('  Test Tell Me Search: "Customers"');
  console.error('═══════════════════════════════════════════════════════════\n');

  const { baseUrl, username, password, tenantId } = bcConfig;

  const client = new BCRawWebSocketClient(
    { baseUrl } as any,
    username,
    password,
    tenantId
  );

  try {
    console.error('[1/5] Authenticating and connecting...');
    await client.authenticateWeb();
    await client.connect();
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '27.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });
    console.error('✓ Connected\n');

    // Get owner form from connection
    const ownerFormId = client.getRoleCenterFormId();
    if (!ownerFormId) {
      throw new Error('No role center form found');
    }
    console.error(`[2/5] Role Center Form ID: ${ownerFormId}\n`);

    // Define predicate for dialog
    const isTellMeDialog = (handlers: any[]) => {
      const formToShow = handlers.find((h: any) =>
        h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
        h.parameters?.[0] === 'FormToShow' &&
        h.parameters?.[1]?.ServerId
      );
      if (formToShow) {
        return { matched: true, data: formToShow.parameters[1].ServerId };
      }
      return { matched: false };
    };

    // Open Tell Me dialog
    console.error('[3/5] Opening Tell Me dialog...');
    const dialogPromise = client.waitForHandlers(isTellMeDialog, { timeoutMs: 15000 });

    void client.invoke({
      interactionName: 'InvokeSessionAction',
      namedParameters: {
        systemAction: 220,
        ownerForm: ownerFormId,
        data: { SearchValue: '' },
      },
      openFormIds: [ownerFormId],
    }).catch(() => {});

    const formId = await dialogPromise;
    console.error(`✓ Dialog opened: formId=${formId}\n`);

    // Initialize search with empty value (required!)
    console.error('[4/5] Initializing search...');
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
    console.error('✓ Search initialized\n');

    // Define predicate for search results
    const isSearchResults = (handlers: any[]) => {
      const bc27Results = extractTellMeResultsFromChangeHandler(handlers);
      if (isOk(bc27Results) && bc27Results.value.length > 0) {
        return { matched: true, data: bc27Results.value };
      }
      return { matched: false };
    };

    // Submit search for "Customers"
    console.error('[5/5] Searching for "Customers"...');
    const resultsPromise = client.waitForHandlers(isSearchResults, { timeoutMs: 15000 });

    void client.invoke({
      interactionName: 'SaveValue',
      namedParameters: {
        newValue: 'Customers',
        isFilterAsYouType: true,
        alwaysCommitChange: true,
        isFilterOptimized: false,
        isSemanticSearch: false,
      },
      controlPath: 'server:c[0]/c[0]',
      formId: formId,
      openFormIds: [ownerFormId, formId],
    }).catch(() => {});

    const searchResults = await resultsPromise;
    console.error(`✓ Search completed!\n`);

    // Convert to page results
    const pages = convertToPageSearchResults(searchResults);

    console.error('═══════════════════════════════════════════════════════════');
    console.error(`✓ SUCCESS! Found ${pages.length} pages:`);
    console.error('═══════════════════════════════════════════════════════════\n');

    pages.slice(0, 10).forEach((page, i) => {
      console.error(`${i + 1}. Page ${page.pageId}: ${page.pageName} (${page.type})`);
    });
    if (pages.length > 10) {
      console.error(`... and ${pages.length - 10} more`);
    }
    console.error('');

    await client.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('✗ FAILED:', error);
    await client.disconnect();
    process.exit(1);
  }
}

test();
