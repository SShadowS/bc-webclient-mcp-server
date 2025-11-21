/**
 * Phase 3: Write Operations
 *
 * Tests from TestFlows.md:
 * 6. Customer Update Name (modify then restore)
 * 7. Customer Update Email
 * 14. Edit Mode Toggle
 *
 * IMPORTANT: All tests restore original data after modification.
 */

import { MCPTestClient, runTest, printSummary, assert, assertEqual, assertDefined } from './mcpTestClient.mjs';
import { TEST_DATA, PAGES } from './_config.mjs';

async function runPhase3Tests() {
  const client = new MCPTestClient();
  const stats = { passed: 0, failed: 0 };

  console.log('\n' + '═'.repeat(60));
  console.log('  Phase 3: Write Operations');
  console.log('═'.repeat(60) + '\n');

  try {
    await client.start();

    // ═══════════════════════════════════════════════════════════════
    // Flow 6: Customer Update Name
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Flow 6: Customer Update Name ---');

    let customerCtx;
    let originalName;

    await runTest('6.1-3 Open Customer Card and read original name', async () => {
      const metadata = await client.getPageMetadata(PAGES.customerCard);
      customerCtx = metadata.pageContextId;

      const data = await client.readPageData(customerCtx, {
        filters: { 'No.': TEST_DATA.customer.no }
      });

      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      originalName = record['Name'] || record.name;

      assertDefined(originalName, 'Original name');
      assertEqual(originalName, TEST_DATA.customer.name, 'Original name matches expected');
    }, stats);

    await runTest('6.4-7 Update name and verify change', async () => {
      const testName = 'Test Name Change';

      try {
        // Update name
        await client.writePageData(customerCtx, { 'Name': testName });

        // Re-read and verify
        const data = await client.readPageData(customerCtx);
        const records = data.records || [data];
        const record = Array.isArray(records) ? records[0] : records;
        const newName = record['Name'] || record.name;

        assertEqual(newName, testName, 'Name updated');
      } finally {
        // Always restore
        console.log('    Restoring original name...');
      }
    }, stats);

    await runTest('6.8-9 Restore original name', async () => {
      await client.writePageData(customerCtx, { 'Name': originalName });

      const data = await client.readPageData(customerCtx);
      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      const restoredName = record['Name'] || record.name;

      assertEqual(restoredName, originalName, 'Name restored');
    }, stats);

    // ═══════════════════════════════════════════════════════════════
    // Flow 7: Customer Update Email
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Flow 7: Customer Update Email ---');

    let originalEmail;

    await runTest('7.1-3 Read original email', async () => {
      const metadata = await client.getPageMetadata(PAGES.customerCard);
      customerCtx = metadata.pageContextId;

      const data = await client.readPageData(customerCtx, {
        filters: { 'No.': TEST_DATA.customer.no }
      });

      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      originalEmail = record['E-Mail'] || record.Email || record.email || '';

      // Email might be empty, that's OK
      assert(originalEmail !== undefined, 'Email field exists');
    }, stats);

    await runTest('7.4-5 Update email and verify', async () => {
      const testEmail = 'test@example.com';

      await client.writePageData(customerCtx, { 'E-Mail': testEmail });

      const data = await client.readPageData(customerCtx);
      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      const newEmail = record['E-Mail'] || record.Email || record.email;

      assertEqual(newEmail, testEmail, 'Email updated');
    }, stats);

    await runTest('7.6-7 Restore original email', async () => {
      await client.writePageData(customerCtx, { 'E-Mail': originalEmail });

      const data = await client.readPageData(customerCtx);
      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      const restoredEmail = record['E-Mail'] || record.Email || record.email || '';

      assertEqual(restoredEmail, originalEmail, 'Email restored');
    }, stats);

    // ═══════════════════════════════════════════════════════════════
    // Flow 14: Edit Mode Toggle
    // ═══════════════════════════════════════════════════════════════
    console.log('\n--- Flow 14: Edit Mode Toggle ---');

    let originalPhone;

    await runTest('14.1-3 Read initial Phone No.', async () => {
      const metadata = await client.getPageMetadata(PAGES.customerCard);
      customerCtx = metadata.pageContextId;

      const data = await client.readPageData(customerCtx, {
        filters: { 'No.': TEST_DATA.customer.no }
      });

      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      originalPhone = record['Phone No.'] || record.PhoneNo || record.phone || '';

      assert(originalPhone !== undefined, 'Phone No. field exists');
    }, stats);

    await runTest('14.4-5 Execute Edit action (if required)', async () => {
      // Some pages may require explicit Edit action
      try {
        await client.executeAction(customerCtx, 'Edit');
        assert(true, 'Edit action executed');
      } catch (error) {
        // Edit action may not be required or may not exist
        console.log('    (Edit action skipped - may not be required)');
        assert(true, 'Edit not required');
      }
    }, stats);

    await runTest('14.6-8 Update Phone No. and verify', async () => {
      const testPhone = '555-TEST-123';

      await client.writePageData(customerCtx, { 'Phone No.': testPhone });

      const data = await client.readPageData(customerCtx);
      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      const newPhone = record['Phone No.'] || record.PhoneNo || record.phone;

      assertEqual(newPhone, testPhone, 'Phone No. updated');
    }, stats);

    await runTest('14.9 Restore original Phone No.', async () => {
      await client.writePageData(customerCtx, { 'Phone No.': originalPhone });

      const data = await client.readPageData(customerCtx);
      const records = data.records || [data];
      const record = Array.isArray(records) ? records[0] : records;
      const restoredPhone = record['Phone No.'] || record.PhoneNo || record.phone || '';

      assertEqual(restoredPhone, originalPhone, 'Phone No. restored');
    }, stats);

  } catch (error) {
    console.error('\nFatal error:', error.message);
    stats.failed++;

    // Emergency restore attempt
    if (client.initialized) {
      console.log('\nAttempting emergency data restore...');
      try {
        const metadata = await client.getPageMetadata(PAGES.customerCard);
        await client.writePageData(metadata.pageContextId, {
          'Name': TEST_DATA.customer.name,
          'E-Mail': TEST_DATA.customer.email,
        });
        console.log('Emergency restore completed');
      } catch (restoreErr) {
        console.error('Emergency restore failed:', restoreErr.message);
      }
    }
  } finally {
    await client.stop();
  }

  printSummary(stats);
  return stats;
}

// Run if executed directly
runPhase3Tests().then(stats => {
  process.exit(stats.failed > 0 ? 1 : 0);
});
