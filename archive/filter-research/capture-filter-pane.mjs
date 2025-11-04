/**
 * Capture Filter Pane Interactions
 *
 * Based on proven capture-all-traffic.mjs pattern using Playwright.
 * Captures WebSocket + HTTP traffic while using the filter pane.
 *
 * Manual Steps:
 * 1. Script opens Customers page and starts capturing
 * 2. You manually:
 *    - Press Shift+F3 (open filter pane)
 *    - Click "Add filter"
 *    - Type "Name" in the picker
 *    - Select "Name" from the list
 *    - Type "Adatum" in the filter input
 *    - Press Enter or click away
 * 3. Script saves all captured traffic
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BC_URL = 'http://Cronus27/BC/?tenant=default&page=22'; // Customers page
const USERNAME = 'sshadows';  // NO tenant prefix
const PASSWORD = '1234';

console.log('═══════════════════════════════════════════════════════════');
console.log('  Filter Pane Interaction Capture');
console.log('  Target: Customers List (Page 22)');
console.log('═══════════════════════════════════════════════════════════\n');

function maybeParseJSON(text) {
  if (typeof text !== 'string') return { ok: false };
  const t = text.trim();
  if (!t || (!t.startsWith('{') && !t.startsWith('['))) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false };
  }
}

function nowISO() {
  return new Date().toISOString();
}

async function captureFilterPaneInteractions() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
  });

  const context = await browser.newContext({
    viewport: null,
  });

  const page = await context.newPage();
  const cdpSession = await context.newCDPSession(page);

  const socketMeta = new Map();
  const wsMessages = [];
  const httpMessages = [];

  await cdpSession.send('Network.enable');

  // ============================================================
  // WebSocket Capture
  // ============================================================

  cdpSession.on('Network.webSocketCreated', ({ requestId, url }) => {
    socketMeta.set(requestId, { url, createdAt: Date.now() });
    console.log(`[WS] Created: ${url}`);
  });

  cdpSession.on('Network.webSocketClosed', ({ requestId }) => {
    const meta = socketMeta.get(requestId);
    console.log(`[WS] Closed: ${meta?.url || requestId}`);
  });

  function recordWsFrame(direction, params) {
    const { requestId, response } = params;
    const { opcode, payloadData, mask } = response || {};
    const meta = socketMeta.get(requestId);

    const record = {
      source: 'websocket',
      direction,
      timestamp: Date.now(),
      iso: nowISO(),
      url: meta?.url,
      opcode,
      masked: Boolean(mask),
      payloadText: (opcode === 1 && typeof payloadData === 'string') ? payloadData : null,
    };

    const parsed = maybeParseJSON(record.payloadText);
    if (parsed.ok) record.payload = parsed.value;

    wsMessages.push(record);

    if (parsed.ok && typeof parsed.value === 'object') {
      const method = parsed.value.method || (parsed.value.result ? 'response' : 'unknown');
      const arrow = direction === 'sent' ? '→' : '←';
      console.log(`[${arrow}] WS ${method}`);
    }
  }

  cdpSession.on('Network.webSocketFrameReceived', (params) => {
    try {
      recordWsFrame('received', params);
    } catch (err) {
      console.error('[WS] Error in webSocketFrameReceived:', err);
    }
  });

  cdpSession.on('Network.webSocketFrameSent', (params) => {
    try {
      recordWsFrame('sent', params);
    } catch (err) {
      console.error('[WS] Error in webSocketFrameSent:', err);
    }
  });

  // ============================================================
  // CRITICAL: Playwright WebSocket Listener for iframes
  // ============================================================

  page.on('websocket', (ws) => {
    console.log(`[WS] Playwright captured: ${ws.url()}`);

    ws.on('framesent', (event) => {
      const text = event.payload;
      const parsed = maybeParseJSON(text);
      const record = {
        source: 'websocket-playwright',
        direction: 'sent',
        timestamp: Date.now(),
        iso: nowISO(),
        url: ws.url(),
        opcode: 1,
        masked: true,
        payloadText: text,
      };
      if (parsed.ok) record.payload = parsed.value;
      wsMessages.push(record);

      if (parsed.ok && typeof parsed.value === 'object') {
        const method = parsed.value.method || 'unknown';
        console.log(`[→] WS ${method}`);
      }
    });

    ws.on('framereceived', (event) => {
      const text = event.payload;
      const parsed = maybeParseJSON(text);
      const record = {
        source: 'websocket-playwright',
        direction: 'received',
        timestamp: Date.now(),
        iso: nowISO(),
        url: ws.url(),
        opcode: 1,
        masked: false,
        payloadText: text,
      };
      if (parsed.ok) record.payload = parsed.value;
      wsMessages.push(record);

      if (parsed.ok && typeof parsed.value === 'object') {
        const method = parsed.value.method || (parsed.value.result ? 'response' : 'unknown');
        console.log(`[←] WS ${method}`);
      }
    });
  });

  // ============================================================
  // HTTP Capture (BC-related POST/PUT/PATCH)
  // ============================================================

  page.on('request', (request) => {
    const url = request.url();
    const method = request.method();
    if (url.includes('/BC/') && ['POST', 'PUT', 'PATCH'].includes(method)) {
      httpMessages.push({
        type: 'request',
        timestamp: nowISO(),
        method,
        url,
        headers: request.headers(),
        postData: request.postData(),
      });
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    const method = response.request().method();
    if (url.includes('/BC/') && ['POST', 'PUT', 'PATCH'].includes(method)) {
      try {
        const body = await response.text();
        httpMessages.push({
          type: 'response',
          timestamp: nowISO(),
          status: response.status(),
          url,
          headers: response.headers(),
          body: body.substring(0, 5000), // Limit size
        });
      } catch (err) {
        console.error('[HTTP] Error reading response:', err);
      }
    }
  });

  try {
    console.log('[1/4] Navigating to BC login page...');
    await page.goto(BC_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Check if we need to login
    const needsLogin = await page.locator('input[name="UserName"]').count() > 0;

    if (needsLogin) {
      console.log('[2/4] Logging in...');
      await page.fill('input[name="UserName"]', USERNAME);
      await page.fill('input[name="Password"]', PASSWORD);
      await page.click('button[type="submit"]');

      // Wait for page to load
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      console.log('✓ Logged in\n');
    } else {
      console.log('[2/4] Already logged in\n');
    }

    console.log('[3/4] Waiting for Customers page to load...');

    // Wait for the page to be ready
    await new Promise(r => setTimeout(r, 5000));

    console.log('✓ Page loaded\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MANUAL STEPS - DO THESE NOW:');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('1. Press Shift+F3 to open the Filter Pane');
    console.log('2. Click "Add filter" (or similar button)');
    console.log('3. Type "Name" in the picker/search');
    console.log('4. Select "Name" from the dropdown/list');
    console.log('5. Type "Adatum" in the filter input that appears');
    console.log('6. Press Enter or click away to apply the filter');
    console.log('7. Observe the filtered results\n');
    console.log('When done, press ENTER in this terminal to save and exit.\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Keep the page open for manual interaction
    await new Promise((resolve) => {
      process.stdin.once('data', () => {
        console.log('\n\n[4/4] Saving captured data...');
        resolve();
      });
    });

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    // Save all captured data
    const outputData = {
      captureTimestamp: nowISO(),
      url: BC_URL,
      username: USERNAME,
      description: 'Filter pane interactions: Shift+F3, Add filter, type Name, select, type Adatum',
      websocketMessages: wsMessages,
      httpRequests: httpMessages,
      stats: {
        totalWebSocketMessages: wsMessages.length,
        sentMessages: wsMessages.filter(m => m.direction === 'sent').length,
        receivedMessages: wsMessages.filter(m => m.direction === 'received').length,
        httpRequests: httpMessages.length,
      },
    };

    writeFileSync('filter-pane-capture.json', JSON.stringify(outputData, null, 2));

    console.log('\n✓ Saved to: filter-pane-capture.json');
    console.log('\nCapture Statistics:');
    console.log(`  WebSocket messages: ${outputData.stats.totalWebSocketMessages}`);
    console.log(`    - Sent: ${outputData.stats.sentMessages}`);
    console.log(`    - Received: ${outputData.stats.receivedMessages}`);
    console.log(`  HTTP requests: ${outputData.stats.httpRequests}\n`);

    await browser.close();
  }
}

captureFilterPaneInteractions().catch(console.error);
