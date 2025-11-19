/**
 * Debug test for Sales Orders page (9305) - why is it returning empty data?
 */

import { BCPageConnection } from './src/connection/bc-page-connection.js';
import { bcConfig } from './src/core/config.js';
import { HandlerParser } from './src/parsers/handler-parser.js';
import { PageDataExtractor } from './src/parsers/page-data-extractor.js';

async function testSalesOrdersPage() {
  console.log('='.repeat(70));
  console.log('Sales Orders Page (9305) Debug Test');
  console.log('='.repeat(70));

  const connection = new BCPageConnection({
    baseUrl: bcConfig.baseUrl,
    username: bcConfig.username,
    password: bcConfig.password,
    tenantId: bcConfig.tenantId,
    timeout: 30000,
  });

  try {
    console.log('\n1. Connecting to BC...');
    await connection.connect();
    console.log('✓ Connected');

    console.log('\n2. Opening Sales Orders page (9305)...');
    const openResult = await connection.openPage('9305');
    if (!openResult.ok) {
      throw new Error(`Failed to open page: ${openResult.error.message}`);
    }

    const { handlers, formId } = openResult.value;
    console.log(`✓ Page opened, formId: ${formId}, handlers: ${handlers.length}`);

    // Parse LogicalForm
    const parser = new HandlerParser();
    const logicalFormResult = parser.extractLogicalForm(handlers as any);
    if (!logicalFormResult.ok) {
      throw new Error(`Failed to extract LogicalForm: ${logicalFormResult.error.message}`);
    }

    const logicalForm = logicalFormResult.value;
    console.log(`\n3. LogicalForm Analysis:`);
    console.log(`   Caption: ${logicalForm.Caption}`);
    console.log(`   ViewMode: ${logicalForm.ViewMode}`);
    console.log(`   DelayedControls: ${logicalForm.DelayedControls}`);
    console.log(`   CacheKey: ${logicalForm.CacheKey?.substring(0, 50)}...`);

    // Check page type
    const extractor = new PageDataExtractor();
    const isListPage = extractor.isListPage(logicalForm);
    console.log(`   Is List Page: ${isListPage}`);

    // Try synchronous extraction
    console.log(`\n4. Trying synchronous data extraction...`);
    const syncResult = extractor.extractListPageData(handlers);
    if (syncResult.ok) {
      console.log(`   Sync extraction: ${syncResult.value.totalCount} records`);
      if (syncResult.value.totalCount > 0) {
        console.log('   First record:', JSON.stringify(syncResult.value.records[0], null, 2));
      }
    } else {
      console.log(`   Sync extraction failed: ${syncResult.error.message}`);
    }

    // Wait for async data if needed
    if (logicalForm.DelayedControls || syncResult.ok && syncResult.value.totalCount === 0) {
      console.log(`\n5. Waiting for async data (DelayedControls or empty sync)...`);

      const hasListData = (handlers: any[]): { matched: boolean; data?: any[] } => {
        const changeHandler = handlers.find(
          (h: any) => h.handlerType === 'DN.LogicalClientChangeHandler'
        );
        if (!changeHandler) {
          console.log('   No LogicalClientChangeHandler found');
          return { matched: false };
        }

        const changes = changeHandler.parameters?.[1];
        if (!Array.isArray(changes)) {
          console.log('   No changes array in handler');
          return { matched: false };
        }

        const dataChange = changes.find(
          (c: any) =>
            (c.t === 'DataRefreshChange' || c.t === 'InitializeChange') &&
            Array.isArray(c.RowChanges) &&
            c.RowChanges.length > 0
        );

        if (!dataChange) {
          console.log(`   Found ${changes.length} changes but no DataRefreshChange with RowChanges`);
          return { matched: false };
        }

        console.log(`   ✓ Found DataRefreshChange with ${dataChange.RowChanges.length} rows`);
        return { matched: true, data: handlers };
      };

      try {
        // Pre-subscribe before refresh
        const asyncPromise = connection.waitForHandlers(hasListData, { timeoutMs: 10000 });

        // Trigger refresh
        console.log('   Triggering RefreshForm...');
        await connection.invoke({
          interactionName: 'RefreshForm',
          namedParameters: {},
          controlPath: 'server:c[0]',
          callbackId: '0',
        });

        // Wait for data
        console.log('   Waiting for async handlers...');
        const asyncHandlers = await asyncPromise;
        console.log(`   ✓ Received ${asyncHandlers.length} async handlers`);

        // Extract from async data
        const asyncResult = extractor.extractListPageData(asyncHandlers as readonly unknown[]);
        if (asyncResult.ok) {
          console.log(`   Async extraction: ${asyncResult.value.totalCount} records`);
          if (asyncResult.value.totalCount > 0) {
            console.log('   First record fields:', Object.keys(asyncResult.value.records[0].fields));
            console.log('   Sample data:', JSON.stringify(asyncResult.value.records[0].fields, null, 2));
          }
        } else {
          console.log(`   Async extraction failed: ${asyncResult.error.message}`);
        }
      } catch (error) {
        console.log(`   Async wait failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.log(`\n5. Skipping async wait (DelayedControls=${logicalForm.DelayedControls})`);
    }

    console.log('\n✓ Test complete');
  } catch (error) {
    console.error('\n❌ Test failed:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
  } finally {
    await connection.disconnect();
  }
}

// Run test
testSalesOrdersPage().catch(console.error);
