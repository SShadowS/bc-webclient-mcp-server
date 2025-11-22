/**
 * Phase 4: Action Execution + Re-fetch Validation
 *
 * CRITICAL BUG REPRODUCTION:
 * This test reproduces the bug from Claude conversation where after executing
 * "Release" action, calling get_page_metadata with filters returns stale data
 * showing "Open" status instead of "Released".
 *
 * Bug scenario:
 * 1. Open Sales Order 101001 (Status: "Open")
 * 2. Execute "Release" action (success)
 * 3. Call get_page_metadata with filters to re-open same order
 * 4. Read Status field
 * 5. BUG: Status shows "Open" instead of "Released"
 *
 * Root cause: get_page_metadata with filters may not properly navigate to
 * the updated record or may be returning cached/stale data.
 */

import { MCPTestClient, runTest, printSummary, assert, assertEqual, assertDefined } from './mcpTestClient.mjs';
import { TEST_DATA, PAGES } from './_config.mjs';

/**
 * Helper: Reset sales order to "Open" status if currently "Released"
 * This ensures tests start with known state
 */
async function ensureOrderIsOpen(client, orderNo) {
  console.log(`    Checking status of order ${orderNo}...`);

  // Get order from List page
  const listMetadata = await client.getPageMetadata(PAGES.salesOrderList);
  const data = await client.readPageData(listMetadata.pageContextId, {
    filters: { 'No.': orderNo }
  });

  if (!data.records || data.records.length === 0) {
    throw new Error(`Order ${orderNo} not found`);
  }

  const record = data.records[0];
  const currentStatus = record['Status'] || record.status;
  const bookmark = record.bookmark;

  console.log(`    Current status: ${currentStatus}`);

  if (currentStatus === 'Released') {
    console.log(`    Order is Released - reopening to reset test state...`);

    // Open Card with bookmark
    const cardMetadata = await client.getPageMetadata(PAGES.salesOrderCard, undefined, bookmark);

    // Execute Reopen action
    try {
      await client.executeAction(cardMetadata.pageContextId, 'Reopen');
      console.log(`    ✓ Order ${orderNo} reopened to Open status`);
    } catch (error) {
      console.log(`    ⚠ Could not reopen order: ${error.message}`);
      console.log(`    Tests may fail if order is already Released`);
    }
  } else if (currentStatus === 'Open') {
    console.log(`    ✓ Order is already Open - ready for test`);
  } else {
    console.log(`    ⚠ Order has unexpected status: ${currentStatus}`);
  }

  return bookmark;
}

