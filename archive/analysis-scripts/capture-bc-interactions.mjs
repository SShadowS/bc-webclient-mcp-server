#!/usr/bin/env node
/**
 * BC Interaction Capture Script
 *
 * Captures WebSocket traffic for various BC interactions to reverse engineer
 * the protocol for implementing MCP tools.
 *
 * Usage:
 *   node capture-bc-interactions.mjs
 *   or
 *   BC_PASSWORD=1234 node capture-bc-interactions.mjs
 *
 * Environment Variables:
 *   BC_URL - BC base URL (default: http://Cronus27/BC/)
 *   BC_USERNAME - BC username (default: sshadows)
 *   BC_PASSWORD - BC password (required)
 *   BC_TENANT - BC tenant ID (default: default)
 *
 * Then perform these actions in the browser:
 * 1. Click an action button (e.g., "Edit" on Customer Card)
 * 2. Change a dropdown field (e.g., Status)
 * 3. Update a text field
 * 4. Navigate to next record
 * 5. Apply a filter on a list page
 * 6. Create a new record
 * 7. Delete a record
 * 8. DrillDown on a field (e.g., "Balance (LCY)")
 * 9. Toggle a FastTab (expand/collapse section)
 * 10. Delete with confirmation dialog
 * 11. Edit subpage (e.g., Sales Order lines)
 *
 * The script saves one JSON file per WebSocket containing multiple interaction groups.
 * Press Enter at any time to stop capture early.
 */

import { chromium } from '@playwright/test';
import fs from 'fs/promises';
import path from 'path';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const BC_BASE_URL = process.env.BC_URL || 'http://Cronus27/BC/';
const BC_USERNAME = process.env.BC_USERNAME || 'sshadows';
const BC_PASSWORD = process.env.BC_PASSWORD || '1234';
const BC_TENANT = process.env.BC_TENANT || 'default';
const BC_URL = `${BC_BASE_URL}?tenant=${BC_TENANT}`;
const OUTPUT_DIR = './bc-interaction-captures';

// Interaction tracking
let interactionCounter = 0;
let currentInteraction = null;
const capturedMessages = [];

