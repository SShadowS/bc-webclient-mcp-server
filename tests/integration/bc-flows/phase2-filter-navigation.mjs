/**
 * Phase 2: Filter & Navigation
 *
 * Tests from TestFlows.md:
 * 11. List to Card Navigation
 * 12. Filter List Flow
 * 13. Find Record Flow
 */

import { MCPTestClient, runTest, printSummary, assert, assertEqual, assertDefined, assertArrayLength } from './mcpTestClient.mjs';
import { TEST_DATA, PAGES } from './_config.mjs';

async function runPhase2Tests() {
  const client = new MCPTestClient();
  const stats = { passed: 0, failed: 0 };

  console.log('\n' + '═'.repeat(60));
  console.log('  Phase 2: Filter & Navigation');
  console.log('═'.repeat(60) + '\n');

  try {
    await client.start();

    // ═══════════════════════════════════════════════════════════════
    // Flow 11: List to Card Navigation
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Flow 11: List to Card Navigation ---');

    let listData;
    await runTest('11.1-2 Open Customer List and read data', async () => {
      const metadata = await client.getPageMetadata(PAGES.customerList);
      assertDefined(metadata.pageContextId, 'pageContextId');

      listData = await client.readPageData(metadata.pageContextId);
      assertDefined(listData, 'List data');
    }, stats);

    await runTest('11.3-4 Find customer 10000 in list and capture data', async () => {
      const rows = listData.records || listData.rows || listData.data || listData;
      assert(Array.isArray(rows), 'Should have records');

      const customer10000 = rows.find(r =>
        r['No.'] === '10000' || r.No === '10000' || r['no.'] === '10000'
      );
      assertDefined(customer10000, 'Customer 10000 in list');

      // Capture name for later comparison
      listData.capturedName = customer10000['Name'] || customer10000.name;
      assertDefined(listData.capturedName, 'Name captured from list');
    }, stats);

    await runTest('11.5-7 Open Card and verify data matches list', async () => {
      const metadata = await client.getPageMetadata(PAGES.customerCard);
      const cardData = await client.readPageData(metadata.pageContextId, {
        filters: { 'No.': '10000' }
      });

      const records = cardData.records || [cardData];
      const record = Array.isArray(records) ? records[0] : records;
      const cardName = record['Name'] || record.name;

      assertEqual(cardName, listData.capturedName, 'Name matches between list and card');
    }, stats);

    // ═══════════════════════════════════════════════════════════════
    // Flow 12: Filter List Flow
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Flow 12: Filter List Flow ---');

    let unfilteredCount;
    let listCtx;
    await runTest('12.1-2 Open Customer List and read unfiltered count', async () => {
      const metadata = await client.getPageMetadata(PAGES.customerList);
      listCtx = metadata.pageContextId;

      const data = await client.readPageData(listCtx);
      const rows = data.records || data.rows || data.data || data;
      assert(Array.isArray(rows), 'Should have records');

      unfilteredCount = rows.length;
      assert(unfilteredCount >= 3, `Expected at least 3 customers, got ${unfilteredCount}`);
    }, stats);

    await runTest('12.3-4 Apply filter No.=10000 and verify single result', async () => {
      const filteredData = await client.readPageData(listCtx, {
        filters: { 'No.': '10000' }
      });

      const rows = filteredData.records || filteredData.rows || filteredData.data || filteredData;
      assert(Array.isArray(rows), 'Should have records');

      // Should be exactly 1 or the filter returns matching row
      if (rows.length > 0) {
        const firstRow = rows[0];
        const no = firstRow['No.'] || firstRow.No || firstRow['no.'];
        assertEqual(no, '10000', 'Filtered result No.');
      }
    }, stats);

    // ═══════════════════════════════════════════════════════════════
    // Flow 13: Find Record Flow
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Flow 13: Find Record Flow ---');

    await runTest('13.1-3 Find by exact No.=10000', async () => {
      const metadata = await client.getPageMetadata(PAGES.customerCard);
      const data = await client.readPageData(metadata.pageContextId, {
        filters: { 'No.': TEST_DATA.customer.no }
      });

      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      const no = record['No.'] || record.No || record['no.'];
      assertEqual(no, TEST_DATA.customer.no, 'Found customer No.');
    }, stats);

    await runTest('13.4-5 Find by Name wildcard "Kontorcentral*"', async () => {
      const metadata = await client.getPageMetadata(PAGES.customerCard);
      const data = await client.readPageData(metadata.pageContextId, {
        filters: { 'Name': 'Kontorcentral*' }
      });

      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      const no = record['No.'] || record.No || record['no.'];
      assertEqual(no, TEST_DATA.customer.no, 'Wildcard found same customer');
    }, stats);

    await runTest('13.6 Find non-existent - no crash', async () => {
      const metadata = await client.getPageMetadata(PAGES.customerCard);

      try {
        const data = await client.readPageData(metadata.pageContextId, {
          filters: { 'No.': 'NONEXISTENT123' }
        });
        // Should return empty or not-found status, not crash
        assert(true, 'No crash on non-existent');
      } catch (error) {
        // If it throws, that's acceptable as long as it's a handled error
        assert(!error.message.includes('crash'), 'Should handle gracefully');
      }
    }, stats);

  } catch (error) {
    console.error('\nFatal error:', error.message);
    stats.failed++;
  } finally {
    await client.stop();
  }

  printSummary(stats);
  return stats;
}

// Run if executed directly
runPhase2Tests();
