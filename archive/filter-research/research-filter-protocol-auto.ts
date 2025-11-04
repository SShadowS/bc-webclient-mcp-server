/**
 * Automated BC Filter Protocol Research
 *
 * This script automatically applies filters and captures the WebSocket protocol.
 */

import { chromium } from 'playwright';
import { writeFile } from 'fs/promises';

interface CapturedMessage {
  direction: 'sent' | 'received';
  timestamp: string;
  data: any;
  summary: string;
}

const capturedMessages: CapturedMessage[] = [];

function getSummary(data: any, direction: string): string {
  if (direction === 'sent' && data.method === 'Invoke') {
    const bodyStr = JSON.stringify(data.params);
    if (bodyStr.includes('SaveValue')) return 'SENT: SaveValue';
    if (bodyStr.includes('InvokeAction')) return 'SENT: InvokeAction';
    if (bodyStr.includes('InvokeSessionAction')) return 'SENT: InvokeSessionAction';
    return 'SENT: Invoke (other)';
  }
  if (direction === 'received' && data.result) {
    const resultStr = JSON.stringify(data.result);
    if (resultStr.includes('LogicalClientChangeHandler')) return 'RECEIVED: ChangeHandler';
    if (resultStr.includes('FormToShow')) return 'RECEIVED: FormToShow';
    return 'RECEIVED: Other';
  }
  return direction === 'sent' ? 'SENT' : 'RECEIVED';
}

async function captureFilterProtocol() {
  console.log('Starting Automated BC Filter Protocol Research...\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });

  // Capture WebSocket traffic
  context.on('websocket', (ws) => {
    console.log('✓ WebSocket connection established\n');

    ws.on('framesent', (event) => {
      try {
        const data = JSON.parse(event.payload as string);
        const summary = getSummary(data, 'sent');
        capturedMessages.push({
          direction: 'sent',
          timestamp: new Date().toISOString(),
          data,
          summary,
        });
        if (summary.includes('SaveValue') || summary.includes('InvokeAction')) {
          console.log(`  → ${summary}`);
        }
      } catch (e) {
        // Non-JSON frame
      }
    });

    ws.on('framereceived', (event) => {
      try {
        const data = JSON.parse(event.payload as string);
        const summary = getSummary(data, 'received');
        capturedMessages.push({
          direction: 'received',
          timestamp: new Date().toISOString(),
          data,
          summary,
        });
        if (summary.includes('ChangeHandler')) {
          console.log(`  ← ${summary}`);
        }
      } catch (e) {
        // Non-JSON frame
      }
    });
  });

  const page = await context.newPage();

  try {
    // Step 1: Navigate and login
    console.log('1. Logging in to BC...');
    await page.goto('http://Cronus27/BC/?tenant=default');
    await page.fill('input[name="UserName"]', 'sshadows');
    await page.fill('input[name="Password"]', '1234');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Step 2: Navigate directly to Customers page (22)
    console.log('2. Opening Customers page (Page 22)...');
    await page.goto('http://Cronus27/BC/?tenant=default&page=22');
    await page.waitForTimeout(5000);

    const initialCount = capturedMessages.length;
    console.log(`   Initial messages: ${initialCount}\n`);

    // Step 3: Find and click on Name column filter
    console.log('3. Applying filter on Name column...');

    // Try to find filter icon or dropdown for Name column
    // BC columns usually have data-id or aria-label attributes
    const nameColumn = page.locator('[aria-label*="Name"]').or(page.locator('[title*="Name"]')).first();

    if (await nameColumn.isVisible({ timeout: 5000 })) {
      console.log('   Found Name column, clicking...');
      await nameColumn.click();
      await page.waitForTimeout(1000);

      // Look for filter option in dropdown
      const filterOption = page.locator('text=Filter').or(page.locator('[aria-label*="Filter"]'));
      if (await filterOption.isVisible({ timeout: 2000 })) {
        console.log('   Found Filter option, clicking...');
        await filterOption.click();
        await page.waitForTimeout(1000);

        // Type filter value
        const filterInput = page.locator('input[type="text"]').first();
        if (await filterInput.isVisible({ timeout: 2000 })) {
          console.log('   Typing "Adatum" in filter box...');
          await filterInput.fill('Adatum');
          await page.waitForTimeout(500);

          // Press Enter or click OK
          await page.keyboard.press('Enter');
          console.log('   Filter applied!\n');
        }
      }
    } else {
      console.log('   Could not find Name column automatically');
      console.log('   Trying alternative: Filter pane at top\n');

      // Try filter pane approach (BC may have a filter pane at top)
      const filterPane = page.locator('[aria-label*="Filter pane"]').or(page.locator('.filter-pane'));
      if (await filterPane.isVisible({ timeout: 2000 })) {
        console.log('   Found filter pane');
        await filterPane.click();
        await page.waitForTimeout(1000);
      }
    }

    await page.waitForTimeout(3000);

    const filterMessages = capturedMessages.slice(initialCount);
    console.log(`✓ Captured ${filterMessages.length} messages during filter\n`);

    // Step 4: Clear filter
    console.log('4. Clearing filter...');

    const clearFilter = page.locator('text=Clear all filters').or(page.locator('[aria-label*="Clear"]'));
    if (await clearFilter.isVisible({ timeout: 2000 })) {
      await clearFilter.click();
      await page.waitForTimeout(2000);
      console.log('   Filter cleared\n');
    }

    const clearMessages = capturedMessages.slice(initialCount + filterMessages.length);
    console.log(`✓ Captured ${clearMessages.length} messages during clear\n`);

    // Save captured data
    console.log('5. Saving captured data...');
    await writeFile(
      'filter-protocol-capture-auto.json',
      JSON.stringify(capturedMessages, null, 2)
    );
    console.log('✓ Saved to filter-protocol-capture-auto.json\n');

    // Analysis
    console.log('=== ANALYSIS ===\n');
    console.log(`Total messages: ${capturedMessages.length}`);

    const saveValueMsgs = capturedMessages.filter(m => m.summary.includes('SaveValue'));
    const changeHandlers = capturedMessages.filter(m => m.summary.includes('ChangeHandler'));

    console.log(`SaveValue messages: ${saveValueMsgs.length}`);
    console.log(`ChangeHandler responses: ${changeHandlers.length}\n`);

    if (saveValueMsgs.length > 0) {
      console.log('First SaveValue message (truncated):');
      const msg = JSON.stringify(saveValueMsgs[0].data, null, 2);
      console.log(msg.substring(0, 800) + '...\n');
    }

    if (changeHandlers.length > 0) {
      console.log('First ChangeHandler response (truncated):');
      const msg = JSON.stringify(changeHandlers[0].data, null, 2);
      console.log(msg.substring(0, 800) + '...\n');
    }

    console.log('✓ Research complete!\n');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await page.waitForTimeout(3000);
    await browser.close();
  }
}

captureFilterProtocol().catch(console.error);
