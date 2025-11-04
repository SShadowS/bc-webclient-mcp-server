/**
 * Playwright script to capture CloseForm WebSocket interaction
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';

async function captureCloseForm() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Capturing CloseForm WebSocket Traffic with Playwright');
  console.log('═══════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const wsMessages: any[] = [];
  let wsConnection: any = null;

  // Intercept WebSocket connections
  page.on('websocket', ws => {
    console.log(`✓ WebSocket connection detected: ${ws.url()}`);
    wsConnection = ws;

    ws.on('framesent', frame => {
      try {
        const data = frame.payload.toString();
        const parsed = JSON.parse(data);

        if (parsed.method === 'Invoke' || parsed.method === 'CloseForm') {
          console.log(`\n→ SENT: ${parsed.method}`);
          if (parsed.params && parsed.params[0]) {
            const params = parsed.params[0];
            if (params.interactionsToInvoke) {
              params.interactionsToInvoke.forEach((interaction: any) => {
                console.log(`  Interaction: ${interaction.interactionName}`);
                if (interaction.namedParameters) {
                  console.log(`  Parameters: ${interaction.namedParameters}`);
                }
              });
            }
          }
          wsMessages.push({ direction: 'sent', data: parsed });
        }
      } catch (e) {
        // Not JSON, ignore
      }
    });

    ws.on('framereceived', frame => {
      try {
        const data = frame.payload.toString();
        const parsed = JSON.parse(data);

        if (parsed.jsonrpc) {
          wsMessages.push({ direction: 'received', data: parsed });
        }
      } catch (e) {
        // Not JSON or compressed, ignore
      }
    });
  });

  try {
    // Step 1: Navigate to BC
    console.log('Step 1: Navigating to BC...');
    await page.goto('http://Cronus27/BC/?tenant=default');
    await page.waitForTimeout(2000);

    // Step 2: Login
    console.log('Step 2: Logging in...');
    await page.fill('input[name="UserName"]', 'default\\sshadows');
    await page.fill('input[name="Password"]', '1234');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);
    console.log('✓ Logged in\n');

    // Step 3: Wait for home page to load
    console.log('Step 3: Waiting for BC to initialize...');
    await page.waitForTimeout(3000);

    // Step 4: Click on Customers to open Page 22
    console.log('Step 4: Opening Customers page...');
    try {
      await page.click('text=Customers', { timeout: 10000 });
      await page.waitForTimeout(3000);
      console.log('✓ Customers page opened\n');
    } catch (e) {
      console.log('  (Could not find Customers link, trying navigation)\n');
    }

    // Step 5: Navigate to another page to trigger form close
    console.log('Step 5: Opening Items page (should close Customers)...');
    try {
      await page.click('text=Items', { timeout: 10000 });
      await page.waitForTimeout(3000);
      console.log('✓ Items page opened\n');
    } catch (e) {
      console.log('  (Could not find Items link)\n');
    }

    // Step 6: Save captured messages
    console.log('Step 6: Saving captured WebSocket messages...');
    await fs.writeFile(
      'websocket-closeform-capture.json',
      JSON.stringify(wsMessages, null, 2)
    );
    console.log(`✓ Saved ${wsMessages.length} messages to websocket-closeform-capture.json\n`);

    // Step 7: Filter and display CloseForm interactions
    console.log('Step 7: Looking for CloseForm interactions...\n');
    const closeFormMessages = wsMessages.filter(msg => {
      if (msg.direction === 'sent' && msg.data.params) {
        const params = msg.data.params[0];
        if (params && params.interactionsToInvoke) {
          return params.interactionsToInvoke.some((i: any) =>
            i.interactionName === 'CloseForm' ||
            i.interactionName.includes('Close')
          );
        }
      }
      return false;
    });

    if (closeFormMessages.length > 0) {
      console.log(`✓ Found ${closeFormMessages.length} CloseForm interaction(s):\n`);
      closeFormMessages.forEach((msg, i) => {
        console.log(`CloseForm #${i + 1}:`);
        console.log(JSON.stringify(msg.data, null, 2));
        console.log('');
      });
    } else {
      console.log('❌ No CloseForm interactions found');
      console.log('   BC might be using a different interaction name or method\n');
    }

    // Wait before closing
    console.log('Waiting 5 seconds before closing...');
    await page.waitForTimeout(5000);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Capture Complete');
  console.log('═══════════════════════════════════════════════════════════');
}

captureCloseForm().catch(console.error);
