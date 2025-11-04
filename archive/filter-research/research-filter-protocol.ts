/**
 * Research Script: BC Filter Protocol
 *
 * This script uses Playwright to interact with BC's Customer List page,
 * captures filter interactions via WebSocket, and saves the protocol details.
 *
 * Goal: Understand how BC filters work so we can implement filter_list tool.
 */

import { chromium, type Page, type BrowserContext } from 'playwright';
import { writeFile } from 'fs/promises';

interface CapturedMessage {
  direction: 'sent' | 'received';
  timestamp: string;
  data: any;
}

const capturedMessages: CapturedMessage[] = [];

async function captureFilterProtocol() {
  console.log('Starting BC Filter Protocol Research...');

  const browser = await chromium.launch({
    headless: false, // Show browser so we can see what's happening
    slowMo: 500, // Slow down for observation
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });

  // Capture WebSocket traffic
  context.on('websocket', (ws) => {
    console.log('✓ WebSocket connection established');

    ws.on('framesent', (event) => {
      try {
        const data = JSON.parse(event.payload as string);
        capturedMessages.push({
          direction: 'sent',
          timestamp: new Date().toISOString(),
          data,
        });
      } catch (e) {
        // Non-JSON frame, skip
      }
    });

    ws.on('framereceived', (event) => {
      try {
        const data = JSON.parse(event.payload as string);
        capturedMessages.push({
          direction: 'received',
          timestamp: new Date().toISOString(),
          data,
        });
      } catch (e) {
        // Non-JSON frame, skip
      }
    });
  });

  const page = await context.newPage();

  try {
    // Step 1: Navigate to BC
    console.log('\n1. Navigating to BC...');
    await page.goto('http://Cronus27/BC/?tenant=default');

    // Step 2: Login
    console.log('2. Logging in...');
    await page.fill('input[name="UserName"]', 'sshadows');
    await page.fill('input[name="Password"]', '1234');
    await page.click('button[type="submit"]');

    // Wait for role center to load
    await page.waitForTimeout(3000);

    // Step 3: Open Customer List (Page 22) - navigate directly by URL
    console.log('3. Opening Customers page (Page 22) directly...');

    // Navigate directly to page 22 (Customers list)
    await page.goto('http://Cronus27/BC/?tenant=default&page=22');

    // Wait for list to load
    await page.waitForTimeout(5000);

    console.log('4. Customer List loaded, capturing initial state...');

    // Clear previous messages (don't need session setup)
    const initialCount = capturedMessages.length;
    console.log(`   (Clearing ${initialCount} session messages)`);

    // Step 4: Apply a filter
    console.log('\n5. Applying filter: Name contains "Adatum"...');
    console.log('   Please manually apply the filter in the browser:');
    console.log('   1. Click on "Name" column header');
    console.log('   2. Click "Filter" option');
    console.log('   3. Enter "Adatum" in the filter box');
    console.log('   4. Press Enter or click OK');
    console.log('\n   Waiting 30 seconds for you to apply filter...');

    // Wait for manual filter application
    await page.waitForTimeout(30000);

    console.log('\n6. Filter should be applied. Capturing protocol...');

    // Get messages sent during filter operation
    const filterMessages = capturedMessages.slice(initialCount);

    console.log(`\n✓ Captured ${filterMessages.length} messages during filter operation`);

    // Step 5: Clear the filter
    console.log('\n7. Now clear the filter:');
    console.log('   1. Click "Clear All Filters" or similar');
    console.log('\n   Waiting 15 seconds...');

    await page.waitForTimeout(15000);

    const clearFilterMessages = capturedMessages.slice(initialCount + filterMessages.length);
    console.log(`\n✓ Captured ${clearFilterMessages.length} messages during filter clear`);

    // Step 6: Try another filter (range filter)
    console.log('\n8. Apply range filter: No. between 10000..20000');
    console.log('   Please manually apply this filter...');
    console.log('\n   Waiting 20 seconds...');

    await page.waitForTimeout(20000);

    const rangeFilterMessages = capturedMessages.slice(initialCount + filterMessages.length + clearFilterMessages.length);
    console.log(`\n✓ Captured ${rangeFilterMessages.length} messages during range filter`);

    // Save all captured data
    console.log('\n9. Saving captured protocol data...');

    await writeFile(
      'filter-protocol-capture.json',
      JSON.stringify(capturedMessages, null, 2)
    );

    console.log('\n✓ Saved to filter-protocol-capture.json');

    // Analyze and summarize
    console.log('\n=== ANALYSIS ===\n');

    const sentMessages = capturedMessages.filter(m => m.direction === 'sent');
    const receivedMessages = capturedMessages.filter(m => m.direction === 'received');

    console.log(`Total messages: ${capturedMessages.length}`);
    console.log(`  Sent: ${sentMessages.length}`);
    console.log(`  Received: ${receivedMessages.length}`);

    // Find SaveValue messages (likely used for filters)
    const saveValueMessages = sentMessages.filter(m =>
      m.data?.method === 'Invoke' &&
      JSON.stringify(m.data).includes('SaveValue')
    );

    console.log(`\nSaveValue interactions: ${saveValueMessages.length}`);

    if (saveValueMessages.length > 0) {
      console.log('\nFirst SaveValue message:');
      console.log(JSON.stringify(saveValueMessages[0].data, null, 2).substring(0, 500));
    }

    // Find ChangeHandler responses (likely contain filter results)
    const changeHandlers = receivedMessages.filter(m =>
      m.data?.result?.value?.some?.((h: any) =>
        h?.handlerType === 'DN.LogicalClientChangeHandler'
      )
    );

    console.log(`\nLogicalClientChangeHandler responses: ${changeHandlers.length}`);

    console.log('\n✓ Research complete! Review filter-protocol-capture.json for details.');

  } catch (error) {
    console.error('Error during research:', error);
  } finally {
    console.log('\nPress any key to close browser...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

// Run the research
captureFilterProtocol().catch(console.error);