async function main() {
  console.log('🎯 BC Interaction Capture Tool');
  console.log('════════════════════════════════════════════════════════════\n');

  // Validate credentials
  if (!BC_PASSWORD) {
    console.error('❌ ERROR: BC_PASSWORD environment variable not set\n');
    console.error('Please set BC credentials in .env file or environment:');
    console.error('  BC_URL=http://Cronus27/BC/');
    console.error('  BC_USERNAME=sshadows');
    console.error('  BC_PASSWORD=your_password');
    console.error('  BC_TENANT=default\n');
    console.error('Or run with:');
    console.error('  BC_PASSWORD=1234 node capture-bc-interactions.mjs\n');
    process.exit(1);
  }

  // Create output directory
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  console.log(`📁 Output directory: ${OUTPUT_DIR}\n`);

  // Launch browser
  console.log('🌐 Launching browser...');
  const browser = await chromium.launch({
    headless: false, // Keep visible so user can interact
    slowMo: 100,
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Set up CDP session for WebSocket capture
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');

  console.log('✅ Browser launched\n');

  // WebSocket message tracking
  const wsMessages = new Map(); // requestId -> messages[]

  client.on('Network.webSocketCreated', ({ requestId, url }) => {
    console.log(`🔌 WebSocket created: ${url}`);
    wsMessages.set(requestId, []);
  });

  client.on('Network.webSocketFrameSent', ({ requestId, timestamp, response }) => {
    const messages = wsMessages.get(requestId);
    if (messages) {
      try {
        const payload = JSON.parse(response.payloadData);
        messages.push({
          direction: 'sent',
          timestamp,
          payload,
        });

        // Log interaction name if present
        if (payload.arguments && payload.arguments[0]) {
          const interaction = payload.arguments[0];
          if (interaction.interactionName) {
            console.log(`  → ${interaction.interactionName}`);
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  });

  client.on('Network.webSocketFrameReceived', ({ requestId, timestamp, response }) => {
    const messages = wsMessages.get(requestId);
    if (messages) {
      try {
        const payload = JSON.parse(response.payloadData);
        messages.push({
          direction: 'received',
          timestamp,
          payload,
        });
      } catch (e) {
        // Ignore parse errors
      }
    }
  });

  // Navigate to BC
  console.log(`📍 Navigating to ${BC_URL}...`);
  await page.goto(BC_URL);

  // Login
  console.log('🔐 Logging in...');
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

  // Use robust selectors like capture-websocket-cdp.mjs
  const usernameSelector = 'input[name="UserName"], input[name="username"], input[aria-label*="User"], input[placeholder*="User"]';
  const passwordSelector = 'input[name="Password"], input[aria-label*="Password"], input[placeholder*="Password"], input[type="password"]';
  const submitSelector = 'button[type="submit"], button:has-text("Sign in"), input[type="submit"]';

  const hasPasswordField = (await page.locator(passwordSelector).count()) > 0;

  if (hasPasswordField) {
    // Fill username if present
    const userField = page.locator(usernameSelector).first();
    if ((await userField.count()) > 0) {
      await userField.fill(BC_USERNAME, { timeout: 10000 }).catch(() => {});
    }

    // Fill password
    const passField = page.locator(passwordSelector).first();
    await passField.fill(BC_PASSWORD, { timeout: 10000 }).catch(() => {});

    // Click submit or press Enter
    const submitBtn = page.locator(submitSelector).first();
    if ((await submitBtn.count()) > 0) {
      await submitBtn.click({ timeout: 10000 }).catch(() => {});
    } else {
      await page.keyboard.press('Enter').catch(() => {});
    }
  }

  // Wait for home page
  await page.waitForTimeout(3000);
  console.log('✅ Logged in successfully\n');

  console.log('════════════════════════════════════════════════════════════');
  console.log('📋 INTERACTION CAPTURE INSTRUCTIONS');
  console.log('════════════════════════════════════════════════════════════\n');
  console.log('The browser window is now open. Please perform these actions:\n');
  console.log('1️⃣  Click an ACTION BUTTON');
  console.log('   Example: Open Customer Card (Page 21), click "Edit"');
  console.log('   Wait 2 seconds after clicking\n');

  console.log('2️⃣  Change a DROPDOWN/OPTION field');
  console.log('   Example: Change "Payment Terms Code" dropdown');
  console.log('   Wait 2 seconds after changing\n');

  console.log('3️⃣  Update a TEXT FIELD');
  console.log('   Example: Change "Name" field value');
  console.log('   Wait 2 seconds after changing\n');

  console.log('4️⃣  Navigate to NEXT/PREVIOUS record');
  console.log('   Example: Use navigation arrows in Customer Card');
  console.log('   Wait 2 seconds after navigating\n');

  console.log('5️⃣  Apply a FILTER on a list page');
  console.log('   Example: Open Customer List (Page 22), apply name filter');
  console.log('   Wait 2 seconds after filtering\n');

  console.log('6️⃣  CREATE a new record');
  console.log('   Example: Click "New" on Customer List');
  console.log('   Wait 2 seconds after creating\n');

  console.log('7️⃣  SELECT a row in a list');
  console.log('   Example: Click a customer row in Customer List');
  console.log('   Wait 2 seconds after selecting\n');

  console.log('8️⃣  DRILLDOWN on a field');
  console.log('   Example: Click "Balance (LCY)" field to see ledger entries');
  console.log('   Wait 2 seconds after clicking\n');

  console.log('9️⃣  TOGGLE a FastTab');
  console.log('   Example: Expand/collapse "Communication" FastTab');
  console.log('   Wait 2 seconds after toggling\n');

  console.log('🔟 DELETE with confirmation dialog');
  console.log('   Example: Delete a record and confirm in dialog');
  console.log('   Wait 2 seconds after confirming\n');

  console.log('1️⃣1️⃣  EDIT SUBPAGE (Sales Order)');
  console.log('   Example: Open Sales Order (Page 43), edit Sales Lines');
  console.log('   Wait 2 seconds after editing\n');

  console.log('════════════════════════════════════════════════════════════');
  console.log('⏰ Press ENTER to stop capture, or wait up to 5 minutes');
  console.log('   The script will auto-save captures every 30 seconds');
  console.log('════════════════════════════════════════════════════════════\n');

  // Auto-save every 30 seconds
  const saveInterval = setInterval(async () => {
    await saveCaptures(wsMessages);
  }, 30000);

  // Wait for user to press Enter or timeout
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const waitForEnter = new Promise((resolve) => {
    rl.on('line', () => {
      console.log('\n✋ User stopped capture');
      resolve('user');
    });
  });

  const waitForTimeout = new Promise((resolve) => {
    setTimeout(() => {
      console.log('\n⏱️ Time limit reached');
      resolve('timeout');
    }, 5 * 60 * 1000);
  });

  // Wait for either Enter key or timeout
  await Promise.race([waitForEnter, waitForTimeout]);

  rl.close();
  clearInterval(saveInterval);

  // Final save
  console.log('Saving final captures...');
  await saveCaptures(wsMessages);

  console.log('\n✅ Capture complete! Closing browser...');
  await browser.close();

  console.log('\n📊 Capture Summary:');
  console.log(`   Total WebSocket connections: ${wsMessages.size}`);
  let totalMessages = 0;
  wsMessages.forEach(messages => totalMessages += messages.length);
  console.log(`   Total messages captured: ${totalMessages}`);
  console.log(`\n📁 Captures saved to: ${OUTPUT_DIR}`);
  console.log('\nNext steps:');
  console.log('  1. Review JSON files in captures directory');
  console.log('  2. Analyze interaction patterns');
  console.log('  3. Implement MCP tools based on findings');
}

async function saveCaptures(wsMessages) {
  let savedCount = 0;

  for (const [requestId, messages] of wsMessages.entries()) {
    if (messages.length === 0) continue;

    const filename = path.join(OUTPUT_DIR, `capture-${Date.now()}-${requestId.slice(0, 8)}.json`);

    // Group messages by interaction
    const interactions = [];
    let currentGroup = [];

    for (const msg of messages) {
      if (msg.direction === 'sent' &&
          msg.payload.arguments &&
          msg.payload.arguments[0] &&
          msg.payload.arguments[0].interactionName) {
        if (currentGroup.length > 0) {
          interactions.push(currentGroup);
        }
        currentGroup = [msg];
      } else {
        currentGroup.push(msg);
      }
    }

    if (currentGroup.length > 0) {
      interactions.push(currentGroup);
    }

    await fs.writeFile(
      filename,
      JSON.stringify({
        capturedAt: new Date().toISOString(),
        requestId,
        totalMessages: messages.length,
        interactionCount: interactions.length,
        interactions,
        rawMessages: messages,
      }, null, 2)
    );

    savedCount++;
  }

  if (savedCount > 0) {
    console.log(`💾 Saved ${savedCount} capture files`);
  }
}

main().catch(console.error);
