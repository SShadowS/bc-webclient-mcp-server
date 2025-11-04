/**
 * Capture Tell Me Search Protocol
 *
 * This script captures BC WebSocket traffic while performing Tell Me searches
 * to discover the exact protocol BC uses for page search.
 *
 * Usage:
 *   node capture-tellme-search.mjs
 *
 * Then:
 *   1. Open BC in the browser that appears
 *   2. Use Tell Me search (Ctrl+Q or search icon)
 *   3. Search for "Customer", "Sales", etc.
 *   4. Press ENTER in the terminal when done
 */

import playwright from 'playwright';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  BC Tell Me Search Protocol Capture                       ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // BC connection details
  const baseUrl = process.env.BC_BASE_URL || 'http://Cronus27/BC/';
  const username = process.env.BC_USERNAME || 'sshadows';
  const password = process.env.BC_PASSWORD || '';

  if (!password) {
    console.error('❌ BC_PASSWORD environment variable not set');
    process.exit(1);
  }

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Username: ${username}`);
  console.log('');

  // Launch browser
  console.log('🌐 Launching browser...');
  const browser = await playwright.chromium.launch({
    headless: false, // Show browser so user can interact
    slowMo: 100,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture WebSocket messages
  const wsMessages = [];

  page.on('websocket', ws => {
    console.log(`📡 WebSocket connection: ${ws.url()}`);

    ws.on('framereceived', event => {
      const payload = event.payload;
      try {
        const parsed = JSON.parse(payload);
        wsMessages.push({
          direction: 'received',
          timestamp: new Date().toISOString(),
          payload: parsed,
        });

        // Log Tell Me related messages
        if (payload.includes('TellMe') || payload.includes('Search') || payload.includes('tellme') || payload.includes('search')) {
          console.log('📥 Tell Me related message received');
        }
      } catch (e) {
        // Not JSON, ignore
      }
    });

    ws.on('framesent', event => {
      const payload = event.payload;
      try {
        const parsed = JSON.parse(payload);
        wsMessages.push({
          direction: 'sent',
          timestamp: new Date().toISOString(),
          payload: parsed,
        });

        // Log Tell Me related messages
        if (payload.includes('TellMe') || payload.includes('Search') || payload.includes('tellme') || payload.includes('search')) {
          console.log('📤 Tell Me related message sent');
        }
      } catch (e) {
        // Not JSON, ignore
      }
    });
  });

  try {
    // Login to BC
    console.log('🔐 Logging in to BC...');
    await page.goto(baseUrl);
    await page.fill('input[name="UserName"]', username);
    await page.fill('input[name="Password"]', password);
    await page.click('input[type="submit"]');

    // Wait for BC to load
    await page.waitForTimeout(5000);
    console.log('✓ Logged in to BC');
    console.log('');

    // Instructions for user
    console.log('═'.repeat(60));
    console.log('MANUAL TESTING INSTRUCTIONS');
    console.log('═'.repeat(60));
    console.log('');
    console.log('1. Use Tell Me search in BC:');
    console.log('   - Press Ctrl+Q (or click search icon)');
    console.log('   - Type "Customer" and wait for results');
    console.log('   - Try other searches: "Sales", "Item", etc.');
    console.log('');
    console.log('2. When done, press ENTER in this terminal');
    console.log('');
    console.log('All WebSocket traffic will be captured automatically.');
    console.log('');

    // Wait for user to press ENTER
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });

    console.log('');
    console.log('💾 Saving captured messages...');

    // Save all WebSocket messages
    fs.writeFileSync(
      'captured-tellme-websocket.json',
      JSON.stringify(wsMessages, null, 2)
    );

    console.log(`✓ Saved ${wsMessages.length} WebSocket messages to captured-tellme-websocket.json`);

    // Filter and display Tell Me related interactions
    console.log('');
    console.log('═'.repeat(60));
    console.log('TELL ME INTERACTIONS FOUND');
    console.log('═'.repeat(60));

    const tellMeMessages = wsMessages.filter(msg => {
      const str = JSON.stringify(msg.payload).toLowerCase();
      return str.includes('tellme') || str.includes('search') || str.includes('query');
    });

    if (tellMeMessages.length === 0) {
      console.log('');
      console.log('⚠️  No Tell Me interactions captured.');
      console.log('   Make sure you used Tell Me search in the BC UI.');
    } else {
      console.log('');
      console.log(`Found ${tellMeMessages.length} Tell Me related messages:`);

      for (let i = 0; i < Math.min(5, tellMeMessages.length); i++) {
        const msg = tellMeMessages[i];
        console.log('');
        console.log(`Message ${i + 1}:`);
        console.log(`  Direction: ${msg.direction}`);
        console.log(`  Time: ${msg.timestamp}`);
        console.log('  Payload:');
        console.log(JSON.stringify(msg.payload, null, 4).split('\n').map(l => '    ' + l).join('\n'));
      }

      if (tellMeMessages.length > 5) {
        console.log('');
        console.log(`... and ${tellMeMessages.length - 5} more (see captured-tellme-websocket.json)`);
      }
    }

  } finally {
    console.log('');
    console.log('🧹 Cleaning up...');
    await browser.close();
  }

  console.log('');
  console.log('═'.repeat(60));
  console.log('CAPTURE COMPLETE');
  console.log('═'.repeat(60));
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review captured-tellme-websocket.json');
  console.log('  2. Identify the Tell Me search interaction');
  console.log('  3. Implement it in search-pages-tool.ts');
  console.log('');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