async function runPhase4Tests() {
  const client = new MCPTestClient();
  const stats = { passed: 0, failed: 0 };

  console.log('\n' + '═'.repeat(60));
  console.log('  Phase 4: Action Execution + Re-fetch Validation');
  console.log('═'.repeat(60) + '\n');

  try {
    await client.start();

    // ═══════════════════════════════════════════════════════════════
    // Flow 15: Sales Order Release + Status Verification (Bookmark Pattern)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Flow 15: Sales Order Release (Bookmark Pattern) ---');

    let initialCtx;
    let orderNo = TEST_DATA.salesOrder.no;
    let initialStatus;
    let orderBookmark;

    await runTest('15.0 Reset test order to Open status', async () => {
      // Ensure order is in Open state before testing Release
      orderBookmark = await ensureOrderIsOpen(client, orderNo);
      assertDefined(orderBookmark, 'Order bookmark from reset');
    }, stats);

    await runTest('15.1 Verify order is ready for Release test', async () => {
      // Re-read to confirm status after reset
      const listMetadata = await client.getPageMetadata(PAGES.salesOrderList);
      const data = await client.readPageData(listMetadata.pageContextId, {
        filters: { 'No.': orderNo }
      });

      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;

      initialStatus = record['Status'] || record.status;
      orderBookmark = record.bookmark;

      assertDefined(initialStatus, 'Initial status');
      assertDefined(orderBookmark, 'Order bookmark');

      console.log(`    Order: ${orderNo}, Status: ${initialStatus}`);
      console.log(`    Bookmark: ${orderBookmark}`);

      // Verify it's Open before we try to Release
      assertEqual(initialStatus, 'Open', 'Order should be Open before Release test');
    }, stats);

    await runTest('15.2 Open Card with bookmark and execute Release', async () => {
      // Step 2: Open Card page using bookmark
      const cardMetadata = await client.getPageMetadata(PAGES.salesOrderCard, undefined, orderBookmark);
      initialCtx = cardMetadata.pageContextId;

      // Execute Release action
      const result = await client.executeAction(initialCtx, 'Release');

      assert(result.success, 'Release action succeeded');
      console.log(`    Action result: ${result.message || 'Success'}`);
    }, stats);

    await runTest('15.3 Re-fetch same order with bookmark (fresh data)', async () => {
      // CRITICAL: Use bookmark to open fresh page session at the same record
      // This is BC's native pattern for getting fresh data after actions
      const metadata = await client.getPageMetadata(PAGES.salesOrderCard, undefined, orderBookmark);

      // Read data to verify the status
      const data = await client.readPageData(metadata.pageContextId);

      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      const currentStatus = record['Status'] || record.status;

      console.log(`    After Release: Status = "${currentStatus}" (expected: "Released")`);

      // With bookmark rehydration, we get fresh data from BC
      assertEqual(currentStatus, 'Released', 'Status should be Released after action');
    }, stats);

    // ═══════════════════════════════════════════════════════════════
    // Flow 16: Bookmark navigation with List → Card workflow
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Flow 16: Bookmark Navigation (List → Card Pattern) ---');

    let order2Ctx;
    let order2No = TEST_DATA.salesOrder.no; // Reuse same order, reset first
    let order2Bookmark;

    await runTest('16.0 Reset second test order to Open status', async () => {
      // Ensure order is in Open state before testing
      order2Bookmark = await ensureOrderIsOpen(client, order2No);
      assertDefined(order2Bookmark, 'Order bookmark from reset');
    }, stats);

    await runTest('16.1 Verify second order is ready', async () => {
      // Open List page and verify order
      const metadata = await client.getPageMetadata(PAGES.salesOrderList);
      order2Ctx = metadata.pageContextId;

      // Read the specific order
      const data = await client.readPageData(order2Ctx, {
        filters: { 'No.': order2No }
      });

      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;

      const status = record['Status'] || record.status;
      order2Bookmark = record.bookmark;

      console.log(`    Order: ${order2No}, Status: ${status}`);
      console.log(`    Bookmark: ${order2Bookmark}`);

      assertEqual(status, 'Open', 'Order should be Open before Release test');
      assertDefined(order2Bookmark, 'Order bookmark');
    }, stats);

    await runTest('16.2 Open Card with bookmark and execute Release', async () => {
      // Open Card directly using bookmark from List
      const cardMetadata = await client.getPageMetadata(PAGES.salesOrderCard, undefined, order2Bookmark);

      // Execute Release
      const result = await client.executeAction(cardMetadata.pageContextId, 'Release');
      assert(result.success, 'Release action succeeded');
    }, stats);

    await runTest('16.3 Try reading from original list context', async () => {
      // Try reading from the original list page context
      // This will likely fail because list doesn't auto-refresh
      try {
        const data = await client.readPageData(order2Ctx, {
          filters: { 'No.': order2No }
        });

        const records = data.records || [data];
        const record = Array.isArray(records) ? records[0] : records;
        const status = record['Status'] || record.status;

        console.log(`    List context Status: "${status}"`);
        // May or may not be updated depending on BC behavior
      } catch (error) {
        console.log(`    Read from list context failed (expected): ${error.message}`);
      }
    }, stats);

    // ═══════════════════════════════════════════════════════════════
    // Flow 17: Bookmark rehydration after action
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Flow 17: Bookmark Rehydration Pattern ---');

    let order3Ctx;
    let order3No = TEST_DATA.salesOrder.no; // Reuse same order, reset first
    let order3Bookmark;

    await runTest('17.0 Reset third test order to Open status', async () => {
      // Ensure order is in Open state before testing
      order3Bookmark = await ensureOrderIsOpen(client, order3No);
      assertDefined(order3Bookmark, 'Order bookmark from reset');
    }, stats);

    await runTest('17.1 Verify third order is ready', async () => {
      // Verify order status
      const listMetadata = await client.getPageMetadata(PAGES.salesOrderList);

      const data = await client.readPageData(listMetadata.pageContextId, {
        filters: { 'No.': order3No }
      });

      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;

      const status = record['Status'] || record.status;
      order3Bookmark = record.bookmark;

      console.log(`    Order ${order3No}, Status: ${status}`);
      console.log(`    Bookmark: ${order3Bookmark}`);

      assertEqual(status, 'Open', 'Order should be Open before test');
      assertDefined(order3Bookmark, 'Order bookmark');
    }, stats);

    await runTest('17.2 Open Card with bookmark and execute action', async () => {
      // Open Card using bookmark
      const cardMetadata = await client.getPageMetadata(PAGES.salesOrderCard, undefined, order3Bookmark);
      order3Ctx = cardMetadata.pageContextId;

      console.log(`    Opened Card with context: ${order3Ctx}`);

      // Execute any action (e.g., "Edit" if already in view mode)
      try {
        await client.executeAction(order3Ctx, 'Edit');
        console.log(`    Edit action executed`);
      } catch (error) {
        console.log(`    Edit action not available or failed: ${error.message}`);
      }

      // Now try reading with the SAME pageContextId
      try {
        const data = await client.readPageData(order3Ctx);
        console.log(`    Read succeeded with old pageContextId (unexpected!)`);

        const records = data.records || [data];
        const record = Array.isArray(records) ? records[0] : records;
        const no = record['No.'] || record.no;

        console.log(`    Read order: ${no}`);
      } catch (error) {
        console.log(`    Read failed with old pageContextId (expected): ${error.message}`);
        // This is expected - pageContext should be invalid after state-changing action
      }
    }, stats);

    await runTest('17.3 Verify bookmark rehydration creates fresh session', async () => {
      // CRITICAL: Use bookmark to create fresh page session
      // This is BC's native pattern for refreshing data after actions
      const newMetadata = await client.getPageMetadata(PAGES.salesOrderCard, undefined, order3Bookmark);

      const data = await client.readPageData(newMetadata.pageContextId);

      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      const no = record['No.'] || record.no;

      assertEqual(no, order3No, 'Fresh pageContextId retrieves correct order');
      console.log(`    Fresh context works: Order ${no}`);
      console.log(`    New pageContextId: ${newMetadata.pageContextId}`);
    }, stats);

  } catch (error) {
    console.error(colors.red + '\n✗ Fatal error during tests:' + colors.reset, error.message);
    console.error(error.stack);
    stats.failed++;
  } finally {
    await client.stop();
  }

  printSummary(stats);
  return stats;
}

// Run tests
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
};

runPhase4Tests()
  .then((stats) => {
    process.exit(stats.failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error(colors.red + 'Fatal error:' + colors.reset, error);
    process.exit(1);
  });
